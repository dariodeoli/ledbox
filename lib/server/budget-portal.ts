import { randomBytes } from "node:crypto";
import { db } from "./db";
import { BUDGET_CODE_ALPHABET, formatBudgetCode, normalizeBudgetCode } from "@/lib/public-config";
import { budgetReference } from "@/lib/admin-format";
import { dayKeyOf } from "./notifications";

/**
 * Portal del cliente (issue #12): acceso público por token y armado del
 * presupuesto sanitizado.
 *
 * Única puerta de entrada de `app/api/portal/*` y de las páginas
 * `app/(portal)/*`: busca por el código del link (nunca por id), y devuelve
 * solo lo que el cliente puede ver —ítems con precio de venta, totales,
 * descuento, validez, notas, cliente, evento, plan de pagos y el estado de sus
 * solicitudes (issue #14)—. El costo interno, el margen, los cobros y la
 * evidencia técnica (IP/user-agent) no salen nunca del panel.
 *
 * Los datos de pago de la empresa (`Organization.paymentDetails`) solo se
 * entregan cuando el presupuesto está aprobado; antes no viajan al navegador.
 *
 * Los comprobantes de pago (issue #17) viajan solo como metadatos: el binario
 * queda en el panel y se sirve únicamente con sesión.
 */

const CODE_LENGTH = 20;

export type PortalBudgetApprovalState = "PENDIENTE" | "APROBADO_DIGITAL" | "APROBADO_MANUAL" | "CAMBIOS_SOLICITADOS";

export type PortalBudgetItem = {
  id: string;
  name: string;
  quantity: number;
  days: number;
  unitPrice: number;
  subtotal: number;
  notes: string | null;
};

/** Cuota del plan de pagos (forma documentada; `dueAt` es `YYYY-MM-DD`). */
export type PortalBudgetInstallment = { label: string; amount: number; dueAt: string | null };

export type PortalBudgetPaymentPlan = {
  /** Anticipo a transferir con la aprobación (0 = no hay anticipo separado). */
  advanceAmount: number;
  installments: PortalBudgetInstallment[];
  /** Lo que el cliente transfiere ahora: anticipo, primera cuota o el total. */
  dueNow: { label: string; amount: number } | null;
  /** Lo que queda agendado después de lo de ahora. */
  scheduled: PortalBudgetInstallment[];
  /** Saldo del plan sin fecha asignada (0 si el plan cubre todo o no hay plan). */
  pending: number;
  /** Condiciones de pago escritas por el equipo. */
  terms: string | null;
};

/** Datos de pago de la empresa: solo con el presupuesto aprobado. */
export type PortalBudgetPaymentDetails = {
  bank: string | null;
  holder: string | null;
  ruc: string | null;
  account: string | null;
  alias: string | null;
};

/**
 * Estado visible de un comprobante subido por el cliente (issue #17): llegó
 * (`received`), el cobro vinculado ya se marcó cobrado (`collected`) o el cobro
 * se anuló (`cancelled`). El portal nunca sirve el archivo: solo sus metadatos.
 */
export type PortalBudgetProofStatus = "received" | "collected" | "cancelled";

export type PortalBudgetProof = {
  id: string;
  uploadedByName: string;
  mime: string;
  size: number;
  createdAt: string;
  status: PortalBudgetProofStatus;
};

/**
 * Estado visible de un pago esperado (issue #28): `AWAITING` esperando la
 * transferencia del cliente, `PROOF` con comprobante en revisión, `CONFIRMED`
 * ya acreditado en una cuenta y `CANCELLED` cuando el plan dejó de incluirlo.
 */
export type PortalExpectedPaymentStatus = "AWAITING" | "PROOF" | "CONFIRMED" | "CANCELLED";

export type PortalExpectedPayment = {
  id: string;
  /** Concepto real del plan: anticipo, cuota N o saldo. */
  concept: "advance" | "installment" | "balance";
  label: string;
  installmentNumber: number | null;
  amount: number;
  dueAt: string | null;
  status: PortalExpectedPaymentStatus;
  /** Nombre de la cuenta de tesorería donde se espera la transferencia. */
  accountName: string | null;
  /** Motivo de la última observación del equipo (revisar y volver a subir). */
  reviewNote: string | null;
  reviewedAt: string | null;
  /** Fecha de la confirmación real en la cuenta. */
  confirmedAt: string | null;
  confirmedByName: string | null;
  /** Si el comprobante vinculado está en revisión (metadato, nunca el archivo). */
  hasProof: boolean;
  createdAt: string;
};

/** Regla del comprobante en el portal (documentada en `portalProofUpload`). */
export type PortalProofUpload = { allowed: boolean; reason: string | null };

export type PortalBudgetRequestKind = "items" | "discount" | "changes";
export type PortalBudgetRequestStatus = "pending" | "accepted" | "rejected";

/** Propuesta de ítems resuelta contra los ítems reales (cantidades y días). */
export type PortalBudgetRequestItemView = {
  id: string;
  name: string;
  quantity: number;
  days: number;
  previousQuantity: number;
  previousDays: number;
  /** Subtotal propuesto, con el precio unitario fijo del presupuesto. */
  subtotal: number;
  /** Subtotal actual (el que el cliente está cambiando). */
  previousSubtotal: number;
};

export type PortalBudgetRequestDiscountView = {
  type: "percent" | "amount";
  /** Porcentaje pedido (0–100) o monto pedido en guaraníes. */
  value: number;
  /** Descuento resultante en guaraníes. */
  amount: number;
  /** Descuento que tiene hoy el presupuesto. */
  previousAmount: number;
};

export type PortalBudgetRequest = {
  id: string;
  kind: PortalBudgetRequestKind;
  status: PortalBudgetRequestStatus;
  /** Motivo escrito por el cliente. */
  note: string | null;
  /** Respuesta del equipo al aceptar o rechazar. */
  responseNote: string | null;
  requestedByName: string;
  resolvedByName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  items: PortalBudgetRequestItemView[];
  discount: PortalBudgetRequestDiscountView | null;
};

export type PortalBudget = {
  reference: string;
  title: string;
  /** Enum real del presupuesto (`CommercialStatus`); la UI lo traduce. */
  status: string;
  organization: string;
  createdAt: string;
  validUntil: string | null;
  notes: string | null;
  client: { name: string; company: string | null };
  event: { name: string; location: string | null; startsAt: string | null } | null;
  items: PortalBudgetItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentPlan: PortalBudgetPaymentPlan;
  /** Solo con el presupuesto aprobado; antes es `null`. */
  paymentDetails: PortalBudgetPaymentDetails | null;
  /** Pagos esperados del plan aprobado (issue #28): el estado real de cada concepto. */
  expectedPayments: PortalExpectedPayment[];
  /** Comprobantes ya subidos (metadatos; el archivo se ve solo en el panel). */
  proofs: PortalBudgetProof[];
  /** Si el portal habilita el formulario de comprobante y por qué no. */
  proofUpload: PortalProofUpload;
  requests: PortalBudgetRequest[];
  approval: {
    state: PortalBudgetApprovalState;
    approvedAt: string | null;
    approvedByName: string | null;
    method: "digital" | "manual" | null;
    note: string | null;
    revisionRequestedAt: string | null;
    revisionNote: string | null;
  };
};

/** Código nuevo (100 bits) en grupos de cuatro, generado con azar del sistema. */
export function generatePublicToken(): string {
  const chars: string[] = [];
  while (chars.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      // Descarta el resto para no sesgar el alfabeto (32 símbolos: 256 / 32 = 8).
      if (byte >= 256 - (256 % BUDGET_CODE_ALPHABET.length)) continue;
      chars.push(BUDGET_CODE_ALPHABET[byte % BUDGET_CODE_ALPHABET.length]);
      if (chars.length === CODE_LENGTH) break;
    }
  }
  return formatBudgetCode(chars.join(""));
}

/** Día en que se puede aprobar: un presupuesto perdido o cancelado ya no está en juego. */
export function portalBudgetOpen(status: string): boolean {
  return status !== "LOST" && status !== "CANCELLED";
}

// ── Límites de la autogestión (issue #14) ───────────────────────────────────
// El cliente solo mueve cantidades y días; el precio unitario es fijo. Los
// topes evitan propuestas absurdas y el API del panel los revalida al aplicar.

export const PORTAL_MAX_QUANTITY = 999;
export const PORTAL_MAX_DAYS = 365;
export const PORTAL_MAX_NOTE = 600;
export const PORTAL_MAX_NAME = 120;
export const PORTAL_MAX_REQUESTS = 20;
export const PORTAL_MAX_PROOFS = 20;

/**
 * Regla del comprobante de pago (issue #17), decidida y documentada acá:
 * el cliente puede subirlo mientras el presupuesto siga en juego
 * (`portalBudgetOpen`: ni perdido ni cancelado) y haya algo que pagar — el
 * presupuesto está aprobado (digital o manual) o existe al menos un cobro a
 * plazo pendiente (`ClientPayment.status = PENDING`). Fuera de esa ventana el
 * portal no dibuja el formulario y el API responde 409; el motivo viaja en la
 * misma vista para que el estado sea honesto.
 *
 * Issue #28: cuando el presupuesto tiene pagos esperados y **ninguno** sigue
 * abierto (todos confirmados o cancelados), el formulario también se cierra con
 * su motivo: ya no hay nada que transferir.
 */
export function portalProofUpload(budget: {
  status: string;
  approvedAt: Date | null;
  pendingPayments: number;
  /**
   * Pagos esperados del presupuesto (issue #28): totales y abiertos
   * (`AWAITING` o `PROOF`). Si el presupuesto está aprobado, tiene esperados y
   * ninguno sigue abierto, ya no hay nada que pagar.
   */
  expectedPayments?: number;
  openExpectedPayments?: number;
}): PortalProofUpload {
  if (!portalBudgetOpen(budget.status)) {
    return { allowed: false, reason: "Este presupuesto ya no está disponible." };
  }
  if (budget.expectedPayments !== undefined && budget.expectedPayments > 0 && budget.openExpectedPayments === 0) {
    return {
      allowed: false,
      reason: "Ya confirmamos todos los pagos de este presupuesto. Si transferiste algo nuevo, escribinos y lo revisamos.",
    };
  }
  if (budget.approvedAt || budget.pendingPayments > 0) return { allowed: true, reason: null };
  return {
    allowed: false,
    reason: "Todavía no recibimos este pago: el comprobante se habilita con el presupuesto aprobado o con un cobro a plazo pendiente.",
  };
}

type BudgetForPortal = {
  id: string;
  title: string;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  advanceAmount: number;
  paymentTerms: string | null;
  installmentsJson: unknown;
  validUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  approvedByName: string | null;
  approvalMethod: string | null;
  approvalNote: string | null;
  revisionRequestedAt: Date | null;
  revisionNote: string | null;
  organization: { name: string; paymentDetails: unknown };
  client: { name: string; company: string | null };
  event: { name: string; location: string | null; startsAt: Date | null } | null;
  items: Array<{ id: string; name: string; quantity: number; days: number; unitPrice: number; subtotal: number; notes: string | null }>;
  /** Solo los cobros pendientes: habilitan el comprobante y el aviso al equipo. */
  payments: Array<{ id: string; amount: number }>;
  /** Pagos esperados del plan aprobado (issue #28), con su cuenta destino. */
  expectedPayments: Array<{
    id: string;
    concept: string;
    installmentNumber: number | null;
    label: string;
    amount: number;
    dueAt: Date | null;
    status: string;
    reviewNote: string | null;
    reviewedAt: Date | null;
    confirmedAt: Date | null;
    confirmedByName: string | null;
    proofId: string | null;
    createdAt: Date;
    expectedAccount: { name: string } | null;
  }>;
  /** Comprobantes ya subidos, sin el binario (el archivo nunca sale del panel). */
  paymentProofs: Array<{
    id: string;
    uploadedByName: string;
    mime: string;
    size: number;
    createdAt: Date;
    payment: { status: string } | null;
  }>;
  changeRequests: Array<{
    id: string;
    kind: string;
    status: string;
    payload: unknown;
    note: string | null;
    responseNote: string | null;
    requestedByName: string;
    resolvedByName: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
  }>;
};

function approvalState(budget: BudgetForPortal): PortalBudgetApprovalState {
  if (budget.approvedAt) return budget.approvalMethod === "manual" ? "APROBADO_MANUAL" : "APROBADO_DIGITAL";
  if (budget.revisionRequestedAt) return "CAMBIOS_SOLICITADOS";
  return "PENDIENTE";
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

// ── Lectura defensiva de los JSON guardados ─────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, max);
}

function asAmount(value: unknown): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.max(0, Math.round(amount));
}

/** Cuotas guardadas en `Budget.installmentsJson`; ignora filas con forma rara. */
export function parseInstallments(value: unknown): PortalBudgetInstallment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!isRecord(row)) return [];
    const amount = asAmount(row.amount);
    if (amount === null || amount <= 0) return [];
    return [
      {
        label: asText(row.label, 60) || "Cuota",
        amount,
        dueAt: asText(row.dueAt, 10),
      },
    ];
  });
}

/** Datos de pago de la empresa guardados en `Organization.paymentDetails`. */
export function parsePaymentDetails(value: unknown): PortalBudgetPaymentDetails | null {
  if (!isRecord(value)) return null;
  const details: PortalBudgetPaymentDetails = {
    bank: asText(value.bank, 80),
    holder: asText(value.holder, 120),
    ruc: asText(value.ruc, 20),
    account: asText(value.account, 40),
    alias: asText(value.alias, 60),
  };
  return details.bank || details.holder || details.ruc || details.account || details.alias ? details : null;
}

/** Plan de pagos derivado: anticipo, cuotas y qué se transfiere ahora. */
export function paymentPlanOf(budget: {
  total: number;
  advanceAmount: number;
  paymentTerms: string | null;
  installmentsJson: unknown;
}): PortalBudgetPaymentPlan {
  const installments = parseInstallments(budget.installmentsJson);
  const advanceAmount = Math.max(0, Math.round(budget.advanceAmount || 0));
  const total = Math.max(0, Math.round(budget.total || 0));
  const hasPlan = advanceAmount > 0 || installments.length > 0;

  const dueNow = advanceAmount > 0
    ? { label: "Anticipo", amount: advanceAmount }
    : installments.length > 0
      ? { label: installments[0].label, amount: installments[0].amount }
      : total > 0
        ? { label: "Pago único", amount: total }
        : null;
  const scheduled = advanceAmount > 0 ? installments : installments.slice(1);
  const committed = advanceAmount + installments.reduce((sum, installment) => sum + installment.amount, 0);

  return {
    advanceAmount,
    installments,
    dueNow,
    scheduled,
    pending: hasPlan ? Math.max(0, total - committed) : 0,
    terms: budget.paymentTerms,
  };
}

/** Propuesta de ítems de una solicitud, cruzada contra los ítems reales del presupuesto. */
function requestItemsView(
  items: BudgetForPortal["items"],
  payload: unknown,
): PortalBudgetRequestItemView[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) return [];
  const byId = new Map(items.map((item) => [item.id, item]));
  return payload.items.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    const item = byId.get(row.id);
    if (!item) return [];
    const quantity = Math.max(1, Math.round(Number(row.quantity) || item.quantity));
    const days = Math.max(1, Math.round(Number(row.days) || item.days));
    return [
      {
        id: item.id,
        name: item.name,
        quantity,
        days,
        previousQuantity: item.quantity,
        previousDays: item.days,
        subtotal: quantity * days * item.unitPrice,
        previousSubtotal: item.subtotal,
      },
    ];
  });
}

function requestDiscountView(budget: BudgetForPortal, payload: unknown): PortalBudgetRequestDiscountView | null {
  if (!isRecord(payload) || !isRecord(payload.discount)) return null;
  const raw = payload.discount;
  const type = raw.type === "percent" ? "percent" : raw.type === "amount" ? "amount" : null;
  if (!type) return null;
  const value = Number(raw.value);
  const amount = asAmount(raw.amount);
  if (!Number.isFinite(value) || amount === null) return null;
  return { type, value, amount, previousAmount: budget.discount };
}

function requestView(budget: BudgetForPortal, request: BudgetForPortal["changeRequests"][number]): PortalBudgetRequest {
  const kind: PortalBudgetRequestKind =
    request.kind === "items" || request.kind === "discount" || request.kind === "changes" ? request.kind : "changes";
  const status: PortalBudgetRequestStatus =
    request.status === "accepted" || request.status === "rejected" ? request.status : "pending";
  return {
    id: request.id,
    kind,
    status,
    note: request.note,
    responseNote: request.responseNote,
    requestedByName: request.requestedByName,
    resolvedByName: request.resolvedByName,
    createdAt: request.createdAt.toISOString(),
    resolvedAt: iso(request.resolvedAt),
    items: kind === "items" ? requestItemsView(budget.items, request.payload) : [],
    discount: kind === "discount" ? requestDiscountView(budget, request.payload) : null,
  };
}

/** Vista pública del presupuesto: solo campos de venta, plan, solicitudes y aprobación. */
export function portalBudgetView(budget: BudgetForPortal): PortalBudget {
  const method = budget.approvalMethod === "manual" ? "manual" : budget.approvalMethod === "digital" ? "digital" : null;
  const approved = Boolean(budget.approvedAt);
  const expectedPayments = budget.expectedPayments.map((expected): PortalExpectedPayment => {
    const status: PortalExpectedPaymentStatus =
      expected.status === "PROOF" || expected.status === "CONFIRMED" || expected.status === "CANCELLED"
        ? expected.status
        : "AWAITING";
    const concept: PortalExpectedPayment["concept"] =
      expected.concept === "advance" || expected.concept === "balance" ? expected.concept : "installment";
    return {
      id: expected.id,
      concept,
      label: expected.label,
      installmentNumber: expected.installmentNumber,
      amount: expected.amount,
      dueAt: expected.dueAt ? dayKeyOf(expected.dueAt) : null,
      status,
      accountName: expected.expectedAccount?.name ?? null,
      reviewNote: expected.reviewNote,
      reviewedAt: iso(expected.reviewedAt),
      confirmedAt: iso(expected.confirmedAt),
      confirmedByName: expected.confirmedByName,
      hasProof: Boolean(expected.proofId),
      createdAt: expected.createdAt.toISOString(),
    };
  });
  const openExpected = budget.expectedPayments.filter((row) => row.status === "AWAITING" || row.status === "PROOF").length;
  return {
    reference: budgetReference(budget.id),
    title: budget.title,
    status: budget.status,
    organization: budget.organization.name,
    createdAt: budget.createdAt.toISOString(),
    validUntil: iso(budget.validUntil),
    notes: budget.notes,
    client: { name: budget.client.name, company: budget.client.company },
    event: budget.event
      ? { name: budget.event.name, location: budget.event.location, startsAt: iso(budget.event.startsAt) }
      : null,
    items: budget.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      days: item.days,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      notes: item.notes,
    })),
    subtotal: budget.subtotal,
    discount: budget.discount,
    total: budget.total,
    paymentPlan: paymentPlanOf(budget),
    // Los datos de pago son de la empresa, no del presupuesto: recién con la
    // aprobación registrada el cliente tiene motivo (y permiso) para verlos.
    paymentDetails: approved ? parsePaymentDetails(budget.organization.paymentDetails) : null,
    expectedPayments,
    proofs: budget.paymentProofs.map((proof) => ({
      id: proof.id,
      uploadedByName: proof.uploadedByName,
      mime: proof.mime,
      size: proof.size,
      createdAt: proof.createdAt.toISOString(),
      status:
        proof.payment?.status === "RECEIVED"
          ? "collected"
          : proof.payment?.status === "CANCELLED"
            ? "cancelled"
            : "received",
    })),
    proofUpload: portalProofUpload({
      status: budget.status,
      approvedAt: budget.approvedAt,
      pendingPayments: budget.payments.length,
      expectedPayments: budget.expectedPayments.length,
      openExpectedPayments: openExpected,
    }),
    requests: budget.changeRequests.map((request) => requestView(budget, request)),
    approval: {
      state: approvalState(budget),
      approvedAt: iso(budget.approvedAt),
      approvedByName: budget.approvedByName,
      method,
      note: budget.approvalNote,
      revisionRequestedAt: iso(budget.revisionRequestedAt),
      revisionNote: budget.revisionNote,
    },
  };
}

const portalInclude = {
  organization: { select: { name: true, paymentDetails: true } },
  client: { select: { name: true, company: true } },
  event: { select: { name: true, location: true, startsAt: true } },
  items: { orderBy: { name: "asc" } },
  changeRequests: { orderBy: { createdAt: "desc" }, take: PORTAL_MAX_REQUESTS },
  payments: { where: { status: "PENDING" }, select: { id: true, amount: true } },
  // Pagos esperados (issue #28): estado real de cada concepto y cuenta destino.
  // No viaja el motivo interno de cancelación ni la observación técnica: solo lo
  // que el cliente necesita para transferir y seguir su pago.
  expectedPayments: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      concept: true,
      installmentNumber: true,
      label: true,
      amount: true,
      dueAt: true,
      status: true,
      reviewNote: true,
      reviewedAt: true,
      confirmedAt: true,
      confirmedByName: true,
      proofId: true,
      createdAt: true,
      expectedAccount: { select: { name: true } },
    },
  },
  paymentProofs: {
    orderBy: { createdAt: "desc" },
    take: PORTAL_MAX_PROOFS,
    select: {
      id: true,
      uploadedByName: true,
      mime: true,
      size: true,
      createdAt: true,
      payment: { select: { status: true } },
    },
  },
} as const;

/** Presupuesto público por código de link; `null` si no existe o no tiene token. */
export async function loadPublicBudget(token: string | null | undefined): Promise<PortalBudget | null> {
  const code = normalizeBudgetCode(token);
  if (!code) return null;
  const budget = await db.budget.findUnique({ where: { publicToken: code }, include: portalInclude });
  return budget ? portalBudgetView(budget) : null;
}

/** Evidencia de la aprobación digital: IP y user-agent del pedido. */
export function approvalEvidence(request: Request): { ip: string; userAgent: string } {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const userAgent = (request.headers.get("user-agent") || "unknown").slice(0, 300);
  return { ip, userAgent };
}

// ── Validación de propuestas del portal (issue #14) ─────────────────────────

export type ProposedItem = { id: string; quantity: number; days: number };

export type ProposalResult<T> = { ok: true; value: T; changed: boolean } | { ok: false; error: string };

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * Normaliza y valida una propuesta de ítems contra los ítems reales del
 * presupuesto: los ids deben existir y no repetirse, la cantidad va de 1 a 999
 * y los días de 1 a 365 (enteros). Con `requireChange` (default) una propuesta
 * idéntica al presupuesto actual se rechaza: no hay nada que resolver y
 * ensuciaría la cola del panel; al aceptar desde el panel se permite dejarla
 * igual (el equipo puede aprobar la propuesta tal como llegó).
 */
export function resolveItemProposal(
  items: Array<{ id: string; name: string; quantity: number; days: number; unitPrice: number }>,
  raw: unknown,
  options?: { requireChange?: boolean },
): ProposalResult<ProposedItem[]> {
  const requireChange = options?.requireChange ?? true;
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Contanos qué cantidades y días necesitás." };
  if (raw.length > items.length) return { ok: false, error: "La propuesta tiene ítems que no son de este presupuesto." };
  const byId = new Map(items.map((item) => [item.id, item]));
  const proposed: ProposedItem[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!isRecord(row) || typeof row.id !== "string") return { ok: false, error: "La propuesta tiene un ítem inválido." };
    const item = byId.get(row.id);
    if (!item) return { ok: false, error: "La propuesta tiene ítems que no son de este presupuesto." };
    if (seen.has(row.id)) return { ok: false, error: "La propuesta repite un ítem." };
    seen.add(row.id);
    const quantity = positiveInt(row.quantity);
    const days = positiveInt(row.days);
    if (quantity === null || quantity > PORTAL_MAX_QUANTITY) {
      return { ok: false, error: `La cantidad de «${item.name}» debe ser un entero entre 1 y ${PORTAL_MAX_QUANTITY}.` };
    }
    if (days === null || days > PORTAL_MAX_DAYS) {
      return { ok: false, error: `Los días de «${item.name}» deben ser un entero entre 1 y ${PORTAL_MAX_DAYS}.` };
    }
    proposed.push({ id: item.id, quantity, days });
  }
  const changed = proposed.some((row) => {
    const item = byId.get(row.id);
    return Boolean(item) && (item!.quantity !== row.quantity || item!.days !== row.days);
  });
  if (requireChange && !changed) return { ok: false, error: "La propuesta es igual al presupuesto actual: cambiá alguna cantidad o días." };
  return { ok: true, value: proposed, changed };
}

export type ProposedDiscount = { type: "percent" | "amount"; value: number; amount: number };

/**
 * Normaliza y valida un pedido de rebaja: porcentaje 0–100 (hasta 2 decimales)
 * o monto en guaraníes hasta el subtotal. Devuelve el monto resultante y si
 * cambia el descuento vigente.
 */
export function resolveDiscountProposal(subtotal: number, currentDiscount: number, raw: unknown): ProposalResult<ProposedDiscount> {
  if (!isRecord(raw)) return { ok: false, error: "Contanos qué descuento necesitás." };
  const type = raw.type === "percent" ? "percent" : raw.type === "amount" ? "amount" : null;
  if (!type) return { ok: false, error: "Elegí si el descuento es un porcentaje o un monto." };
  const value = Number(raw.value);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: "El descuento pedido debe ser mayor a cero." };
  const base = Math.max(0, Math.round(subtotal));
  if (type === "percent") {
    if (value > 100) return { ok: false, error: "El porcentaje no puede superar el 100 %." };
    const percent = Math.round(value * 100) / 100;
    const amount = Math.round((base * percent) / 100);
    if (amount <= 0) return { ok: false, error: "El descuento pedido no alcanza un monto válido." };
    return { ok: true, value: { type, value: percent, amount }, changed: amount !== currentDiscount };
  }
  const amount = Math.round(value);
  if (amount > base) return { ok: false, error: "El monto pedido no puede superar el subtotal del presupuesto." };
  if (amount <= 0) return { ok: false, error: "El descuento pedido debe ser mayor a cero." };
  return { ok: true, value: { type, value: amount, amount }, changed: amount !== currentDiscount };
}

/** Contenido útil de `BudgetChangeRequest.payload`, leído de forma defensiva. */
export type ParsedProposal = {
  items: ProposedItem[];
  discount: ProposedDiscount | null;
  comment: string | null;
};

/** Payload guardado de una solicitud; ignora filas con forma rara (nunca lanza). */
export function parseProposalPayload(value: unknown): ParsedProposal {
  const payload = isRecord(value) ? value : {};
  const items = Array.isArray(payload.items)
    ? payload.items.flatMap((row) => {
        if (!isRecord(row) || typeof row.id !== "string") return [];
        const quantity = positiveInt(row.quantity);
        const days = positiveInt(row.days);
        if (quantity === null || days === null) return [];
        return [{ id: row.id, quantity, days }];
      })
    : [];
  const rawDiscount = isRecord(payload.discount) ? payload.discount : null;
  const discountType: "percent" | "amount" | null =
    rawDiscount?.type === "percent" ? "percent" : rawDiscount?.type === "amount" ? "amount" : null;
  const discountValue = Number(rawDiscount?.value);
  const discountAmount = asAmount(rawDiscount?.amount);
  const discount: ProposedDiscount | null =
    discountType && Number.isFinite(discountValue) && discountAmount !== null
      ? { type: discountType, value: discountValue, amount: discountAmount }
      : null;
  return { items, discount, comment: asText(payload.comment, PORTAL_MAX_NOTE) };
}
