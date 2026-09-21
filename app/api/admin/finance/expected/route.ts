import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { confirmExpectedPayment, reviewExpectedPayment } from "@/lib/server/expected-payments";
import { dayKeyOf, dayStart, isValidDayKey } from "@/lib/server/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pagos esperados del plan y su confirmación en cuenta (issue #28).
 *
 * - `GET` devuelve los pagos esperados de la empresa activa (anticipo, cuotas y
 *   saldo) con su presupuesto, cliente, cuenta destino, comprobante y cobro
 *   confirmado, más los totales honestos: **por confirmar** (comprobantes en
 *   revisión + vencidos sin comprobante) va aparte de lo cobrado y del
 *   disponible. `?budgetId=` acota a un presupuesto y es la fuente de la
 *   trazabilidad completa de ese cobro.
 * - `POST` con `kind: "confirm"` confirma en una cuenta de tesorería: crea el
 *   cobro `RECEIVED` y el movimiento de entrada en la misma transacción. Con
 *   `kind: "reject"` observa/rechaza con un motivo que el cliente ve en el
 *   portal. La confirmación es idempotente: repetirla no duplica nada.
 *
 * Todo se filtra por `organizationId`, la lectura es para cualquier rol y la
 * escritura exige `finance.write` (VIEWER recibe 403).
 */

const MAX_ROWS = 300;
/** Tope de la trazabilidad de un presupuesto puntual. */
const MAX_TIMELINE_ROWS = 100;

const accountSelect = { id: true, name: true, type: true, bank: true } as const;

const rowInclude = {
  budget: {
    select: {
      id: true,
      title: true,
      total: true,
      status: true,
      approvedAt: true,
      approvedByName: true,
      approvalMethod: true,
      publicToken: true,
      client: { select: { id: true, name: true, company: true } },
    },
  },
  expectedAccount: { select: accountSelect },
  proof: { select: { id: true, uploadedByName: true, mime: true, size: true, createdAt: true } },
  payment: { select: { id: true, status: true, collectedAt: true, paidAt: true, method: true, reference: true, treasuryAccountId: true } },
} as const;

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const budgetId = (new URL(request.url).searchParams.get("budgetId") ?? "").trim();
  if (budgetId) {
    const budget = await db.budget.findFirst({ where: { id: budgetId, organizationId }, select: { id: true } });
    if (!budget) return jsonError("Budget not found.", 404);
  }

  const [expectedPayments, totals] = await Promise.all([
    db.expectedPayment.findMany({
      where: { organizationId, ...(budgetId ? { budgetId } : {}) },
      orderBy: [{ createdAt: "desc" }],
      take: budgetId ? MAX_TIMELINE_ROWS : MAX_ROWS,
      include: rowInclude,
    }),
    db.expectedPayment.findMany({
      where: { organizationId, ...(budgetId ? { budgetId } : {}) },
      select: { status: true, amount: true, dueAt: true },
    }),
  ]);

  const todayKey = dayKeyOf(new Date());
  const summary = {
    awaiting: { count: 0, total: 0 },
    proof: { count: 0, total: 0 },
    overdue: { count: 0, total: 0 },
    confirmed: { count: 0, total: 0 },
    /** Lo que necesita acción: comprobantes en revisión + vencidos sin comprobante. */
    pending: { count: 0, total: 0 },
  };
  for (const row of totals) {
    if (row.status === "AWAITING") {
      summary.awaiting.count += 1;
      summary.awaiting.total += row.amount;
      const overdue = Boolean(row.dueAt) && dayKeyOf(row.dueAt as Date) < todayKey;
      if (overdue) {
        summary.overdue.count += 1;
        summary.overdue.total += row.amount;
      }
    } else if (row.status === "PROOF") {
      summary.proof.count += 1;
      summary.proof.total += row.amount;
    } else if (row.status === "CONFIRMED") {
      summary.confirmed.count += 1;
      summary.confirmed.total += row.amount;
    }
  }
  summary.pending = {
    count: summary.proof.count + summary.overdue.count,
    total: summary.proof.total + summary.overdue.total,
  };

  return Response.json({
    expectedPayments,
    expectedSummary: summary,
    // Día de Asunción de hoy: el panel marca los vencidos con el mismo criterio.
    expectedToday: todayKey,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;

  const body = (await readJson(request)) as Record<string, unknown>;
  const expectedPaymentId = typeof body.expectedPaymentId === "string" ? body.expectedPaymentId : "";
  if (!expectedPaymentId) return jsonError("Indicá el pago esperado.", 400);
  const kind = body.kind === "confirm" ? "confirm" : body.kind === "reject" ? "reject" : "";
  if (!kind) return jsonError("Unknown expected payment entry.", 400);

  if (kind === "reject") {
    const note = typeof body.note === "string" ? body.note : "";
    const outcome = await reviewExpectedPayment({
      organizationId: auth.context.organizationId,
      expectedPaymentId,
      note,
      actor: auth.context,
    });
    if (!outcome.ok) return jsonError(outcome.error, outcome.status);
    return Response.json({ expectedPayment: outcome.expectedPayment });
  }

  const accountId = typeof body.accountId === "string" && body.accountId.trim() ? body.accountId.trim() : null;
  let collectedAt: Date | null = null;
  if (body.date !== undefined && body.date !== null && body.date !== "") {
    if (typeof body.date !== "string" || !isValidDayKey(body.date.trim().slice(0, 10))) {
      return jsonError("La fecha del cobro tiene que ser un día válido (AAAA-MM-DD).", 400);
    }
    collectedAt = dayStart(body.date.trim().slice(0, 10));
  }
  const reference = typeof body.reference === "string" ? body.reference : null;
  const notes = typeof body.notes === "string" ? body.notes : null;

  const outcome = await confirmExpectedPayment({
    organizationId: auth.context.organizationId,
    expectedPaymentId,
    accountId,
    actor: auth.context,
    collectedAt,
    reference,
    notes,
  });
  if (!outcome.ok) return jsonError(outcome.error, outcome.status);

  return Response.json({
    expectedPayment: outcome.expectedPayment,
    alreadyConfirmed: outcome.alreadyConfirmed,
    movementCreated: outcome.movementCreated,
  });
}
