import type { PortalBudget, PortalBudgetProof, PortalBudgetRequest } from "@/lib/server/budget-portal";

/**
 * Portal del cliente en modo demo (issue #52): simulación por sesión.
 *
 * El presupuesto de ejemplo es una fila real de la empresa demo, así que sus
 * acciones se resolvían contra la base y quedaban persistidas (el re-seed era el
 * parche). Ahora el portal en modo demo **no escribe nada**: las acciones del
 * cliente (autorizar con ajustes, pedir rebaja, pedir un cambio y subir el
 * comprobante) se resuelven acá, sobre la vista canónica, y el resultado se
 * guarda en `sessionStorage` con una clave por token: sobrevive la navegación de
 * esa visita y otro visitante ve el estado canónico.
 *
 * Todo es puro y testeable (`tests/portal-demo.test.ts`); el acceso al storage se
 * inyecta, así que en Node no hace falta un navegador.
 */

/** Aprobación simulada: mismo contrato que el bloque `approval` de la vista. */
export type PortalDemoApproval = { at: string; name: string; note: string | null };

/** Pedido de cambio simulado (`revision`): la nota y quién la pidió. */
export type PortalDemoRevision = { at: string; name: string; note: string };

/** Comprobante simulado: sin binario, igual que la vista pública (issue #17). */
export type PortalDemoProof = PortalBudgetProof;

export type PortalDemoState = {
  approval: PortalDemoApproval | null;
  revision: PortalDemoRevision | null;
  /** Solicitudes simuladas, de la más nueva a la más vieja. */
  requests: PortalBudgetRequest[];
  /** Comprobantes simulados, del más nuevo al más viejo. */
  proofs: PortalDemoProof[];
};

/** Estado de una visita sin acciones simuladas. */
export function emptyPortalDemoState(): PortalDemoState {
  return { approval: null, revision: null, requests: [], proofs: [] };
}

export type PortalDemoAction =
  | {
      type: "approve";
      at: string;
      name: string;
      note: string | null;
      /** Ajuste de ítems que acompaña la autorización (cantidades y días). */
      items: Array<{ id: string; quantity: number; days: number }>;
      /** Motivo del ajuste (el mismo texto que manda el portal real). */
      itemsNote: string | null;
    }
  | {
      type: "discount";
      at: string;
      name: string;
      note: string;
      discount: { type: "percent" | "amount"; value: number; amount: number };
    }
  | { type: "revision"; at: string; name: string; note: string }
  | {
      type: "proof";
      at: string;
      proof: { uploadedByName: string; mime: string; size: number; expectedPaymentId: string | null };
    };

// ── Sesión del visitante ────────────────────────────────────────────────────
// El estado vive en `sessionStorage` (se va con la pestaña) y la clave lleva el
// token: dos presupuestos abiertos en la misma visita no se mezclan.

/** Acceso mínimo al storage (real: `sessionStorage`; tests: un doble en memoria). */
export type PortalDemoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function portalDemoKey(token: string): string {
  return `ledbox.portal.demo.${token}`;
}

function storageOrNull(storage?: PortalDemoStorage | null): PortalDemoStorage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Navegador con storage bloqueado (modo privado estricto): se simula igual,
    // solo que la visita no sobrevive la navegación.
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function readApproval(value: unknown): PortalDemoApproval | null {
  const row = asRecord(value);
  if (!row || typeof row.at !== "string" || typeof row.name !== "string") return null;
  return { at: row.at, name: row.name, note: typeof row.note === "string" ? row.note : null };
}

function readRevision(value: unknown): PortalDemoRevision | null {
  const row = asRecord(value);
  if (!row || typeof row.at !== "string" || typeof row.name !== "string" || typeof row.note !== "string") return null;
  return { at: row.at, name: row.name, note: row.note };
}

/** Estado guardado de la visita; sin storage o con datos raros, estado vacío. */
export function readPortalDemoState(token: string, storage?: PortalDemoStorage | null): PortalDemoState {
  const store = storageOrNull(storage);
  if (!store || !token) return emptyPortalDemoState();
  try {
    const raw = store.getItem(portalDemoKey(token));
    if (!raw) return emptyPortalDemoState();
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed) return emptyPortalDemoState();
    return {
      approval: readApproval(parsed.approval),
      revision: readRevision(parsed.revision),
      requests: Array.isArray(parsed.requests) ? (parsed.requests as PortalBudgetRequest[]) : [],
      proofs: Array.isArray(parsed.proofs) ? (parsed.proofs as PortalDemoProof[]) : [],
    };
  } catch {
    return emptyPortalDemoState();
  }
}

/** Guarda la simulación de la visita; si el storage no está, no rompe nada. */
export function writePortalDemoState(token: string, state: PortalDemoState, storage?: PortalDemoStorage | null): void {
  const store = storageOrNull(storage);
  if (!store || !token) return;
  try {
    store.setItem(portalDemoKey(token), JSON.stringify(state));
  } catch {
    // Storage lleno o bloqueado: la acción simulada ya se ve en pantalla.
  }
}

// ── Acciones simuladas ──────────────────────────────────────────────────────

/** Ítem propuesto con su lectura visible, igual que arma el API del portal. */
function requestItemsView(budget: PortalBudget, rows: Array<{ id: string; quantity: number; days: number }>) {
  const byId = new Map(budget.items.map((item) => [item.id, item]));
  return rows.flatMap((row) => {
    const item = byId.get(row.id);
    if (!item) return [];
    return [
      {
        id: item.id,
        name: item.name,
        quantity: row.quantity,
        days: row.days,
        previousQuantity: item.quantity,
        previousDays: item.days,
        subtotal: row.quantity * row.days * item.unitPrice,
        previousSubtotal: item.subtotal,
      },
    ];
  });
}

function requestOf(
  kind: PortalBudgetRequest["kind"],
  action: { at: string; name: string; note: string | null },
  extra: Pick<PortalBudgetRequest, "items" | "discount">,
): PortalBudgetRequest {
  return {
    id: `demo-${kind}-${action.at}`,
    kind,
    status: "pending",
    note: action.note,
    responseNote: null,
    requestedByName: action.name,
    resolvedByName: null,
    createdAt: action.at,
    resolvedAt: null,
    items: extra.items,
    discount: extra.discount,
  };
}

/**
 * Aplica una acción simulada sobre el estado de la visita. Los ids llevan el
 * instante de la acción, así que dos pedidos seguidos no colisionan.
 */
export function reducePortalDemo(state: PortalDemoState, budget: PortalBudget, action: PortalDemoAction): PortalDemoState {
  if (action.type === "approve") {
    const people = { at: action.at, name: action.name, note: action.note };
    const requests =
      action.items.length > 0
        ? [requestOf("items", people, { items: requestItemsView(budget, action.items), discount: null }), ...state.requests]
        : state.requests;
    return { ...state, approval: { at: action.at, name: action.name, note: action.note }, requests };
  }
  if (action.type === "discount") {
    const discount = { ...action.discount, previousAmount: budget.discount };
    return {
      ...state,
      requests: [
        requestOf("discount", { at: action.at, name: action.name, note: action.note }, { items: [], discount }),
        ...state.requests,
      ],
    };
  }
  if (action.type === "revision") {
    return {
      ...state,
      revision: { at: action.at, name: action.name, note: action.note },
      requests: [
        requestOf("changes", { at: action.at, name: action.name, note: action.note }, { items: [], discount: null }),
        ...state.requests,
      ],
    };
  }
  const proof: PortalDemoProof = {
    id: `demo-proof-${action.at}`,
    uploadedByName: action.proof.uploadedByName,
    mime: action.proof.mime,
    size: action.proof.size,
    createdAt: action.at,
    status: "received",
  };
  return { ...state, proofs: [proof, ...state.proofs] };
}

/**
 * Vista visible para el visitante: la canónica con lo simulado encima. No muta
 * el presupuesto original, así que la canónica siempre vuelve a estar disponible
 * (por ejemplo al cerrar la pestaña) y otro visitante ve el estado real.
 */
export function applyPortalDemoState(budget: PortalBudget, state: PortalDemoState): PortalBudget {
  const simulatedApproval = state.approval;
  // Un pedido de cambio simulado no cuenta si el visitante ya autorizó: el
  // presupuesto aprobado queda en solo lectura, igual que en el flujo real.
  const simulatedRevision = simulatedApproval ? null : state.revision;
  const approved = Boolean(budget.approval.approvedAt || simulatedApproval);
  return {
    ...budget,
    status: simulatedApproval ? "APPROVED" : budget.status,
    approval: {
      ...budget.approval,
      ...(simulatedApproval
        ? {
            state: "APROBADO_DIGITAL" as const,
            approvedAt: simulatedApproval.at,
            approvedByName: simulatedApproval.name,
            method: "digital" as const,
            note: simulatedApproval.note,
          }
        : {}),
      ...(simulatedRevision
        ? { revisionRequestedAt: simulatedRevision.at, revisionNote: `${simulatedRevision.note} — ${simulatedRevision.name}` }
        : {}),
    },
    requests: state.requests.length > 0 ? [...state.requests, ...budget.requests] : budget.requests,
    proofs: state.proofs.length > 0 ? [...state.proofs, ...budget.proofs] : budget.proofs,
    // La aprobación simulada abre el comprobante igual que la real. El
    // presupuesto de ejemplo no tiene cobros pendientes ni pagos esperados, así
    // que la regla de `portalProofUpload` se reduce a la aprobación.
    proofUpload:
      simulatedApproval && !budget.proofUpload.allowed ? { allowed: true, reason: null } : budget.proofUpload,
    // Los datos de pago de la empresa demo viajan en `demoPaymentDetails` (el
    // resto de los presupuestos los recibe recién con la aprobación): se ven
    // con la aprobación visible, real o simulada.
    paymentDetails: budget.paymentDetails ?? (approved ? budget.demoPaymentDetails ?? null : null),
  };
}
