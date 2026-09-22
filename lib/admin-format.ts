/**
 * Formatos y etiquetas del panel (fuente única).
 * Montos en PYG sin decimales; fechas y horas es-PY en 24 h (`hourCycle: "h23"`)
 * y en la zona de la empresa (`America/Asuncion`), así el servidor y el
 * navegador dibujan el mismo día.
 */

import { DEFAULT_PHONE_COUNTRY, normalizePhone, parsePhone, phoneValid } from "./field-rules";

export type AdminTone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

const TIME_ZONE = "America/Asuncion";

const moneyFormat = new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat("es-PY", { timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric" });
const dateShortFormat = new Intl.DateTimeFormat("es-PY", { timeZone: TIME_ZONE, day: "2-digit", month: "short" });
const dateTimeFormat = new Intl.DateTimeFormat("es-PY", { timeZone: TIME_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const timeFormat = new Intl.DateTimeFormat("es-PY", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatMoney(value: number | null | undefined): string {
  const amount = Number(value);
  return moneyFormat.format(Number.isFinite(amount) ? amount : 0);
}

export function formatNumber(value: number | null | undefined): string {
  const amount = Number(value);
  return numberFormat.format(Number.isFinite(amount) ? amount : 0);
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dateFormat.format(date) : "—";
}

export function formatDateShort(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dateShortFormat.format(date) : "—";
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? dateTimeFormat.format(date) : "—";
}

export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? timeFormat.format(date) : "—";
}

/**
 * Hace cuánto pasó un instante: "recién", "hace 4 min", "hace 2 h" y, pasado el
 * día, la fecha completa (`17-sept. · 08:40`, 24 h). Lo usa la cola offline para
 * mostrar cuándo se guardó y cuándo se subió cada acción de campo.
 */
export function formatSince(value: string | Date | null | undefined, now = Date.now()): string {
  const date = toDate(value);
  if (!date) return "—";
  const elapsed = now - date.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "recién";
  if (elapsed < 3_600_000) return `hace ${formatNumber(Math.floor(elapsed / 60_000))} min`;
  if (elapsed < 86_400_000) return `hace ${formatNumber(Math.floor(elapsed / 3_600_000))} h`;
  return `${formatDateShort(date)} · ${formatTime(date)}`;
}

// ── Frecuencia de contratación (issue #34) ──────────────────────────────────
// El promedio en meses de la ficha del cliente: un decimal, coma es-PY
// («2,4 meses»). Sin muestra (menos de dos contrataciones) se dibuja «—».

const MONTHS_FORMAT = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1 });

export function formatMonths(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  return `${MONTHS_FORMAT.format(value)} ${value === 1 ? "mes" : "meses"}`;
}

const FILE_SIZE_FORMAT = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1 });

/** Tamaño de un archivo legible: bytes, kB y MB (1,2 MB). */
export function formatBytes(value: number | null | undefined): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${numberFormat.format(Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${numberFormat.format(Math.round(bytes / 1024))} kB`;
  return `${FILE_SIZE_FORMAT.format(bytes / (1024 * 1024))} MB`;
}

const PAYMENT_PROOF_MIME: Record<string, string> = {
  "image/jpeg": "Imagen JPG",
  "image/png": "Imagen PNG",
  "image/webp": "Imagen WebP",
  "application/pdf": "PDF",
};

/** Tipo de archivo del comprobante; un MIME desconocido se muestra tal cual. */
export const paymentProofMimeLabel = (value: string | null | undefined) => label(PAYMENT_PROOF_MIME, value);

/** Tipo real de una imagen de identidad (avatar o logo), misma tabla de etiquetas. */
export const identityImageMimeLabel = (value: string | null | undefined) => label(PAYMENT_PROOF_MIME, value);

/**
 * Nombre de la variante del logo (issue #22): el claro va sobre fondos oscuros
 * y el oscuro sobre fondos claros; en papel siempre se usa el claro.
 */
export const logoVariantLabel = (value: string | null | undefined) => (value === "dark" ? "Logo oscuro" : "Logo claro");

/** Referencia corta y estable del presupuesto para documentos y links (deriva del id real). */
export function budgetReference(id: string | null | undefined): string {
  return String(id ?? "")
    .replace(/-/g, "")
    .slice(0, 8)
    .toUpperCase();
}

/** Vencido o a punto de vencer (dentro de los próximos `days` días). */
export function isDueSoon(value: string | Date | null | undefined, days = 7): boolean {
  const date = toDate(value);
  if (!date) return false;
  return date.getTime() <= Date.now() + days * 86_400_000;
}

/**
 * Hecho que cae en la ventana de aviso: dentro de los próximos `days` días
 * (también lo que arrancó ayer y sigue vivo). Es la misma ventana que usan las
 * notificaciones operativas, para que el riesgo del panel y el aviso coincidan.
 */
export function isUpcomingWithin(value: string | Date | null | undefined, days = 7): boolean {
  const date = toDate(value);
  if (!date) return false;
  const now = Date.now();
  return date.getTime() >= now - 86_400_000 && date.getTime() <= now + days * 86_400_000;
}

const EVENT_STATUS: Record<string, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmado",
  IN_PROGRESS: "En curso",
  COMPLETED: "Finalizado",
  CANCELLED: "Cancelado",
};

const BUDGET_STATUS: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Enviado",
  NEGOTIATING: "En negociación",
  APPROVED: "Aprobado",
  LOST: "Perdido",
  CANCELLED: "Cancelado",
};

const JOB_STATUS: Record<string, string> = {
  PENDING: "Pendiente",
  CONTRACTED: "Contratado",
  ADVANCE_PENDING: "Anticipo pendiente",
  ADVANCE_PAID: "Anticipo pagado",
  IN_PRODUCTION: "En producción",
  DELIVERED: "Entregado",
  BALANCE_PENDING: "Saldo pendiente",
  PAID: "Pagado",
  CANCELLED: "Cancelado",
};

const INVENTORY_KIND: Record<string, string> = {
  REUSABLE: "Reutilizable",
  CONSUMABLE: "Consumible",
  DISPOSABLE: "Descartable",
};

const INVENTORY_STATUS: Record<string, string> = {
  AVAILABLE: "Disponible",
  RESERVED: "Reservado",
  IN_USE: "En uso",
  MAINTENANCE: "Mantenimiento",
  RETIRED: "Retirado",
};

const TASK_TYPE: Record<string, string> = {
  SETUP: "Montaje",
  EVENT: "Evento",
  STRIKE: "Desmontaje",
  PAYMENT: "Pago",
  COLLECTION: "Cobro",
};

const CLIENT_TYPE: Record<string, string> = {
  FINAL: "Cliente final",
  RESELLER: "Mayorista",
};

/**
 * Disponibilidad de promotoras (issue #24): estado real, no bloquea la
 * asignación. Mismas etiquetas y tonos en toda la app.
 */
const PROMOTER_AVAILABILITY: Record<string, string> = {
  AVAILABLE: "Disponible",
  UNAVAILABLE: "No disponible",
  TO_DEFINE: "A definir",
};

const LEAD_STATUS: Record<string, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  QUOTED: "Cotizado",
  WON: "Ganado",
  LOST: "Perdido",
};

/** Origen del lead; los valores desconocidos se muestran tal cual llegan. */
const LEAD_SOURCE: Record<string, string> = {
  website: "Sitio web",
};

const BILLING_UNIT: Record<string, string> = {
  DAILY: "Por día",
  SQUARE_METER_DAILY: "Por m² y día",
  EVENT: "Por evento",
};

const SUPPLIER_CATEGORY: Record<string, string> = {
  CARPENTRY: "Carpintería",
  GRAPHICS: "Gráfica",
  ELECTRICITY: "Electricidad",
  TRANSPORT: "Transporte",
  FURNITURE: "Mobiliario",
  AUDIOVISUAL: "Audiovisual",
  STAFF: "Staff",
  OTHER: "Otros",
};

const ROLE: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  FINANCE: "Finanzas",
  OPERATIONS: "Operaciones",
  VIEWER: "Consulta",
};

const TONES: Record<string, AdminTone> = {
  DRAFT: "neutral",
  NEW: "accent",
  CONTACTED: "info",
  QUOTED: "warn",
  WON: "ok",
  CONFIRMED: "accent",
  IN_PROGRESS: "info",
  COMPLETED: "ok",
  CANCELLED: "danger",
  SENT: "info",
  NEGOTIATING: "warn",
  APPROVED: "ok",
  LOST: "danger",
  PENDING: "neutral",
  CONTRACTED: "info",
  ADVANCE_PENDING: "warn",
  ADVANCE_PAID: "info",
  IN_PRODUCTION: "accent",
  DELIVERED: "info",
  BALANCE_PENDING: "warn",
  PAID: "ok",
  AVAILABLE: "ok",
  RESERVED: "info",
  IN_USE: "accent",
  MAINTENANCE: "warn",
  RETIRED: "neutral",
  REUSABLE: "info",
  CONSUMABLE: "neutral",
  DISPOSABLE: "warn",
  FINAL: "neutral",
  RESELLER: "accent",
  UNAVAILABLE: "danger",
  TO_DEFINE: "warn",
  OWNER: "accent",
  ADMIN: "info",
  FINANCE: "ok",
  OPERATIONS: "info",
  VIEWER: "neutral",
  SETUP: "info",
  EVENT: "accent",
  STRIKE: "warn",
  PAYMENT: "ok",
  COLLECTION: "ok",
  // Registro fiscal (issue #41): estados, condiciones y tipos de IVA.
  ISSUED: "info",
  VOID: "danger",
  CASH: "neutral",
  CREDIT: "warn",
  OPEN: "warn",
  CLOSED: "ok",
  IVA10: "accent",
  IVA5: "info",
  EXEMPT: "neutral",
};

function label(map: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "—";
  return map[value] ?? value;
}

export const eventStatusLabel = (value: string | null | undefined) => label(EVENT_STATUS, value);
export const budgetStatusLabel = (value: string | null | undefined) => label(BUDGET_STATUS, value);
export const jobStatusLabel = (value: string | null | undefined) => label(JOB_STATUS, value);
export const inventoryKindLabel = (value: string | null | undefined) => label(INVENTORY_KIND, value);
export const inventoryStatusLabel = (value: string | null | undefined) => label(INVENTORY_STATUS, value);
export const taskTypeLabel = (value: string | null | undefined) => label(TASK_TYPE, value);
export const clientTypeLabel = (value: string | null | undefined) => label(CLIENT_TYPE, value);
export const leadStatusLabel = (value: string | null | undefined) => label(LEAD_STATUS, value);
export const leadSourceLabel = (value: string | null | undefined) => label(LEAD_SOURCE, value);
export const billingUnitLabel = (value: string | null | undefined) => label(BILLING_UNIT, value);
export const supplierCategoryLabel = (value: string | null | undefined) => label(SUPPLIER_CATEGORY, value);
export const adminRoleLabel = (value: string | null | undefined) => label(ROLE, value);
export const promoterAvailabilityLabel = (value: string | null | undefined) => label(PROMOTER_AVAILABILITY, value);

/** Historial de correo (issue #30): categorías del envío y estado real del proveedor. */
const MAIL_CATEGORY: Record<string, string> = {
  reset: "Reset de contraseña",
  reminder: "Recordatorio de cobro",
  budget: "Presupuesto",
  test: "Prueba",
  invitation: "Invitación",
  alert: "Alerta de sistema",
};
const MAIL_STATUS: Record<string, string> = {
  sending: "Enviando",
  sent: "Enviado",
  failed: "Falló",
};
const MAIL_STATUS_TONES: Record<string, AdminTone> = {
  sending: "warn",
  sent: "ok",
  failed: "danger",
};

export const mailCategoryLabel = (value: string | null | undefined) => label(MAIL_CATEGORY, value);
export const mailStatusLabel = (value: string | null | undefined) => label(MAIL_STATUS, value);

export function mailStatusTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return MAIL_STATUS_TONES[value] ?? "neutral";
}

// ── Invitaciones al equipo (issue #31) ──────────────────────────────────────
// Estado real de la invitación (enum `TeamInvitationStatus`); el mismo texto y
// tono en la lista del panel y en la página de aceptación.

const INVITATION_STATUS: Record<string, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  revoked: "Revocada",
  expired: "Vencida",
};

const INVITATION_STATUS_TONES: Record<string, AdminTone> = {
  pending: "warn",
  accepted: "ok",
  revoked: "danger",
  expired: "danger",
};

export const invitationStatusLabel = (value: string | null | undefined) => label(INVITATION_STATUS, value);

export function invitationStatusTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return INVITATION_STATUS_TONES[value] ?? "neutral";
}

// ── Solicitudes de cambio de plan (issue #42) ───────────────────────────────
// Estado real de `PlanChangeRequest`: nace `pending` (la pide el equipo) y la
// resuelve Owncoding al aplicar el cambio.

const PLAN_REQUEST_STATUS: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aplicada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
};

const PLAN_REQUEST_STATUS_TONES: Record<string, AdminTone> = {
  pending: "warn",
  approved: "ok",
  rejected: "danger",
  cancelled: "neutral",
};

export const planRequestStatusLabel = (value: string | null | undefined) => label(PLAN_REQUEST_STATUS, value);

export function planRequestStatusTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return PLAN_REQUEST_STATUS_TONES[value] ?? "neutral";
}

export function statusTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return TONES[value] ?? "neutral";
}

// ── Registro fiscal interno (issue #41) ─────────────────────────────────────
// Etiquetas de los estados, condiciones y tipos de IVA del comprobante. La
// misma fuente para la lista, el libro y el imprimible.

const INVOICE_STATUS: Record<string, string> = {
  ISSUED: "Emitida",
  PAID: "Saldada",
  VOID: "Anulada",
};

const INVOICE_CONDITION: Record<string, string> = {
  CASH: "Contado",
  CREDIT: "Crédito",
};

const INVOICE_TAX_TYPE: Record<string, string> = {
  IVA10: "Gravada 10 %",
  IVA5: "Gravada 5 %",
  EXEMPT: "Exenta",
};

const FISCAL_PERIOD_STATUS: Record<string, string> = {
  OPEN: "Abierto",
  CLOSED: "Cerrado",
};

export const invoiceStatusLabel = (value: string | null | undefined) => label(INVOICE_STATUS, value);
export const invoiceConditionLabel = (value: string | null | undefined) => label(INVOICE_CONDITION, value);
export const invoiceTaxTypeLabel = (value: string | null | undefined) => label(INVOICE_TAX_TYPE, value);
export const fiscalPeriodStatusLabel = (value: string | null | undefined) => label(FISCAL_PERIOD_STATUS, value);

/** Tipo de IVA de un comprobante de compra a partir de sus montos (sin campo propio). */
export function purchaseTaxTypeLabel(row: {
  taxable10?: number | null;
  iva10?: number | null;
  taxable5?: number | null;
  iva5?: number | null;
} | null | undefined): string {
  if (!row) return "—";
  if ((row.taxable10 ?? 0) > 0 || (row.iva10 ?? 0) > 0) return INVOICE_TAX_TYPE.IVA10;
  if ((row.taxable5 ?? 0) > 0 || (row.iva5 ?? 0) > 0) return INVOICE_TAX_TYPE.IVA5;
  return INVOICE_TAX_TYPE.EXEMPT;
}

/** Tono de la disponibilidad de una promotora (fuente única con `statusTone`). */
export function promoterAvailabilityTone(value: string | null | undefined): AdminTone {
  return statusTone(value);
}

/**
 * Detalle real de la disponibilidad: motivo y, si hay, hasta cuándo. Se usa en
 * el `title` de la fila y en el aviso al asignar una promotora a una tarea.
 */
export function promoterAvailabilityDetail(
  promoter:
    | { availability: string; availabilityNote?: string | null; unavailableUntil?: string | null }
    | null
    | undefined,
): string {
  if (!promoter) return "";
  const parts: string[] = [];
  if (promoter.availability === "UNAVAILABLE" && promoter.unavailableUntil) {
    parts.push(`hasta el ${formatDate(promoter.unavailableUntil)}`);
  }
  if (promoter.availabilityNote?.trim()) parts.push(promoter.availabilityNote.trim());
  return parts.join(" · ");
}

// ── Avance real del checklist (issue #24) ───────────────────────────────────
// El avance se cuenta sobre las tareas reales del evento: cumplidas, pendientes
// y vencidas (`dueAt` pasado, día de Asunción). Un evento próximo sin ninguna
// tarea cumplida queda señalizado como riesgo.

export type ChecklistProgress = {
  done: number;
  total: number;
  pending: number;
  overdue: number;
  /** Evento próximo con checklist cargado y 0 tareas cumplidas. */
  atRisk: boolean;
  tone: AdminTone;
  /** Texto corto `2/4` para la celda. */
  label: string;
  /** Detalle completo para el `title`. */
  title: string;
};

export function checklistProgress(
  tasks: ReadonlyArray<{ completedAt: string | Date | null | undefined; dueAt?: string | Date | null | undefined }>,
  options: { risk?: boolean } = {},
): ChecklistProgress {
  const total = tasks.length;
  const done = tasks.filter((task) => Boolean(task.completedAt)).length;
  const overdue = tasks.filter((task) => !task.completedAt && isOverdue(task.dueAt)).length;
  const pending = total - done;
  const atRisk = Boolean(options.risk) && total > 0 && done === 0;
  const tone: AdminTone = atRisk ? "danger" : overdue > 0 ? "warn" : total > 0 && done === total ? "ok" : "neutral";
  const parts = [`${done} de ${total} tareas cumplidas`];
  if (pending > 0) parts.push(`${pending} pendiente${pending === 1 ? "" : "s"}`);
  if (overdue > 0) parts.push(`${overdue} vencida${overdue === 1 ? "" : "s"}`);
  if (atRisk) parts.push("evento próximo sin avance: riesgo");
  return { done, total, pending, overdue, atRisk, tone, label: `${done}/${total}`, title: parts.join(" · ") };
}

/** Vencimiento ya pasado (día de Asunción, no la medianoche del navegador). */
export function isOverdue(value: string | Date | null | undefined): boolean {
  const days = daysUntilDue(value);
  return days !== null && days < 0;
}

// ── Cuánto falta (issue #25) ────────────────────────────────────────────────
// Una sola cuenta regresiva para todas las listas y fichas: se calcula por día
// de Asunción (nunca por la medianoche del navegador) y se escribe igual en todo
// el panel. El portal y los mensajes al cliente usan la misma función con la voz
// del cliente (`client`) y los lugares ajustados, la variante corta (`short`).

/** Variante del texto: panel («faltan 3 días»), corta («en 3 d») o del cliente («vence en 3 días»). */
export type CountdownVariant = "panel" | "short" | "client";

const DAY_KEY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Días de calendario de Asunción que faltan para una fecha: 0 = hoy, 1 = mañana,
 * negativo = vencida. Acepta un ISO, un `Date` o una clave `YYYY-MM-DD` (que se
 * toma como día puro, sin corrimiento de zona).
 */
export function countdownDays(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const dayKey = typeof value === "string" && DAY_KEY_FORMAT.test(value) ? value : dayKeyOf(value);
  const target = dayKeyToUtcDate(dayKey);
  const today = dayKeyToUtcDate(dayKeyOf());
  if (!target || !today) return null;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Texto único de la cuenta regresiva: «hoy» · «mañana» · «faltan N días» · «venció hace N días». */
export function formatCountdown(value: string | Date | null | undefined, variant: CountdownVariant = "panel"): string {
  const days = countdownDays(value);
  if (days === null) return "—";
  if (variant === "short") {
    if (days === 0) return "hoy";
    if (days === 1) return "mañana";
    if (days === -1) return "ayer";
    return days > 0 ? `en ${formatNumber(days)} d` : `hace ${formatNumber(Math.abs(days))} d`;
  }
  const plural = (count: number) => (count === 1 ? "día" : "días");
  if (variant === "client") {
    if (days === 0) return "vence hoy";
    if (days === 1) return "vence mañana";
    return days > 0
      ? `vence en ${formatNumber(days)} ${plural(days)}`
      : `venció hace ${formatNumber(Math.abs(days))} ${plural(Math.abs(days))}`;
  }
  if (days === 0) return "hoy";
  if (days === 1) return "mañana";
  return days > 0
    ? `faltan ${formatNumber(days)} ${plural(days)}`
    : `venció hace ${formatNumber(Math.abs(days))} ${plural(Math.abs(days))}`;
}

/**
 * Tono único de la cuenta regresiva: rojo si venció, ámbar si vence dentro de
 * `days` días (hoy incluido) y neutro si falta más.
 */
export function countdownTone(value: string | Date | null | undefined, days = 7): AdminTone {
  const distance = countdownDays(value);
  if (distance === null) return "neutral";
  if (distance < 0) return "danger";
  return distance <= days ? "warn" : "neutral";
}

// ── Cobros a plazo (issue #16) ──────────────────────────────────────────────
// Estado del cobro de cliente (enum `ClientPaymentStatus`); la cuenta regresiva
// del vencimiento es la misma del panel (issue #25).

const PAYMENT_STATUS: Record<string, string> = {
  PENDING: "A cobrar",
  RECEIVED: "Cobrado",
  CANCELLED: "Anulado",
};

const PAYMENT_STATUS_TONES: Record<string, AdminTone> = {
  PENDING: "warn",
  RECEIVED: "ok",
  CANCELLED: "danger",
};

export const paymentStatusLabel = (value: string | null | undefined) => label(PAYMENT_STATUS, value);

export function paymentStatusTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return PAYMENT_STATUS_TONES[value] ?? "neutral";
}

/** Días de calendario (Asunción) que faltan para un vencimiento; `null` si no hay fecha. */
export function daysUntilDue(value: string | Date | null | undefined): number | null {
  return countdownDays(value);
}

// ── Portal del cliente (issue #12) ──────────────────────────────────────────
// Estado de la aprobación del presupuesto tal como se ve en la lista del panel.

const BUDGET_APPROVAL: Record<string, string> = {
  PENDIENTE: "Pendiente",
  APROBADO_DIGITAL: "Aprobado digital",
  APROBADO_MANUAL: "Aprobado manual",
  CAMBIOS_SOLICITADOS: "Cambios solicitados",
};

const BUDGET_APPROVAL_TONES: Record<string, AdminTone> = {
  PENDIENTE: "neutral",
  APROBADO_DIGITAL: "ok",
  APROBADO_MANUAL: "ok",
  CAMBIOS_SOLICITADOS: "warn",
};

export const budgetApprovalLabel = (value: string | null | undefined) => label(BUDGET_APPROVAL, value);

export function budgetApprovalTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return BUDGET_APPROVAL_TONES[value] ?? "neutral";
}

/** Cómo se registró la aprobación: por el portal (cliente) o desde el panel (equipo). */
export const BUDGET_APPROVAL_METHOD: Record<string, string> = {
  digital: "Portal del cliente",
  manual: "Panel",
};

export const budgetApprovalMethodLabel = (value: string | null | undefined) => label(BUDGET_APPROVAL_METHOD, value);

// ── Solicitudes del portal (issue #14) ──────────────────────────────────────
// Mismas etiquetas que la cola del panel; los valores reales del enum viven en
// `BudgetChangeKind`/`BudgetChangeStatus` (Prisma) y viajan tal cual al API.

const BUDGET_CHANGE_KIND: Record<string, string> = {
  items: "Propuesta de ítems",
  discount: "Pedido de rebaja",
  changes: "Pedido de cambios",
};

const BUDGET_CHANGE_STATUS: Record<string, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  rejected: "Rechazada",
};

const BUDGET_CHANGE_STATUS_TONES: Record<string, AdminTone> = {
  pending: "warn",
  accepted: "ok",
  rejected: "danger",
};

export const budgetChangeKindLabel = (value: string | null | undefined) => label(BUDGET_CHANGE_KIND, value);
export const budgetChangeStatusLabel = (value: string | null | undefined) => label(BUDGET_CHANGE_STATUS, value);

export function budgetChangeStatusTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return BUDGET_CHANGE_STATUS_TONES[value] ?? "neutral";
}

// ── Cronología (issue #33) ──────────────────────────────────────────────────
// Un tipo de hito por hecho real; la etiqueta es la misma en el panel, el
// filtro y la versión cliente del portal. El tono viaja en cada hito (lo decide
// la fuente con el resultado real), acá solo vive la etiqueta del tipo.

const TIMELINE_KIND: Record<string, string> = {
  created: "Alta",
  updated: "Cambio",
  status: "Estado",
  sent: "Correo",
  viewed: "Vista del portal",
  request: "Solicitud",
  request_resolved: "Respuesta",
  approved: "Aprobación",
  revision: "Cambios pedidos",
  expected: "Pago esperado",
  proof: "Comprobante",
  payment: "Cobro",
  treasury: "Tesorería",
  inventory: "Reserva",
  checkout: "Salida",
  checkin: "Devolución",
  task: "Tarea",
  task_done: "Tarea cumplida",
  event_date: "Fecha del evento",
  cancelled: "Cancelación",
  thanks: "Agradecimiento",
};

export const timelineKindLabel = (value: string | null | undefined) => label(TIMELINE_KIND, value);

/** Estados de un equipo al retirar/devolver (source única para los formularios). */
export const ITEM_CONDITIONS = ["Bueno", "Con detalles", "Dañado"] as const;

/**
 * Estado operativo de una asignación: `checkedOutAt`/`checkedInAt` mandan; los
 * booleanos quedan como marca heredada de registros viejos sin fecha exacta.
 */
export function inventoryAssignmentState(assignment: {
  checkedOut: boolean;
  checkedIn: boolean;
  checkedOutAt?: string | Date | null;
  checkedInAt?: string | Date | null;
}): { label: string; tone: AdminTone } {
  if (assignment.checkedInAt || assignment.checkedIn) return { label: "Devuelto", tone: "ok" };
  if (assignment.checkedOutAt || assignment.checkedOut) return { label: "Afuera", tone: "accent" };
  return { label: "Asignado", tone: "info" };
}

/**
 * Fecha relevante de una asignación para la cuenta regresiva (issue #25): la
 * salida mientras sigue asignada y la devolución cuando ya está afuera. Devuelve
 * `null` si ya volvió (no hay nada que esperar) o si no tiene la fecha.
 */
export function inventoryAssignmentCountdown(assignment: {
  checkedOut: boolean;
  checkedIn: boolean;
  checkedOutAt?: string | Date | null;
  checkedInAt?: string | Date | null;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
}): { at: string | Date | null; title: string } | null {
  const state = inventoryAssignmentState(assignment);
  if (state.label === "Devuelto") return null;
  if (state.label === "Afuera") {
    return assignment.endsAt ? { at: assignment.endsAt, title: "Devolución pendiente" } : null;
  }
  return assignment.startsAt ? { at: assignment.startsAt, title: "Salida pendiente" } : null;
}

/** Resumen de daños y faltantes para listas: `2 dañadas · 1 faltante`. */
export function damageSummary(damaged: number, missing: number): string | null {
  const parts: string[] = [];
  if (damaged > 0) parts.push(`${damaged} dañada${damaged === 1 ? "" : "s"}`);
  if (missing > 0) parts.push(`${missing} faltante${missing === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Iniciales para el avatar del topbar (máximo dos letras). */
export function initials(name: string | null | undefined): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "LB";
  const first = parts[0][0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + second).toUpperCase();
}

/** Link de mensajería con el teléfono normalizado sin signos (números locales asumen Paraguay). */
export function whatsappHref(phone: string | null | undefined, message?: string | null): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const international = digits.startsWith("595") ? digits : digits.startsWith("0") ? `595${digits.slice(1)}` : `595${digits}`;
  const text = String(message ?? "").trim();
  return text ? `https://wa.me/${international}?text=${encodeURIComponent(text)}` : `https://wa.me/${international}`;
}

// ── Datos de contacto del cliente (issue #36) ───────────────────────────────
// El sitio web se guarda normalizado con esquema (`https://…`) y el Instagram
// como usuario sin `@`. Los links se arman acá una sola vez; si el dato falta,
// el link no se dibuja (nunca se reemplaza por otro objeto).

/** Mensaje único por regla de link; el API revalida con el mismo texto. */
export const CLIENT_LINK_MESSAGES = {
  website: "Ingresá un sitio web válido, por ejemplo ledbox.online.",
  instagram: "Ingresá un usuario de Instagram válido (letras, números, puntos y guiones bajos).",
} as const;

/** Límite del sitio web guardado. */
export const CLIENT_WEBSITE_MAX_LENGTH = 200;

/** Sitio web como se guarda: sin espacios, con esquema y sin barra final. */
export function normalizeWebsite(value: string | null | undefined): string {
  const raw = String(value ?? "").trim().replace(/\s+/g, "");
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

export function websiteValid(value: string | null | undefined): boolean {
  const url = normalizeWebsite(value);
  if (!url || url.length > CLIENT_WEBSITE_MAX_LENGTH) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Link del sitio web; `null` si el dato falta o no es válido. */
export function websiteHref(value: string | null | undefined): string | null {
  return websiteValid(value) ? normalizeWebsite(value) : null;
}

/** Usuario de Instagram como se guarda: sin URL, sin `@` y sin query. */
export function normalizeInstagram(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@+/, "")
    .split(/[/?#]/)[0]
    .trim();
}

export function instagramValid(value: string | null | undefined): boolean {
  return /^[A-Za-z0-9._]{1,30}$/.test(normalizeInstagram(value));
}

/** Link del perfil de Instagram; `null` si el dato falta o no es válido. */
export function instagramHref(value: string | null | undefined): string | null {
  const handle = normalizeInstagram(value);
  return instagramValid(handle) ? `https://www.instagram.com/${handle}` : null;
}

/** Usuario visible con arroba (`@ledboxpy`); `null` si no hay dato válido. */
export function instagramLabel(value: string | null | undefined): string | null {
  const handle = normalizeInstagram(value);
  return instagramValid(handle) ? `@${handle}` : null;
}

/** Saludo del WhatsApp prellenado de un cliente; sin nombre queda el genérico. */
export function clientWhatsappMessage(name: string | null | undefined): string {
  const who = String(name ?? "").trim();
  return who ? `Hola ${who}: te escribimos de LedBox.` : "Hola: te escribimos de LedBox.";
}

/**
 * Teléfono de contacto como se guarda en el cliente (issue #36): usa las reglas
 * del kit y además acepta el formato local con 0 (`0981…`), que se normaliza a
 * `+595 981…`. Vacío o inválido devuelve `""`; el API revalida con esta misma
 * función.
 */
export function normalizeContactPhone(value: string | null | undefined): string {
  const parsed = parsePhone(value);
  const national = parsed.countryCode === DEFAULT_PHONE_COUNTRY ? parsed.national.replace(/^0/, "") : parsed.national;
  const normalized = normalizePhone(`+${parsed.countryCode} ${national}`);
  return phoneValid(normalized) ? normalized : "";
}

export function contactPhoneValid(value: string | null | undefined): boolean {
  return Boolean(normalizeContactPhone(value));
}

// ── Recordatorios de cobro (issue #19) ─────────────────────────────────────
// Texto prellenado del WhatsApp y etiquetas del historial. El mensaje se arma
// acá (una sola vez) y lo usan Finanzas y la campana de avisos.

export type PaymentReminderMessageInput = {
  client: string;
  amount: number;
  dueAt: string | Date | null;
  invoiceNumber?: string | null;
  budgetTitle?: string | null;
  /** Link del portal del presupuesto asociado; sin link, el mensaje no lo inventa. */
  portalUrl?: string | null;
};

/** Mensaje prellenado del recordatorio de cobro: monto, vencimiento y link del portal. */
export function paymentReminderMessage(input: PaymentReminderMessageInput): string {
  const lines = [
    `Hola ${input.client}: te recordamos el pago pendiente.`,
    "",
    `• Monto: ${formatMoney(input.amount)}`,
    `• Vencimiento: ${input.dueAt ? `${formatDate(input.dueAt)} · ${formatCountdown(input.dueAt, "client")}` : "sin fecha"}`,
  ];
  if (input.invoiceNumber) lines.push(`• Factura: ${input.invoiceNumber}`);
  if (input.budgetTitle) lines.push(`• Presupuesto: ${input.budgetTitle}`);
  if (input.portalUrl) lines.push("", `Podés ver el detalle y los datos de pago en el portal: ${input.portalUrl}`);
  lines.push("", "LedBox");
  return lines.join("\n");
}

const REMINDER_CHANNEL: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
};

const REMINDER_STATUS: Record<string, string> = {
  sending: "En curso",
  sent: "Enviado",
  failed: "Falló",
  opened: "Abierto en WhatsApp",
};

const REMINDER_STATUS_TONES: Record<string, AdminTone> = {
  sending: "info",
  sent: "ok",
  failed: "danger",
  opened: "accent",
};

export const reminderChannelLabel = (value: string | null | undefined) => label(REMINDER_CHANNEL, value);
export const reminderStatusLabel = (value: string | null | undefined) => label(REMINDER_STATUS, value);

export function reminderStatusTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return REMINDER_STATUS_TONES[value] ?? "neutral";
}

// ── Plantillas de mensajes (issue #35) ──────────────────────────────────────

const MESSAGE_TEMPLATE_CATEGORY: Record<string, string> = {
  budget: "Presupuestos",
  client: "Clientes",
  event: "Eventos",
  collection: "Cobranzas",
  other: "Otras",
};

export const messageTemplateCategoryLabel = (value: string | null | undefined) => label(MESSAGE_TEMPLATE_CATEGORY, value);

/** ¿El valor cae en el día de Asunción de hoy? (para el "enviado hoy" del recordatorio). */
export function isTodayAsuncion(value: string | Date | null | undefined): boolean {
  const date = toDate(value);
  return date ? dayKeyOf(date) === dayKeyOf() : false;
}

// ── Períodos de las listas (issue #27) ──────────────────────────────────────
// Un solo catálogo de períodos para los filtros de movimientos y gastos: el
// rango sale de días de Asunción (`YYYY-MM-DD`) y siempre incluye hoy.

export const DATE_PERIODS = ["this-month", "last-month", "last-30", "this-year", "all"] as const;
export type DatePeriodValue = (typeof DATE_PERIODS)[number];

const DATE_PERIOD_LABEL: Record<string, string> = {
  "this-month": "Este mes",
  "last-month": "Mes pasado",
  "last-30": "Últimos 30 días",
  "this-year": "Este año",
  all: "Todo",
};

export const datePeriodLabel = (value: string | null | undefined) => label(DATE_PERIOD_LABEL, value);

/** Día de Asunción de hoy (`YYYY-MM-DD`) para los valores por defecto de un formulario. */
export function todayDayKey(): string {
  return dayKeyOf();
}

function utcDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Rango de días de Asunción de un período; `null` en "todo" (sin filtro). */
export function datePeriodRange(period: string): { from: string; to: string } | null {
  const todayKey = dayKeyOf();
  const today = dayKeyToUtcDate(todayKey);
  if (!today) return null;
  switch (period) {
    case "this-month":
      return { from: `${todayKey.slice(0, 7)}-01`, to: todayKey };
    case "last-month": {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { from: utcDayKey(first), to: utcDayKey(last) };
    }
    case "last-30":
      return { from: utcDayKey(new Date(today.getTime() - 29 * 86_400_000)), to: todayKey };
    case "this-year":
      return { from: `${todayKey.slice(0, 4)}-01-01`, to: todayKey };
    default:
      return null;
  }
}

/** Query de período para los GET del panel (`?from=…&to=…`); vacío en "todo". */
export function datePeriodQuery(period: string): string {
  const range = datePeriodRange(period);
  if (!range) return "";
  return `?from=${range.from}&to=${range.to}`;
}

// ── Tesorería y gastos (issue #27) ──────────────────────────────────────────
// Etiquetas del catálogo real de cuentas, movimientos y gastos; los valores
// viven en `lib/admin-types.ts` (fuente única de los selectores).

const TREASURY_ACCOUNT_TYPE: Record<string, string> = {
  CASH: "Efectivo",
  BANK: "Banco",
  CHEQUE: "Cheques a cobrar",
  OTHER: "Otra",
};

const TREASURY_ACCOUNT_TYPE_TONES: Record<string, AdminTone> = {
  CASH: "ok",
  BANK: "info",
  CHEQUE: "warn",
  OTHER: "neutral",
};

const TREASURY_DIRECTION: Record<string, string> = {
  IN: "Entrada",
  OUT: "Salida",
  TRANSFER: "Transferencia",
};

const TREASURY_DIRECTION_TONES: Record<string, AdminTone> = {
  IN: "ok",
  OUT: "danger",
  TRANSFER: "info",
};

const TREASURY_ORIGIN: Record<string, string> = {
  client_payment: "Cobro de cliente",
  supplier_job: "Pago a proveedor",
  expense: "Gasto",
  adjustment: "Ajuste",
};

const EXPENSE_CATEGORY: Record<string, string> = {
  TRANSPORT: "Transporte",
  FUEL: "Combustible",
  FOOD: "Comida",
  MATERIALS: "Materiales",
  RENT: "Alquiler",
  SERVICES: "Servicios",
  SALARIES: "Sueldos",
  TOOLS: "Herramientas",
  OTHER: "Otros",
};

export const treasuryAccountTypeLabel = (value: string | null | undefined) => label(TREASURY_ACCOUNT_TYPE, value);
export const treasuryDirectionLabel = (value: string | null | undefined) => label(TREASURY_DIRECTION, value);
export const treasuryOriginLabel = (value: string | null | undefined) => label(TREASURY_ORIGIN, value);
export const expenseCategoryLabel = (value: string | null | undefined) => label(EXPENSE_CATEGORY, value);

export function treasuryAccountTypeTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return TREASURY_ACCOUNT_TYPE_TONES[value] ?? "neutral";
}

export function treasuryDirectionTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return TREASURY_DIRECTION_TONES[value] ?? "neutral";
}

// ── Pagos esperados (issue #28) ─────────────────────────────────────────────
// El estado real de cada concepto del plan. Lo esperado no es plata cobrada: la
// UI muestra "por confirmar" aparte del cobrado y del disponible.

const EXPECTED_STATUS: Record<string, string> = {
  AWAITING: "Esperando transferencia",
  PROOF: "Comprobante en revisión",
  CONFIRMED: "Confirmado",
  CANCELLED: "Cancelado",
};

const EXPECTED_STATUS_TONES: Record<string, AdminTone> = {
  AWAITING: "warn",
  PROOF: "info",
  CONFIRMED: "ok",
  CANCELLED: "neutral",
};

const EXPECTED_CONCEPT: Record<string, string> = {
  advance: "Anticipo",
  installment: "Cuota",
  balance: "Saldo",
};

/** Estado del pago esperado con su tono; `Vencido` se agrega desde la fila. */
export const expectedPaymentStatusLabel = (value: string | null | undefined) => label(EXPECTED_STATUS, value);
export const expectedPaymentConceptLabel = (value: string | null | undefined) => label(EXPECTED_CONCEPT, value);

export function expectedPaymentStatusTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return EXPECTED_STATUS_TONES[value] ?? "neutral";
}

/** Concepto completo de una fila: «Anticipo», «Cuota 2» o «Saldo». */
export function expectedPaymentConcept(row: {
  concept: string;
  label?: string | null;
  installmentNumber?: number | null;
}): string {
  if (row.concept === "installment" && row.installmentNumber) return `Cuota ${row.installmentNumber}`;
  if (row.concept === "advance") return "Anticipo";
  if (row.concept === "balance") return "Saldo";
  return row.label?.trim() || expectedPaymentConceptLabel(row.concept);
}

// ── Calendario operativo ────────────────────────────────────────────────────
// Las vistas del calendario agrupan por día puro (`YYYY-MM-DD`); esos días se
// formatean en UTC para que no se corran de fecha, mientras que las horas de
// cada hecho salen de `formatTime` (zona de la empresa).

const CALENDAR_KIND: Record<string, string> = {
  setup: "Montaje",
  event: "Evento",
  event_end: "Fin de evento",
  strike: "Desmontaje",
  collection: "Cobro",
  collection_due: "Vence cobro",
  supplier_due: "Vence proveedor",
  supplier_delivery: "Entrega proveedor",
  supplier_payment: "Pago proveedor",
  task: "Tarea",
};

const CALENDAR_ALERT_KIND: Record<string, string> = {
  task: "Tarea",
  supplier_due: "Proveedor",
  checklist: "Checklist",
};

const CALENDAR_ALERT_LEVEL: Record<string, string> = {
  overdue: "Atrasado",
  soon: "Próximo",
};

export const calendarKindLabel = (value: string | null | undefined) => label(CALENDAR_KIND, value);
export const calendarAlertKindLabel = (value: string | null | undefined) => label(CALENDAR_ALERT_KIND, value);
export const calendarAlertLevelLabel = (value: string | null | undefined) => label(CALENDAR_ALERT_LEVEL, value);

function dayKeyToUtcDate(dayKey: string | null | undefined): Date | null {
  if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

const calendarWeekdayFormat = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", weekday: "long" });
const calendarWeekdayShortFormat = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", weekday: "short" });
const calendarMonthFormat = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", month: "long", year: "numeric" });
const calendarDayFormat = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const calendarDayShortFormat = new Intl.DateTimeFormat("es-PY", { timeZone: "UTC", day: "2-digit", month: "short" });

/** Día de la semana de una clave `YYYY-MM-DD` (ej.: "lunes"). */
export function formatCalendarWeekday(dayKey: string | null | undefined): string {
  const date = dayKeyToUtcDate(dayKey);
  return date ? calendarWeekdayFormat.format(date) : "—";
}

/** Mes y año de una clave `YYYY-MM-DD` (ej.: "septiembre 2026"). */
export function formatCalendarMonth(dayKey: string | null | undefined): string {
  const date = dayKeyToUtcDate(dayKey);
  return date ? calendarMonthFormat.format(date) : "—";
}

/** Día completo de una clave `YYYY-MM-DD` (ej.: "lunes, 21 de septiembre"). */
export function formatCalendarDay(dayKey: string | null | undefined): string {
  const date = dayKeyToUtcDate(dayKey);
  return date ? calendarDayFormat.format(date) : "—";
}

/** Día corto de una clave `YYYY-MM-DD` (ej.: "21 sept"). */
export function formatCalendarDayShort(dayKey: string | null | undefined): string {
  const date = dayKeyToUtcDate(dayKey);
  return date ? calendarDayShortFormat.format(date) : "—";
}

/** Encabezado de la grilla mensual: lunes primero (1-ene-2024 fue lunes). */
export const CALENDAR_WEEKDAYS: readonly string[] = Array.from({ length: 7 }, (_, index) =>
  calendarWeekdayShortFormat.format(new Date(Date.UTC(2024, 0, 1 + index))).replace(/\.$/, ""),
);

// ── Avisos operativos ───────────────────────────────────────────────────────
// Mismos textos que las alertas del calendario para los `kind` compartidos; la
// campana y el Resumen suman los informativos (`lead`, `collection`).

const NOTIFICATION_LEVEL: Record<string, string> = {
  overdue: "Vencido",
  soon: "Próximo",
  info: "Aviso",
};

const NOTIFICATION_KIND: Record<string, string> = {
  task: "Tarea",
  supplier_due: "Proveedor",
  checklist: "Checklist",
  reservation: "Reserva",
  collection: "Cobro",
  collection_due: "Cobro a plazo",
  expected_due: "Pago esperado",
  lead: "Lead",
  portal_request: "Solicitud del portal",
  payment_proof: "Comprobante de pago",
};

export const notificationLevelLabel = (value: string | null | undefined) => label(NOTIFICATION_LEVEL, value);
export const notificationKindLabel = (value: string | null | undefined) => label(NOTIFICATION_KIND, value);

/** Tono del nivel de un aviso: vencido (rojo), próximo (ámbar) o informativo (azul). */
export function notificationTone(level: string | null | undefined): AdminTone {
  if (level === "overdue") return "danger";
  if (level === "soon") return "warn";
  return "info";
}

const dayKeyPartsFormat = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Día de Asunción de un instante (`YYYY-MM-DD`); por defecto, hoy. */
function dayKeyOf(value: string | Date = new Date()): string {
  const date = toDate(value);
  if (!date) return "";
  const parts = dayKeyPartsFormat.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/**
 * Cuándo ocurre o pasó un día de Asunción, en texto corto: "hoy", "mañana",
 * "en 3 d", "hace 2 d". Delega en la cuenta regresiva compartida (issue #25)
 * para que el calendario y los avisos no tengan un lenguaje propio.
 */
export function formatDayWhen(dayKey: string | null | undefined): string {
  return formatCountdown(dayKey, "short");
}
// ── Auditoría ───────────────────────────────────────────────────────────────

const AUDIT_ACTION: Record<string, string> = {
  create: "Creó",
  update: "Editó",
  delete: "Eliminó",
  status: "Cambió estado",
  checkout: "Salida",
  checkin: "Devolución",
  convert: "Convirtió",
  remind: "Recordó",
  send: "Envió",
  lock: "Bloqueó",
  unlock: "Desbloqueó",
  deny: "Falló",
};

const AUDIT_ACTION_TONES: Record<string, AdminTone> = {
  create: "ok",
  update: "info",
  delete: "danger",
  status: "warn",
  checkout: "accent",
  checkin: "info",
  convert: "accent",
  remind: "accent",
  send: "accent",
  lock: "warn",
  unlock: "ok",
  deny: "danger",
};

const AUDIT_ENTITY: Record<string, string> = {
  Client: "Cliente",
  Event: "Evento",
  Budget: "Presupuesto",
  BudgetPaymentProof: "Comprobante de pago",
  ClientPayment: "Cobro",
  Supplier: "Proveedor",
  SupplierJob: "Trabajo de proveedor",
  InventoryItem: "Inventario",
  EventInventory: "Asignación de equipo",
  EventTask: "Tarea",
  Promoter: "Promotora",
  AdminUser: "Usuario",
  AdminSession: "Sesión del panel",
  TeamInvitation: "Invitación",
  Lead: "Lead",
  Organization: "Empresa",
  TreasuryAccount: "Cuenta de tesorería",
  TreasuryMovement: "Movimiento de tesorería",
  Expense: "Gasto",
  MessageTemplate: "Plantilla de mensaje",
  System: "Sistema",
  PlanChangeRequest: "Solicitud de plan",
  Invoice: "Factura",
  PurchaseInvoice: "Compra",
  FiscalPeriod: "Cierre mensual",
};

const AUDIT_FIELD: Record<string, string> = {
  name: "Nombre",
  company: "Empresa",
  type: "Tipo",
  email: "Correo",
  phone: "Teléfono",
  ruc: "RUC",
  notes: "Notas",
  active: "Activo",
  status: "Estado",
  role: "Rol",
  title: "Título",
  location: "Lugar",
  startsAt: "Inicio",
  endsAt: "Fin",
  setupAt: "Montaje",
  strikeAt: "Desmontaje",
  clientId: "Cliente",
  eventId: "Evento",
  budgetId: "Presupuesto",
  supplierId: "Proveedor",
  inventoryId: "Ítem",
  items: "Ítems",
  itemCount: "Ítems",
  subtotal: "Subtotal",
  discount: "Descuento",
  total: "Total",
  costEstimate: "Costo estimado",
  advanceAmount: "Anticipo",
  installments: "Cuotas",
  bank: "Banco",
  holder: "Titular",
  account: "Cuenta",
  alias: "Alias",
  unitPrice: "Precio unitario",
  costPrice: "Costo unitario",
  validUntil: "Válido hasta",
  amount: "Monto",
  method: "Medio de pago",
  reference: "Referencia",
  paidAt: "Pagado",
  collectedAt: "Cobrado el",
  invoiceNumber: "Nº de factura",
  invoiceIssuedAt: "Emisión de factura",
  chequeDate: "Fecha del cheque",
  mime: "Tipo de archivo",
  size: "Tamaño",
  password: "Contraseña",
  avatar: "Avatar",
  logo: "Logo",
  logoLight: "Logo claro",
  logoDark: "Logo oscuro",
  paymentId: "Cobro",
  category: "Categoría",
  body: "Mensaje",
  kind: "Tipo de ítem",
  quantity: "Cantidad",
  replacementCost: "Reposición",
  dailyCost: "Costo diario",
  specialties: "Especialidades",
  paymentTerms: "Condiciones de pago",
  description: "Descripción",
  advance: "Anticipo",
  dueAt: "Vencimiento",
  deliveredAt: "Entrega",
  paymentMethod: "Medio de pago",
  receipt: "Comprobante",
  checkedOut: "Salida registrada",
  checkedOutAt: "Fecha de salida",
  checkedIn: "Devolución registrada",
  checkedInAt: "Fecha de devolución",
  conditionOut: "Estado al retirar",
  conditionIn: "Estado al devolver",
  damagedQuantity: "Dañadas",
  missingQuantity: "Faltantes",
  damageNotes: "Notas de daños",
  completedAt: "Completada",
  internalNotes: "Notas internas",
  clientCreated: "Cliente creado",
  newAccount: "Cuenta nueva",
  fromLeadId: "Lead de origen",
  currency: "Moneda",
  openingBalance: "Saldo inicial",
  sortOrder: "Orden",
  direction: "Dirección",
  occurredAt: "Fecha del movimiento",
  origin: "Origen",
  sourceId: "Registro de origen",
  accountId: "Cuenta",
  counterAccountId: "Cuenta destino",
  createdByName: "Registrado por",
  date: "Fecha",
  invitedByName: "Invitado por",
  expiresAt: "Vence",
  sentCount: "Envíos",
  lastSentAt: "Último envío",
  via: "Ingreso",
  channel: "Canal",
  to: "Destino",
  template: "Plantilla",
  planCode: "Código del plan",
  planName: "Plan",
  priceMonthly: "Precio mensual",
  replacedPending: "Reemplazó la solicitud pendiente",
  planStartedAt: "Inicio del plan",
  // Registro fiscal (issue #41).
  number: "Número",
  clientName: "Razón social",
  clientRuc: "RUC del cliente",
  condition: "Condición",
  issuedAt: "Emisión",
  taxable10: "Gravada 10 %",
  iva10: "IVA 10 %",
  taxable5: "Gravada 5 %",
  iva5: "IVA 5 %",
  exempt: "Exenta",
  voidReason: "Motivo de anulación",
  month: "Mes",
  reason: "Razón social",
  timbrado: "Timbrado",
  concept: "Concepto",
  voidedByName: "Anulada por",
  closedByName: "Cerrado por",
  reopenedByName: "Reabierto por",
  reopenReason: "Motivo de reapertura",
  summary: "Resumen del cierre",
  establecimiento: "Establecimiento",
  direccion: "Dirección",
  razonSocial: "Razón social",
  fiscalDetails: "Datos fiscales",
};

/** Campos cuyo valor se dibuja como monto (PYG entero). */
const AUDIT_MONEY_FIELDS: ReadonlySet<string> = new Set([
  "subtotal",
  "discount",
  "total",
  "costEstimate",
  "advanceAmount",
  "amount",
  "advance",
  "replacementCost",
  "dailyCost",
  "unitPrice",
  "costPrice",
  "openingBalance",
  "priceMonthly",
  "taxable10",
  "iva10",
  "taxable5",
  "iva5",
  "exempt",
  "debitIva",
  "creditIva",
  "balance",
  "result",
]);

export const auditActionLabel = (value: string | null | undefined) => label(AUDIT_ACTION, value);
export const auditEntityLabel = (value: string | null | undefined) => label(AUDIT_ENTITY, value);

export function auditActionTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return AUDIT_ACTION_TONES[value] ?? "neutral";
}

/** Etiqueta legible del campo tocado; los nombres desconocidos se muestran tal cual. */
export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD[field] ?? field;
}

/** Valor de un cambio en formato legible (estados, roles, fechas y montos incluidos). */
export function auditValueLabel(entity: string | null | undefined, field: string | null | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const text = String(value);
  const key = field ?? "";
  if (key === "status") {
    if (entity === "Event") return eventStatusLabel(text);
    if (entity === "Budget") return budgetStatusLabel(text);
    if (entity === "ClientPayment") return paymentStatusLabel(text);
    if (entity === "SupplierJob") return jobStatusLabel(text);
    if (entity === "InventoryItem") return inventoryStatusLabel(text);
    if (entity === "Lead") return leadStatusLabel(text);
  }
  if (key === "role") return adminRoleLabel(text);
  if (key === "type" && entity === "Client") return clientTypeLabel(text);
  if (key === "type" && entity === "EventTask") return taskTypeLabel(text);
  if (key === "type" && entity === "TreasuryAccount") return treasuryAccountTypeLabel(text);
  if (key === "direction") return treasuryDirectionLabel(text);
  if (key === "origin") return treasuryOriginLabel(text);
  if (key === "category" && entity === "Expense") return expenseCategoryLabel(text);
  if (key === "category" && entity === "MessageTemplate") return messageTemplateCategoryLabel(text);
  if (key === "kind") return inventoryKindLabel(text);
  if (key === "category") return supplierCategoryLabel(text);
  if (key === "items" || key === "itemCount" || key === "installments") return numberFormat.format(Number(text) || 0);
  if (key === "size") return formatBytes(Number(text));
  if (key === "mime") return paymentProofMimeLabel(text);
  if (AUDIT_MONEY_FIELDS.has(key)) {
    const amount = Number(text);
    return Number.isFinite(amount) ? formatMoney(amount) : text;
  }
  if (/(At|Date)$/.test(key)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? text : formatDateTime(date);
  }
  return text;
}

export type AdminAuditLine = { label: string; from?: string; to?: string; value?: string };

/** Detalle de un cambio en líneas legibles: `Estado: Borrador → Confirmado`. */
export function auditDetailLines(
  entity: string,
  detail:
    | {
        changes?: Record<string, { from: unknown; to: unknown }>;
        fields?: Record<string, unknown>;
        before?: Record<string, unknown>;
      }
    | null
    | undefined,
): AdminAuditLine[] {
  if (!detail) return [];
  const lines: AdminAuditLine[] = [];
  if (detail.changes) {
    for (const [field, change] of Object.entries(detail.changes)) {
      lines.push({
        label: auditFieldLabel(field),
        from: auditValueLabel(entity, field, change.from),
        to: auditValueLabel(entity, field, change.to),
      });
    }
  }
  for (const [field, value] of Object.entries(detail.fields ?? {})) {
    lines.push({ label: auditFieldLabel(field), value: auditValueLabel(entity, field, value) });
  }
  for (const [field, value] of Object.entries(detail.before ?? {})) {
    lines.push({ label: auditFieldLabel(field), value: auditValueLabel(entity, field, value) });
  }
  return lines;
}

/** Detalle en una línea para el `title` de la fila. */
export function auditDetailText(
  entity: string,
  detail: Parameters<typeof auditDetailLines>[1],
): string | undefined {
  const lines = auditDetailLines(entity, detail);
  if (lines.length === 0) return undefined;
  return lines
    .map((line) => (line.from !== undefined || line.to !== undefined ? `${line.label}: ${line.from} → ${line.to}` : `${line.label}: ${line.value}`))
    .join(" · ");
}

