import { integerDraft } from "./quantity-control";
import { counterofferExclusion, isEventBilledItem, rentalDaysOf, resolveQuoteSelection, selectionLine, type QuoteSelectionItem } from "./quote-selection";

export type CounterofferDraft = { quantity: string; days: string; excluded?: boolean };
export function counterofferDraft(item: Pick<QuoteSelectionItem, "quantity" | "days" | "excluded">): CounterofferDraft {
  return { quantity: String(item.quantity), days: String(item.days), excluded: Boolean(item.excluded) };
}
export function originalCounterofferDraft(item: QuoteSelectionItem): CounterofferDraft {
  return counterofferDraft({ ...item, days: isEventBilledItem(item) ? 1 : rentalDaysOf(item) });
}
/** Checkbox semantics stay canonical; only the editable representation is text. */
export function counterofferDraftExclusion(original: QuoteSelectionItem, proposed: CounterofferDraft, excluded: boolean): CounterofferDraft {
  if (!excluded) return { ...proposed, excluded: false };
  return counterofferDraft(counterofferExclusion({ quantity: original.quantity, days: isEventBilledItem(original) ? 1 : rentalDaysOf(original) }, { quantity: Number(proposed.quantity), days: Number(proposed.days) }, true));
}
/** Convert only at submit; blanks, signs and decimals are never coerced to one. */
export function resolveCounterofferDraft(items: QuoteSelectionItem[], drafts: Record<string, CounterofferDraft>) {
  const entries = Object.entries(drafts);
  if (entries.some(([, row]) => row.quantity === "" || row.days === "" || integerDraft(row.quantity) === null || integerDraft(row.days) === null)) return { ok: false as const, error: "Completá la cantidad y los días con números enteros. Usá Retirar para excluir un ítem." };
  return resolveQuoteSelection(items, entries.map(([id, row]) => ({ id, quantity: Number(row.quantity), days: Number(row.days), excluded: Boolean(row.excluded) })), { requireChange: false });
}
export function counterofferDraftSubtotal(items: QuoteSelectionItem[], drafts: Record<string, CounterofferDraft>): number | null {
  let total = 0;
  for (const item of items) {
    const draft = drafts[item.id] ?? originalCounterofferDraft(item);
    if (draft.excluded) continue;
    if (!draft.quantity || !draft.days || integerDraft(draft.quantity) === null || integerDraft(draft.days) === null) return null;
    const quantity = Number(draft.quantity), days = Number(draft.days);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(days) || days < 1) return null;
    total += selectionLine(item, { quantity, days: isEventBilledItem(item) ? 1 : days }).subtotal;
  }
  return Number.isSafeInteger(total) ? total : null;
}
