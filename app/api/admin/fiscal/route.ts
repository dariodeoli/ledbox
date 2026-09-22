import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  fiscalSummaryOf,
  grossToNet,
  invoiceLineSubtotal,
  isInvoiceCondition,
  isInvoiceTaxType,
  taxTotalsOf,
  type InvoiceConditionValue,
  type InvoiceTaxTypeValue,
} from "@/lib/fiscal";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import {
  currentMonthKey,
  FISCAL_FIELDS,
  hasFiscalDetails,
  monthBounds,
  monthOf,
  parseFiscalDetails,
  parseFiscalSummary,
  readMonthKey,
  salesRowsForSummary,
  type FiscalSummarySnapshot,
} from "@/lib/server/fiscal";
import { jsonError, readJson } from "@/lib/server/http";
import { withIdempotency, type IdempotentTx } from "@/lib/server/idempotency";
import { dayKeyOf, dayStart, isValidDayKey } from "@/lib/server/notifications";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Registro fiscal interno (issue #41): facturas de venta, compras del libro de
 * IVA, datos fiscales de la empresa y cierre mensual.
 *
 * **Alcance honesto**: no es la factura electrónica de SIFEN/DNIT (ver
 * `docs/FISCAL-SIFEN.md`); es el registro interno de la empresa, con numeración
 * correlativa sin huecos, IVA 10 %/5 %/exenta y libro de IVA.
 *
 * - `GET ?month=YYYY-MM` devuelve los datos fiscales, las facturas y compras del
 *   mes, el resumen del libro, el período (abierto o cerrado con su snapshot) y
 *   la lista de períodos. Todo filtrado por la empresa activa.
 * - `POST` con `kind`: `profile` (OWNER/ADMIN), `invoice`, `purchase` y
 *   `period-close` (FINANCE/OWNER/ADMIN).
 * - `PATCH` con `kind`: `invoice` (anular o marcar saldada), `purchase`
 *   (editar/borrar con el mes abierto) y `period-reopen` (solo OWNER).
 *
 * Reglas duras:
 * - La numeración la asigna la secuencia atómica de la empresa dentro de la
 *   misma transacción que crea la factura (sin huecos; un rollback la devuelve).
 * - Una factura **nunca se borra**: se anula con motivo y queda la auditoría.
 * - Un mes cerrado bloquea emisión, anulación, saldado y compras (409 claro).
 * - Los montos son enteros PYG calculados con `lib/fiscal.ts` (nunca se confía
 *   en los totales que manda el cliente).
 */

const MAX_AMOUNT = 99_000_000_000;
const MAX_QUANTITY = 10_000;
const MAX_ITEMS = 50;
const MAX_ITEM_NAME = 160;
const MAX_CLIENT_NAME = 160;
const MAX_RUC = 20;
const MAX_TIMBRADO = 30;
const MAX_RECEIPT_NUMBER = 40;
const MAX_CONCEPT = 200;
const MAX_NOTES = 1000;
const MAX_REASON = 300;
const MIN_REASON = 5;
const MAX_MONTHS = 48;

/** Datos que se auditan al emitir una factura. */
const INVOICE_AUDIT_FIELDS = [
  "number",
  "status",
  "condition",
  "clientId",
  "clientName",
  "clientRuc",
  "budgetId",
  "eventId",
  "issuedAt",
  "dueAt",
  "taxable10",
  "iva10",
  "taxable5",
  "iva5",
  "exempt",
  "total",
] as const;

/** Datos que se auditan al registrar o editar una compra. */
const PURCHASE_AUDIT_FIELDS = [
  "supplierId",
  "date",
  "reason",
  "ruc",
  "timbrado",
  "number",
  "concept",
  "taxable10",
  "iva10",
  "taxable5",
  "iva5",
  "exempt",
  "total",
] as const;

const invoiceInclude = {
  items: { orderBy: { id: "asc" } },
  client: { select: { id: true, name: true, company: true } },
  budget: { select: { id: true, title: true, status: true } },
  event: { select: { id: true, name: true } },
} as const;

const purchaseInclude = { supplier: { select: { id: true, name: true } } } as const;

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

/** Período cerrado de un mes de Asunción: la edición del mes se bloquea. */
async function closedPeriod(tx: IdempotentTx, organizationId: string, month: string) {
  return tx.fiscalPeriod.findFirst({
    where: { organizationId, month, status: "CLOSED" },
    select: { month: true },
  });
}

/** Respuesta explicada cuando el mes está cerrado. */
async function guardOpenMonth(tx: IdempotentTx, organizationId: string, month: string): Promise<Response | null> {
  const closed = await closedPeriod(tx, organizationId, month);
  if (!closed) return null;
  return jsonError(`El mes ${month} está cerrado. Reabrilo (solo el propietario) para editar sus comprobantes.`, 409);
}

/** Período abierto o cerrado del mes, tal como viaja al panel. */
function periodPayload(period: {
  id: string;
  month: string;
  status: string;
  summary: unknown;
  closedAt: Date | null;
  closedByName: string | null;
  reopenedAt: Date | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  updatedAt: Date;
}) {
  return {
    id: period.id,
    month: period.month,
    status: period.status,
    summary: parseFiscalSummary(period.summary),
    closedAt: period.closedAt,
    closedByName: period.closedByName,
    reopenedAt: period.reopenedAt,
    reopenedByName: period.reopenedByName,
    reopenReason: period.reopenReason,
    updatedAt: period.updatedAt,
  };
}

/** Resumen vivo del mes: facturas no anuladas + compras registradas. */
async function liveSummary(
  tx: IdempotentTx,
  organizationId: string,
  month: string,
): Promise<FiscalSummarySnapshot> {
  const { start, end } = monthBounds(month);
  const [invoices, purchases, voided] = await Promise.all([
    tx.invoice.findMany({
      where: { organizationId, issuedAt: { gte: start, lt: end }, status: { not: "VOID" } },
      select: { taxable10: true, iva10: true, taxable5: true, iva5: true, exempt: true, total: true },
    }),
    tx.purchaseInvoice.findMany({
      where: { organizationId, date: { gte: start, lt: end } },
      select: { taxable10: true, iva10: true, taxable5: true, iva5: true, exempt: true, total: true },
    }),
    tx.invoice.count({ where: { organizationId, issuedAt: { gte: start, lt: end }, status: "VOID" } }),
  ]);
  const summary = fiscalSummaryOf(invoices, purchases);
  return { ...summary, counts: { sales: invoices.length, purchases: purchases.length, voided } };
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const requested = readMonthKey(new URL(request.url).searchParams.get("month"), currentMonthKey());
  if (!requested) return jsonError("El mes tiene que estar en formato AAAA-MM.", 400);
  const month = requested;
  const { start, end } = monthBounds(month);

  const [organization, invoices, purchases, period, periods] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { fiscalDetails: true } }),
    db.invoice.findMany({
      where: { organizationId, issuedAt: { gte: start, lt: end } },
      orderBy: [{ number: "desc" }],
      take: 500,
      include: invoiceInclude,
    }),
    db.purchaseInvoice.findMany({
      where: { organizationId, date: { gte: start, lt: end } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 500,
      include: purchaseInclude,
    }),
    db.fiscalPeriod.findUnique({ where: { organizationId_month: { organizationId, month } } }),
    db.fiscalPeriod.findMany({
      where: { organizationId },
      orderBy: { month: "desc" },
      take: MAX_MONTHS,
    }),
  ]);

  const summary = fiscalSummaryOf(salesRowsForSummary(invoices), purchases);

  return Response.json({
    profile: parseFiscalDetails(organization?.fiscalDetails),
    month,
    period: period ? periodPayload(period) : null,
    summary: { ...summary, counts: { sales: summary.sales.count, purchases: summary.purchases.count, voided: invoices.filter((invoice) => invoice.status === "VOID").length } },
    invoices,
    purchases,
    periods: periods.map(periodPayload),
  });
}

export async function POST(request: Request) {
  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";

  // ── Datos fiscales de la empresa (OWNER/ADMIN) ────────────────────────────
  if (kind === "profile") {
    const auth = await requireAdminContext("org.manage");
    if (!auth.ok) return auth.response;
    const { organizationId, organization } = auth.context;
    for (const field of FISCAL_FIELDS) {
      const raw = body[field.key];
      if (raw !== undefined && raw !== null && typeof raw !== "string") return jsonError(`El campo ${field.label} debe ser texto.`, 400);
      if (typeof raw === "string" && raw.trim().length > field.max) {
        return jsonError(`${field.label} no puede superar los ${field.max} caracteres.`, 400);
      }
    }
    return withIdempotency({ request, organizationId, scope: "fiscal:POST:profile", body }, async (tx) => {
      const beforeRow = await tx.organization.findUnique({ where: { id: organizationId }, select: { fiscalDetails: true } });
      const before = parseFiscalDetails(beforeRow?.fiscalDetails);
      const after = parseFiscalDetails(body);
      const changes = auditChanges({ ...before }, { ...after }, FISCAL_FIELDS.map((field) => field.key));
      if (!changes) return { status: 200, body: { profile: before, unchanged: true } };
      await tx.organization.update({
        where: { id: organizationId },
        data: { fiscalDetails: hasFiscalDetails(after) ? (after as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
      });
      return {
        status: 200,
        body: { profile: after },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "update",
            entity: "Organization",
            entityId: organizationId,
            summary: `Actualizó los datos fiscales de «${organization.name}»`,
            detail: { changes },
          }),
      };
    });
  }

  // ── Emisión de factura ────────────────────────────────────────────────────
  if (kind === "invoice") {
    const auth = await requireAdminContext("finance.write");
    if (!auth.ok) return auth.response;
    const { organizationId, user } = auth.context;
    return withIdempotency({ request, organizationId, scope: "fiscal:POST:invoice", body }, async (tx) => {
      const issuedKey = readDayKey(body.issuedAt);
      if (issuedKey === null) return jsonError("La fecha de emisión tiene que ser un día válido (AAAA-MM-DD).", 400);
      const issuedAt = dayStart(issuedKey ?? dayKeyOf(new Date()));
      const month = monthOf(issuedAt);
      const closed = await guardOpenMonth(tx, organizationId, month);
      if (closed) return closed;

      const condition: InvoiceConditionValue = isInvoiceCondition(body.condition) ? body.condition : "CASH";
      const dueKey = readDayKey(body.dueAt);
      if (dueKey === null) return jsonError("El vencimiento tiene que ser un día válido (AAAA-MM-DD).", 400);
      if (condition === "CREDIT" && !dueKey) return jsonError("Una factura a crédito necesita fecha de vencimiento.", 400);
      if (dueKey && dayStart(dueKey).getTime() < issuedAt.getTime()) {
        return jsonError("El vencimiento no puede ser anterior a la emisión.", 400);
      }
      const dueAt = condition === "CREDIT" ? dayStart(dueKey as string) : null;

      // Cliente del panel (opcional): de ahí salen la razón social y el RUC por
      // defecto; el receptor se guarda como snapshot y se puede corregir a mano.
      // Al facturar desde un presupuesto se usa el cliente del presupuesto.
      let client: { id: string; name: string; company: string | null; ruc: string | null } | null = null;
      if (body.clientId !== undefined && body.clientId !== null && body.clientId !== "") {
        if (typeof body.clientId !== "string") return jsonError("El cliente no es válido.", 400);
        client = await tx.client.findFirst({
          where: { id: body.clientId, organizationId },
          select: { id: true, name: true, company: true, ruc: true },
        });
        if (!client) return jsonError("El cliente no existe en esta empresa.", 404);
      }
      // Presupuesto (opcional): solo aprobados, y si no llegan ítems se arman
      // desde sus líneas (misma regla que muestra el panel).
      let budget: { id: string; clientId: string; eventId: string | null; title: string; status: string } | null = null;
      if (body.budgetId !== undefined && body.budgetId !== null && body.budgetId !== "") {
        if (typeof body.budgetId !== "string") return jsonError("El presupuesto no es válido.", 400);
        budget = await tx.budget.findFirst({
          where: { id: body.budgetId, organizationId },
          select: { id: true, clientId: true, eventId: true, title: true, status: true },
        });
        if (!budget) return jsonError("El presupuesto no existe en esta empresa.", 404);
        if (budget.status !== "APPROVED") return jsonError("Solo se puede facturar desde un presupuesto aprobado.", 409);
      }

      // Sin cliente explícito, el receptor sale del presupuesto (misma empresa).
      if (!client && budget) {
        client = await tx.client.findFirst({
          where: { id: budget.clientId, organizationId },
          select: { id: true, name: true, company: true, ruc: true },
        });
      }

      const clientName = (optionalText(body.clientName, MAX_CLIENT_NAME) ?? "") ||
        (client ? client.company || client.name : "") ||
        "";
      if (clientName.trim().length < 2) return jsonError("La razón social del receptor es obligatoria.", 400);
      const clientRuc = optionalText(body.clientRuc, MAX_RUC) ?? client?.ruc ?? null;
      const notes = optionalText(body.notes, MAX_NOTES);

      // Líneas: se revalida todo y los importes salen de acá, nunca del cliente.
      const rawItems = Array.isArray(body.items) ? body.items : [];
      type DraftItem = { name: string; quantity: number; unitPrice: number; taxType: InvoiceTaxTypeValue; subtotal: number };
      let items: DraftItem[] = [];
      if (rawItems.length > 0) {
        if (rawItems.length > MAX_ITEMS) return jsonError(`La factura no puede superar los ${MAX_ITEMS} ítems.`, 400);
        for (const raw of rawItems) {
          const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
          if (!item) return jsonError("Hay un ítem con formato inválido.", 400);
          const name = typeof item.name === "string" ? item.name.trim() : "";
          if (name.length < 2) return jsonError("Cada ítem necesita un nombre (mínimo 2 caracteres).", 400);
          const quantity = toInteger(item.quantity, 1, MAX_QUANTITY);
          if (quantity === null) return jsonError(`La cantidad de «${name}» tiene que ser un entero entre 1 y ${MAX_QUANTITY}.`, 400);
          const unitPrice = toInteger(item.unitPrice, 0, MAX_AMOUNT);
          if (unitPrice === null) return jsonError(`El precio unitario de «${name}» tiene que ser un monto en guaraníes (hasta 99.000.000.000).`, 400);
          const taxType: InvoiceTaxTypeValue = isInvoiceTaxType(item.taxType) ? item.taxType : "IVA10";
          const subtotal = invoiceLineSubtotal(quantity, unitPrice);
          if (subtotal <= 0) return jsonError(`El importe de «${name}» tiene que ser mayor a cero.`, 400);
          items.push({ name: name.slice(0, MAX_ITEM_NAME), quantity, unitPrice, taxType, subtotal });
        }
      } else if (budget) {
        const budgetItems = await tx.budgetItem.findMany({
          where: { budgetId: budget.id },
          orderBy: { name: "asc" },
          select: { name: true, quantity: true, subtotal: true },
        });
        items = budgetItems.flatMap((item) => {
          const subtotal = Math.max(0, item.subtotal);
          if (subtotal <= 0) return [];
          const quantity = item.quantity > 0 ? item.quantity : 1;
          // División exacta: la línea conserva el importe del presupuesto; si no
          // es exacta, entra como una línea con cantidad 1 por el total real.
          const exact = subtotal % quantity === 0;
          return [{
            name: item.name.slice(0, MAX_ITEM_NAME),
            quantity: exact ? quantity : 1,
            unitPrice: exact ? subtotal / quantity : subtotal,
            taxType: "IVA10" as InvoiceTaxTypeValue,
            subtotal,
          }];
        });
        if (items.length === 0) return jsonError("El presupuesto no tiene ítems con importe para facturar.", 409);
      }
      if (items.length === 0) return jsonError("Agregá al menos un ítem a la factura.", 400);
      if (items.length > MAX_ITEMS) return jsonError(`La factura no puede superar los ${MAX_ITEMS} ítems.`, 400);

      const totals = taxTotalsOf(items);
      if (totals.total <= 0) return jsonError("El total de la factura tiene que ser mayor a cero.", 400);
      if (totals.total > MAX_AMOUNT) return jsonError("El total de la factura supera el máximo admitido (99.000.000.000 Gs.).", 400);

      // Evento: el del body o el del presupuesto; siempre de la empresa activa.
      let eventId: string | null = null;
      const requestedEvent = body.eventId ?? budget?.eventId ?? null;
      if (requestedEvent) {
        if (typeof requestedEvent !== "string") return jsonError("El evento no es válido.", 400);
        const event = await tx.event.findFirst({ where: { id: requestedEvent, organizationId }, select: { id: true } });
        if (!event) return jsonError("El evento no existe en esta empresa.", 404);
        eventId = event.id;
      }

      // Numeración atómica y sin huecos: el UPDATE … RETURNING de la secuencia
      // corre en la misma transacción que la factura; si algo falla, el número
      // vuelve atrás con la fila y nunca queda un hueco.
      const rows = await tx.$queryRaw<Array<{ lastNumber: number }>>(Prisma.sql`
        INSERT INTO "InvoiceSequence" ("id", "organizationId", "lastNumber", "updatedAt")
        VALUES (${randomUUID()}, ${organizationId}, 1, CURRENT_TIMESTAMP)
        ON CONFLICT ("organizationId") DO UPDATE
          SET "lastNumber" = "InvoiceSequence"."lastNumber" + 1, "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "lastNumber"
      `);
      const number = rows[0]?.lastNumber;
      if (!number) return jsonError("No pudimos asignar el número de la factura.", 500);

      const invoice = await tx.invoice.create({
        data: {
          id: randomUUID(),
          organizationId,
          number,
          status: "ISSUED",
          condition,
          clientId: client?.id ?? budget?.clientId ?? null,
          clientName,
          clientRuc,
          budgetId: budget?.id ?? null,
          eventId,
          issuedAt,
          dueAt,
          taxable10: totals.taxable10,
          iva10: totals.iva10,
          taxable5: totals.taxable5,
          iva5: totals.iva5,
          exempt: totals.exempt,
          total: totals.total,
          notes: typeof notes === "string" ? notes : null,
          createdById: user.id,
          createdByName: user.name,
          createdByEmail: user.email,
          items: {
            create: items.map((item) => ({
              id: randomUUID(),
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              taxType: item.taxType,
              subtotal: item.subtotal,
              ...grossToNet(item.subtotal, item.taxType),
            })),
          },
        },
        include: invoiceInclude,
      });

      return {
        status: 201,
        body: { invoice },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "create",
            entity: "Invoice",
            entityId: invoice.id,
            summary: `Emitió la factura Nº ${number} a «${clientName}» por ${totals.total} Gs.`,
            detail: { fields: { ...auditPick(invoice, INVOICE_AUDIT_FIELDS), items: items.length, budgetTitle: budget?.title ?? null } },
          }),
      };
    });
  }

  // ── Registro de compra del libro de IVA ───────────────────────────────────
  if (kind === "purchase") {
    const auth = await requireAdminContext("finance.write");
    if (!auth.ok) return auth.response;
    const { organizationId, user } = auth.context;
    return withIdempotency({ request, organizationId, scope: "fiscal:POST:purchase", body }, async (tx) => {
      const draft = await readPurchaseDraft(tx, organizationId, body);
      if (draft instanceof Response) return draft;
      const closed = await guardOpenMonth(tx, organizationId, monthOf(draft.date));
      if (closed) return closed;

      const purchase = await tx.purchaseInvoice.create({
        data: {
          id: randomUUID(),
          organizationId,
          supplierId: draft.supplierId,
          date: draft.date,
          reason: draft.reason,
          ruc: draft.ruc,
          timbrado: draft.timbrado,
          number: draft.number,
          concept: draft.concept,
          taxable10: draft.taxable10,
          iva10: draft.iva10,
          taxable5: draft.taxable5,
          iva5: draft.iva5,
          exempt: draft.exempt,
          total: draft.total,
          createdById: user.id,
          createdByName: user.name,
          createdByEmail: user.email,
        },
        include: purchaseInclude,
      });
      return {
        status: 201,
        body: { purchase },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "create",
            entity: "PurchaseInvoice",
            entityId: purchase.id,
            summary: `Registró la compra de «${draft.reason}» por ${draft.total} Gs. (${monthOf(draft.date)})`,
            detail: { fields: auditPick(purchase, PURCHASE_AUDIT_FIELDS) },
          }),
      };
    });
  }

  // ── Cierre mensual ────────────────────────────────────────────────────────
  if (kind === "period-close") {
    const auth = await requireAdminContext("finance.write");
    if (!auth.ok) return auth.response;
    const { organizationId } = auth.context;
    return withIdempotency({ request, organizationId, scope: "fiscal:POST:period-close", body }, async (tx) => {
      const month = readMonthKey(body.month);
      if (!month) return jsonError("El mes a cerrar tiene que estar en formato AAAA-MM.", 400);
      const now = currentMonthKey();
      if (month > now) return jsonError("No se puede cerrar un mes que todavía no empezó.", 400);
      const existing = await tx.fiscalPeriod.findUnique({ where: { organizationId_month: { organizationId, month } } });
      if (existing?.status === "CLOSED") return jsonError(`El mes ${month} ya está cerrado.`, 409);

      const summary = await liveSummary(tx, organizationId, month);
      const period = existing
        ? await tx.fiscalPeriod.update({
            where: { id: existing.id },
            data: {
              status: "CLOSED",
              summary: summary as unknown as Prisma.InputJsonValue,
              closedAt: new Date(),
              closedById: auth.context.user.id,
              closedByName: auth.context.user.name,
              // La reapertura anterior queda como historia del período.
            },
          })
        : await tx.fiscalPeriod.create({
            data: {
              id: randomUUID(),
              organizationId,
              month,
              status: "CLOSED",
              summary: summary as unknown as Prisma.InputJsonValue,
              closedAt: new Date(),
              closedById: auth.context.user.id,
              closedByName: auth.context.user.name,
            },
          });
      return {
        status: 200,
        body: { period: periodPayload(period) },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "status",
            entity: "FiscalPeriod",
            entityId: period.id,
            summary: `Cerró el mes fiscal ${month}: ventas ${summary.sales.total} Gs., compras ${summary.purchases.total} Gs.`,
            detail: {
              changes: {
                status: { from: existing?.status ?? "OPEN", to: "CLOSED" },
                sales: { from: null, to: summary.sales.total },
                purchases: { from: null, to: summary.purchases.total },
                balance: { from: null, to: summary.balance },
              },
            },
          }),
      };
    });
  }

  return jsonError("Unknown fiscal entry.", 400);
}

export async function PATCH(request: Request) {
  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";

  // ── Anulación y saldado de facturas ───────────────────────────────────────
  if (kind === "invoice") {
    const auth = await requireAdminContext("finance.write");
    if (!auth.ok) return auth.response;
    const { organizationId, user } = auth.context;
    const action = body.action === "void" ? "void" : body.action === "paid" ? "paid" : null;
    if (!action) return jsonError("Acción de factura desconocida.", 400);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta la factura.", 400);

    return withIdempotency({ request, organizationId, scope: "fiscal:PATCH:invoice", body }, async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id, organizationId }, include: invoiceInclude });
      if (!invoice) return jsonError("La factura no existe en esta empresa.", 404);
      const closed = await guardOpenMonth(tx, organizationId, monthOf(invoice.issuedAt));
      if (closed) return closed;

      if (action === "void") {
        const reason = optionalText(body.reason, MAX_REASON) ?? "";
        if (reason.trim().length < MIN_REASON) return jsonError(`El motivo de la anulación es obligatorio (mínimo ${MIN_REASON} caracteres).`, 400);
        if (invoice.status === "VOID") return jsonError("La factura ya está anulada.", 409);
        if (invoice.status === "PAID") {
          return jsonError("La factura está saldada: quitá el estado saldada antes de anularla.", 409);
        }
        const updated = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "VOID",
            voidedAt: new Date(),
            voidedById: user.id,
            voidedByName: user.name,
            voidReason: reason,
          },
          include: invoiceInclude,
        });
        return {
          status: 200,
          body: { invoice: updated },
          afterCommit: () =>
            recordAudit({
              context: auth.context,
              action: "status",
              entity: "Invoice",
              entityId: invoice.id,
              summary: `Anuló la factura Nº ${invoice.number} (${invoice.clientName}): ${reason}`,
              detail: { changes: { status: { from: invoice.status, to: "VOID" }, voidReason: { from: null, to: reason } } },
            }),
        };
      }

      // Saldado (o su reverso): el circuito de cobro vive en Finanzas; acá se
      // registra el estado real del comprobante con su fecha.
      if (typeof body.paid !== "boolean") return jsonError("Indicá si la factura queda saldada.", 400);
      if (invoice.status === "VOID") return jsonError("La factura está anulada: no se puede marcar saldada.", 409);
      const paidKey = readDayKey(body.paidAt);
      if (paidKey === null) return jsonError("La fecha de pago tiene que ser un día válido (AAAA-MM-DD).", 400);
      const paidAt = body.paid ? dayStart(paidKey ?? dayKeyOf(new Date())) : null;
      const nextStatus = body.paid ? "PAID" : "ISSUED";
      if (invoice.status === nextStatus && Boolean(invoice.paidAt) === Boolean(paidAt)) {
        return { status: 200, body: { invoice, unchanged: true } };
      }
      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: nextStatus, paidAt },
        include: invoiceInclude,
      });
      return {
        status: 200,
        body: { invoice: updated },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "status",
            entity: "Invoice",
            entityId: invoice.id,
            summary: `${body.paid ? "Marcó saldada" : "Volvió a emitida"} la factura Nº ${invoice.number} (${invoice.clientName})`,
            detail: { changes: { status: { from: invoice.status, to: nextStatus }, paidAt: { from: invoice.paidAt, to: paidAt } } },
          }),
      };
    });
  }

  // ── Edición y baja de compras (con el mes abierto) ────────────────────────
  if (kind === "purchase") {
    const auth = await requireAdminContext("finance.write");
    if (!auth.ok) return auth.response;
    const { organizationId } = auth.context;
    const action = body.action === "update" ? "update" : body.action === "delete" ? "delete" : null;
    if (!action) return jsonError("Acción de compra desconocida.", 400);
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta la compra.", 400);

    return withIdempotency({ request, organizationId, scope: "fiscal:PATCH:purchase", body }, async (tx) => {
      const purchase = await tx.purchaseInvoice.findFirst({ where: { id, organizationId } });
      if (!purchase) return jsonError("La compra no existe en esta empresa.", 404);
      const closed = await guardOpenMonth(tx, organizationId, monthOf(purchase.date));
      if (closed) return closed;

      if (action === "delete") {
        await tx.purchaseInvoice.delete({ where: { id: purchase.id } });
        return {
          status: 200,
          body: { deleted: purchase.id },
          afterCommit: () =>
            recordAudit({
              context: auth.context,
              action: "delete",
              entity: "PurchaseInvoice",
              entityId: purchase.id,
              summary: `Borró la compra de «${purchase.reason}» del ${monthOf(purchase.date)}`,
              detail: { before: auditPick(purchase, PURCHASE_AUDIT_FIELDS) },
            }),
        };
      }

      const draft = await readPurchaseDraft(tx, organizationId, body);
      if (draft instanceof Response) return draft;
      // Mover una compra de mes también exige que el mes destino esté abierto.
      const targetClosed = await guardOpenMonth(tx, organizationId, monthOf(draft.date));
      if (targetClosed) return targetClosed;
      const updated = await tx.purchaseInvoice.update({
        where: { id: purchase.id },
        data: {
          supplierId: draft.supplierId,
          date: draft.date,
          reason: draft.reason,
          ruc: draft.ruc,
          timbrado: draft.timbrado,
          number: draft.number,
          concept: draft.concept,
          taxable10: draft.taxable10,
          iva10: draft.iva10,
          taxable5: draft.taxable5,
          iva5: draft.iva5,
          exempt: draft.exempt,
          total: draft.total,
        },
        include: purchaseInclude,
      });
      const changes = auditChanges(purchase, updated, PURCHASE_AUDIT_FIELDS);
      return {
        status: 200,
        body: { purchase: updated },
        ...(changes
          ? {
              afterCommit: () =>
                recordAudit({
                  context: auth.context,
                  action: "update",
                  entity: "PurchaseInvoice",
                  entityId: purchase.id,
                  summary: `Editó la compra de «${updated.reason}» del ${monthOf(updated.date)}`,
                  detail: { changes },
                }),
            }
          : {}),
      };
    });
  }

  // ── Reapertura del mes (solo OWNER, con motivo y auditoría) ───────────────
  if (kind === "period-reopen") {
    const auth = await requireAdminContext();
    if (!auth.ok) return auth.response;
    const { organizationId, role } = auth.context;
    if (role !== "OWNER") return jsonError("Solo el propietario puede reabrir un mes cerrado.", 403);
    return withIdempotency({ request, organizationId, scope: "fiscal:PATCH:period-reopen", body }, async (tx) => {
      const month = readMonthKey(body.month);
      if (!month) return jsonError("El mes a reabrir tiene que estar en formato AAAA-MM.", 400);
      const period = await tx.fiscalPeriod.findUnique({ where: { organizationId_month: { organizationId, month } } });
      if (!period) return jsonError(`El mes ${month} no tiene cierre registrado.`, 404);
      if (period.status === "OPEN") return jsonError(`El mes ${month} ya está abierto.`, 409);
      const reason = optionalText(body.reason, MAX_REASON) ?? "";
      if (reason.trim().length < MIN_REASON) return jsonError(`El motivo de la reapertura es obligatorio (mínimo ${MIN_REASON} caracteres).`, 400);

      const updated = await tx.fiscalPeriod.update({
        where: { id: period.id },
        data: {
          status: "OPEN",
          reopenedAt: new Date(),
          reopenedById: auth.context.user.id,
          reopenedByName: auth.context.user.name,
          reopenReason: reason,
        },
      });
      return {
        status: 200,
        body: { period: periodPayload(updated) },
        afterCommit: () =>
          recordAudit({
            context: auth.context,
            action: "unlock",
            entity: "FiscalPeriod",
            entityId: period.id,
            summary: `Reabrió el mes fiscal ${month}: ${reason}`,
            detail: {
              changes: {
                status: { from: "CLOSED", to: "OPEN" },
                reopenReason: { from: period.reopenReason, to: reason },
              },
            },
          }),
      };
    });
  }

  return jsonError("Unknown fiscal entry.", 400);
}

/**
 * Arma y valida el borrador de una compra. El comprobante lo emite el proveedor
 * (timbrado y número son textos tal como vienen) y el IVA sale del tipo
 * elegido sobre el total bruto: la misma regla de `lib/fiscal.ts` que las ventas.
 */
async function readPurchaseDraft(
  tx: IdempotentTx,
  organizationId: string,
  body: Record<string, unknown>,
): Promise<
  | {
      supplierId: string | null;
      date: Date;
      reason: string;
      ruc: string | null;
      timbrado: string | null;
      number: string | null;
      concept: string | null;
      taxable10: number;
      iva10: number;
      taxable5: number;
      iva5: number;
      exempt: number;
      total: number;
    }
  | Response
> {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 2) return jsonError("La razón social del proveedor es obligatoria.", 400);

  const dateKey = readDayKey(body.date);
  if (dateKey === null) return jsonError("La fecha del comprobante tiene que ser un día válido (AAAA-MM-DD).", 400);
  const date = dayStart(dateKey ?? dayKeyOf(new Date()));

  const taxType: InvoiceTaxTypeValue = isInvoiceTaxType(body.taxType) ? body.taxType : "IVA10";
  const total = toInteger(body.total, 1, MAX_AMOUNT);
  if (total === null) return jsonError("El total del comprobante tiene que ser un monto en guaraníes (hasta 99.000.000.000).", 400);
  const { taxable, taxAmount } = grossToNet(total, taxType);

  let supplierId: string | null = null;
  if (body.supplierId !== undefined && body.supplierId !== null && body.supplierId !== "") {
    if (typeof body.supplierId !== "string") return jsonError("El proveedor no es válido.", 400);
    const supplier = await tx.supplier.findFirst({ where: { id: body.supplierId, organizationId }, select: { id: true } });
    if (!supplier) return jsonError("El proveedor no existe en esta empresa.", 404);
    supplierId = supplier.id;
  }

  return {
    supplierId,
    date,
    reason: reason.slice(0, MAX_CLIENT_NAME),
    ruc: optionalText(body.ruc, MAX_RUC) ?? null,
    timbrado: optionalText(body.timbrado, MAX_TIMBRADO) ?? null,
    number: optionalText(body.number, MAX_RECEIPT_NUMBER) ?? null,
    concept: optionalText(body.concept, MAX_CONCEPT) ?? null,
    taxable10: taxType === "IVA10" ? taxable : 0,
    iva10: taxType === "IVA10" ? taxAmount : 0,
    taxable5: taxType === "IVA5" ? taxable : 0,
    iva5: taxType === "IVA5" ? taxAmount : 0,
    exempt: taxType === "EXEMPT" ? taxable : 0,
    total,
  };
}
