/**
 * Tipos del panel: reflejan el contrato real de `/api/admin/*` (handlers en `app/api/admin/`).
 * Se declaran solo los campos que la UI consume; los payloads traen el resto de los escalares.
 */

import { isOverdue, type AdminTone } from "./admin-format";

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
  | "eye-off"
  | "user"
  | "building"
  | "chevron-down"
  | "upload"
  | "trash";

export type AdminSessionUser = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  /** Avatar subido (issue #22): `null` = el chip dibuja las iniciales. */
  avatarUpdatedAt?: string | null;
};

export type AdminOrganization = {
  id: string;
  name: string;
  slug?: string | null;
  role?: string | null;
  /** Logo por tema (issue #22): `null` en cada variante que falta. */
  logos?: AdminOrganizationLogos;
};

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
  /** Promotora asignada (issue #24): null si la tarea es del equipo. */
  promoterId?: string | null;
  promoter?: AdminPromoterRef | null;
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

/**
 * Deuda vencida derivada de los cobros reales (issue #24): solo los cobros
 * pendientes (`PENDING`) con vencimiento pasado cuentan. No hay campo nuevo:
 * sale del dato de finanzas, igual que el saldo de un presupuesto.
 */
export function overdueAmount(
  payments: ReadonlyArray<Pick<AdminPayment, "amount" | "status" | "dueAt">>,
): number {
  return payments.reduce(
    (sum, payment) => (payment.status === "PENDING" && isOverdue(payment.dueAt) ? sum + payment.amount : sum),
    0,
  );
}

/** Cobros vencidos de una lista (cantidad), para el detalle del indicador. */
export function overdueCount(
  payments: ReadonlyArray<Pick<AdminPayment, "status" | "dueAt">>,
): number {
  return payments.filter((payment) => payment.status === "PENDING" && isOverdue(payment.dueAt)).length;
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

export type AdminPaymentRow = AdminPayment & {
  client: AdminClientRef;
  budget: { id: string; title: string; publicToken?: string | null } | null;
  /** Recordatorios enviados/abiertos de este cobro (issue #19), más recientes primero. */
  reminders: AdminPaymentReminder[];
  /** Cuenta de tesorería del cobro (issue #27); `null` si se registró sin cuenta. */
  treasuryAccount?: AdminTreasuryAccountRef | null;
};

// ── Tesorería por cuentas y gastos (issue #27) ──────────────────────────────
// El saldo de una cuenta nunca se guarda: siempre se deriva del saldo inicial
// declarado más los movimientos registrados. Estas listas son la fuente única
// de los selectores del panel y espejan los enums del schema.

/** Tipos de cuenta (`TreasuryAccountType`). */
export const TREASURY_ACCOUNT_TYPES = ["CASH", "BANK", "CHEQUE", "OTHER"] as const;
export type TreasuryAccountTypeValue = (typeof TREASURY_ACCOUNT_TYPES)[number];

/** Direcciones de un movimiento (`TreasuryMovementDirection`). */
export const TREASURY_DIRECTIONS = ["IN", "OUT", "TRANSFER"] as const;
export type TreasuryDirectionValue = (typeof TREASURY_DIRECTIONS)[number];

/** Origen de un movimiento (`TreasuryMovementOrigin`). */
export const TREASURY_ORIGINS = ["client_payment", "supplier_job", "expense", "adjustment"] as const;
export type TreasuryOriginValue = (typeof TREASURY_ORIGINS)[number];

/** Categorías de gasto (`ExpenseCategory`). */
export const EXPENSE_CATEGORIES = [
  "TRANSPORT",
  "FUEL",
  "FOOD",
  "MATERIALS",
  "RENT",
  "SERVICES",
  "SALARIES",
  "TOOLS",
  "OTHER",
] as const;
export type ExpenseCategoryValue = (typeof EXPENSE_CATEGORIES)[number];

/** Métodos de pago del panel: misma lista que valida el API de finanzas. */
export const PAYMENT_METHODS = ["Transferencia", "Efectivo", "Cheque", "Tarjeta", "Otro"] as const;

/** Referencia mínima de una cuenta de tesorería dentro de otro registro. */
export type AdminTreasuryAccountRef = { id: string; name: string; type: string };

/** Cuenta de tesorería con su saldo derivado. */
export type AdminTreasuryAccountRow = AdminTreasuryAccountRef & {
  bank: string | null;
  currency: string;
  openingBalance: number;
  sortOrder: number;
  active: boolean;
  /** Saldo inicial + entradas − salidas (y transferencias). No es saldo bancario. */
  balance: number;
};

/** Totales por tipo de cuenta: los KPIs de tesorería. */
export type AdminTreasurySummary = {
  cash: number;
  bank: number;
  cheque: number;
  other: number;
  total: number;
  accounts: number;
  activeAccounts: number;
};

export type AdminTreasuryMovementRow = {
  id: string;
  direction: string;
  amount: number;
  occurredAt: string;
  origin: string;
  sourceId: string | null;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  account: AdminTreasuryAccountRef;
  counterAccount: AdminTreasuryAccountRef | null;
  /** Hecho real que lo originó, ya resuelto por el API (cliente, proveedor o gasto). */
  sourceLabel: string | null;
};

export type AdminExpenseRow = {
  id: string;
  date: string;
  amount: number;
  category: string;
  description: string;
  method: string | null;
  receipt: string | null;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  account: AdminTreasuryAccountRef;
  /** Proyecto/evento asociado; `null` es "A definir" (se asigna desde la fila). */
  event: AdminEventRef | null;
  supplier: { id: string; name: string } | null;
};

/** Proyecto disponible para asociar un gasto (lista liviana del selector). */
export type AdminExpenseProject = {
  id: string;
  name: string;
  startsAt: string | null;
  client: { id: string; name: string; company: string | null };
};

// ── Pagos esperados y confirmación en cuenta (issue #28) ────────────────────
// Espejo de `ExpectedPayment`: el dinero que el plan del presupuesto promete y
// que solo cuenta como cobrado al confirmarse en una cuenta de tesorería.

/** Concepto del plan (`ExpectedPaymentConcept`). */
export const EXPECTED_PAYMENT_CONCEPTS = ["advance", "installment", "balance"] as const;
export type ExpectedPaymentConceptValue = (typeof EXPECTED_PAYMENT_CONCEPTS)[number];

/** Estado del pago esperado (`ExpectedPaymentStatus`). */
export const EXPECTED_PAYMENT_STATUSES = ["AWAITING", "PROOF", "CONFIRMED", "CANCELLED"] as const;
export type ExpectedPaymentStatusValue = (typeof EXPECTED_PAYMENT_STATUSES)[number];

export type AdminExpectedPaymentRow = {
  id: string;
  concept: string;
  installmentNumber: number | null;
  label: string;
  amount: number;
  dueAt: string | null;
  status: string;
  /** Observación del equipo (el cliente ve el motivo en el portal). */
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  confirmedAt: string | null;
  confirmedByName: string | null;
  confirmedByEmail: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  budget: {
    id: string;
    title: string;
    total: number;
    status: string;
    approvedAt: string | null;
    approvedByName: string | null;
    approvalMethod: string | null;
    publicToken: string | null;
    client: AdminClientRef;
  };
  /** Cuenta destino esperada; `null` cuando la empresa todavía no tiene cuentas. */
  expectedAccount: (AdminTreasuryAccountRef & { bank: string | null }) | null;
  /** Comprobante del portal vinculado (solo metadatos; el archivo va aparte). */
  proof: { id: string; uploadedByName: string; mime: string; size: number; createdAt: string } | null;
  /** Cobro real confirmado (o su espera), con la cuenta donde entró. */
  payment: {
    id: string;
    status: string;
    collectedAt: string | null;
    paidAt: string | null;
    method: string | null;
    reference: string | null;
    treasuryAccountId: string | null;
  } | null;
};

export type AdminExpectedPaymentAmount = { count: number; total: number };

/** Totales honestos de los pagos esperados: lo por confirmar va aparte de lo cobrado. */
export type AdminExpectedPaymentSummary = {
  awaiting: AdminExpectedPaymentAmount;
  proof: AdminExpectedPaymentAmount;
  overdue: AdminExpectedPaymentAmount;
  confirmed: AdminExpectedPaymentAmount;
  /** Necesita acción: comprobantes en revisión + vencidos sin comprobante. */
  pending: AdminExpectedPaymentAmount;
};

/** ¿Necesita acción hoy? Con comprobante en revisión o vencido sin comprobante. */
export function expectedPaymentNeedsAction(row: Pick<AdminExpectedPaymentRow, "status" | "dueAt">): boolean {
  if (row.status === "PROOF") return true;
  return row.status === "AWAITING" && isOverdue(row.dueAt);
}

// ── Recordatorios de cobro (issue #19) ──────────────────────────────────────
// Espejo de `PaymentReminderLog`: una fila por cobro, canal y día de Asunción.
// `email` lo manda Resend (status `sent`/`failed`); `whatsapp` registra que el
// equipo abrió el mensaje prellenado (status `opened`).

export type AdminReminderChannel = "email" | "whatsapp";
export type AdminReminderStatus = "sending" | "sent" | "failed" | "opened";

export type AdminPaymentReminder = {
  id: string;
  paymentId: string;
  channel: AdminReminderChannel;
  status: AdminReminderStatus;
  /** Destino real: correo del cliente o teléfono. */
  to: string;
  /** Día de Asunción (`YYYY-MM-DD`) del recordatorio. */
  dayKey: string;
  subject: string | null;
  error: string | null;
  actorKind: string;
  actorName: string | null;
  actorEmail: string | null;
  sentAt: string;
};

/** Resumen real de una corrida de recordatorios (`POST /api/admin/reminders/run`). */
export type AdminReminderRun = {
  /** Día de Asunción de la corrida (`YYYY-MM-DD`). */
  dayKey: string;
  /** Destinatarios en la ventana: cobros a plazo + pagos esperados (issue #28). */
  candidates: number;
  /** Cobros pendientes dentro de la ventana. */
  paymentCandidates?: number;
  /** Pagos esperados en `AWAITING` dentro de la ventana (issue #28). */
  expectedCandidates?: number;
  sent: number;
  failed: number;
  skipped: number;
  alreadySentToday: number;
  /** Por qué no se envió nada: falta el proveedor o la empresa activa es la demo. */
  reason?: "missing_resend_api_key" | "demo_organization";
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

// ── Comprobantes de pago (issue #17) ────────────────────────────────────────
// Reglas puras del adjunto, compartidas por el portal (front y API) y el panel:
// tope de tamaño, tipos aceptados y detección por magic bytes. El tipo real del
// archivo sale SIEMPRE del contenido —nunca del MIME declarado ni de la
// extensión—, así un ejecutable renombrado a .jpg se rechaza.

/** Tope del comprobante: 2 MB (las fotos se comprimen en el navegador antes de subir). */
export const PAYMENT_PROOF_MAX_BYTES = 2 * 1024 * 1024;

/** Tipos aceptados por el portal; el servidor decide por contenido, no por este valor. */
export const PAYMENT_PROOF_MIMES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type PaymentProofMime = (typeof PAYMENT_PROOF_MIMES)[number];

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/** Firma real del archivo: JPG, PNG, WebP (`RIFF…WEBP`) o PDF (`%PDF-`). */
export function detectPaymentProofMime(bytes: Uint8Array): PaymentProofMime | null {
  const startsWith = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (startsWith(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return "image/webp";
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  return null;
}

/** Extensión canónica del comprobante (el archivo servido la usa en su nombre). */
export function paymentProofExtension(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/** Nombre ASCII del archivo servido con sesión: `comprobante-<ref>-<AAAAMMDD-HHmm>.<ext>`. */
export function paymentProofFileName(mime: string, createdAt: string | Date, reference: string): string {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const stamp = Number.isNaN(date.getTime())
    ? ""
    : date.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const ref = String(reference ?? "").trim().toUpperCase();
  return `comprobante-${ref}${stamp ? `-${stamp}` : ""}.${paymentProofExtension(mime)}`;
}

/** Comprobante sin el binario: es lo que devuelve `GET /api/admin/budgets/proofs`. */
export type AdminBudgetPaymentProofRow = {
  id: string;
  budgetId: string;
  paymentId: string | null;
  uploadedByName: string;
  mime: string;
  size: number;
  createdAt: string;
};
/** Comprobantes agrupados por presupuesto (índice que consumen Presupuestos y Finanzas). */
export function groupProofsByBudget(
  proofs: readonly AdminBudgetPaymentProofRow[],
): Record<string, AdminBudgetPaymentProofRow[]> {
  const grouped: Record<string, AdminBudgetPaymentProofRow[]> = {};
  for (const proof of proofs) (grouped[proof.budgetId] ??= []).push(proof);
  return grouped;
}

// ── Imagen de identidad: avatar de persona y logo de empresa (issue #22) ─────
// Las dos superficies comparten las mismas reglas: JPG, PNG o WebP de hasta
// 1 MB, ya recortados y comprimidos en el navegador (canvas, sin librerías). El
// tipo real sale SIEMPRE del contenido —nunca del MIME declarado ni de la
// extensión—, así un PDF o un ejecutable renombrado se rechaza en el cliente y
// otra vez en el API. Los binarios viven en la base y se sirven solo con sesión.

/** Tope de la imagen de identidad: 1 MB (el navegador la comprime antes de subir). */
export const IDENTITY_IMAGE_MAX_BYTES = 1024 * 1024;

/** Tipos aceptados por el avatar y el logo; el servidor decide por contenido. */
export const IDENTITY_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type IdentityImageMime = (typeof IDENTITY_IMAGE_MIMES)[number];

/** Firma real de una imagen de identidad (JPG, PNG o WebP); `null` si no lo es. */
export function detectIdentityImageMime(bytes: Uint8Array): IdentityImageMime | null {
  const mime = detectPaymentProofMime(bytes);
  return mime && mime !== "application/pdf" ? mime : null;
}

/** Extensión canónica del archivo servido (nombre del avatar y del logo). */
export function identityImageExtension(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

/**
 * Variantes del logo de empresa (enum `OrganizationLogoVariant`). La regla que
 * decide cuál se usa vive en un solo lugar (`components/admin/AdminAvatar.tsx`):
 * fondo oscuro → variante clara; fondo claro y papel → variante oscura.
 */
export const LOGO_VARIANTS = ["light", "dark"] as const;
export type LogoVariant = (typeof LOGO_VARIANTS)[number];

export function isLogoVariant(value: string): value is LogoVariant {
  return (LOGO_VARIANTS as readonly string[]).includes(value);
}

/** Cuándo se subió cada variante; `null` = la empresa todavía no la subió. */
export type AdminOrganizationLogos = Record<LogoVariant, string | null>;

function versionQuery(version: string | Date | null | undefined): string {
  const value = version instanceof Date ? version.toISOString() : version;
  return value ? `?v=${encodeURIComponent(value)}` : "";
}

/** URL del avatar de un usuario; se sirve con sesión y `version` corta la caché. */
export function adminAvatarUrl(userId: string, version?: string | Date | null): string {
  return `/api/admin/users/avatars/${encodeURIComponent(userId)}${versionQuery(version)}`;
}

/** URL del logo de la empresa para una variante; se sirve con sesión. */
export function organizationLogoUrl(variant: LogoVariant, version?: string | Date | null): string {
  return `/api/admin/organization/branding/logos/${variant}${versionQuery(version)}`;
}

/**
 * Perfil propio (`GET /api/admin/profile`): el correo es la identidad de acceso
 * y no se edita desde acá; `hasPassword` distingue las cuentas con contraseña de
 * las que entran solo con Google.
 */
export type AdminProfile = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  hasPassword: boolean;
  avatarUpdatedAt: string | null;
};

/** Marca de la empresa (`GET /api/admin/organization/branding`). */
export type AdminOrganizationBranding = {
  organization: { id: string; name: string; slug: string };
  logos: AdminOrganizationLogos;
};


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
  /** Foto permitida de la promotora (issue #22): la dibuja el avatar único; sin foto, iniciales. */
  photoUrl: string | null;
  specialties: string | null;
  active: boolean;
  createdAt: string;
  /** Disponibilidad declarada (issue #24): `AVAILABLE`, `UNAVAILABLE` o `TO_DEFINE`. */
  availability: string;
  availabilityNote: string | null;
  unavailableUntil: string | null;
};

/** Promotora embebida en una tarea de evento (el estado viaja con la relación). */
export type AdminPromoterRef = Pick<
  AdminPromoterRow,
  "id" | "name" | "availability" | "availabilityNote" | "unavailableUntil"
>;

/** ¿La promotora puede tomar la tarea hoy? `TO_DEFINE` y `UNAVAILABLE` avisan. */
export function promoterIsAvailable(promoter: Pick<AdminPromoterRow, "availability"> | null | undefined): boolean {
  return !promoter || promoter.availability === "AVAILABLE";
}

/** Valores del enum `PromoterAvailability`: fuente única de los selectores del panel. */
export const PROMOTER_AVAILABILITIES = ["AVAILABLE", "UNAVAILABLE", "TO_DEFINE"] as const;

export type PromoterAvailabilityValue = (typeof PROMOTER_AVAILABILITIES)[number];

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
  /** Avatar subido (issue #22); `null` = iniciales. */
  avatarUpdatedAt: string | null;
};

/**
 * Entidades auditables: fuente única del nombre que se guarda en `AuditLog.entity`
 * y del filtro de `/api/admin/audit`. Solo se registran mutaciones (nunca lecturas).
 */
export const AUDIT_ENTITIES = [
  "Client",
  "Event",
  "Budget",
  "BudgetPaymentProof",
  "ExpectedPayment",
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
  "TreasuryAccount",
  "TreasuryMovement",
  "Expense",
] as const;

export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

/** Acciones auditadas: alta, edición, baja, cambio de estado, salida/devolución, conversión y recordatorio al cliente. */
export const AUDIT_ACTIONS = ["create", "update", "delete", "status", "checkout", "checkin", "convert", "remind"] as const;

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
  | "expected_due"
  | "lead"
  | "portal_request"
  | "reservation"
  | "payment_proof";

export type AdminNotification = {
  id: string;
  kind: AdminNotificationKind;
  level: AdminNotificationLevel;
  title: string;
  subtitle: string | null;
  /** Día de Asunción del hecho (`YYYY-MM-DD`); es la fecha real, no el día de consulta. */
  date: string;
  href: string;
  /**
   * Recordatorio por WhatsApp (issue #19): llega solo en los avisos de cobro a
   * plazo con teléfono del cliente, con los datos reales del cobro y el link del
   * portal para que la campana abra el mensaje prellenado.
   */
  reminder?: AdminNotificationReminder | null;
};

/** Datos reales de un recordatorio desde la campana (issue #19). */
export type AdminNotificationReminder = {
  phone: string;
  client: string;
  amount: number;
  /** Vencimiento real del cobro (ISO). */
  dueAt: string;
  invoiceNumber: string | null;
  budgetTitle: string | null;
  portalUrl: string | null;
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
  /**
   * Logo de la empresa para la hoja (issue #22): siempre la variante clara,
   * servida con sesión; `null` deja el monograma `LB`.
   */
  logo: string | null;
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
  /** Perfil propio (`GET /api/admin/profile`). */
  profile?: AdminProfile;
  /** Marca de la empresa (`GET /api/admin/organization/branding`). */
  organization?: AdminOrganizationBranding["organization"];
  logos?: AdminOrganizationLogos;
  clients?: AdminClientRow[];
  leads?: AdminLeadRow[];
  events?: AdminEventRow[];
  budgets?: AdminBudgetRow[];
  budgetRequests?: AdminBudgetRequestRow[];
  proofs?: AdminBudgetPaymentProofRow[];
  clientPayments?: AdminPaymentRow[];
  /** Recordatorio recién enviado/registrado (respuesta de `/api/admin/reminders`). */
  reminder?: AdminPaymentReminder | null;
  alreadySentToday?: boolean;
  /** Resumen de la corrida forzada de recordatorios (`/api/admin/reminders/run`). */
  result?: AdminReminderRun;
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
  /** Tesorería (issue #27): cuentas con su saldo, movimientos del período y KPIs. */
  accounts?: AdminTreasuryAccountRow[];
  movements?: AdminTreasuryMovementRow[];
  summary?: AdminTreasurySummary;
  /** Gastos del período con su cuenta, proyecto y proveedor (issue #27). */
  expenses?: AdminExpenseRow[];
  projects?: AdminExpenseProject[];
  /** Pagos esperados del plan con su cuenta destino y comprobante (issue #28). */
  expectedPayments?: AdminExpectedPaymentRow[];
  /** Totales de pagos esperados: por confirmar, vencidos y confirmados (issue #28). */
  expectedSummary?: AdminExpectedPaymentSummary;
};
