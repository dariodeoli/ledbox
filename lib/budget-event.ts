/**
 * Presupuesto aprobado → evento. Reglas puras (sin base ni red) compartidas por
 * el endpoint `POST /api/admin/budgets/[id]/create-event` y por el panel.
 *
 * El evento se crea solo al aprobar (`ensureEventForApprovedBudget`, servidor).
 * El aviso con el botón «Crear evento» queda como respaldo cuando esa creación
 * falla (p. ej. límite del plan).
 */

export const BUDGET_EVENT_NOTICE = "El cliente aprobó el presupuesto. Falta crear el evento";
export const EVENT_NAME_MAX = 160;

type BudgetEventState = {
  status: string;
  event?: { status: string } | null;
  eventId?: string | null;
};

export type BudgetEventPrompt = "create" | "confirm" | null;

/**
 * Qué falta hacer con el evento de un presupuesto:
 * - `create`: aprobado y sin evento;
 * - `confirm`: aprobado y su evento sigue en borrador;
 * - `null`: nada pendiente.
 */
export function budgetEventPrompt(budget: BudgetEventState): BudgetEventPrompt {
  if (budget.status !== "APPROVED") return null;
  if (!budget.eventId && !budget.event) return "create";
  if (budget.event?.status === "DRAFT") return "confirm";
  return null;
}

/** Datos del evento que nace de un presupuesto: solo lo que el presupuesto realmente tiene. */
export function eventDataFromBudget(budget: { title: string; deliveryAt: Date | null }): {
  name: string;
  startsAt: Date | null;
  status: "CONFIRMED";
} {
  return {
    name: budget.title.trim().slice(0, EVENT_NAME_MAX),
    startsAt: budget.deliveryAt ?? null,
    status: "CONFIRMED",
  };
}
