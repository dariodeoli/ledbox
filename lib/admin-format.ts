/**
 * Formatos y etiquetas del panel (fuente única).
 * Montos en PYG sin decimales; fechas y horas es-PY en 24 h (`hourCycle: "h23"`)
 * y en la zona de la empresa (`America/Asuncion`), así el servidor y el
 * navegador dibujan el mismo día.
 */

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

// ── Cobros a plazo (issue #16) ──────────────────────────────────────────────
// Estado del cobro de cliente (enum `ClientPaymentStatus`) y cuenta regresiva
// del vencimiento, calculada por día de Asunción (nunca por la medianoche del
// navegador): "cobramos en X días" / "vencido hace X días".

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
  const due = dayKeyToUtcDate(value ? dayKeyOf(value) : null);
  const today = dayKeyToUtcDate(dayKeyOf());
  if (!due || !today) return null;
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Cuenta regresiva del cobro: "cobramos en 12 días" / "vencido hace 3 días". */
export function collectionDueText(value: string | Date | null | undefined): string {
  const days = daysUntilDue(value);
  if (days === null) return "Sin vencimiento";
  if (days === 0) return "cobramos hoy";
  if (days === 1) return "cobramos mañana";
  if (days === -1) return "vencido hace 1 día";
  return days > 0 ? `cobramos en ${formatNumber(days)} días` : `vencido hace ${formatNumber(Math.abs(days))} días`;
}

/** Tono de la cuenta regresiva: vencido (rojo) o por vencer en 7 días (ámbar). */
export function collectionDueTone(value: string | Date | null | undefined, days = 7): AdminTone | undefined {
  const distance = daysUntilDue(value);
  if (distance === null) return undefined;
  if (distance < 0) return "danger";
  if (distance <= days) return "warn";
  return undefined;
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
export function whatsappHref(phone: string | null | undefined): string | null {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const international = digits.startsWith("595") ? digits : digits.startsWith("0") ? `595${digits.slice(1)}` : `595${digits}`;
  return `https://wa.me/${international}`;
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
  collection: "Cobro",
  collection_due: "Cobro a plazo",
  lead: "Lead",
  portal_request: "Solicitud del portal",
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
 * "en 3 d", "hace 2 d". Se calcula contra el día de Asunción, no contra la
 * medianoche del navegador.
 */
export function formatDayWhen(dayKey: string | null | undefined): string {
  const date = dayKeyToUtcDate(dayKey);
  const today = dayKeyToUtcDate(dayKeyOf());
  if (!date || !today) return "—";
  const distance = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (distance === 0) return "hoy";
  if (distance === 1) return "mañana";
  if (distance === -1) return "ayer";
  return distance > 0 ? `en ${formatNumber(distance)} d` : `hace ${formatNumber(Math.abs(distance))} d`;
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
};

const AUDIT_ACTION_TONES: Record<string, AdminTone> = {
  create: "ok",
  update: "info",
  delete: "danger",
  status: "warn",
  checkout: "accent",
  checkin: "info",
  convert: "accent",
};

const AUDIT_ENTITY: Record<string, string> = {
  Client: "Cliente",
  Event: "Evento",
  Budget: "Presupuesto",
  ClientPayment: "Cobro",
  Supplier: "Proveedor",
  SupplierJob: "Trabajo de proveedor",
  InventoryItem: "Inventario",
  EventInventory: "Asignación de equipo",
  EventTask: "Tarea",
  Promoter: "Promotora",
  AdminUser: "Usuario",
  Lead: "Lead",
  Organization: "Empresa",
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
  category: "Categoría",
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
  if (key === "kind") return inventoryKindLabel(text);
  if (key === "category") return supplierCategoryLabel(text);
  if (key === "items" || key === "itemCount" || key === "installments") return numberFormat.format(Number(text) || 0);
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

