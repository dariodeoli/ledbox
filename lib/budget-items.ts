import { budgetMoneyValid } from "./budget-payment-plan";
import type { AdminInventoryLink } from "./admin-types";

export type BudgetItemDraft = { id: string | null; name: string; quantity: string; days: string; unitPrice: string; costPrice: string; notes: string; inventory: AdminInventoryLink | null; excluded?: boolean;
  /** Gratis a propósito (precio 0 confirmado). */
  freeOnPurpose?: boolean;
  /** Días reales del alquiler cuando el precio sale de un producto: un escalón «total» guarda `days = 1`. */
  rentalDays?: string };
export function emptyBudgetItem(): BudgetItemDraft {
  return { id: null, name: "", quantity: "1", days: "1", unitPrice: "", costPrice: "0", notes: "", inventory: null };
}
export function budgetUsesDays(item: { days: number; inventoryId?: string | null }): boolean {
  // No inferred service/category conversion: existing durations are preserved.
  return Boolean(item.inventoryId) || item.days > 1;
}
export function budgetItemError(item: { name: string; quantity: number; days: number; unitPrice: number; costPrice: number }): string | null {
  if (!item.name.trim() || item.name.trim().length > 160) return "Escribí un ítem de hasta 160 caracteres.";
  if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 9999) return "La cantidad debe estar entre 1 y 9999.";
  if (!Number.isInteger(item.days) || item.days <= 0 || item.days > 9999) return "La duración debe estar entre 1 y 9999 días.";
  if (!budgetMoneyValid(item.unitPrice) || !budgetMoneyValid(item.costPrice) || !budgetMoneyValid(item.quantity * item.days * item.unitPrice) || !budgetMoneyValid(item.quantity * item.days * item.costPrice)) return "Precio, costo o total del ítem supera el límite Int en guaraníes.";
  return null;
}
export function budgetDraftSubtotal(items: BudgetItemDraft[]): number {
  return items.reduce((sum, item) => sum + (item.excluded ? 0 : Number(item.quantity) * Number(item.days) * Number(item.unitPrice)), 0);
}

/** Solo OWNER y ADMIN marcan o desmarcan «Gratis a propósito» (el 0 confirmado). */
export function canSetFreeOnPurpose(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * `true` si el body cambia «Gratis a propósito» respecto de lo guardado: un ítem
 * nuevo con el interruptor, o uno existente con el valor distinto. Quien no
 * puede cambiarlo recibe 403; mandar el mismo valor guardado no cuenta.
 */
export function freeOnPurposeChanged(rawItems: unknown[], saved: ReadonlyMap<string, boolean>): boolean {
  return rawItems.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const row = raw as Record<string, unknown>;
    const previous = typeof row.id === "string" ? saved.get(row.id) ?? false : false;
    return (row.freeOnPurpose === true) !== previous;
  });
}

export const FREE_ON_PURPOSE_FORBIDDEN = "Solo un propietario o un administrador puede marcar un ítem como gratis a propósito.";
