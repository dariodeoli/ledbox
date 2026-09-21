/**
 * Tipos del panel: reflejan el contrato real de `/api/admin/*` (handlers en `app/api/admin/`).
 * Se declaran solo los campos que la UI consume; los payloads traen el resto de los escalares.
 */

import type { AdminTone } from "./admin-format";

export type AdminRole = "OWNER" | "ADMIN" | "FINANCE" | "OPERATIONS" | "VIEWER";

export type AdminIconName =
  | "overview"
  | "events"
  | "calendar"
  | "clients"
  | "leads"
  | "budgets"
  | "audit"
  | "bell"
  | "finance"
  | "inventory"
  | "suppliers"
  | "promoters"
  | "users"
  | "menu"
  | "close"
  | "sun"
  | "moon"
  | "logout"
  | "external"
  | "search"
  | "plus"
  | "check"
  | "edit"
  | "arrow-right"
  | "alert"
  | "power"
  | "mail"
  | "refresh"
  | "clock"
  | "info"
  | "print"
  | "download"
  | "eye"
  | "eye-off";

export type AdminSessionUser = { id: string; name: string; email: string; role: AdminRole };

export type AdminOrganization = { id: string; name: string; slug?: string | null; role?: string | null };

/**
 * `GET /api/admin/session`. Contrato objetivo `{ user, organization, organizations[] }`; el API
 * actual todavía anida el usuario autenticado (`user.user`), por eso el consumo es defensivo.
 * `demo: true` marca la sesión de la demo pública (issue #14), de solo lectura.
 */
export type AdminSessionPayload = {
  user: AdminSessionUser | { user: AdminSessionUser } | null;
  organization?: AdminOrganization | null;
  organizations?: AdminOrganization[] | null;
  demo?: boolean | null;
};

/** Cliente embebido en eventos/presupuestos/finanzas (relación `client: true`). */
export type AdminClientRef = {
  id: string;
  name: string;
  company: string | null;
  type: string;
  email: string | null;
  phone: string | null;
};

export type AdminClientRow = AdminClientRef & {
  ruc: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  _count: { events: number; budgets: number };
};

export type AdminEventRef = {
  id: string;
  name: string;
  startsAt: string | null;
  status: string;
  /** Rango del evento (issue #18): lo usa la reserva de inventario; puede faltar en refs mínimas. */
  setupAt?: string | null;
  endsAt?: string | null;
  strikeAt?: string | null;
};

export type AdminEventTask = {
  id: string;
  eventId: string;
  type: string;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
};

export type AdminEventAssignmentMovement = {
  id: string;
  quantity: number;
  startsAt: string | null;
  endsAt: string | null;
  checkedOut: boolean;
  checkedIn: boolean;
  checkedOutAt: string | null;
  checkedInAt: string | null;
  conditionOut: string | null;
  conditionIn: string | null;
  damagedQuantity: number;
  missingQuantity: number;
  damageNotes: string | null;
};

export type AdminEventAssignment = AdminEventAssignmentMovement & {
  eventId: string;
  inventory: { id: string; name: string; sku: string | null };
};

export type AdminEventRow = {
  id: string;
  name: string;
  location: string | null;
  setupAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  strikeAt: string | null;
  status: string;
  notes: string | null;
  client: AdminClientRef;
  assignments: AdminEventAssignment[];
  tasks: AdminEventTask[];
};

export type AdminBudgetItem = {
  id: string;
  name: string;
  quantity: number;
  days: number;
  unitPrice: number;
  costPrice: number;
  subtotal: number;
  /** Vínculo con inventario (issue #18): `null` = el ítem no reserva nada. */
  inventoryId: string | null;
  inventory: AdminInventoryLink | null;
};

/** Cuota del plan de pagos (issue #14); `dueAt` es `YYYY-MM-DD`. */
export type AdminBudgetInstallment = { label: string; amount: number; dueAt: string | null };

export type AdminPayment = {
  id: string;
  amount: number;
  /** A cobrar / cobrado / anulado (issue #16). */
  status: string;
  /** Fecha de pago; `null` mientras el cobro está pendiente. */
  paidAt: string | null;
  /** Fecha real del cobro (los cobros viejos usan `paidAt`). */
  collectedAt: string | null;
  method: string | null;
  reference: string | null;
  budgetId: string | null;
  invoiceNumber: string | null;
  invoiceIssuedAt: string | null;
  /** Vencimiento de cobro de un cobro a plazo. */
  dueAt: string | null;
  /** Fecha del cheque cuando el método es cheque. */
  chequeDate: string | null;
  createdAt: string;
};

/** Solo un cobro `RECEIVED` cuenta como plata cobrada (nada de contar pendientes). */
export function isCollectedPayment(payment: Pick<AdminPayment, "status">): boolean {
  return payment.status === "RECEIVED";
}

/** Monto realmente cobrado de una lista de cobros. */
export function collectedAmount(payments: ReadonlyArray<Pick<AdminPayment, "amount" | "status">>): number {
  return payments.reduce((sum, payment) => (isCollectedPayment(payment) ? sum + payment.amount : sum), 0);
}

export type AdminBudgetRow = {
  id: string;
  title: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  costEstimate: number;
  validUntil: string | null;
  createdAt: string;
  notes: string | null;
  client: AdminClientRef;
  event: AdminEventRef | null;
  items: AdminBudgetItem[];
  payments: AdminPayment[];
  /** Plan de pagos (issue #14): anticipo, condiciones y cuotas. */
  advanceAmount: number;
  paymentTerms: string | null;
  installmentsJson: AdminBudgetInstallment[] | null;
  /** Portal del cliente (issue #12): token público y evidencia de la aprobación. */
  publicToken: string | null;
  publicTokenCreatedAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  approvalMethod: string | null;
  approvalNote: string | null;
  revisionRequestedAt: string | null;
  revisionNote: string | null;
};

// ── Solicitudes del portal (issue #14) ──────────────────────────────────────
// El cliente propone cantidades/días o pide una rebaja; el equipo acepta
// (aplicándola al presupuesto) o rechaza con nota. `changes` es el pedido de
// cambios libre del issue #12, que ahora también se resuelve desde la cola.

export type AdminBudgetChangeKind = "items" | "discount" | "changes";
export type AdminBudgetChangeStatus = "pending" | "accepted" | "rejected";

export type AdminBudgetRequestItem = { id: string; quantity: number; days: number };
export type AdminBudgetRequestDiscount = { type: "percent" | "amount"; value: number; amount: number };
export type AdminBudgetRequestPayload = {
  items?: AdminBudgetRequestItem[];
  discount?: AdminBudgetRequestDiscount;
  comment?: string;
};

export type AdminBudgetRequestRow = {
  id: string;
  budgetId: string;
  kind: AdminBudgetChangeKind;
  status: AdminBudgetChangeStatus;
  payload: AdminBudgetRequestPayload;
  note: string | null;
  requestedByName: string;
  requestedByEmail: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByName: string | null;
  responseNote: string | null;
  budget: {
    id: string;
    title: string;
    status: string;
    subtotal: number;
    discount: number;
    total: number;
    /** Referencia mínima del cliente (el API de solicitudes solo manda nombre y empresa). */
    client: Pick<AdminClientRef, "name" | "company">;
    items: Array<Pick<AdminBudgetItem, "id" | "name" | "quantity" | "days" | "unitPrice">>;
  };
};

/** Datos de pago de la empresa (issue #14); `null` en los campos sin cargar. */
export type AdminPaymentDetails = {
  bank: string | null;
  holder: string | null;
  ruc: string | null;
  account: string | null;
  alias: string | null;
};

export type AdminBudgetPlanPayload = {
  budget?: Pick<AdminBudgetRow, "id" | "advanceAmount" | "paymentTerms" | "installmentsJson" | "total">;
  error?: string;
};

export type AdminBudgetApprovalState = "PENDIENTE" | "APROBADO_DIGITAL" | "APROBADO_MANUAL" | "CAMBIOS_SOLICITADOS";

/** Estado del portal de un presupuesto (mismo criterio que el API público). */
export function budgetApprovalState(
  budget: Pick<AdminBudgetRow, "approvedAt" | "approvalMethod" | "revisionRequestedAt">,
): AdminBudgetApprovalState {
  if (budget.approvedAt) return budget.approvalMethod === "manual" ? "APROBADO_MANUAL" : "APROBADO_DIGITAL";
  if (budget.revisionRequestedAt) return "CAMBIOS_SOLICITADOS";
  return "PENDIENTE";
}

/** Respuesta de `POST /api/admin/budgets/token` y `POST /api/admin/budgets/approval`. */
export type AdminBudgetPortalPayload = {
  budget?: {
    id: string;
    publicToken: string | null;
    publicTokenCreatedAt: string | null;
    approvedAt: string | null;
    approvedByName: string | null;
    approvalMethod: string | null;
    approvalNote: string | null;
    revisionRequestedAt: string | null;
    revisionNote: string | null;
  };
  /** Reserva automática al aprobar (issue #18); `null`/ausente si no se aprobó ahora. */
  reservations?: AdminBudgetReservation | null;
  error?: string;
};

// ── Reserva automática al aprobar (issue #18) ────────────────────────────────
// Contrato real de `reserveBudgetInventory`: qué se reservó, qué quedó pendiente
// y qué alternativas hay. La UI solo lo dibuja.

export type AdminReservationStatus =
  | "created"
  | "updated"
  | "unchanged"
  | "conflict"
  | "blocked"
  | "missing-event"
  | "missing-range"
  | "in-movement";

export type AdminReservationOutcome = {
  itemId: string;
  itemName: string;
  quantity: number;
  inventoryId: string;
  inventoryName: string;
  inventorySku: string | null;
  status: AdminReservationStatus;
  reserved: number;
  available: number;
  total: number;
  conflicts: Array<{
    id: string;
    eventId: string;
    eventName: string;
    quantity: number;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  substitutes: AdminInventorySubstitute[];
  reason: string | null;
};

export type AdminBudgetReservation = {
  eventId: string | null;
  eventName: string | null;
  range: { startsAt: string; endsAt: string } | null;
  outcomes: AdminReservationOutcome[];
  requested: number;
  reserved: number;
  conflicts: number;
  failed: boolean;
};

export type AdminPaymentRow = AdminPayment & { client: AdminClientRef; budget: { id: string; title: string } | null };

/** Ítem de pedido que llega con el lead desde el sitio (relación `quoteRequests.items`). */
export type AdminLeadItem = {
  id: string;
  productSlug: string;
  productName: string;
  quantity: number;
  duration: number | null;
  billingUnit: string;
  unitPrice: number | null;
  subtotal: number | null;
  notes: string | null;
};

export type AdminLeadQuote = {
  id: string;
  referenceTotal: number | null;
  currency: string;
  durationDays: number | null;
  eventDate: string | null;
  location: string | null;
  source: string;
  createdAt: string;
  items: AdminLeadItem[];
};

export type AdminLeadRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string | null;
  ruc: string | null;
  reason: string | null;
  eventDate: string | null;
  location: string | null;
  message: string | null;
  internalNotes: string | null;
  source: string;
  consentAt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  quoteRequests: AdminLeadQuote[];
};

export type AdminSupplierJobRow = {
  id: string;
  description: string;
  category: string;
  total: number;
  advance: number;
  status: string;
  dueAt: string | null;
  deliveredAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
  receipt: string | null;
  notes: string | null;
  supplier: { id: string; name: string; phone: string | null; category: string };
  event: AdminEventRef | null;
};

export type AdminSupplierRow = {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  category: string;
  paymentTerms: string | null;
  notes: string | null;
  active: boolean;
  _count?: { jobs: number };
};

/** Categorías del enum `SupplierCategory`: fuente única para los selectores del panel. */
export const SUPPLIER_CATEGORIES = [
  "CARPENTRY",
  "GRAPHICS",
  "ELECTRICITY",
  "TRANSPORT",
  "FURNITURE",
  "AUDIOVISUAL",
  "STAFF",
  "OTHER",
] as const;

export type SupplierCategoryValue = (typeof SUPPLIER_CATEGORIES)[number];

/** Estados del trabajo de proveedor (enum `SupplierWorkStatus`). */
export const SUPPLIER_JOB_STATUSES = [
  "PENDING",
  "CONTRACTED",
  "ADVANCE_PENDING",
  "ADVANCE_PAID",
  "IN_PRODUCTION",
  "DELIVERED",
  "BALANCE_PENDING",
  "PAID",
  "CANCELLED",
] as const;

export type SupplierJobStatus = (typeof SUPPLIER_JOB_STATUSES)[number];

/**
 * Máquina de estados del trabajo de proveedor (fuente única: la valida el API y la
 * dibuja la UI). Solo se avanza a un estado siguiente válido; `CANCELLED` corta desde
 * cualquier estado abierto y los terminales (`PAID`, `CANCELLED`) no se reabren.
 * Reglas de montos que aplica el API: `ADVANCE_PENDING`/`ADVANCE_PAID` exigen
 * anticipo > 0 y `BALANCE_PENDING` exige saldo > 0.
 */
export const SUPPLIER_JOB_TRANSITIONS: Record<SupplierJobStatus, readonly SupplierJobStatus[]> = {
  PENDING: ["CONTRACTED", "CANCELLED"],
  CONTRACTED: ["ADVANCE_PENDING", "ADVANCE_PAID", "IN_PRODUCTION", "CANCELLED"],
  ADVANCE_PENDING: ["ADVANCE_PAID", "CONTRACTED", "CANCELLED"],
  ADVANCE_PAID: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["BALANCE_PENDING", "PAID", "CANCELLED"],
  BALANCE_PENDING: ["PAID", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

export function supplierJobTransitions(status: string): readonly SupplierJobStatus[] {
  return SUPPLIER_JOB_TRANSITIONS[status as SupplierJobStatus] ?? [];
}

/** Transiciones válidas para un trabajo concreto: aplica la máquina y las reglas de montos. */
export function supplierJobNextStatuses(job: { total: number; advance: number; status: string }): readonly SupplierJobStatus[] {
  return supplierJobTransitions(job.status).filter((next) => {
    if (next === "ADVANCE_PENDING" || next === "ADVANCE_PAID") return job.advance > 0;
    if (next === "BALANCE_PENDING") return job.total - job.advance > 0;
    return true;
  });
}

export function isSupplierJobOpen(status: string): boolean {
  return status !== "PAID" && status !== "CANCELLED";
}

/** Saldo pendiente real de un trabajo: 0 si está pagado o cancelado; si no, total − anticipo. */
export function supplierJobBalance(job: { total: number; advance: number; status: string }): number {
  if (!isSupplierJobOpen(job.status)) return 0;
  return Math.max(0, job.total - job.advance);
}

export type AdminInventoryRow = {
  id: string;
  name: string;
  category: string;
  sku: string | null;
  kind: string;
  status: string;
  quantity: number;
  replacementCost: number;
  dailyCost: number;
  notes: string | null;
  updatedAt: string;
};

/** Asignación de inventario a un evento, tal como la sirve `/api/admin/inventory`. */
export type AdminInventoryAssignmentRow = AdminEventAssignmentMovement & {
  eventId: string;
  event: { id: string; name: string; startsAt: string | null; endsAt: string | null; status: string };
};

export type AdminInventoryAvailability = {
  inventoryId: string;
  name: string;
  status: string;
  total: number;
  committed: number;
  available: number;
  blocked: boolean;
  startsAt: string;
  endsAt: string;
  conflicts: Array<{
    id: string;
    eventId: string;
    eventName: string;
    quantity: number;
    startsAt: string | null;
    endsAt: string | null;
  }>;
};

/** Artículo del inventario vinculado a un ítem del presupuesto (issue #18). */
export type AdminInventoryLink = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  quantity: number;
  status: string;
};

/** Disponibilidad por rango de la vista de inventario (issue #18). */
export type AdminInventoryRangeAvailability = {
  startsAt: string;
  endsAt: string;
  committed: number;
  available: number;
  overcommitted: boolean;
  /** Rangos comprometidos por equipo que se solapan con el rango pedido. */
  conflicts: AdminInventoryAvailability["conflicts"];
};

/** Sustituto sugerido: misma categoría con stock libre en el rango (issue #18). */
export type AdminInventorySubstitute = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  status: string;
  total: number;
  committed: number;
  available: number;
  conflicts: number;
};

/** Ítem de `/api/admin/inventory`: incluye asignaciones y disponibilidad de hoy. */
export type AdminInventoryItemRow = AdminInventoryRow & {
  assignments: AdminInventoryAssignmentRow[];
  availability: {
    committedNow: number;
    availableNow: number;
    overcommittedNow: boolean;
    /** Disponibilidad del rango pedido; `null` cuando la lista va sin rango. */
    range?: AdminInventoryRangeAvailability | null;
  };
};

export type AdminPromoterRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  specialties: string | null;
  active: boolean;
  createdAt: string;
};

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
};

/**
 * Entidades auditables: fuente única del nombre que se guarda en `AuditLog.entity`
 * y del filtro de `/api/admin/audit`. Solo se registran mutaciones (nunca lecturas).
 */
export const AUDIT_ENTITIES = [
  "Client",
  "Event",
  "Budget",
  "ClientPayment",
  "Supplier",
  "SupplierJob",
  "InventoryItem",
  "EventInventory",
  "EventTask",
  "Promoter",
  "AdminUser",
  "Lead",
  "Organization",
] as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Acciones auditadas: alta, edición, baja, cambio de estado, salida/devolución y conversión. */
export const AUDIT_ACTIONS = ["create", "update", "delete", "status", "checkout", "checkin", "convert"] as const;

export type AuditActionValue = (typeof AUDIT_ACTIONS)[number];

/** Valor anterior y nuevo de un campo que cambió. */
export type AdminAuditChange = { from: unknown; to: unknown };

/** Detalle acotado: `changes` (antes/después), `fields` (alta) o `before` (baja). */
export type AdminAuditDetail = {
  changes?: Record<string, AdminAuditChange>;
  fields?: Record<string, unknown>;
  before?: Record<string, unknown>;
};

export type AdminAuditRow = {
  id: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  detail: AdminAuditDetail | null;
  createdAt: string;
};

/** Actor con actividad registrada en la empresa (para el filtro del historial). */
export type AdminAuditActor = { id: string; name: string; email: string };

export type AdminOverview = {
  counts: {
    clients: number;
    budgets: number;
    events: number;
    suppliers: number;
    inventory: number;
    promoters: number;
    leads: number;
  };
  finance: { totalReceivable: number; totalPayable: number; committedCash: number };
  upcoming: Array<{
    id: string;
    name: string;
    location: string | null;
    startsAt: string | null;
    status: string;
    client: AdminClientRef;
    assignments: Array<{ quantity: number; inventory: { id: string; name: string; sku: string | null } }>;
    tasks: Array<{ title: string; completedAt: string | null }>;
  }>;
};

/** Calendario operativo (`GET /api/admin/calendar?from&to`): marcador sobre un hecho real. */
export type AdminCalendarItemKind =
  | "setup"
  | "event"
  | "event_end"
  | "strike"
  | "collection"
  | "collection_due"
  | "supplier_due"
  | "supplier_delivery"
  | "supplier_payment"
  | "task";

export type AdminCalendarItem = {
  id: string;
  kind: AdminCalendarItemKind;
  /** Día de Asunción del hecho (`YYYY-MM-DD`); es la clave con la que agrupa la vista. */
  date: string;
  /** Instante real del hecho (ISO). */
  at: string;
  /** Fin del rango real, solo para eventos de varios días. */
  endAt: string | null;
  endDate: string | null;
  title: string;
  subtitle: string | null;
  href: string;
  tone: AdminTone;
  /** Enum real de la entidad (estado del evento o del trabajo, tipo de tarea) para el badge. */
  tag: string | null;
  amount: number | null;
};

export type AdminCalendarAlertLevel = "overdue" | "soon";
export type AdminCalendarAlertKind = "task" | "supplier_due" | "checklist";

export type AdminCalendarAlert = {
  id: string;
  level: AdminCalendarAlertLevel;
  kind: AdminCalendarAlertKind;
  title: string;
  subtitle: string | null;
  /** Día de Asunción del vencimiento (`YYYY-MM-DD`). */
  date: string;
  href: string;
};

/**
 * Avisos operativos (`GET /api/admin/notifications`): mismo esqueleto que las
 * alertas del calendario, con los niveles/kind ampliados a todos los hechos
 * reales del panel. Los `kind` compartidos con el calendario se conservan tal cual.
 */
export type AdminNotificationLevel = AdminCalendarAlertLevel | "info";
export type AdminNotificationKind =
  | AdminCalendarAlertKind
  | "collection"
  | "collection_due"
  | "lead"
  | "portal_request"
  | "reservation";

export type AdminNotification = {
  id: string;
  kind: AdminNotificationKind;
  level: AdminNotificationLevel;
  title: string;
  subtitle: string | null;
  /** Día de Asunción del hecho (`YYYY-MM-DD`); es la fecha real, no el día de consulta. */
  date: string;
  href: string;
};

/** Totales reales del feed (sin el recorte) para el contador de la campana. */
export type AdminNotificationCounts = {
  overdue: number;
  soon: number;
  info: number;
  total: number;
};

/**
 * Reporte mensual imprimible (`/imprimir/reporte?mes=YYYY-MM`).
 * Se arma server-side con datos reales del período y llega al cliente ya
 * formateado: la hoja impresa y el CSV salen del mismo modelo.
 */
export type AdminMonthlyReportEventRow = {
  id: string;
  date: string;
  name: string;
  client: string;
  location: string | null;
  /** Venta presupuestada del evento (Σ presupuestos). */
  sale: number;
  /** Costos estimados cargados en los presupuestos del evento. */
  costEstimate: number;
  /** Venta − costos estimados; `null` cuando el evento no tiene costos cargados. */
  margin: number | null;
  /** Trabajos de proveedor cargados contra el evento. */
  supplierJobs: number;
  supplierTotal: number;
};

export type AdminMonthlyReportCollectionRow = {
  id: string;
  date: string;
  client: string;
  budget: string | null;
  method: string | null;
  reference: string | null;
  amount: number;
};

export type AdminMonthlyReportSupplierPaymentRow = {
  id: string;
  date: string;
  supplier: string;
  description: string;
  event: string | null;
  method: string | null;
  receipt: string | null;
  amount: number;
};

export type AdminMonthlyReportSupplierPendingRow = {
  id: string;
  dueDate: string;
  supplier: string;
  description: string;
  event: string | null;
  status: string;
  total: number;
  advance: number;
  balance: number;
};

export type AdminMonthlyReportTotals = {
  events: number;
  sale: number;
  costEstimate: number;
  /** Σ margen de los eventos con costos cargados; `null` si ninguno los tiene. */
  margin: number | null;
  collected: number;
  paidToSuppliers: number;
  committedBalance: number;
};

export type AdminMonthlyReport = {
  /** Mes del período (`YYYY-MM`). */
  month: string;
  /** Etiqueta del período (ej.: "septiembre 2026"). */
  monthLabel: string;
  /** Fecha y hora de emisión, es-PY 24 h. */
  issuedAt: string;
  /** Empresa activa (nombre real de la organización). */
  organization: string;
  totals: AdminMonthlyReportTotals;
  events: AdminMonthlyReportEventRow[];
  collections: AdminMonthlyReportCollectionRow[];
  supplierPayments: AdminMonthlyReportSupplierPaymentRow[];
  supplierPending: AdminMonthlyReportSupplierPendingRow[];
};

/** Sobre común de los GET del panel; cada módulo consume las claves que su endpoint devuelve. */
export type AdminApiResponse = {
  items?: AdminCalendarItem[];
  alerts?: AdminCalendarAlert[];
  notifications?: AdminNotification[];
  notificationCounts?: AdminNotificationCounts;
  error?: string;
  clients?: AdminClientRow[];
  leads?: AdminLeadRow[];
  events?: AdminEventRow[];
  budgets?: AdminBudgetRow[];
  budgetRequests?: AdminBudgetRequestRow[];
  clientPayments?: AdminPaymentRow[];
  supplierJobs?: AdminSupplierJobRow[];
  jobs?: AdminSupplierJobRow[];
  suppliers?: AdminSupplierRow[];
  inventory?: Array<AdminInventoryRow | AdminInventoryItemRow>;
  availability?: AdminInventoryAvailability;
  substitutes?: AdminInventorySubstitute[];
  promoters?: AdminPromoterRow[];
  users?: AdminUserRow[];
  auditLogs?: AdminAuditRow[];
  auditActors?: AdminAuditActor[];
  auditTotal?: number;
  auditPage?: number;
  auditPageSize?: number;
  counts?: AdminOverview["counts"];
  finance?: AdminOverview["finance"];
  upcoming?: AdminOverview["upcoming"];
};
