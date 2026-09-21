import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { recordWhatsappReminder, sendReminderEmailForTarget, type ReminderTarget } from "@/lib/server/reminders";
import { emailConfigured } from "@/lib/server/resend";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Recordatorios de cobro al cliente (issues #19 y #28).
 *
 * `POST` con `{ paymentId, channel }` (cobro a plazo) o
 * `{ expectedPaymentId, channel }` (pago esperado del plan) envía (o registra)
 * el recordatorio de un destinatario pendiente de la empresa activa:
 * - `email`: manda la plantilla por Resend con monto, vencimiento, factura o
 *   presupuesto, link del portal y datos de pago de la empresa. Si ya hay un
 *   recordatorio de hoy responde `alreadySentToday: true` sin duplicar; un
 *   intento fallido del mismo día se puede reintentar desde el panel (se
 *   actualiza la misma fila, nunca se crea otra).
 * - `whatsapp`: registra la apertura del mensaje prellenado (el envío lo hace
 *   el equipo en WhatsApp; sin APIs externas).
 *
 * Todo queda auditado con el actor real y en el historial del destinatario
 * (`PaymentReminderLog`). Requiere `finance.write`: VIEWER nunca recibe ni manda
 * recordatorios.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("finance.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  const expectedPaymentId = typeof body.expectedPaymentId === "string" ? body.expectedPaymentId : "";
  const channel = body.channel === "email" ? "email" : body.channel === "whatsapp" ? "whatsapp" : "";
  if ((!paymentId && !expectedPaymentId) || !channel) {
    return jsonError("Indicá el cobro o el pago esperado, y el canal del recordatorio.", 400);
  }

  let target: ReminderTarget;
  if (expectedPaymentId) {
    const expected = await db.expectedPayment.findFirst({
      where: { id: expectedPaymentId, organizationId, status: "AWAITING" },
      include: { budget: { include: { client: true } } },
    });
    if (!expected) return jsonError("Pago esperado pendiente de transferencia no encontrado.", 404);
    target = { kind: "expected", expected };
  } else {
    const payment = await db.clientPayment.findFirst({
      where: { id: paymentId, organizationId, status: "PENDING" },
      include: { client: true, budget: true },
    });
    if (!payment) return jsonError("Cobro pendiente no encontrado.", 404);
    target = { kind: "payment", payment };
  }

  const client = target.kind === "payment" ? target.payment.client : target.expected.budget.client;

  if (channel === "whatsapp") {
    const result = await recordWhatsappReminder({ organizationId, target, actor: auth.context });
    if (!result) return jsonError("El cliente no tiene teléfono cargado.", 400);
    return Response.json({ reminder: result.reminder, alreadySentToday: result.alreadyToday });
  }

  if (!client.email) return jsonError("El cliente no tiene correo cargado.", 400);
  if (!emailConfigured()) {
    return jsonError("Falta configurar RESEND_API_KEY: el recordatorio por email está deshabilitado.", 503);
  }

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, slug: true, paymentDetails: true },
  });
  if (!organization) return jsonError("Empresa no encontrada.", 404);

  const outcome = await sendReminderEmailForTarget({
    organization,
    target,
    actor: auth.context,
    retryFailed: true,
  });
  return Response.json({
    reminder: outcome.reminder,
    alreadySentToday: outcome.alreadySentToday,
    error: outcome.error,
  });
}
