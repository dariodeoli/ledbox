import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditPick, recordAudit } from "@/lib/server/audit";
import { clientLabel, dayKeyOf, dayStart, isValidDayKey, shiftDayKey } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cobros de clientes y cuentas por pagar de la empresa activa (issue #16).
 *
 * `POST` con `kind: "client"` registra un cobro: cobrado al momento (default,
 * `status RECEIVED`, con `paidAt`/`collectedAt` reales) o a plazo
 * (`status PENDING`, con factura emitida, vencimiento calculado desde la emisión
 * + días o fecha exacta, y fecha de cheque obligatoria cuando el método es
 * cheque). Un cobro pendiente no es plata cobrada: `paidAt` queda nulo.
 *
 * `PATCH` con `kind: "client"` cierra un cobro a plazo: `action: "collect"` lo
 * pasa a `RECEIVED` sellando la fecha real, `action: "cancel"` lo anula. Las
 * transiciones son monotónicas (solo desde `PENDING`) y cada una queda auditada.
 */

/** Métodos de pago aceptados (catálogo cerrado del panel). */
const PAYMENT_METHODS = ["Transferencia", "Efectivo", "Cheque", "Tarjeta", "Otro"] as const;
/** Métodos válidos para un cobro a plazo. */
const TERM_METHODS = ["Transferencia", "Efectivo", "Cheque"] as const;
/** Plazos ofrecidos en días desde la emisión de la factura. */
const TERM_DAYS: readonly number[] = [0, 15, 30, 60];
const MAX_AMOUNT = 99_000_000_000;
const MAX_INVOICE = 60;
const MAX_REFERENCE = 120;

/** Método canónico de la lista; `null` si no vino, `false` si es desconocido. */
function normalizeMethod(raw: unknown, allowed: readonly string[]): string | null | false {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toLowerCase();
  return allowed.find((method) => method.toLowerCase() === value) ?? false;
}

/** Día de Asunción (`YYYY-MM-DD`) validado desde el body. */
function readDayKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().slice(0, 10);
  return isValidDayKey(key) ? key : null;
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const [clientPayments, supplierJobs] = await Promise.all([
    db.clientPayment.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { client: true, budget: true },
    }),
    db.supplierJob.findMany({
      where: { organizationId },
      orderBy: { dueAt: "asc" },
      take: 200,
      include: { supplier: true, event: true },
    }),
  ]);
  return Response.json({ clientPayments, supplierJobs });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  if (body.kind !== "client") return jsonError("Unknown finance entry.", 400);

  const clientId = typeof body.clientId === "string" ? body.clientId : "";
  const amount = Number(body.amount);
  if (!clientId || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return jsonError("Elegí un cliente y un monto entero en guaraníes (hasta 99.000.000.000).", 400);
  }
  const client = await db.client.findFirst({
    where: { id: clientId, organizationId },
    select: { id: true, name: true, company: true },
  });
  if (!client) return jsonError("Client not found.", 404);
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  if (budgetId) {
    const budget = await db.budget.findFirst({ where: { id: budgetId, organizationId }, select: { id: true } });
    if (!budget) return jsonError("Budget not found.", 404);
  }

  // ── Cobro a plazo: a cobrar, con factura y/o cheque ───────────────────────
  if (body.status === "PENDING") {
    const method = normalizeMethod(body.method, TERM_METHODS);
    if (method === false) return jsonError("El método de un cobro a plazo es transferencia, efectivo o cheque.", 400);
    if (!method) return jsonError("Indicá el método del cobro a plazo.", 400);

    const chequeDayKey = readDayKey(body.chequeDate);
    if (method === "Cheque" && !chequeDayKey) return jsonError("La fecha del cheque es obligatoria.", 400);
    if (method !== "Cheque" && chequeDayKey) return jsonError("Solo un cobro con cheque lleva fecha de cheque.", 400);

    const invoiceDayKey = readDayKey(body.invoiceIssuedAt);
    const invoiceNumber = typeof body.invoiceNumber === "string" ? body.invoiceNumber.trim() : "";
    if (invoiceNumber.length > MAX_INVOICE) return jsonError(`El número de factura no puede superar los ${MAX_INVOICE} caracteres.`, 400);
    if (invoiceDayKey && !invoiceNumber) return jsonError("Ingresá el número de la factura emitida.", 400);
    if (!invoiceDayKey && invoiceNumber) return jsonError("Indicá la fecha de emisión de la factura.", 400);

    let dueDayKey = readDayKey(body.dueAt);
    if (!dueDayKey) {
      const dueDays = Number(body.dueDays);
      if (!TERM_DAYS.includes(dueDays)) {
        return jsonError("Elegí el vencimiento de cobro: 0, 15, 30 o 60 días desde la emisión, o una fecha exacta.", 400);
      }
      dueDayKey = shiftDayKey(invoiceDayKey ?? dayKeyOf(new Date()), dueDays);
    }

    const payment = await db.clientPayment.create({
      data: {
        id: randomUUID(),
        organizationId,
        clientId: client.id,
        budgetId: budgetId || undefined,
        amount,
        status: "PENDING",
        method,
        invoiceNumber: invoiceNumber || null,
        invoiceIssuedAt: invoiceDayKey ? dayStart(invoiceDayKey) : null,
        dueAt: dayStart(dueDayKey),
        chequeDate: chequeDayKey ? dayStart(chequeDayKey) : null,
      },
    });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "ClientPayment",
      entityId: payment.id,
      summary: `Registró un cobro a plazo del cliente «${clientLabel(client)}»`,
      detail: {
        fields: auditPick(payment, [
          "clientId",
          "budgetId",
          "amount",
          "status",
          "method",
          "invoiceNumber",
          "invoiceIssuedAt",
          "dueAt",
          "chequeDate",
        ]),
      },
    });
    return Response.json({ payment }, { status: 201 });
  }

  // ── Cobro cobrado al momento (compatibilidad con el alta directa) ─────────
  const method = normalizeMethod(body.method, PAYMENT_METHODS);
  if (method === false) return jsonError("Método de pago desconocido.", 400);
  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (reference.length > MAX_REFERENCE) return jsonError(`La referencia no puede superar los ${MAX_REFERENCE} caracteres.`, 400);

  const now = new Date();
  const payment = await db.clientPayment.create({
    data: {
      id: randomUUID(),
      organizationId,
      clientId: client.id,
      budgetId: budgetId || undefined,
      amount,
      status: "RECEIVED",
      paidAt: now,
      collectedAt: now,
      method: method ?? undefined,
      reference: reference || undefined,
    },
  });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "ClientPayment",
    entityId: payment.id,
    summary: `Registró un cobro del cliente «${clientLabel(client)}»`,
    detail: { fields: auditPick(payment, ["clientId", "budgetId", "amount", "method", "reference", "paidAt"]) },
  });
  return Response.json({ payment }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  if (body.kind !== "client") return jsonError("Unknown finance entry.", 400);

  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  const action = body.action === "collect" ? "collect" : body.action === "cancel" ? "cancel" : "";
  if (!paymentId || !action) return jsonError("paymentId and action are required.", 400);

  const payment = await db.clientPayment.findFirst({
    where: { id: paymentId, organizationId },
    include: { client: { select: { name: true, company: true } } },
  });
  if (!payment) return jsonError("Payment not found.", 404);
  if (payment.status !== "PENDING") return jsonError("El cobro ya está cerrado.", 409);
  const label = clientLabel(payment.client);

  if (action === "collect") {
    // Una sola escritura condicional: si otro usuario lo cobró antes, no se pisa.
    const now = new Date();
    const applied = await db.clientPayment.updateMany({
      where: { id: payment.id, organizationId, status: "PENDING" },
      data: { status: "RECEIVED", paidAt: now, collectedAt: now },
    });
    if (applied.count === 0) return jsonError("El cobro ya está cerrado.", 409);
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "ClientPayment",
      entityId: payment.id,
      summary: `Marcó como cobrado el cobro a plazo de «${label}»`,
      detail: { changes: { status: { from: "PENDING", to: "RECEIVED" }, collectedAt: { from: null, to: now } } },
    });
    const updated = await db.clientPayment.findUnique({ where: { id: payment.id } });
    return Response.json({ payment: updated });
  }

  const applied = await db.clientPayment.updateMany({
    where: { id: payment.id, organizationId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (applied.count === 0) return jsonError("El cobro ya está cerrado.", 409);
  await recordAudit({
    context: auth.context,
    action: "status",
    entity: "ClientPayment",
    entityId: payment.id,
    summary: `Anuló el cobro a plazo de «${label}»`,
    detail: { changes: { status: { from: "PENDING", to: "CANCELLED" } } },
  });
  const updated = await db.clientPayment.findUnique({ where: { id: payment.id } });
  return Response.json({ payment: updated });
}
