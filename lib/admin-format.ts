/**
 * Formatos y etiquetas del panel (fuente única).
 * Montos en PYG sin decimales; fechas y horas es-PY en 24 h (`hourCycle: "h23"`).
 */

export type AdminTone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info";

const moneyFormat = new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "short", year: "numeric" });
const dateShortFormat = new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "short" });
const dateTimeFormat = new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const timeFormat = new Intl.DateTimeFormat("es-PY", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

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

/** Vencido o a punto de vencer (dentro de los próximos `days` días). */
export function isDueSoon(value: string | Date | null | undefined, days = 7): boolean {
  const date = toDate(value);
  if (!date) return false;
  return date.getTime() <= Date.now() + days * 86_400_000;
}

export function dueTone(value: string | Date | null | undefined, days = 7): AdminTone | undefined {
  return isDueSoon(value, days) ? "warn" : undefined;
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

export function statusTone(value: string | null | undefined): AdminTone {
  if (!value) return "neutral";
  return TONES[value] ?? "neutral";
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
export function whatsappHref(phone: string | null | undefined): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const international = digits.startsWith("595") ? digits : digits.startsWith("0") ? `595${digits.slice(1)}` : `595${digits}`;
  return `https://wa.me/${international}`;
}
