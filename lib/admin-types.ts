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
  | "alert"
  | "power"
  | "mail"
  | "refresh"
  | "clock"
  | "info";

export type AdminSessionUser = { id: string; name: string; email: string; role: AdminRole };

export type AdminOrganization = { id: string; name: string; slug?: string | null; role?: string | null };

/**
 * `GET /api/admin/session`. Contrato objetivo `{ user, organization, organizations[] }`; el API
 * actual todavía anida el usuario autenticado (`user.user`), por eso el consumo es defensivo.
 */
export type AdminSessionPayload = {
  user: AdminSessionUser | { user: AdminSessionUser } | null;
  organization?: AdminOrganization | null;
  organizations?: AdminOrganization[] | null;
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

export type AdminEventRef = { id: string; name: string; startsAt: string | null; status: string };

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
};

export type AdminPayment = {
  id: string;
  amount: number;
  paidAt: string;
  method: string | null;
  reference: string | null;
  budgetId: string | null;
};

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
  total: number;
  advance: number;
  status: string;
  dueAt: string | null;
  deliveredAt: string | null;
  paidAt: string | null;
  paymentMethod: string | null;
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
};

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

/** Ítem de `/api/admin/inventory`: incluye asignaciones y disponibilidad de hoy. */
export type AdminInventoryItemRow = AdminInventoryRow & {
  assignments: AdminInventoryAssignmentRow[];
  availability: { committedNow: number; availableNow: number; overcommittedNow: boolean };
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

/** Sobre común de los GET del panel; cada módulo consume las claves que su endpoint devuelve. */
export type AdminApiResponse = {
  items?: AdminCalendarItem[];
  alerts?: AdminCalendarAlert[];
  error?: string;
  clients?: AdminClientRow[];
  leads?: AdminLeadRow[];
  events?: AdminEventRow[];
  budgets?: AdminBudgetRow[];
  clientPayments?: AdminPaymentRow[];
  supplierJobs?: AdminSupplierJobRow[];
  suppliers?: AdminSupplierRow[];
  inventory?: Array<AdminInventoryRow | AdminInventoryItemRow>;
  availability?: AdminInventoryAvailability;
  promoters?: AdminPromoterRow[];
  users?: AdminUserRow[];
  counts?: AdminOverview["counts"];
  finance?: AdminOverview["finance"];
  upcoming?: AdminOverview["upcoming"];
};
