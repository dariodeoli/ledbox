import { randomUUID } from "node:crypto";
import type { MailStatus } from "@prisma/client";
import { normalizeEmail } from "@/lib/field-rules";
import { db } from "../db";
import { emailConfigured, missingApiKeyMessage, sendThroughProvider } from "./transport";

/**
 * Envío único de correo de la app (`sendMail`).
 *
 * Decide la plantilla quien llama (`renderMail`), pero **todos** los envíos
 * pasan por acá: la clave del proveedor, el remitente y el historial
 * (`MailLog`) viven en un solo lugar. El historial es la verificación de envío
 * del panel: una fila por intento con destinatario, categoría, estado real del
 * proveedor, motivo del fallo e id del mensaje.
 *
 * Decisiones:
 * - Categorías cerradas (`MAIL_CATEGORIES`) para el historial y los asuntos:
 *   `reset`, `reminder`, `budget`, `test` e `invitation` (esta última cuando
 *   llegue el flujo de invitaciones, issue #31).
 * - El historial NO reemplaza la bitácora de recordatorios
 *   (`PaymentReminderLog`, que garantiza un recordatorio por cobro y día): la
 *   complementa con el resultado crudo del proveedor.
 * - `sendMail` no lanza: devuelve `sent`, `failed` (con el error del proveedor)
 *   o `skipped` (sin `RESEND_API_KEY` o sin destinatario; no se registra porque
 *   no hubo intento real).
 * - El mejor esfuerzo al registrar: si el historial falla, el envío no se
 *   bloquea y el problema queda en consola.
 */

/** Categorías de correo de la app (el historial y los asuntos se agrupan así). */
export const MAIL_CATEGORIES = ["reset", "reminder", "budget", "test", "invitation"] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export type MailActor = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
};

export type SendMailInput = {
  to: string;
  subject: string;
  category: MailCategory;
  html: string;
  text?: string;
  /** Empresa activa; los correos de plataforma (reset sin empresa) van en `null`. */
  organizationId?: string | null;
  /** Entidad relacionada (por ejemplo `Budget`) y su id. */
  entity?: string | null;
  entityId?: string | null;
  /** Actor real del panel que disparó el envío (lo dibuja el historial). */
  actor?: MailActor | null;
  /** Instante del intento (lo usan las pruebas y los registros). */
  now?: Date;
};

export type SendMailResult = {
  /** `sent` (proveedor lo aceptó), `failed` (lo rechazó) o `skipped` (no se intentó). */
  status: "sent" | "failed" | "skipped";
  /** Motivo del fallo o de la omisión. */
  error?: string;
  providerId?: string | null;
  /** Fila del historial; `null` cuando no hubo intento o no se pudo registrar. */
  logId?: string | null;
};

const MAX_ERROR = 300;

async function writeMailLog(data: {
  id: string;
  organizationId: string | null;
  category: MailCategory;
  status: MailStatus;
  to: string;
  subject: string;
  entity: string | null;
  entityId: string | null;
  actor: MailActor | null;
  sentAt: Date;
}): Promise<boolean> {
  try {
    await db.mailLog.create({
      data: {
        id: data.id,
        organizationId: data.organizationId,
        category: data.category,
        status: data.status,
        to: data.to,
        subject: data.subject,
        entity: data.entity,
        entityId: data.entityId,
        actorId: data.actor?.id ?? null,
        actorName: data.actor?.name ?? null,
        actorEmail: data.actor?.email ?? null,
        sentAt: data.sentAt,
      },
    });
    return true;
  } catch (error) {
    console.error(
      `[mail] No se pudo registrar el envío ${data.category} a ${data.to}:`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

async function updateMailLog(id: string, data: { status: MailStatus; error: string | null; providerId: string | null }): Promise<void> {
  try {
    await db.mailLog.update({ where: { id }, data: { status: data.status, error: data.error, providerId: data.providerId } });
  } catch (error) {
    console.error(`[mail] No se pudo actualizar el envío ${id}:`, error instanceof Error ? error.message : error);
  }
}

/** Envía un correo y lo registra en el historial. Nunca lanza. */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const to = normalizeEmail(input.to);
  if (!to) return { status: "skipped", error: "Sin destinatario." };
  if (!emailConfigured()) return { status: "skipped", error: missingApiKeyMessage() };

  const now = input.now ?? new Date();
  const logId = randomUUID();
  const actor = input.actor ?? null;
  const organizationId = input.organizationId?.trim() || null;
  const registered = await writeMailLog({
    id: logId,
    organizationId,
    category: input.category,
    status: "sending",
    to,
    subject: input.subject,
    entity: input.entity ?? null,
    entityId: input.entityId ?? null,
    actor,
    sentAt: now,
  });

  const outcome = await sendThroughProvider({ to, subject: input.subject, html: input.html, text: input.text });
  const status: MailStatus = outcome.error ? "failed" : "sent";
  const error = outcome.error ? outcome.error.slice(0, MAX_ERROR) : null;
  if (registered) await updateMailLog(logId, { status, error, providerId: outcome.providerId });

  if (outcome.error) {
    console.error(`[mail] Falló el envío ${input.category} a ${to}: ${error}`);
    return { status: "failed", error: error ?? undefined, providerId: null, logId: registered ? logId : null };
  }
  return { status: "sent", providerId: outcome.providerId, logId: registered ? logId : null };
}
