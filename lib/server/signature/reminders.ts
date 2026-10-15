import { dayKeyOf, dayStart, shiftDayKey } from "../notifications";
import { db } from "../db";
import { isDemoOrganizationSlug } from "../demo-data";
import { recordAudit, type AuditContext } from "../audit";
import { emailConfigured, mailIdentityFor, sendMail } from "../mail";
import { buildSignatureReminderMail } from "../mail/signature";
import { signaturePortalUrl } from "@/lib/public-config";
import { appendSignatureEvent } from "./events";
import { signatureIsActive, signatureMethodLabel, type SignatureStatusValue } from "./rules";

/**
 * Recordatorios de vencimiento de firma (issue #81), en el mismo patrón de los
 * recordatorios de cobro (`lib/server/reminders.ts`):
 *
 * - Alcance: solicitudes **activas** (el cliente todavía puede firmar) cuyo
 *   vencimiento cae dentro de la ventana de aviso.
 * - Ventana **global** configurable por entorno:
 *   `SIGNATURE_REMINDER_DAYS_BEFORE` (días antes del vencimiento; default 3,
 *   entre 1 y 15). La configuración por solicitud queda para una fase
 *   siguiente; se eligió la global por ser la más simple y suficiente.
 * - Idempotencia **por cadena de auditoría**: si la solicitud ya tuvo hoy
 *   (Asunción) un correo —aviso original, reenvío o recordatorio— o un intento
 *   de recordatorio fallido, no se vuelve a intentar. Una solicitud recibe como
 *   máximo un recordatorio por día, sin columnas nuevas ni tablas de registro.
 * - Cada envío deja su evento (`EMAIL_SENT` con `tipo: recordatorio`, o
 *   `EMAIL_FAILED`) y su fila en `AuditLog`; si falta `RESEND_API_KEY` la
 *   corrida se omite con un log claro y sin romper nada.
 * - La empresa demo nunca despacha (sus contactos son ficticios).
 */

/** Días de antelación del recordatorio (env `SIGNATURE_REMINDER_DAYS_BEFORE`). */
export const SIGNATURE_REMINDER_DAYS_BEFORE = clampReminderDays(process.env.SIGNATURE_REMINDER_DAYS_BEFORE);

/** Normaliza los días de antelación: entero entre 1 y 15; sin dato, 3. */
export function clampReminderDays(value: unknown): number {
  const days = Math.round(Number(value));
  if (!Number.isFinite(days) || days < 1) return 3;
  return Math.min(days, 15);
}

/** Tope de recordatorios por corrida (una corrida grande no bloquea el panel). */
export const SIGNATURE_REMINDER_MAX_PER_RUN = 100;

/** Actor de auditoría del despacho automático (el actor real es el sistema). */
export function systemSignatureReminderActor(organizationId: string): AuditContext {
  return {
    organizationId,
    user: { id: "signature-reminders", name: "Recordatorios de firma", email: "", role: "VIEWER" },
  };
}

/** Ventana del recordatorio: fin del día de Asunción de hoy + `daysBefore`. */
export function signatureReminderWindow(
  now: Date,
  daysBefore = SIGNATURE_REMINDER_DAYS_BEFORE,
): { dayKey: string; windowEnd: Date } {
  const dayKey = dayKeyOf(now);
  return { dayKey, windowEnd: dayStart(shiftDayKey(dayKey, daysBefore + 1)) };
}

/** Días de Asunción que faltan para el vencimiento (0 = hoy, negativo = vencida). */
export function signatureReminderDaysLeft(expiresAt: Date, now: Date): number {
  const diff = dayStart(dayKeyOf(expiresAt)).getTime() - dayStart(dayKeyOf(now)).getTime();
  return Math.round(diff / 86_400_000);
}

/**
 * Decisión pura: ¿corresponde recordar hoy esta solicitud? Solo si sigue
 * activa, todavía no venció, entra en la ventana y hoy no hubo un correo ni un
 * intento de recordatorio (el llamador resuelve `emailedToday`).
 */
export function shouldRemindSignature(input: {
  status: string;
  expiresAt: Date;
  now: Date;
  windowEnd: Date;
  emailedToday: boolean;
}): boolean {
  if (input.emailedToday) return false;
  if (!signatureIsActive(input.status as SignatureStatusValue)) return false;
  if (input.expiresAt.getTime() <= input.now.getTime()) return false;
  return input.expiresAt.getTime() < input.windowEnd.getTime();
}

export type SignatureReminderRunSummary = {
  dayKey: string;
  /** Solicitudes activas dentro de la ventana (vencidas no cuentan). */
  candidates: number;
  sent: number;
  failed: number;
  /** Sin correo cargado: no se intenta y no se registra evento de correo. */
  skipped: number;
  alreadySentToday: number;
  /** Por qué no se envió nada: sin proveedor configurado o empresa demo. */
  reason?: "missing_resend_api_key" | "demo_organization";
};

/**
 * Despacho diario de recordatorios de firma de una empresa: recorre las
 * solicitudes activas que vencen dentro de la ventana y manda **un** recordatorio
 * por solicitud y día. Es idempotente (lo llaman el primer uso del panel y el
 * endpoint forzado, y repetirlo no duplica nada).
 */
export async function runDailySignatureReminders(input: {
  organizationId: string;
  now?: Date;
  actor?: AuditContext;
}): Promise<SignatureReminderRunSummary> {
  const now = input.now ?? new Date();
  const { dayKey, windowEnd } = signatureReminderWindow(now);
  const summary: SignatureReminderRunSummary = {
    dayKey,
    candidates: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    alreadySentToday: 0,
  };

  const organization = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, slug: true },
  });
  if (!organization) return summary;
  if (isDemoOrganizationSlug(organization.slug)) {
    return { ...summary, reason: "demo_organization" };
  }

  const rows = await db.signatureRequest.findMany({
    where: {
      organizationId: organization.id,
      status: { in: ["SENT", "DELIVERED", "VIEWED", "PENDING_SIGNATURE"] },
      expiresAt: { gt: now, lt: windowEnd },
    },
    orderBy: { expiresAt: "asc" },
    take: SIGNATURE_REMINDER_MAX_PER_RUN + 1,
    select: {
      id: true,
      title: true,
      publicCode: true,
      recipientName: true,
      recipientEmail: true,
      expiresAt: true,
      status: true,
      senderName: true,
      senderEmail: true,
      method: true,
    },
  });
  if (rows.length > SIGNATURE_REMINDER_MAX_PER_RUN) {
    console.warn(
      `[signature-reminders] Hay más de ${SIGNATURE_REMINDER_MAX_PER_RUN} solicitudes por recordar en la ventana; se recuerdan las más urgentes.`,
    );
  }
  const candidates = rows.slice(0, SIGNATURE_REMINDER_MAX_PER_RUN);
  summary.candidates = candidates.length;
  if (candidates.length === 0) return summary;

  if (!emailConfigured()) {
    console.warn(
      `[signature-reminders] RESEND_API_KEY ausente: se omiten ${candidates.length} recordatorio(s) del ${dayKey} (la corrida se reintenta en el próximo uso del panel).`,
    );
    return { ...summary, reason: "missing_resend_api_key" };
  }

  const todayStart = dayStart(dayKey);
  // Idempotencia por cadena: alcanza con un correo hoy (aviso, reenvío o
  // recordatorio) o con un intento de recordatorio fallido del mismo día.
  const contacted = await db.signatureEvent.findMany({
    where: {
      organizationId: organization.id,
      requestId: { in: candidates.map((row) => row.id) },
      occurredAt: { gte: todayStart },
      OR: [
        { eventType: "EMAIL_SENT" },
        { eventType: "EMAIL_FAILED", metadataJson: { path: ["tipo"], equals: "recordatorio" } },
      ],
    },
    select: { requestId: true },
    distinct: ["requestId"],
  });
  const emailedToday = new Set(contacted.map((row) => row.requestId));

  const actor = input.actor ?? systemSignatureReminderActor(organization.id);
  for (const row of candidates) {
    if (!row.recipientEmail) {
      summary.skipped += 1;
      continue;
    }
    if (!shouldRemindSignature({ status: row.status, expiresAt: row.expiresAt, now, windowEnd, emailedToday: emailedToday.has(row.id) })) {
      summary.alreadySentToday += 1;
      continue;
    }
    const daysLeft = signatureReminderDaysLeft(row.expiresAt, now);
    const identity = await mailIdentityFor(organization.id);
    const content = buildSignatureReminderMail({
      organizationName: organization.name,
      brand: identity.brand,
      title: row.title,
      recipientName: row.recipientName,
      senderName: row.senderName,
      code: row.publicCode,
      portalUrl: signaturePortalUrl(row.publicCode),
      expiresAt: row.expiresAt,
      daysLeft,
      methodLabel: signatureMethodLabel(row.method),
    });
    const result = await sendMail({
      to: row.recipientEmail,
      subject: content.subject,
      category: "signature",
      html: content.html,
      text: content.text,
      organizationId: organization.id,
      identity,
      entity: "SignatureRequest",
      entityId: row.id,
      actor: input.actor ? { id: input.actor.user.id, name: input.actor.user.name, email: input.actor.user.email } : null,
    });
    if (result.status === "sent") {
      summary.sent += 1;
      await db.signatureRequest.update({ where: { id: row.id }, data: { sentAt: new Date() } });
    } else if (result.status === "failed") {
      summary.failed += 1;
    } else {
      summary.skipped += 1;
    }
    await appendSignatureEvent({
      requestId: row.id,
      organizationId: organization.id,
      eventType: result.status === "sent" ? "EMAIL_SENT" : "EMAIL_FAILED",
      status: row.status as SignatureStatusValue,
      actor: { type: "SYSTEM" },
      metadata: {
        tipo: "recordatorio",
        to: row.recipientEmail,
        diasRestantes: daysLeft,
        vence: row.expiresAt.toISOString(),
        motivo: result.status === "sent" ? null : result.error ?? "Sin proveedor de correo configurado",
      },
    });
    await recordAudit({
      context: actor,
      action: "remind",
      entity: "SignatureRequest",
      entityId: row.id,
      summary:
        result.status === "sent"
          ? `Envió el recordatorio de firma de «${row.title}» a «${row.recipientName}» (vence en ${daysLeft} día${daysLeft === 1 ? "" : "s"})`
          : `Falló el recordatorio de firma de «${row.title}»: ${result.error ?? "sin proveedor de correo"}`.slice(0, 400),
      detail: {
        fields: {
          tipo: "recordatorio",
          to: row.recipientEmail,
          vence: row.expiresAt,
          diasRestantes: daysLeft,
          status: result.status,
          ...(result.error ? { error: result.error } : {}),
        },
      },
    });
  }

  console.info(
    `[signature-reminders] ${dayKey}: ${summary.sent} enviados, ${summary.failed} fallidos, ${summary.skipped} sin correo, ${summary.alreadySentToday} ya emailados hoy (de ${summary.candidates} en la ventana de ${SIGNATURE_REMINDER_DAYS_BEFORE} días).`,
  );
  return summary;
}
