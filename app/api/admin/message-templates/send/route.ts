import { canWrite } from "@/lib/admin-policy";
import { collectedAmount, MESSAGE_TEMPLATE_TARGET_CATEGORIES } from "@/lib/admin-types";
import {
  budgetMessageValues,
  clientMessageValues,
  collectionMessageValues,
  eventMessageValues,
  isMessageTemplateCategory,
  renderMessageTemplate,
  type MessageTemplateVariableValues,
} from "@/lib/server/message-templates";
import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { recordWhatsappReminder, type ReminderTarget } from "@/lib/server/reminders";
import { requireAdminContext, type AdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Envío (y vista previa) de una plantilla de mensaje de WhatsApp con datos
 * reales (issue #35). El render vive en `lib/server/message-templates.ts`.
 *
 * `POST { templateId, target: { kind, id }, preview }`:
 * - `preview: true` (solo lectura) devuelve `{ message, phone }` con el texto
 *   completo para la vista previa del diálogo. No registra nada.
 * - sin `preview` registra el envío: auditoría con el actor real y, en cobros,
 *   la fila de `PaymentReminderLog` (canal WhatsApp) que ya usa Finanzas, así el
 *   estado «abierto hoy» sigue siendo el mismo. Falla claro si falta un dato
 *   (nunca devuelve `{{...}}`).
 *
 * WhatsApp no usa APIs externas: el panel abre el mensaje prellenado
 * (`wa.me`) y acá queda la constancia. La empresa demo es de solo lectura y
 * VIEWER no envía.
 */

type TargetKind = keyof typeof MESSAGE_TEMPLATE_TARGET_CATEGORIES;

function isTargetKind(value: unknown): value is TargetKind {
  return typeof value === "string" && value in MESSAGE_TEMPLATE_TARGET_CATEGORIES;
}

type ResolvedTarget = {
  kind: TargetKind;
  entity: "Budget" | "Event" | "Client" | "ClientPayment";
  label: string;
  phone: string | null;
  values: MessageTemplateVariableValues;
  /** Cobro a plazo: además del mensaje, registra el recordatorio del día. */
  reminder: ReminderTarget | null;
};

/** Carga el destinatario real (siempre acotado a la empresa activa) y arma sus variables. */
async function resolveTarget(
  context: AdminContext,
  kind: TargetKind,
  id: string,
): Promise<ResolvedTarget | null> {
  const sender = { organizationName: context.organization.name, sellerName: context.user.name };

  if (kind === "budget") {
    const budget = await db.budget.findFirst({
      where: { id, organizationId: context.organizationId },
      include: { client: true, payments: true },
    });
    if (!budget) return null;
    return {
      kind,
      entity: "Budget",
      label: budget.title,
      phone: budget.client.phone?.trim() || null,
      values: budgetMessageValues({
        ...sender,
        client: budget.client,
        budgetTitle: budget.title,
        total: budget.total,
        balance: budget.total - collectedAmount(budget.payments),
        validUntil: budget.validUntil,
        portalToken: budget.publicToken,
      }),
      reminder: null,
    };
  }

  if (kind === "event") {
    const event = await db.event.findFirst({
      where: { id, organizationId: context.organizationId },
      include: { client: true },
    });
    if (!event) return null;
    return {
      kind,
      entity: "Event",
      label: event.name,
      phone: event.client.phone?.trim() || null,
      values: eventMessageValues({
        ...sender,
        client: event.client,
        eventName: event.name,
        startsAt: event.startsAt,
        location: event.location,
      }),
      reminder: null,
    };
  }

  if (kind === "client") {
    const client = await db.client.findFirst({ where: { id, organizationId: context.organizationId } });
    if (!client) return null;
    return {
      kind,
      entity: "Client",
      label: client.company?.trim() || client.name,
      phone: client.phone?.trim() || null,
      values: clientMessageValues({ ...sender, client }),
      reminder: null,
    };
  }

  // Cobro a plazo pendiente: el mismo destinatario del recordatorio de Finanzas.
  const payment = await db.clientPayment.findFirst({
    where: { id, organizationId: context.organizationId, status: "PENDING" },
    include: { client: true, budget: { include: { payments: true } } },
  });
  if (!payment) return null;
  const balance = payment.budget ? payment.budget.total - collectedAmount(payment.budget.payments) : payment.amount;
  return {
    kind,
    entity: "ClientPayment",
    label: payment.client.company?.trim() || payment.client.name,
    phone: payment.client.phone?.trim() || null,
    values: collectionMessageValues({
      ...sender,
      client: payment.client,
      budgetTitle: payment.budget?.title ?? null,
      amount: payment.amount,
      balance,
      dueAt: payment.dueAt,
      portalToken: payment.budget?.publicToken ?? null,
    }),
    reminder: { kind: "payment", payment },
  };
}

export async function POST(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { context } = auth;

  const body = (await readJson(request)) as Record<string, unknown>;
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  const kind = isTargetKind((body.target as Record<string, unknown> | undefined)?.kind)
    ? ((body.target as Record<string, unknown>).kind as TargetKind)
    : null;
  const targetId = typeof (body.target as Record<string, unknown> | undefined)?.id === "string"
    ? ((body.target as Record<string, unknown>).id as string)
    : "";
  const preview = body.preview === true;
  if (!templateId || !kind || !targetId) {
    return jsonError("Indicá la plantilla y el destinatario del mensaje.", 400);
  }

  const template = await db.messageTemplate.findFirst({
    where: { id: templateId, organizationId: context.organizationId },
  });
  if (!template || !template.active) return jsonError("La plantilla no existe o está inactiva.", 404);
  if (!isMessageTemplateCategory(template.category) || template.category !== MESSAGE_TEMPLATE_TARGET_CATEGORIES[kind]) {
    return jsonError("La plantilla no corresponde a este contexto.", 400);
  }

  const target = await resolveTarget(context, kind, targetId);
  if (!target) {
    const label = kind === "budget" ? "presupuesto" : kind === "event" ? "evento" : kind === "client" ? "cliente" : "cobro pendiente";
    return jsonError(`No encontramos el ${label} en esta empresa.`, 404);
  }

  let message: string;
  try {
    message = renderMessageTemplate(template.body, target.values);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "No se pudo completar el mensaje.", 400);
  }

  if (preview) {
    return Response.json({ message, phone: target.phone });
  }

  if (context.demo) return jsonError("Modo demo: solo lectura", 403);
  // Enviar es una acción de comunicación: cualquier rol que no sea VIEWER
  // (misma regla que las acciones de los módulos). Administrar plantillas sí es
  // por categoría y rol (`canWriteTemplateCategory`).
  if (!canWrite(context.role)) return jsonError("Forbidden", 403);
  if (!target.phone) return jsonError("El cliente no tiene teléfono cargado.", 400);

  let alreadyToday = false;
  if (target.reminder) {
    const recorded = await recordWhatsappReminder({
      organizationId: context.organizationId,
      target: target.reminder,
      actor: context,
      templateTitle: template.title,
    });
    alreadyToday = recorded?.alreadyToday ?? false;
  } else {
    await recordAudit({
      context,
      action: "send",
      entity: target.entity,
      entityId: targetId,
      summary: `Envió por WhatsApp «${template.title}» a ${target.label}`,
      detail: { fields: { channel: "whatsapp", to: target.phone, template: template.title } },
    });
  }

  return Response.json({ message, phone: target.phone, templateId: template.id, registered: true, alreadyToday });
}
