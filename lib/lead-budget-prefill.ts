import { quoteItemActive } from "./catalog-public";
import type { AdminInventoryLink } from "./admin-types";
import type { BudgetItemDraft } from "./budget-items";

/** Read-only line data returned by the lead-draft endpoint. */
export type LeadBudgetPrefillLine = {
  state?: string | null;
  productName: string;
  quantity: number;
  days: number;
  unitPrice: number | null;
  notes: string | null;
  inventory: AdminInventoryLink | null;
  priceSource: "catalog" | "request" | "pending";
  /** Set only when the editor can safely snapshot the current retail price. */
  snapshotDays?: number | null;
};

/**
 * Convert active request lines into editable budget rows. No stock is reserved
 * here; prices and quantities remain editable in BudgetItemsEditor. Missing or
 * zero quote prices stay blank so the editor blocks saving until reviewed.
 */
export function leadBudgetPrefillItems(lines: readonly LeadBudgetPrefillLine[]): BudgetItemDraft[] {
  return lines.filter((line) => quoteItemActive(line.state)).map((line) => ({
    id: null,
    name: line.inventory?.name ?? line.productName,
    quantity: String(line.quantity),
    days: String(line.days),
    unitPrice: line.unitPrice && line.unitPrice > 0 ? String(line.unitPrice) : "",
    costPrice: "0",
    notes: line.notes ?? "",
    inventory: line.inventory,
    ...(line.snapshotDays && line.snapshotDays > 0 ? { rentalDays: String(line.snapshotDays) } : {}),
  }));
}
