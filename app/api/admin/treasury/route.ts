import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  PAYMENT_METHODS,
  TREASURY_ACCOUNT_TYPES,
  supplierJobNextStatuses,
  type TreasuryAccountTypeValue,
} from "@/lib/admin-types";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { withIdempotency } from "@/lib/server/idempotency";
import { movementSourceSnapshot, parseMovementSourceSnapshot } from "@/lib/server/finance-snapshots";
import { dayKeyOf, dayStart, isValidDayKey, shiftDayKey } from "@/lib/server/notifications";
import { MAX_SOURCE_LABEL, resolveSourceLabels } from "@/lib/server/treasury-labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tesorería por cuentas (issue #27).
 *
 * - `GET` devuelve las cuentas con su **saldo derivado**, los movimientos del
 *   período pedido (`from`/`to`, días de Asunción) y los KPIs por tipo. El saldo
 *   nunca se guarda: es `openingBalance` + entradas − salidas (± transferencias),
 *   calculado sobre los movimientos registrados (no es saldo bancario real).
 * - `POST` crea una cuenta (`kind: "account"`), un movimiento manual
 *   (`kind: "movement"`, entrada/salida/transferencia) o registra el pago o
 *   anticipo de un trabajo de proveedor (`kind: "supplier-payment"`), que
 *   descuenta del saldo y actualiza el anticipo del trabajo.
 * - `PATCH` edita una cuenta (`kind: "account"`), incluida su baja lógica.
 *
 * Idempotencia y snapshots (issue #20): cada mutación pasa por
 * `withIdempotency` con su `scope` —repetir la misma clave devuelve la misma
 * respuesta y no duplica cuentas, movimientos, pagos ni anticipos— y todo
 * movimiento nacido de un hecho real guarda su `sourceSnapshot` (etiqueta,
 * monto y referencia del momento). La lista prefiere ese snapshot y solo cae a
 * la fuente viva en los movimientos anteriores a la migración.
 *
 * Todo se filtra por `organizationId`, exige `finance.write` (VIEWER solo lee),
 * queda auditado una sola vez por operación y no cruza datos entre empresas.
 * Una cuenta de otra empresa responde 404.
 */

const MAX_AMOUNT = 99_000_000_000;
const MAX_NAME = 120;
const MAX_BANK = 120;
const MAX_NOTES = 1000;
const MAX_RECEIPT = 120;
const MAX_SORT_ORDER = 9_999;

const accountSelect = { id: true, name: true, type: true } as const;
const movementInclude = { account: { select: accountSelect }, counterAccount: { select: accountSelect } } as const;

/** Campos que se auditan al crear o editar una cuenta. */
const ACCOUNT_AUDIT_FIELDS = ["name", "type", "bank", "currency", "openingBalance", "sortOrder", "active"] as const;
/** Campos que se auditan al crear un movimiento. */
const MOVEMENT_AUDIT_FIELDS = [
  "direction",
  "amount",
  "occurredAt",
  "origin",
  "sourceId",
  "accountId",
  "counterAccountId",
  "notes",
] as const;

function isAccountType(value: unknown): value is TreasuryAccountTypeValue {
  return typeof value === "string" && (TREASURY_ACCOUNT_TYPES as readonly string[]).includes(value);
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

/** Día de Asunción (`YYYY-MM-DD`) pedido en el body; `null` si viene inválido. */
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

/** Primera cuenta activa de la empresa: la cuenta por defecto de un movimiento. */
async function firstActiveAccount(tx: Prisma.TransactionClient, organizationId: string) {
  return tx.treasuryAccount.findFirst({
    where: { organizationId, active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: accountSelect,
  });
}

/** Cuenta de la empresa pedida en el body; `undefined` si no vino. */
async function requestedAccount(tx: Prisma.TransactionClient, organizationId: string, raw: unknown) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;
  return tx.treasuryAccount.findFirst({
    where: { id: raw, organizationId },
    select: accountSelect,
  });
}

/**
 * Movimientos de tesorería del período con su cuenta y su hecho de origen: la
 * etiqueta viva (`resolveSourceLabels`) es el respaldo de los movimientos
 * anteriores a los snapshots (issue #20).
 */

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const range = dayRange(new URL(request.url).searchParams);
  if (!range) return jsonError("El período tiene que estar en días válidos (AAAA-MM-DD).", 400);

  const [accounts, movements, grouped, transfersIn] = await Promise.all([
    db.treasuryAccount.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.treasuryMovement.findMany({
      where: {
        organizationId,
        ...(range.from || range.to
          ? { occurredAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) } }
          : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: 200,
      include: movementInclude,
    }),
    // Saldo por cuenta sobre TODOS los movimientos (no solo el período pedido):
    // el disponible es de hoy, la lista sí es del período.
    db.treasuryMovement.groupBy({
      by: ["accountId", "direction"],
      where: { organizationId },
      _sum: { amount: true },
    }),
    db.treasuryMovement.groupBy({
      by: ["counterAccountId"],
      where: { organizationId, direction: "TRANSFER", counterAccountId: { not: null } },
      _sum: { amount: true },
    }),
  ]);

  const liveLabels = await resolveSourceLabels(organizationId, movements);

  /** Saldo derivado: saldo inicial + entradas − salidas ± transferencias. */
  function balanceOf(accountId: string): number {
    let balance = 0;
    for (const row of grouped) {
      if (row.accountId !== accountId) continue;
      const amount = row._sum.amount ?? 0;
      balance += row.direction === "IN" ? amount : -amount;
    }
    for (const row of transfersIn) {
      if (row.counterAccountId === accountId) balance += row._sum.amount ?? 0;
    }
    return balance;
  }

  const accountRows = accounts.map((account) => ({
    ...account,
    balance: account.openingBalance + balanceOf(account.id),
  }));

  const summary = accountRows.reduce(
    (totals, account) => {
      totals.total += account.balance;
      if (account.type === "CASH") totals.cash += account.balance;
      else if (account.type === "BANK") totals.bank += account.balance;
      else if (account.type === "CHEQUE") totals.cheque += account.balance;
      else totals.other += account.balance;
      totals.accounts += 1;
      if (account.active) totals.activeAccounts += 1;
      return totals;
    },
    { cash: 0, bank: 0, cheque: 0, other: 0, total: 0, accounts: 0, activeAccounts: 0 },
  );

  return Response.json({
    accounts: accountRows,
    summary,
    movements: movements.map((movement) => {
      // La etiqueta congelada del hecho manda; los movimientos viejos caen a la
      // fuente viva (issue #20).
      const snapshot = parseMovementSourceSnapshot(movement.sourceSnapshot);
      const live = movement.sourceId ? liveLabels.get(`${movement.origin}:${movement.sourceId}`) : null;
      const label = snapshot?.label ?? live ?? null;
      return {
        id: movement.id,
        direction: movement.direction,
        amount: movement.amount,
        occurredAt: movement.occurredAt,
        origin: movement.origin,
        sourceId: movement.sourceId,
        notes: movement.notes,
        createdByName: movement.createdByName,
        createdAt: movement.createdAt,
        account: movement.account,
        counterAccount: movement.counterAccount,
        sourceLabel: label ? label.slice(0, MAX_SOURCE_LABEL) : null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  if (kind !== "account" && kind !== "movement" && kind !== "supplier-payment") {
    return jsonError("Unknown treasury entry.", 400);
  }

  return withIdempotency(
    { request, organizationId, scope: `treasury:POST:${kind}`, body },
    async (tx) => {
      // ── Alta de cuenta ────────────────────────────────────────────────────────
      if (kind === "account") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (name.length < 2) return jsonError("El nombre de la cuenta es obligatorio.", 400);
        if (body.type !== undefined && !isAccountType(body.type)) {
          return jsonError("El tipo de cuenta es CASH, BANK, CHEQUE u OTHER.", 400);
        }
        const type: TreasuryAccountTypeValue = isAccountType(body.type) ? body.type : "CASH";
        const openingBalance = body.openingBalance === undefined ? 0 : toInteger(body.openingBalance, 0, MAX_AMOUNT);
        if (openingBalance === null) return jsonError("El saldo inicial tiene que ser un monto en guaraníes (hasta 99.000.000.000).", 400);
        const sortOrder = body.sortOrder === undefined ? 0 : toInteger(body.sortOrder, 0, MAX_SORT_ORDER);
        if (sortOrder === null) return jsonError(`El orden tiene que ser un número entre 0 y ${MAX_SORT_ORDER}.`, 400);
        const bank = type === "BANK" ? (optionalText(body.bank, MAX_BANK) ?? null) : null;

        const duplicate = await tx.treasuryAccount.findFirst({ where: { organizationId, name }, select: { id: true } });
        if (duplicate) return jsonError(`Ya existe una cuenta llamada «${name}».`, 409);

        const account = await tx.treasuryAccount.create({
          data: {
            id: randomUUID(),
            organizationId,
            name: name.slice(0, MAX_NAME),
            type,
            bank,
            currency: "PYG",
            openingBalance,
            sortOrder,
            active: body.active === undefined ? true : body.active === true,
          },
        });
        return {
          status: 201,
          body: { account },
          afterCommit: () =>
            recordAudit({
              context: auth.context,
              action: "create",
              entity: "TreasuryAccount",
              entityId: account.id,
              summary: `Creó la cuenta de tesorería «${account.name}»`,
              detail: { fields: auditPick(account, ACCOUNT_AUDIT_FIELDS) },
            }),
        };
      }

      // ── Movimiento manual: entrada, salida o transferencia ────────────────────
      if (kind === "movement") {
        const direction = body.direction === "IN" ? "IN" : body.direction === "OUT" ? "OUT" : body.direction === "TRANSFER" ? "TRANSFER" : null;
        if (!direction) return jsonError("Elegí el tipo de movimiento: entrada, salida o transferencia.", 400);
        const amount = toInteger(body.amount, 1, MAX_AMOUNT);
        if (amount === null) return jsonError("El monto tiene que ser un entero en guaraníes (hasta 99.000.000.000).", 400);

        const account = await requestedAccount(tx, organizationId, body.accountId);
        if (account === undefined) return jsonError("Elegí la cuenta del movimiento.", 400);
        if (!account) return jsonError("La cuenta no existe en esta empresa.", 404);

        let counterAccount: { id: string; name: string; type: string } | null = null;
        if (direction === "TRANSFER") {
          const requested = await requestedAccount(tx, organizationId, body.counterAccountId);
          if (requested === undefined) return jsonError("Elegí la cuenta destino de la transferencia.", 400);
          if (!requested) return jsonError("La cuenta destino no existe en esta empresa.", 404);
          if (requested.id === account.id) return jsonError("La cuenta destino tiene que ser distinta de la cuenta origen.", 400);
          counterAccount = requested;
        }

        const dayKey = readDayKey(body.date);
        if (dayKey === null) return jsonError("La fecha del movimiento tiene que ser un día válido (AAAA-MM-DD).", 400);
        const occurredAt = dayStart(dayKey ?? dayKeyOf(new Date()));
        const notes = optionalText(body.notes, MAX_NOTES);

        const movement = await tx.treasuryMovement.create({
          data: {
            id: randomUUID(),
            organizationId,
            accountId: account.id,
            counterAccountId: counterAccount?.id ?? null,
            direction,
            amount,
            occurredAt,
            origin: "adjustment",
            notes: typeof notes === "string" ? notes : null,
            createdById: user.id,
            createdByName: user.name,
            createdByEmail: user.email,
          },
          include: movementInclude,
        });
        const action = direction === "TRANSFER" ? "Registró la transferencia" : direction === "IN" ? "Registró la entrada" : "Registró la salida";
        const route = counterAccount ? `«${account.name}» → «${counterAccount.name}»` : `«${account.name}»`;
        return {
          status: 201,
          body: { movement },
          afterCommit: () =>
            recordAudit({
              context: auth.context,
              action: "create",
              entity: "TreasuryMovement",
              entityId: movement.id,
              summary: `${action} de tesorería ${route}`,
              detail: { fields: auditPick(movement, MOVEMENT_AUDIT_FIELDS) },
            }),
        };
      }

      // ── Pago o anticipo a un trabajo de proveedor ─────────────────────────────
      const jobId = typeof body.jobId === "string" ? body.jobId : "";
      if (!jobId) return jsonError("Elegí el trabajo del proveedor.", 400);
      const job = await tx.supplierJob.findFirst({
        where: { id: jobId, organizationId },
        include: { supplier: { select: { id: true, name: true } } },
      });
      if (!job) return jsonError("Trabajo de proveedor no encontrado.", 404);
      if (job.status === "PAID" || job.status === "CANCELLED") {
        return jsonError("El trabajo ya está cerrado: no admite pagos.", 409);
      }

      const balance = Math.max(0, job.total - job.advance);
      if (balance <= 0) return jsonError("El trabajo no tiene saldo pendiente.", 409);
      const amount = toInteger(body.amount, 1, MAX_AMOUNT);
      if (amount === null) return jsonError("El monto tiene que ser un entero en guaraníes (hasta 99.000.000.000).", 400);
      if (amount > balance) return jsonError(`El monto no puede superar el saldo pendiente (${balance} Gs.).`, 400);

      const requested = await requestedAccount(tx, organizationId, body.accountId);
      if (requested === null) return jsonError("La cuenta no existe en esta empresa.", 404);
      const account = requested ?? (await firstActiveAccount(tx, organizationId));
      if (!account) return jsonError("Creá una cuenta de tesorería antes de registrar el pago.", 400);

      const dayKey = readDayKey(body.date);
      if (dayKey === null) return jsonError("La fecha del pago tiene que ser un día válido (AAAA-MM-DD).", 400);
      const occurredAt = dayStart(dayKey ?? dayKeyOf(new Date()));
      const method = optionalText(body.method, 60);
      if (method && !(PAYMENT_METHODS as readonly string[]).includes(method)) return jsonError("Método de pago desconocido.", 400);
      const receipt = optionalText(body.receipt, MAX_RECEIPT);
      const notes = optionalText(body.notes, MAX_NOTES);

      // Estado del trabajo: solo se avanza a un estado válido de la máquina; si el
      // pago no habilita una transición, el trabajo queda como está (se gestiona en
      // Proveedores) y el anticipo igual queda registrado.
      const nextAdvance = job.advance + amount;
      const nextStatuses = supplierJobNextStatuses({ total: job.total, advance: nextAdvance, status: job.status });
      const status = nextAdvance >= job.total && nextStatuses.includes("PAID")
        ? "PAID"
        : nextStatuses.includes("ADVANCE_PAID")
          ? "ADVANCE_PAID"
          : job.status;

      const movement = await tx.treasuryMovement.create({
        data: {
          id: randomUUID(),
          organizationId,
          accountId: account.id,
          direction: "OUT",
          amount,
          occurredAt,
          origin: "supplier_job",
          sourceId: job.id,
          // Snapshot del trabajo pagado (issue #20): proveedor y descripción del
          // momento, para que un cambio posterior no reescriba la historia.
          sourceSnapshot: movementSourceSnapshot({
            kind: "supplier_job",
            label: `${job.supplier.name} · ${job.description}`,
            amount,
            ref: (typeof receipt === "string" ? receipt : null) ?? method ?? null,
          }),
          notes: typeof notes === "string" ? notes : null,
          createdById: user.id,
          createdByName: user.name,
          createdByEmail: user.email,
        },
        include: movementInclude,
      });
      const updatedJob = await tx.supplierJob.update({
        where: { id: job.id },
        data: {
          advance: nextAdvance,
          ...(status !== job.status ? { status, ...(status === "PAID" ? { paidAt: occurredAt } : {}) } : {}),
          ...(method ? { paymentMethod: method } : {}),
          ...(typeof receipt === "string" ? { receipt } : {}),
        },
        select: { id: true, status: true, advance: true, total: true, paidAt: true },
      });

      return {
        status: 201,
        body: { movement, job: updatedJob },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "create",
            entity: "TreasuryMovement",
            entityId: movement.id,
            summary: `Pagó ${amount} Gs. al proveedor «${job.supplier.name}» desde «${account.name}»`,
            detail: {
              fields: {
                ...auditPick(movement, MOVEMENT_AUDIT_FIELDS),
                jobId: job.id,
                jobDescription: job.description,
                jobStatus: updatedJob.status,
                jobAdvance: updatedJob.advance,
              },
            },
          }),
      };
    },
  );
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  if (body.kind !== "account") return jsonError("Unknown treasury entry.", 400);

  const accountId = typeof body.accountId === "string" ? body.accountId : "";
  if (!accountId) return jsonError("Falta la cuenta.", 400);

  return withIdempotency({ request, organizationId, scope: "treasury:PATCH:account", body }, async (tx) => {
    const account = await tx.treasuryAccount.findFirst({ where: { id: accountId, organizationId } });
    if (!account) return jsonError("La cuenta no existe en esta empresa.", 404);

    const name = body.name === undefined ? undefined : typeof body.name === "string" ? body.name.trim() : "";
    if (name !== undefined && name.length < 2) return jsonError("El nombre de la cuenta es obligatorio.", 400);
    if (body.type !== undefined && !isAccountType(body.type)) {
      return jsonError("El tipo de cuenta es CASH, BANK, CHEQUE u OTHER.", 400);
    }
    const nextType = isAccountType(body.type) ? body.type : account.type;
    const openingBalance = body.openingBalance === undefined ? account.openingBalance : toInteger(body.openingBalance, 0, MAX_AMOUNT);
    if (openingBalance === null) return jsonError("El saldo inicial tiene que ser un monto en guaraníes (hasta 99.000.000.000).", 400);
    const sortOrder = body.sortOrder === undefined ? account.sortOrder : toInteger(body.sortOrder, 0, MAX_SORT_ORDER);
    if (sortOrder === null) return jsonError(`El orden tiene que ser un número entre 0 y ${MAX_SORT_ORDER}.`, 400);
    if (body.active !== undefined && typeof body.active !== "boolean") return jsonError("El estado activo tiene que ser verdadero o falso.", 400);

    if (name && name !== account.name) {
      const duplicate = await tx.treasuryAccount.findFirst({
        where: { organizationId, name, id: { not: account.id } },
        select: { id: true },
      });
      if (duplicate) return jsonError(`Ya existe una cuenta llamada «${name}».`, 409);
    }
    const bank = nextType === "BANK"
      ? body.bank === undefined
        ? account.bank
        : optionalText(body.bank, MAX_BANK) ?? null
      : null;

    const updated = await tx.treasuryAccount.update({
      where: { id: account.id },
      data: {
        ...(name !== undefined ? { name: name.slice(0, MAX_NAME) } : {}),
        ...(body.type !== undefined ? { type: nextType } : {}),
        ...(body.type !== undefined || body.bank !== undefined ? { bank } : {}),
        ...(body.openingBalance !== undefined ? { openingBalance } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder } : {}),
        ...(body.active !== undefined ? { active: body.active as boolean } : {}),
      },
    });
    const changes = auditChanges(account, updated, ACCOUNT_AUDIT_FIELDS);
    return {
      status: 200,
      body: { account: updated },
      ...(changes
        ? {
            afterCommit: () =>
              recordAudit({
                context: auth.context,
                action: "active" in changes ? "status" : "update",
                entity: "TreasuryAccount",
                entityId: account.id,
                summary: "active" in changes
                  ? `${updated.active ? "Activó" : "Desactivó"} la cuenta de tesorería «${updated.name}»`
                  : `Editó la cuenta de tesorería «${updated.name}»`,
                detail: { changes },
              }),
          }
        : {}),
    };
  });
}
