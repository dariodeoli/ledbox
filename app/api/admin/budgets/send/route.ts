import { emailValid, normalizeEmail } from "@/lib/field-rules";
import { stableOrderBudgetItems } from "@/lib/budget-item-order";
import { missingPriceMessage, missingPriceNames } from "@/lib/budget-price-gate";
import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { buildBudgetMail, mailIdentityFor, sendMail } from "@/lib/server/mail";
import { createMailPreview, verifyMailPreviewConfirmation, MailPreviewUnavailableError } from "@/lib/server/mail/preview";
import { requireAdminContext } from "@/lib/server/tenancy";
import { budgetMailAttemptId, readBudgetMailAttempt, reconcileBudgetMailAttempt, sendBudgetMailAttempt } from "@/lib/server/budget-mail-attempt";

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
  if (!budgetId) return jsonError("Elegí el presupuesto a enviar.", 400);
  if (preview && (body.confirm === true || body.receiptOnly === true)) return jsonError("Elegí previsualizar, confirmar o consultar un intento.", 400);
  // Recuperar un intento nunca renderiza ni reenvía el correo. La autorización
  // vigente y el recibo ligan empresa, actor y presupuesto, incluso si éste avanzó.
  const receiptId = body.receiptOnly === true && typeof body.attemptId === "string" ? body.attemptId
    : !preview && body.confirm === true && typeof body.confirmationToken === "string" && body.confirmationToken.length <= 4096
      ? budgetMailAttemptId(body.confirmationToken) : null;
  if (receiptId) {
    try {
      const receipt = await readBudgetMailAttempt(auth.context, budgetId, receiptId);
      if (receipt) return Response.json(await reconcileBudgetMailAttempt(auth.context, receipt), { headers: { "Cache-Control": "no-store" } });
      if (body.receiptOnly === true) return jsonError("No encontramos un recibo vigente de este intento para tu sesión. No se reenvió ningún correo.", 404);
    } catch {
      return jsonError("No pudimos consultar el intento. Revisá el historial antes de intentar un nuevo envío.", 503);
    }
  }
  if (body.receiptOnly === true) return jsonError("Indicá un intento de correo válido.", 400);
  if (!preview && (body.confirm !== true || typeof body.confirmationToken !== "string")) {
    return jsonError("Previsualizá el correo antes de confirmar el envío.", 409);
  }
  if (message.length > MAX_MESSAGE) return jsonError(`El mensaje no puede superar los ${MAX_MESSAGE} caracteres.`, 400);

  const to = normalizeEmail(rawTo);
  if (!emailValid(to)) {
    return jsonError("Ingresá un correo válido: el cliente no tiene uno cargado o el destinatario está mal escrito.", 400);
  }

  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    include: {
      client: { select: { name: true, company: true, tradeName: true, legalName: true } },
      event: { select: { name: true, startsAt: true, endsAt: true } },
      items: { orderBy: { name: "asc" }, select: { sortOrder: true, name: true, quantity: true, days: true, subtotal: true, unitPrice: true, excluded: true, freeOnPurpose: true } },
      organization: { select: { name: true, paymentDetails: true } },
    },
  });
  if (!budget) return jsonError("Presupuesto no encontrado.", 404);
  // «Falta precio»: con las líneas ya leídas (misma regla que el resto de los frenos).
  const missing = missingPriceNames(budget.items);
  if (missing.length > 0) return jsonError(missingPriceMessage(missing, "enviar"), 409, "price_missing");
  if (!budget.publicToken) {
    return jsonError("Este presupuesto todavía no tiene link del portal: generá el link antes de enviarlo.", 409);
  }

  const identity = await mailIdentityFor(organizationId);
  const content = buildBudgetMail({
    organizationName: budget.organization.name,
    brand: identity.brand,
    paymentDetails: budget.organization.paymentDetails,
    budget: { ...budget, items: stableOrderBudgetItems(budget.items) },
    message,
    sandbox: auth.context.sandbox,
  });
  if (!content) return jsonError("Este presupuesto todavía no tiene link del portal: generá el link antes de enviarlo.", 409);

  const sendable = { from: identity.from, to, subject: content.subject, html: content.html, text: content.text };
  const scope = { organizationId, actorId: auth.context.user.id, entity: "Budget", entityId: budget.id };
  try {
    if (preview) {
      // Read-only: no send, MailLog, audit, portal token generation or budget mutation.
      const result = await createMailPreview(sendable, scope);
      return Response.json({ ...result, attemptId: budgetMailAttemptId(result.confirmationToken) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!await verifyMailPreviewConfirmation(body.confirmationToken as string, sendable, scope)) {
      return jsonError("La vista previa venció o cambió el correo. Previsualizá nuevamente antes de enviarlo.", 409);
    }
  } catch (error) {
    if (error instanceof MailPreviewUnavailableError) return jsonError(error.message, 503);
    throw error;
  }

  const clientLabel = clientDisplayName(budget.client);
  let attempt: Awaited<ReturnType<typeof sendBudgetMailAttempt>>;
  try {
    attempt = await sendBudgetMailAttempt({ request, context: auth.context, budgetId: budget.id, updatedAt: budget.updatedAt,
      token: body.confirmationToken as string, to, subject: content.subject,
      deliver: () => sendMail({
        to,
        subject: content.subject,
        category: "budget",
        html: content.html,
        text: content.text,
        organizationId,
        identity,
        entity: "Budget",
        entityId: budget.id,
        actor: auth.context.user,
      }),
    });
  } catch {
    return jsonError("No pudimos registrar o recuperar el intento; no se repetirá el envío automáticamente. Revisá el historial.", 503);
  }
  const result = attempt.reply;

  if (attempt.firstAttempt) await recordAudit({
    context: auth.context,
    action: "send",
    entity: "Budget",
    entityId: budget.id,
    summary:
      result.simulated
        ? `Simuló el envío por correo del presupuesto «${budget.title}» a «${clientLabel}» (${to}): en la demo no sale ningún correo`
        : result.status === "sent"
        ? `El proveedor aceptó el correo del presupuesto «${budget.title}» para «${clientLabel}» (${to}); no acredita entrega al buzón`
        : result.status === "unknown" || result.status === "pending"
        ? `Resultado del correo del presupuesto «${budget.title}» pendiente de confirmación; no se reenvió automáticamente`
        : `No pudo enviar por correo el presupuesto «${budget.title}» a «${clientLabel}»: ${result.error ?? "sin detalle"}`,
    detail: {
      fields: {
        to,
        category: "budget",
        status: result.status,
        attemptId: result.attemptId,
        commercialState: result.commercialState,
        portalCode: content.code,
        ...(result.error ? { error: result.error } : {}),
      },
    },
  });

  return Response.json({
    ...result,
    // Demo: el correo no salió; solo una sandbox recibe la vista previa de lo que se habría enviado.
    ...(result.simulated ? { simulated: true, preview: attempt.preview ?? null } : {}),
    to,
    subject: content.subject,
    portalUrl: content.portalUrl,
    code: content.code,
  }, { headers: { "Cache-Control": "no-store" } });
}
