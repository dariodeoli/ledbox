import { emailValid, normalizeEmail } from "@/lib/field-rules";
import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { buildBudgetMail, sendMail } from "@/lib/server/mail";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mensaje corto opcional del diálogo de envío (no es una carta). */
const MAX_MESSAGE = 600;

/**
 * `POST /api/admin/budgets/send` (issue #31): envía el presupuesto al cliente
 * por correo con la plantilla única (`lib/server/mail/**`).
 *
 * - El destinatario es editable, pero se revalida con **la misma regla que el
 *   alta de clientes** (`emailValid`); sin correo válido no se envía.
 * - El correo lleva el link del portal con su código, el resumen de ítems,
 *   subtotal/descuento/total, la validez, la hoja imprimible y los datos de pago
 *   **solo con el presupuesto aprobado**. Sin link público se corta con 409: no
 *   se inventa un portal.
 * - Todo envío queda en el historial de correo (`MailLog`) y en la auditoría
 *   (`recordAudit`, acción `send`) con el actor real de la sesión.
 *
 * Requiere `budgets.write`: VIEWER nunca envía.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  const rawTo = typeof body.to === "string" ? body.to : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!budgetId) return jsonError("Elegí el presupuesto a enviar.", 400);
  if (message.length > MAX_MESSAGE) return jsonError(`El mensaje no puede superar los ${MAX_MESSAGE} caracteres.`, 400);

  const to = normalizeEmail(rawTo);
  if (!emailValid(to)) {
    return jsonError("Ingresá un correo válido: el cliente no tiene uno cargado o el destinatario está mal escrito.", 400);
  }

  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    include: {
      client: { select: { name: true, company: true } },
      event: { select: { name: true } },
      items: { orderBy: { name: "asc" }, select: { name: true, quantity: true, days: true, subtotal: true } },
      organization: { select: { name: true, paymentDetails: true } },
    },
  });
  if (!budget) return jsonError("Presupuesto no encontrado.", 404);
  if (!budget.publicToken) {
    return jsonError("Este presupuesto todavía no tiene link del portal: generá el link antes de enviarlo.", 409);
  }

  const content = buildBudgetMail({
    organizationName: budget.organization.name,
    paymentDetails: budget.organization.paymentDetails,
    budget,
    message,
  });
  if (!content) return jsonError("Este presupuesto todavía no tiene link del portal: generá el link antes de enviarlo.", 409);

  const clientLabel = budget.client.company?.trim() || budget.client.name;
  const result = await sendMail({
    to,
    subject: content.subject,
    category: "budget",
    html: content.html,
    text: content.text,
    organizationId,
    entity: "Budget",
    entityId: budget.id,
    actor: auth.context.user,
  });

  await recordAudit({
    context: auth.context,
    action: "send",
    entity: "Budget",
    entityId: budget.id,
    summary:
      result.status === "sent"
        ? `Envió por correo el presupuesto «${budget.title}» a «${clientLabel}» (${to})`
        : `No pudo enviar por correo el presupuesto «${budget.title}» a «${clientLabel}»: ${result.error ?? "sin detalle"}`,
    detail: {
      fields: {
        to,
        category: "budget",
        status: result.status,
        portalCode: content.code,
        ...(result.error ? { error: result.error } : {}),
      },
    },
  });

  return Response.json({
    status: result.status,
    error: result.error ?? null,
    to,
    subject: content.subject,
    portalUrl: content.portalUrl,
    code: content.code,
    sentAt: new Date().toISOString(),
  });
}
