import { randomUUID } from "node:crypto";
import type { PaymentReminderLog, Prisma } from "@prisma/client";
import { daysUntilDue, formatDate, formatMoney, formatNumber } from "@/lib/admin-format";
import { portalBudgetUrl } from "@/lib/public-config";
import { recordAudit, type AuditContext } from "./audit";
import { parsePaymentDetails, type PortalBudgetPaymentDetails } from "./budget-portal";
import { db } from "./db";
import { isDemoOrganizationSlug } from "./demo-data";
import { dayKeyOf, dayStart, shiftDayKey } from "./notifications";
import { renderMail, renderMailText, type MailRow } from "./mail";
import { emailConfigured, sendReminderEmail } from "./resend";

/**
 * Recordatorios de cobro al cliente (issue #19).
 *
 * Alcance: cobros a plazo todavía pendientes (`ClientPayment.status = PENDING`)
 * con vencimiento vencido o dentro de los próximos 7 días, medidos por día de
 * Asunción (misma ventana que los avisos internos).
 *
 * Idempotencia sin cron externo: cada envío se registra en `PaymentReminderLog`
 * y el índice único `(paymentId, channel, dayKey)` garantiza **un recordatorio
 * por cobro y canal por día**, aunque corran a la vez el despacho automático
 * (al primer uso del panel) y el envío manual. El correo viaja por Resend
 * (`lib/server/resend.ts`); si falta `RESEND_API_KEY` la corrida se omite con un
 * log claro y no rompe nada. WhatsApp no usa APIs externas: el panel abre el
 * mensaje prellenado y acá solo se registra la apertura (status `opened`).
 *
 * La organización demo nunca despacha: sus contactos son ficticios.
 */

/** Días de antelación con los que se recuerda un vencimiento (misma ventana que los avisos). */
export const REMINDER_WINDOW_DAYS = 7;

/** Canales del recordatorio (espejo del enum `PaymentReminderChannel`). */
export const REMINDER_CHANNELS = ["email", "whatsapp"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

/** Tope de recordatorios por corrida (una corrida grande no bloquea el panel). */
const MAX_REMINDERS_PER_RUN = 100;

const ACTOR_SYSTEM = {
  id: "reminders",
  name: "Recordatorios automáticos",
  email: "",
} as const;

/** Actor de auditoría del despacho automático (el actor real es el sistema). */
export function systemReminderActor(organizationId: string): AuditContext {
  return { organizationId, user: { ...ACTOR_SYSTEM, role: "VIEWER" } };
}

const reminderPaymentInclude = { client: true, budget: true } as const;
export type ReminderPayment = Prisma.ClientPaymentGetPayload<{ include: typeof reminderPaymentInclude }>;

type ReminderOrganization = {
  id: string;
  name: string;
  slug: string;
  paymentDetails: Prisma.JsonValue;
};

// ── Alcance y contenido ─────────────────────────────────────────────────────

/**
 * Cobros pendientes que corresponden recordar hoy: vencidos o por vencer dentro
 * de la ventana, ordenados por vencimiento. Se filtra por día de Asunción: un
 * cobro que vence a 8 días todavía no se recuerda.
 */
export async function listPendingReminderPayments(
  organizationId: string,
  now = new Date(),
): Promise<ReminderPayment[]> {
  const todayKey = dayKeyOf(now);
  const windowEnd = dayStart(shiftDayKey(todayKey, REMINDER_WINDOW_DAYS + 1));
  const payments = await db.clientPayment.findMany({
    where: { organizationId, status: "PENDING", dueAt: { not: null, lt: windowEnd } },
    orderBy: { dueAt: "asc" },
    take: MAX_REMINDERS_PER_RUN + 1,
    include: reminderPaymentInclude,
  });
  if (payments.length > MAX_REMINDERS_PER_RUN) {
    console.warn(
      `[reminders] Hay más de ${MAX_REMINDERS_PER_RUN} cobros por recordar en la ventana de ${REMINDER_WINDOW_DAYS} días; se recuerdan los más urgentes.`,
    );
    return payments.slice(0, MAX_REMINDERS_PER_RUN);
  }
  return payments;
}

export function clientLabel(client: { name: string; company: string | null }): string {
  return client.company?.trim() || client.name;
}

/** Concepto del cobro para asuntos y resúmenes: factura, presupuesto o cuota. */
function reminderConcept(input: { invoiceNumber: string | null; budgetTitle: string | null }): string {
  if (input.invoiceNumber) return `factura ${input.invoiceNumber}`;
  if (input.budgetTitle) return `presupuesto «${input.budgetTitle}»`;
  return "cuota pendiente";
}

/** Cuenta regresiva del vencimiento en lenguaje del cliente: "vence en 3 días". */
function clientDueText(dueAt: Date): string {
  const days = daysUntilDue(dueAt);
  if (days === null) return "";
  if (days === 0) return "vence hoy";
  if (days === 1) return "vence mañana";
  if (days === -1) return "venció ayer";
  return days > 0 ? `vence en ${formatNumber(days)} días` : `venció hace ${formatNumber(Math.abs(days))} días`;
}

export type PaymentReminderEmail = {
  subject: string;
  html: string;
  /** Alternativa en texto plano (misma información). */
  text: string;
};

export type PaymentReminderEmailInput = {
  organizationName: string;
  client: { name: string; company: string | null };
  amount: number;
  dueAt: Date;
  invoiceNumber: string | null;
  budgetTitle: string | null;
  portalUrl: string | null;
  paymentDetails: PortalBudgetPaymentDetails | null;
};

/**
 * Recordatorio con la plantilla única de correo: número de factura o
 * presupuesto, monto, vencimiento con su cuenta regresiva, link del portal y
 * datos de pago de la empresa cuando están cargados. Sin link no se inventa uno.
 * Los textos clave se mantienen respecto de la versión anterior.
 */
export function buildPaymentReminderEmail(input: PaymentReminderEmailInput): PaymentReminderEmail {
  const due = formatDate(input.dueAt);
  const concept = reminderConcept(input);
  const dueText = clientDueText(input.dueAt);
  const subject = `Recordatorio de pago · ${concept} · ${dueText || "vence"} el ${due}`;

  const rows: MailRow[] = [
    { label: "Monto", value: formatMoney(input.amount), strong: true },
    { label: "Vencimiento", value: [due, dueText].filter(Boolean).join(" · "), strong: true },
  ];
  if (input.invoiceNumber) rows.push({ label: "Factura", value: input.invoiceNumber });
  if (input.budgetTitle) rows.push({ label: "Presupuesto", value: input.budgetTitle });

  const details = input.paymentDetails;
  if (details) {
    if (details.bank) rows.push({ label: "Banco", value: details.bank });
    if (details.holder) rows.push({ label: "Titular", value: details.holder });
    if (details.account) rows.push({ label: "Cuenta", value: details.account });
    if (details.alias) rows.push({ label: "Alias", value: details.alias });
  }

  const content = {
    title: `Recordatorio de pago · ${dueText || `vence el ${due}`}`,
    intro: [
      `Hola ${clientLabel(input.client)}:`,
      `Te escribimos de ${input.organizationName} para recordarte un pago pendiente.`,
    ],
    rows,
    cta: input.portalUrl ? { label: "Ver el detalle y pagar en el portal", url: input.portalUrl } : null,
    note: "Si ya abonaste este pago, ignorá este mensaje.",
    preheader: `${formatMoney(input.amount)} · ${dueText || `vence el ${due}`}`,
    organization: input.organizationName,
    reason: `el equipo de ${input.organizationName} te recuerda un pago pendiente`,
  };

  return { subject, html: renderMail(content), text: renderMailText(content) };
}

/** Link del portal del cobro: el del presupuesto asociado, si tiene token activo. */
export function paymentPortalUrl(payment: { budget: { publicToken: string | null } | null }): string | null {
  const token = payment.budget?.publicToken;
  return token ? portalBudgetUrl(token) : null;
}

// ── Registro y envío ────────────────────────────────────────────────────────

export type PaymentReminderOutcome = {
  /** `sent` (proveedor lo aceptó), `failed` (el proveedor lo rechazó) o `skipped` (no se intentó). */
  status: "sent" | "failed" | "skipped";
  reminder: PaymentReminderLog | null;
  /** Ya había un recordatorio de hoy para este cobro y canal. */
  alreadySentToday: boolean;
  error?: string;
};

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: string }).code === "P2002";
}

/** Estado del registro → resultado del envío (`sending` en curso no es un fallo). */
function reminderOutcomeOf(status: PaymentReminderLog["status"]): PaymentReminderOutcome["status"] {
  if (status === "sent") return "sent";
  if (status === "sending") return "skipped";
  return "failed";
}

/** Copia del actor para el registro: el sistema no tiene usuario del panel. */
function actorFields(actor: AuditContext) {
  return {
    actorKind: actor.user.id === ACTOR_SYSTEM.id ? "system" : "admin",
    actorId: actor.user.id,
    actorName: actor.user.name,
    actorEmail: actor.user.email,
  };
}

/**
 * Envía el recordatorio por email de un cobro y lo registra.
 *
 * - Sin correo del cliente → `skipped` (no se registra nada: cuando se cargue el
 *   correo, el recordatorio del día sigue disponible).
 * - Con un registro de hoy: `alreadySentToday` (no se reenvía). El envío manual
 *   puede pedir `retryFailed` para reintentar un intento fallido del mismo día
 *   actualizando la misma fila (nunca se duplica).
 */
export async function sendPaymentReminderEmail(input: {
  organization: ReminderOrganization;
  payment: ReminderPayment;
  actor: AuditContext;
  now?: Date;
  retryFailed?: boolean;
}): Promise<PaymentReminderOutcome> {
  const { organization, payment, actor } = input;
  const now = input.now ?? new Date();
  const dayKey = dayKeyOf(now);
  const to = (payment.client.email ?? "").trim().toLowerCase();
  const label = clientLabel(payment.client);
  if (!to) {
    return { status: "skipped", reminder: null, alreadySentToday: false, error: "El cliente no tiene correo cargado." };
  }

  const existing = await db.paymentReminderLog.findUnique({
    where: { paymentId_channel_dayKey: { paymentId: payment.id, channel: "email", dayKey } },
  });
  if (existing && !(input.retryFailed && existing.status === "failed")) {
    return {
      status: reminderOutcomeOf(existing.status),
      reminder: existing,
      alreadySentToday: true,
      error: existing.error ?? undefined,
    };
  }

  const content = buildPaymentReminderEmail({
    organizationName: organization.name,
    client: payment.client,
    amount: payment.amount,
    dueAt: payment.dueAt ?? now,
    invoiceNumber: payment.invoiceNumber,
    budgetTitle: payment.budget?.title ?? null,
    portalUrl: paymentPortalUrl(payment),
    paymentDetails: parsePaymentDetails(organization.paymentDetails),
  });

  const data = {
    status: "sending" as const,
    to,
    dayKey,
    subject: content.subject,
    error: null,
    sentAt: now,
    ...actorFields(actor),
  };
  let reminder: PaymentReminderLog;
  if (existing) {
    // Reintento explícito del mismo día: se actualiza la fila, no se duplica.
    reminder = await db.paymentReminderLog.update({ where: { id: existing.id }, data });
  } else {
    try {
      reminder = await db.paymentReminderLog.create({
        data: { id: randomUUID(), organizationId: organization.id, paymentId: payment.id, channel: "email", ...data },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await db.paymentReminderLog.findUnique({
        where: { paymentId_channel_dayKey: { paymentId: payment.id, channel: "email", dayKey } },
      });
      return {
        status: concurrent ? reminderOutcomeOf(concurrent.status) : "skipped",
        reminder: concurrent,
        alreadySentToday: true,
      };
    }
  }

  const concept = reminderConcept({ invoiceNumber: payment.invoiceNumber, budgetTitle: payment.budget?.title ?? null });
  const detail = {
    fields: {
      channel: "email",
      to,
      amount: payment.amount,
      dueAt: payment.dueAt,
      invoiceNumber: payment.invoiceNumber,
    },
  };
  try {
    await sendReminderEmail({
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      organizationId: organization.id,
      paymentId: payment.id,
      actor: { id: actor.user.id, name: actor.user.name, email: actor.user.email },
    });
    reminder = await db.paymentReminderLog.update({
      where: { id: reminder.id },
      data: { status: "sent", error: null },
    });
    await recordAudit({
      context: actor,
      action: "remind",
      entity: "ClientPayment",
      entityId: payment.id,
      summary: `Envió el recordatorio de pago por email a «${label}» (${concept})`,
      detail,
    });
    return { status: "sent", reminder, alreadySentToday: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo enviar el recordatorio.";
    reminder = await db.paymentReminderLog.update({
      where: { id: reminder.id },
      data: { status: "failed", error: message.slice(0, 300) },
    });
    console.error(`[reminders] Falló el recordatorio de «${label}» (${to}): ${message}`);
    await recordAudit({
      context: actor,
      action: "remind",
      entity: "ClientPayment",
      entityId: payment.id,
      summary: `Falló el recordatorio de pago por email a «${label}»: ${message}`.slice(0, 400),
      detail: { fields: { ...detail.fields, status: "failed" } },
    });
    return { status: "failed", reminder, alreadySentToday: false, error: message };
  }
}

/**
 * Registra que el equipo abrió el mensaje de WhatsApp del cobro (el envío lo
 * confirma el equipo en WhatsApp; acá queda la constancia del día). Un solo
 * registro por cobro y día: los clics repetidos no duplican ni ensucian la
 * auditoría.
 */
export async function recordWhatsappReminder(input: {
  organizationId: string;
  payment: { id: string; client: { name: string; company: string | null; phone: string | null } };
  actor: AuditContext;
  now?: Date;
}): Promise<{ reminder: PaymentReminderLog; alreadyToday: boolean } | null> {
  const now = input.now ?? new Date();
  const dayKey = dayKeyOf(now);
  const to = (input.payment.client.phone ?? "").trim();
  if (!to) return null;
  const label = clientLabel(input.payment.client);

  try {
    const reminder = await db.paymentReminderLog.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        paymentId: input.payment.id,
        channel: "whatsapp",
        status: "opened",
        to,
        dayKey,
        subject: null,
        error: null,
        sentAt: now,
        ...actorFields(input.actor),
      },
    });
    await recordAudit({
      context: input.actor,
      action: "remind",
      entity: "ClientPayment",
      entityId: input.payment.id,
      summary: `Abrió WhatsApp para recordarle el pago a «${label}»`,
      detail: { fields: { channel: "whatsapp", to, status: "opened" } },
    });
    return { reminder, alreadyToday: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.paymentReminderLog.findUnique({
      where: { paymentId_channel_dayKey: { paymentId: input.payment.id, channel: "whatsapp", dayKey } },
    });
    return existing ? { reminder: existing, alreadyToday: true } : null;
  }
}

// ── Despacho diario ─────────────────────────────────────────────────────────

export type ReminderRunSummary = {
  dayKey: string;
  /** Cobros pendientes dentro de la ventana (vencidos o por vencer). */
  candidates: number;
  sent: number;
  failed: number;
  /** Sin correo del cliente: no se intenta y no se registra. */
  skipped: number;
  alreadySentToday: number;
  /** Por qué no se envió nada: sin proveedor configurado o empresa demo. */
  reason?: "missing_resend_api_key" | "demo_organization";
};

/**
 * Despacho diario: recorre los cobros pendientes de la ventana y manda **un**
 * recordatorio por cobro y día. Lo llaman el primer uso del panel del día y el
 * endpoint forzado; es idempotente, así que repetirlo no duplica nada.
 */
export async function runDailyPaymentReminders(input: {
  organizationId: string;
  now?: Date;
  actor?: AuditContext;
}): Promise<ReminderRunSummary> {
  const now = input.now ?? new Date();
  const dayKey = dayKeyOf(now);
  const summary: ReminderRunSummary = { dayKey, candidates: 0, sent: 0, failed: 0, skipped: 0, alreadySentToday: 0 };

  const organization = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, slug: true, paymentDetails: true },
  });
  if (!organization) return summary;
  if (isDemoOrganizationSlug(organization.slug)) {
    return { ...summary, reason: "demo_organization" };
  }

  const candidates = await listPendingReminderPayments(organization.id, now);
  summary.candidates = candidates.length;
  if (candidates.length === 0) return summary;

  if (!emailConfigured()) {
    console.warn(
      `[reminders] RESEND_API_KEY ausente: se omiten ${candidates.length} recordatorio(s) del ${dayKey} (la corrida se reintenta en el próximo uso del panel).`,
    );
    return { ...summary, reason: "missing_resend_api_key" };
  }

  const actor = input.actor ?? systemReminderActor(organization.id);
  const todayLogs = await db.paymentReminderLog.findMany({
    where: { organizationId: organization.id, channel: "email", dayKey },
    select: { paymentId: true },
  });
  const alreadyToday = new Set(todayLogs.map((log) => log.paymentId));

  for (const payment of candidates) {
    if (alreadyToday.has(payment.id)) {
      summary.alreadySentToday += 1;
      continue;
    }
    const outcome = await sendPaymentReminderEmail({ organization, payment, actor, now });
    if (outcome.status === "sent") summary.sent += 1;
    else if (outcome.status === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }

  console.info(
    `[reminders] ${dayKey}: ${summary.sent} enviados, ${summary.failed} fallidos, ${summary.skipped} sin correo, ${summary.alreadySentToday} ya enviados (de ${summary.candidates} cobros en la ventana).`,
  );
  return summary;
}
