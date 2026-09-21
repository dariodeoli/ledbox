import { randomUUID } from "node:crypto";
import {
  EXPENSE_CATEGORIES,
  PAYMENT_METHODS,
  type ExpenseCategoryValue,
} from "@/lib/admin-types";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { dayKeyOf, dayStart, isValidDayKey, shiftDayKey } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Gastos de la empresa (issue #27).
 *
 * - `GET` lista los gastos del período (`from`/`to`, días de Asunción) con su
 *   cuenta, su proyecto y su proveedor, y devuelve además los catálogos del
 *   selector: proyectos (eventos) y proveedores.
 * - `POST` carga un gasto y su **movimiento de egreso** en una sola transacción:
 *   el gasto siempre sale de una cuenta real (la pedida o la primera activa).
 * - `PATCH` edita el gasto (por ejemplo, asignarle el proyecto que quedó "A
 *   definir" desde la fila) y mantiene sincronizado su movimiento cuando cambia
 *   el monto, la cuenta o la fecha.
 *
 * Todo se filtra por `organizationId`, exige `finance.write` (VIEWER solo lee),
 * queda auditado y no cruza datos entre empresas.
 */

const MAX_AMOUNT = 99_000_000_000;
const MAX_DESCRIPTION = 200;
const MAX_METHOD = 60;
const MAX_RECEIPT = 120;
const MAX_NOTES = 1000;
const MAX_ROWS = 300;

const accountSelect = { id: true, name: true, type: true } as const;
const expenseInclude = {
  account: { select: accountSelect },
  event: { select: { id: true, name: true, startsAt: true, status: true } },
  supplier: { select: { id: true, name: true } },
} as const;

/** Campos que se auditan al crear o editar un gasto. */
const EXPENSE_AUDIT_FIELDS = [
  "date",
  "amount",
  "category",
  "description",
  "accountId",
  "eventId",
  "supplierId",
  "method",
  "receipt",
  "notes",
] as const;

function isCategory(value: unknown): value is ExpenseCategoryValue {
  return typeof value === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

/** Entero válido dentro de un rango; `null` si no lo es. */
function toInteger(value: unknown, min: number, max: number): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/** Texto opcional acotado: `undefined` no toca el campo, vacío lo limpia. */
function optionalText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Día de Asunción del gasto; `null` si el valor vino inválido. */
function readDayKey(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;
  const key = raw.trim().slice(0, 10);
  return isValidDayKey(key) ? key : null;
}

/** Rango de días de Asunción del filtro `from`/`to` (ambos inclusive). */
function dayRange(params: URLSearchParams): { from?: Date; to?: Date } | null {
  const from = (params.get("from") ?? "").trim();
  const to = (params.get("to") ?? "").trim();
  const range: { from?: Date; to?: Date } = {};
  if (from) {
    if (!isValidDayKey(from)) return null;
    range.from = dayStart(from);
  }
  if (to) {
    if (!isValidDayKey(to)) return null;
    range.to = dayStart(shiftDayKey(to, 1));
  }
  return range;
}

/** Primera cuenta activa de la empresa: la cuenta por defecto de un gasto. */
async function firstActiveAccount(organizationId: string) {
  return db.treasuryAccount.findFirst({
    where: { organizationId, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: accountSelect,
  });
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const range = dayRange(new URL(request.url).searchParams);
  if (!range) return jsonError("El período tiene que estar en días válidos (AAAA-MM-DD).", 400);

  const [expenses, projects, suppliers] = await Promise.all([
    db.expense.findMany({
      where: {
        organizationId,
        ...(range.from || range.to
          ? { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) } }
          : {}),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: MAX_ROWS,
      include: expenseInclude,
    }),
    db.event.findMany({
      where: { organizationId },
      orderBy: [{ startsAt: "desc" }],
      take: 200,
      select: { id: true, name: true, startsAt: true, client: { select: { id: true, name: true, company: true } } },
    }),
    db.supplier.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      take: 200,
      select: { id: true, name: true, company: true, phone: true, email: true, category: true, paymentTerms: true, notes: true, active: true },
    }),
  ]);

  return Response.json({ expenses, projects, suppliers });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length < 2) return jsonError("La descripción del gasto es obligatoria.", 400);
  const amount = toInteger(body.amount, 1, MAX_AMOUNT);
  if (amount === null) return jsonError("El monto tiene que ser un entero en guaraníes (hasta 99.000.000.000).", 400);
  if (!isCategory(body.category)) return jsonError("Elegí la categoría del gasto.", 400);
  const category = body.category;

  const requestedAccountId = typeof body.accountId === "string" && body.accountId ? body.accountId : "";
  const account = requestedAccountId
    ? await db.treasuryAccount.findFirst({ where: { id: requestedAccountId, organizationId }, select: accountSelect })
    : await firstActiveAccount(organizationId);
  if (!account) {
    return jsonError(
      requestedAccountId ? "La cuenta no existe en esta empresa." : "Creá una cuenta de tesorería antes de cargar el gasto.",
      requestedAccountId ? 404 : 400,
    );
  }

  const dayKey = readDayKey(body.date);
  if (dayKey === null) return jsonError("La fecha del gasto tiene que ser un día válido (AAAA-MM-DD).", 400);
  const date = dayStart(dayKey ?? dayKeyOf(new Date()));

  const eventId = typeof body.eventId === "string" && body.eventId ? body.eventId : "";
  if (eventId) {
    const event = await db.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
    if (!event) return jsonError("El proyecto no existe en esta empresa.", 404);
  }
  const supplierId = typeof body.supplierId === "string" && body.supplierId ? body.supplierId : "";
  if (supplierId) {
    const supplier = await db.supplier.findFirst({ where: { id: supplierId, organizationId }, select: { id: true } });
    if (!supplier) return jsonError("El proveedor no existe en esta empresa.", 404);
  }
  const method = optionalText(body.method, MAX_METHOD);
  if (method && !(PAYMENT_METHODS as readonly string[]).includes(method)) return jsonError("Método de pago desconocido.", 400);

  const [expense, movement] = await db.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        id: randomUUID(),
        organizationId,
        accountId: account.id,
        eventId: eventId || null,
        supplierId: supplierId || null,
        date,
        amount,
        category,
        description: description.slice(0, MAX_DESCRIPTION),
        method: typeof method === "string" ? method : null,
        receipt: optionalText(body.receipt, MAX_RECEIPT) ?? null,
        notes: optionalText(body.notes, MAX_NOTES) ?? null,
        createdById: user.id,
        createdByName: user.name,
        createdByEmail: user.email,
      },
      include: expenseInclude,
    });
    // El egreso nace en la misma transacción que el gasto, ya vinculado a su id
    // real: sin movimiento el saldo de la cuenta mentiría.
    const createdMovement = await tx.treasuryMovement.create({
      data: {
        id: randomUUID(),
        organizationId,
        accountId: account.id,
        direction: "OUT",
        amount,
        occurredAt: date,
        origin: "expense",
        sourceId: created.id,
        createdById: user.id,
        createdByName: user.name,
        createdByEmail: user.email,
      },
      select: { id: true },
    });
    return [created, createdMovement] as const;
  });

  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "Expense",
    entityId: expense.id,
    summary: `Cargó el gasto «${expense.description}» desde «${account.name}»`,
    detail: { fields: { ...auditPick(expense, EXPENSE_AUDIT_FIELDS), movementId: movement.id } },
  });
  return Response.json({ expense }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;

  const expenseId = typeof body.expenseId === "string" ? body.expenseId : "";
  if (!expenseId) return jsonError("Falta el gasto.", 400);
  const expense = await db.expense.findFirst({ where: { id: expenseId, organizationId } });
  if (!expense) return jsonError("El gasto no existe en esta empresa.", 404);

  const description = body.description === undefined
    ? undefined
    : typeof body.description === "string"
      ? body.description.trim()
      : "";
  if (description !== undefined && description.length < 2) return jsonError("La descripción del gasto es obligatoria.", 400);
  const amount = body.amount === undefined ? expense.amount : toInteger(body.amount, 1, MAX_AMOUNT);
  if (amount === null) return jsonError("El monto tiene que ser un entero en guaraníes (hasta 99.000.000.000).", 400);
  if (body.category !== undefined && !isCategory(body.category)) return jsonError("Elegí la categoría del gasto.", 400);

  let accountId = expense.accountId;
  if (body.accountId !== undefined) {
    if (typeof body.accountId !== "string" || !body.accountId) return jsonError("Elegí la cuenta del gasto.", 400);
    const account = await db.treasuryAccount.findFirst({ where: { id: body.accountId, organizationId }, select: { id: true } });
    if (!account) return jsonError("La cuenta no existe en esta empresa.", 404);
    accountId = account.id;
  }

  const dayKey = readDayKey(body.date);
  if (dayKey === null) return jsonError("La fecha del gasto tiene que ser un día válido (AAAA-MM-DD).", 400);
  const date = dayKey ? dayStart(dayKey) : expense.date;

  let eventId: string | null = expense.eventId;
  if (body.eventId !== undefined) {
    eventId = typeof body.eventId === "string" && body.eventId ? body.eventId : null;
    if (eventId) {
      const event = await db.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
      if (!event) return jsonError("El proyecto no existe en esta empresa.", 404);
    }
  }
  let supplierId: string | null = expense.supplierId;
  if (body.supplierId !== undefined) {
    supplierId = typeof body.supplierId === "string" && body.supplierId ? body.supplierId : null;
    if (supplierId) {
      const supplier = await db.supplier.findFirst({ where: { id: supplierId, organizationId }, select: { id: true } });
      if (!supplier) return jsonError("El proveedor no existe en esta empresa.", 404);
    }
  }
  const method = optionalText(body.method, MAX_METHOD);
  if (method && !(PAYMENT_METHODS as readonly string[]).includes(method)) return jsonError("Método de pago desconocido.", 400);

  const updated = await db.expense.update({
    where: { id: expense.id },
    data: {
      ...(description !== undefined ? { description: description.slice(0, MAX_DESCRIPTION) } : {}),
      ...(body.amount !== undefined ? { amount } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      accountId,
      eventId,
      supplierId,
      date,
      ...(body.method !== undefined ? { method: typeof method === "string" ? method : null } : {}),
      ...(body.receipt !== undefined ? { receipt: optionalText(body.receipt, MAX_RECEIPT) ?? null } : {}),
      ...(body.notes !== undefined ? { notes: optionalText(body.notes, MAX_NOTES) ?? null } : {}),
    },
    include: expenseInclude,
  });

  // El egreso acompaña al gasto: monto, cuenta y fecha siempre coinciden.
  const movement = await db.treasuryMovement.findFirst({
    where: { organizationId, origin: "expense", sourceId: expense.id },
    select: { id: true },
  });
  if (movement) {
    await db.treasuryMovement.update({
      where: { id: movement.id },
      data: { amount: updated.amount, accountId: updated.accountId, occurredAt: updated.date },
    });
  }

  const changes = auditChanges(expense, updated, EXPENSE_AUDIT_FIELDS);
  if (changes) {
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Expense",
      entityId: expense.id,
      summary: `Editó el gasto «${updated.description}»`,
      detail: { changes },
    });
  }
  return Response.json({ expense: updated });
}
