import { randomUUID } from "node:crypto";
import type { PaymentReminderLog, Prisma } from "@prisma/client";
import { daysUntilDue, formatDate, formatMoney, formatNumber } from "@/lib/admin-format";
import { portalBudgetUrl } from "@/lib/public-config";
import { recordAudit, type AuditContext } from "./audit";
import { parsePaymentDetails, type PortalBudgetPaymentDetails } from "./budget-portal";
import { db } from "./db";
import { isDemoOrganizationSlug } from "./demo-data";
import { dayKeyOf, dayStart, shiftDayKey } from "./notifications";
import { emailConfigured, sendReminderEmail } from "./resend";

/**
 * Recordatorios de cobro al cliente (issues #19 y #28).
 *
 * Alcance: cobros a plazo todavía pendientes (`ClientPayment.status = PENDING`)
 * y pagos esperados del plan que siguen esperando la transferencia
 * (`ExpectedPayment.status = AWAITING`), con vencimiento vencido o dentro de los
 * próximos 7 días, medidos por día de Asunción (misma ventana que los avisos
 * internos). Un pago esperado con comprobante en revisión no se reclama.
 *
 * Idempotencia sin cron externo: cada envío se registra en `PaymentReminderLog`
 * y el índice único `(targetKey, channel, dayKey)` garantiza **un recordatorio
 * por destinatario y canal por día** —`client:<paymentId>` o
 * `expected:<expectedPaymentId>`—, aunque corran a la vez el despacho automático
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

const reminderExpectedInclude = { budget: { include: { client: true } } } as const;
export type ReminderExpectedPayment = Prisma.ExpectedPaymentGetPayload<{ include: typeof reminderExpectedInclude }>;

/** Destinatario de un recordatorio: un cobro a plazo o un pago esperado del plan. */
export type ReminderTarget =
  | { kind: "payment"; payment: ReminderPayment }
  | { kind: "expected"; expected: ReminderExpectedPayment };

/** Clave estable del destinatario en `PaymentReminderLog.targetKey`. */
export function reminderTargetKey(target: ReminderTarget): string {
  return target.kind === "payment" ? `client:${target.payment.id}` : `expected:${target.expected.id}`;
}

type ReminderTargetFields = {
  targetKey: string;
  paymentId: string | null;
  expectedPaymentId: string | null;
  label: string;
  amount: number;
  dueAt: Date;
  invoiceNumber: string | null;
  budgetTitle: string | null;
  portalUrl: string | null;
  client: { name: string; company: string | null; email: string | null; phone: string | null };
  concept: string;
};

/** Campos reales del recordatorio, comunes a cobros y pagos esperados. */
export function reminderTargetFields(target: ReminderTarget): ReminderTargetFields {
  if (target.kind === "payment") {
    const { payment } = target;
    return {
      targetKey: reminderTargetKey(target),
      paymentId: payment.id,
      expectedPaymentId: null,
      label: clientLabel(payment.client),
      amount: payment.amount,
      dueAt: payment.dueAt ?? new Date(),
      invoiceNumber: payment.invoiceNumber,
      budgetTitle: payment.budget?.title ?? null,
      portalUrl: paymentPortalUrl(payment),
      client: payment.client,
      concept: reminderConcept({ invoiceNumber: payment.invoiceNumber, budgetTitle: payment.budget?.title ?? null }),
    };
  }
  const { expected } = target;
  const client = expected.budget.client;
  return {
    targetKey: reminderTargetKey(target),
    paymentId: null,
    expectedPaymentId: expected.id,
    label: clientLabel(client),
    amount: expected.amount,
    dueAt: expected.dueAt ?? new Date(),
    invoiceNumber: null,
    budgetTitle: expected.budget.title,
    portalUrl: expected.budget.publicToken ? portalBudgetUrl(expected.budget.publicToken) : null,
    client,
    concept: `${expected.label} del presupuesto «${expected.budget.title}»`,
  };
}

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

/**
 * Pagos esperados que corresponden recordar hoy (issue #28): conceptos del plan
 * en `AWAITING` (sin comprobante en revisión) con vencimiento vencido o por
 * vencer dentro de la ventana, ordenados por vencimiento. El anticipo vence el
 * día de la aprobación; el saldo sin fecha no se recuerda.
 */
export async function listPendingReminderExpectedPayments(
  organizationId: string,
  now = new Date(),
): Promise<ReminderExpectedPayment[]> {
  const todayKey = dayKeyOf(now);
  const windowEnd = dayStart(shiftDayKey(todayKey, REMINDER_WINDOW_DAYS + 1));
  const expected = await db.expectedPayment.findMany({
    where: { organizationId, status: "AWAITING", dueAt: { not: null, lt: windowEnd } },
    orderBy: { dueAt: "asc" },
    take: MAX_REMINDERS_PER_RUN + 1,
    include: reminderExpectedInclude,
  });
  if (expected.length > MAX_REMINDERS_PER_RUN) {
    console.warn(
      `[reminders] Hay más de ${MAX_REMINDERS_PER_RUN} pagos esperados por recordar en la ventana de ${REMINDER_WINDOW_DAYS} días; se recuerdan los más urgentes.`,
    );
    return expected.slice(0, MAX_REMINDERS_PER_RUN);
  }
  return expected;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
 * Plantilla del recordatorio: número de factura o presupuesto, monto,
 * vencimiento con su cuenta regresiva, link del portal y datos de pago de la
 * empresa cuando están cargados. Sin link no se inventa uno.
 */
export function buildPaymentReminderEmail(input: PaymentReminderEmailInput): PaymentReminderEmail {
  const due = formatDate(input.dueAt);
  const concept = reminderConcept(input);
  const dueText = clientDueText(input.dueAt);
  const subject = `Recordatorio de pago · ${concept} · ${dueText || "vence"} el ${due}`;

  const rows: string[] = [
    `<tr><td style="padding:2px 12px 2px 0;color:#5b6672">Monto</td><td style="padding:2px 0;font-weight:600;white-space:nowrap">${escapeHtml(formatMoney(input.amount))}</td></tr>`,
    `<tr><td style="padding:2px 12px 2px 0;color:#5b6672">Vencimiento</td><td style="padding:2px 0;font-weight:600;white-space:nowrap">${escapeHtml([due, dueText].filter(Boolean).join(" · "))}</td></tr>`,
  ];
  if (input.invoiceNumber) {
    rows.push(
      `<tr><td style="padding:2px 12px 2px 0;color:#5b6672">Factura</td><td style="padding:2px 0;font-weight:600">${escapeHtml(input.invoiceNumber)}</td></tr>`,
    );
  }
  if (input.budgetTitle) {
    rows.push(
      `<tr><td style="padding:2px 12px 2px 0;color:#5b6672">Presupuesto</td><td style="padding:2px 0;font-weight:600">${escapeHtml(input.budgetTitle)}</td></tr>`,
    );
  }

  const details = input.paymentDetails;
  const detailsLine = details
    ? [
        details.bank ? `Banco: ${details.bank}` : null,
        details.holder ? `Titular: ${details.holder}` : null,
        details.account ? `Cuenta: ${details.account}` : null,
        details.alias ? `Alias: ${details.alias}` : null,
      ]
        .filter((part): part is string => Boolean(part))
        .join(" · ")
    : "";

  const html = [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.6;color:#101418">`,
    `<p>Hola ${escapeHtml(clientLabel(input.client))}:</p>`,
    `<p>Te escribimos de ${escapeHtml(input.organizationName)} para recordarte un pago pendiente.</p>`,
    `<table cellpadding="0" cellspacing="0" style="margin:0 0 14px;font-size:15px">${rows.join("")}</table>`,
    input.portalUrl
      ? `<p><a href="${input.portalUrl}" style="display:inline-block;padding:9px 14px;border-radius:8px;background:#101418;color:#ffffff;text-decoration:none;font-weight:700">Ver el detalle y pagar en el portal</a></p><p style="color:#5b6672;font-size:13px">O copiá este link: ${escapeHtml(input.portalUrl)}</p>`
      : "",
    detailsLine
      ? `<p><strong>Datos de pago</strong><br>${escapeHtml(detailsLine)}</p>`
      : "",
    `<p>Si ya abonaste este pago, ignorá este mensaje.</p>`,
    `<p>Gracias,<br>${escapeHtml(input.organizationName)}</p>`,
    `</div>`,
  ]
    .filter(Boolean)
    .join("");

  return { subject, html };
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
 * Envía el recordatorio por email de un destinatario (cobro a plazo o pago
 * esperado) y lo registra.
 *
 * - Sin correo del cliente → `skipped` (no se registra nada: cuando se cargue el
 *   correo, el recordatorio del día sigue disponible).
 * - Con un registro de hoy: `alreadySentToday` (no se reenvía). El envío manual
 *   puede pedir `retryFailed` para reintentar un intento fallido del mismo día
 *   actualizando la misma fila (nunca se duplica).
 */
export async function sendReminderEmailForTarget(input: {
  organization: ReminderOrganization;
  target: ReminderTarget;
  actor: AuditContext;
  now?: Date;
  retryFailed?: boolean;
}): Promise<PaymentReminderOutcome> {
  const { organization, actor } = input;
  const fields = reminderTargetFields(input.target);
  const now = input.now ?? new Date();
  const dayKey = dayKeyOf(now);
  const to = (fields.client.email ?? "").trim().toLowerCase();
  const label = fields.label;
  if (!to) {
    return { status: "skipped", reminder: null, alreadySentToday: false, error: "El cliente no tiene correo cargado." };
  }

  const existing = await db.paymentReminderLog.findUnique({
    where: { targetKey_channel_dayKey: { targetKey: fields.targetKey, channel: "email", dayKey } },
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
    client: fields.client,
    amount: fields.amount,
    dueAt: fields.dueAt,
    invoiceNumber: fields.invoiceNumber,
    budgetTitle: fields.budgetTitle,
    portalUrl: fields.portalUrl,
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
        data: {
          id: randomUUID(),
          organizationId: organization.id,
          paymentId: fields.paymentId,
          expectedPaymentId: fields.expectedPaymentId,
          targetKey: fields.targetKey,
          channel: "email",
          ...data,
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await db.paymentReminderLog.findUnique({
        where: { targetKey_channel_dayKey: { targetKey: fields.targetKey, channel: "email", dayKey } },
      });
      return {
        status: concurrent ? reminderOutcomeOf(concurrent.status) : "skipped",
        reminder: concurrent,
        alreadySentToday: true,
      };
    }
  }

  const concept = fields.concept;
  const detail = {
    fields: {
      channel: "email",
      to,
      amount: fields.amount,
      dueAt: fields.dueAt,
      invoiceNumber: fields.invoiceNumber,
      ...(fields.expectedPaymentId ? { expectedPaymentId: fields.expectedPaymentId } : {}),
    },
  };
  try {
    await sendReminderEmail({ to, subject: content.subject, html: content.html });
    reminder = await db.paymentReminderLog.update({
      where: { id: reminder.id },
      data: { status: "sent", error: null },
    });
    await recordAudit({
      context: actor,
      action: "remind",
      entity: fields.expectedPaymentId ? "ExpectedPayment" : "ClientPayment",
      entityId: fields.expectedPaymentId ?? (fields.paymentId as string),
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
      entity: fields.expectedPaymentId ? "ExpectedPayment" : "ClientPayment",
      entityId: fields.expectedPaymentId ?? (fields.paymentId as string),
      summary: `Falló el recordatorio de pago por email a «${label}»: ${message}`.slice(0, 400),
      detail: { fields: { ...detail.fields, status: "failed" } },
    });
    return { status: "failed", reminder, alreadySentToday: false, error: message };
  }
}

/** Compatibilidad: recordatorio por email de un cobro de cliente (`POST /reminders`). */
export function sendPaymentReminderEmail(input: {
  organization: ReminderOrganization;
  payment: ReminderPayment;
  actor: AuditContext;
  now?: Date;
  retryFailed?: boolean;
}): Promise<PaymentReminderOutcome> {
  return sendReminderEmailForTarget({
    organization: input.organization,
    target: { kind: "payment", payment: input.payment },
    actor: input.actor,
    now: input.now,
    retryFailed: input.retryFailed,
  });
}

/**
 * Registra que el equipo abrió el mensaje de WhatsApp del destinatario (el
 * envío lo confirma el equipo en WhatsApp; acá queda la constancia del día).
 * Un solo registro por destinatario y día: los clics repetidos no duplican ni
 * ensucian la auditoría.
 */
export async function recordWhatsappReminder(input: {
  organizationId: string;
  target: ReminderTarget;
  actor: AuditContext;
  now?: Date;
}): Promise<{ reminder: PaymentReminderLog; alreadyToday: boolean } | null> {
  const fields = reminderTargetFields(input.target);
  const now = input.now ?? new Date();
  const dayKey = dayKeyOf(now);
  const to = (fields.client.phone ?? "").trim();
  if (!to) return null;
  const label = fields.label;

  try {
    const reminder = await db.paymentReminderLog.create({
      data: {
        id: randomUUID(),
        organizationId: input.organizationId,
        paymentId: fields.paymentId,
        expectedPaymentId: fields.expectedPaymentId,
        targetKey: fields.targetKey,
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
      entity: fields.expectedPaymentId ? "ExpectedPayment" : "ClientPayment",
      entityId: fields.expectedPaymentId ?? (fields.paymentId as string),
      summary: `Abrió WhatsApp para recordarle el pago a «${label}» (${fields.concept})`,
      detail: { fields: { channel: "whatsapp", to, status: "opened" } },
    });
    return { reminder, alreadyToday: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.paymentReminderLog.findUnique({
      where: { targetKey_channel_dayKey: { targetKey: fields.targetKey, channel: "whatsapp", dayKey } },
    });
    return existing ? { reminder: existing, alreadyToday: true } : null;
  }
}

// ── Despacho diario ─────────────────────────────────────────────────────────

export type ReminderRunSummary = {
  dayKey: string;
  /** Destinatarios en la ventana: cobros a plazo + pagos esperados (issue #28). */
  candidates: number;
  /** Cobros pendientes dentro de la ventana (vencidos o por vencer). */
  paymentCandidates: number;
  /** Pagos esperados en `AWAITING` dentro de la ventana (issue #28). */
  expectedCandidates: number;
  sent: number;
  failed: number;
  /** Sin correo del cliente: no se intenta y no se registra. */
  skipped: number;
  alreadySentToday: number;
  /** Por qué no se envió nada: sin proveedor configurado o empresa demo. */
  reason?: "missing_resend_api_key" | "demo_organization";
};

/**
 * Despacho diario: recorre los cobros pendientes y los pagos esperados de la
 * ventana y manda **un** recordatorio por destinatario y día. Lo llaman el
 * primer uso del panel del día y el endpoint forzado; es idempotente, así que
 * repetirlo no duplica nada.
 */
export async function runDailyPaymentReminders(input: {
  organizationId: string;
  now?: Date;
  actor?: AuditContext;
}): Promise<ReminderRunSummary> {
  const now = input.now ?? new Date();
  const dayKey = dayKeyOf(now);
  const summary: ReminderRunSummary = {
    dayKey,
    candidates: 0,
    paymentCandidates: 0,
    expectedCandidates: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    alreadySentToday: 0,
  };

  const organization = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, slug: true, paymentDetails: true },
  });
  if (!organization) return summary;
  if (isDemoOrganizationSlug(organization.slug)) {
    return { ...summary, reason: "demo_organization" };
  }

  const payments = await listPendingReminderPayments(organization.id, now);
  const expected = await listPendingReminderExpectedPayments(organization.id, now);
  summary.paymentCandidates = payments.length;
  summary.expectedCandidates = expected.length;
  summary.candidates = payments.length + expected.length;
  if (summary.candidates === 0) return summary;

  if (!emailConfigured()) {
    console.warn(
      `[reminders] RESEND_API_KEY ausente: se omiten ${summary.candidates} recordatorio(s) del ${dayKey} (la corrida se reintenta en el próximo uso del panel).`,
    );
    return { ...summary, reason: "missing_resend_api_key" };
  }

  const actor = input.actor ?? systemReminderActor(organization.id);
  const todayLogs = await db.paymentReminderLog.findMany({
    where: { organizationId: organization.id, channel: "email", dayKey },
    select: { targetKey: true },
  });
  const alreadyToday = new Set(todayLogs.map((log) => log.targetKey));

  const targets: ReminderTarget[] = [
    ...payments.map((payment): ReminderTarget => ({ kind: "payment", payment })),
    ...expected.map((row): ReminderTarget => ({ kind: "expected", expected: row })),
  ];
  for (const target of targets) {
    if (alreadyToday.has(reminderTargetKey(target))) {
      summary.alreadySentToday += 1;
      continue;
    }
    const outcome = await sendReminderEmailForTarget({ organization, target, actor, now });
    if (outcome.status === "sent") summary.sent += 1;
    else if (outcome.status === "failed") summary.failed += 1;
    else summary.skipped += 1;
  }

  console.info(
    `[reminders] ${dayKey}: ${summary.sent} enviados, ${summary.failed} fallidos, ${summary.skipped} sin correo, ${summary.alreadySentToday} ya enviados (de ${summary.paymentCandidates} cobros y ${summary.expectedCandidates} pagos esperados en la ventana).`,
  );
  return summary;
}
