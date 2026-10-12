import { emailValid, normalizeEmail } from "@/lib/field-rules";
import { stableOrderBudgetItems } from "@/lib/budget-item-order";
import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { appEmailSender, buildBudgetMail, sendMail } from "@/lib/server/mail";
import { createMailPreview, verifyMailPreviewConfirmation, MailPreviewUnavailableError } from "@/lib/server/mail/preview";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
import { clientDisplayName } from "@/lib/client-identity";
export const dynamic = "force-dynamic";

/** Mensaje corto opcional del diálogo de envío (no es una carta). */
const MAX_MESSAGE = 600;

/**
 * `POST /api/admin/budgets/send` (issue #30): envía el presupuesto al cliente
 * por correo con la plantilla única (`lib/server/mail/**`).
 *
 * - El destinatario es editable, pero se revalida con **la misma regla que el
 *   alta de clientes** (`emailValid`); sin correo válido no se envía.
 * - El correo lleva el link del portal con su código, el resumen de ítems,
 *   subtotal/descuento/total, la validez, la hoja imprimible y los datos de pago
 *   **solo con el presupuesto aprobado**. Sin link público se corta con 409: no
 *   se inventa un portal.
 * - `preview: true` devuelve el correo real sin enviar ni registrar. El envío
 *   exige `confirm: true` y una confirmación vigente del mismo contenido.
 * - Todo envío queda en el historial de correo (`MailLog`) y en la auditoría
 *   (`recordAudit`, acción `send`) con el actor real de la sesión.
 *
 * Requiere `budgets.write`: VIEWER nunca envía.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  const input = await readJson(request);
  if (!input || typeof input !== "object" || Array.isArray(input)) return jsonError("Indicá los datos del correo.", 400);
  const body = input as Record<string, unknown>;
  const budgetId = typeof body.budgetId === "string" ? body.budgetId : "";
  const rawTo = typeof body.to === "string" ? body.to : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const preview = body.preview === true;
  if (preview && body.confirm === true) return jsonError("Elegí previsualizar o confirmar el envío.", 400);
  if (!preview && (body.confirm !== true || typeof body.confirmationToken !== "string")) {
    return jsonError("Previsualizá el correo antes de confirmar el envío.", 409);
  }
  if (!budgetId) return jsonError("Elegí el presupuesto a enviar.", 400);
  if (message.length > MAX_MESSAGE) return jsonError(`El mensaje no puede superar los ${MAX_MESSAGE} caracteres.`, 400);

  const to = normalizeEmail(rawTo);
  if (!emailValid(to)) {
    return jsonError("Ingresá un correo válido: el cliente no tiene uno cargado o el destinatario está mal escrito.", 400);
  }

  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    include: {
      client: { select: { name: true, company: true, tradeName: true, legalName: true } },
      event: { select: { name: true } },
      items: { orderBy: { name: "asc" }, select: { sortOrder: true, name: true, quantity: true, days: true, subtotal: true } },
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
    budget: { ...budget, items: stableOrderBudgetItems(budget.items) },
    message,
  });
  if (!content) return jsonError("Este presupuesto todavía no tiene link del portal: generá el link antes de enviarlo.", 409);

  const sendable = { from: appEmailSender(), to, subject: content.subject, html: content.html, text: content.text };
  const scope = { organizationId, actorId: auth.context.user.id, entity: "Budget", entityId: budget.id };
  try {
    if (preview) {
      // Read-only: no send, MailLog, audit, portal token generation or budget mutation.
      return Response.json(await createMailPreview(sendable, scope), { headers: { "Cache-Control": "no-store" } });
    }
    if (!await verifyMailPreviewConfirmation(body.confirmationToken as string, sendable, scope)) {
      return jsonError("La vista previa venció o cambió el correo. Previsualizá nuevamente antes de enviarlo.", 409);
    }
  } catch (error) {
    if (error instanceof MailPreviewUnavailableError) return jsonError(error.message, 503);
    throw error;
  }

  const clientLabel = clientDisplayName(budget.client);
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
