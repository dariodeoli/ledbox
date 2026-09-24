import { auditChanges } from "@/lib/server/audit";

/**
 * PATCH comercial del presupuesto (issues #65 y #70): precio final, condiciones
 * del cliente y costos internos.
 *
 * Acá viven las dos decisiones que el endpoint necesita, en un solo lugar y
 * testeables:
 *
 * - **Qué cambió**: se comparan *todos* los campos comerciales (precio,
 *   vigencia, entrega, IVA, garantía, observaciones y costos internos). El
 *   `unchanged` sale de esta comparación, así que cambiar solo las notas, la
 *   garantía o el IVA se persiste y se audita (issue #70: antes el early-return
 *   solo miraba costos y descuento y descartaba el resto en silencio).
 * - **Qué se puede tocar**: los datos que el cliente ya vio (precio y
 *   condiciones) quedan congelados con la aprobación y con los estados fuera de
 *   juego; los costos internos —del dueño, no del cliente— se corrigen siempre.
 *
 * Los montos van en PYG enteros y las fechas como día `YYYY-MM-DD` (lo que se
 * audita es el día, no el horario).
 */

export const BUDGET_COMMERCIAL_FIELDS = [
  "materialCost",
  "laborCost",
  "discount",
  "validUntil",
  "deliveryAt",
  "ivaType",
  "warranty",
  "notes",
] as const;

export type BudgetCommercialField = (typeof BUDGET_COMMERCIAL_FIELDS)[number];

/** Campos que el cliente ya vio: congelados después de la aprobación. */
export const BUDGET_CLIENT_FIELDS = ["discount", "validUntil", "deliveryAt", "ivaType", "warranty", "notes"] as const;

export type BudgetCommercialSnapshot = {
  /** Costo de materiales (interno, PYG). */
  materialCost: number;
  /** Mano de obra (interno, PYG). */
  laborCost: number;
  /** Descuento sobre el subtotal (PYG): define el precio final. */
  discount: number;
  validUntil: string | null;
  deliveryAt: string | null;
  ivaType: string | null;
  warranty: string | null;
  notes: string | null;
};

/** ¿El body toca algo que el cliente ya vio? (precio o condiciones) */
export function touchesBudgetClientFields(body: Record<string, unknown>): boolean {
  return BUDGET_CLIENT_FIELDS.some((field) => body[field] !== undefined);
}

/** Estado propuesto: lo que viene en el patch pisa el valor actual. */
export function mergeBudgetCommercial(
  current: BudgetCommercialSnapshot,
  patch: Partial<BudgetCommercialSnapshot>,
): BudgetCommercialSnapshot {
  const next: BudgetCommercialSnapshot = { ...current };
  for (const field of BUDGET_COMMERCIAL_FIELDS) {
    const value = patch[field];
    if (value !== undefined) next[field] = value as never;
  }
  return next;
}

/**
 * Campos que cambian entre el estado actual y el propuesto (comparación canónica
 * de la auditoría); `null` cuando no cambia nada y el endpoint responde
 * `unchanged`.
 */
export function budgetCommercialChanges(
  current: BudgetCommercialSnapshot,
  patch: Partial<BudgetCommercialSnapshot>,
): Record<string, { from: unknown; to: unknown }> | null {
  return auditChanges(
    current as unknown as Record<string, unknown>,
    mergeBudgetCommercial(current, patch) as unknown as Record<string, unknown>,
    BUDGET_COMMERCIAL_FIELDS,
  );
}

export type BudgetCommercialGuard = { ok: true } | { ok: false; status: number; error: string };

/** La versión del cliente no se reescribe: aprobado o fuera de juego, solo costos. */
export function budgetCommercialGuard(
  budget: { approved: boolean; status: string },
  body: Record<string, unknown>,
): BudgetCommercialGuard {
  if (!touchesBudgetClientFields(body)) return { ok: true };
  if (budget.approved) {
    return { ok: false, status: 409, error: "El presupuesto ya está aprobado: la versión del cliente no se cambia." };
  }
  if (budget.status === "LOST" || budget.status === "CANCELLED") {
    return { ok: false, status: 409, error: "Este presupuesto ya no está en juego." };
  }
  return { ok: true };
}
