/** Drafts are unsigned whole numbers. Reject malformed text rather than changing
 * `1.5`, `-2` or `1e3` into a different order quantity. Blank is a valid draft. */
export function integerDraft(text: string): string | null {
  if (!/^\d*$/.test(text)) return null;
  return text.replace(/^0+(?=\d)/, "");
}

export function quantityFromDraft(text: string, min: number, max: number): number | null {
  const draft = integerDraft(text);
  if (draft === null || draft === "") return null;
  const value = Number(draft);
  if (!Number.isSafeInteger(value)) return null;
  return Math.min(max, Math.max(min, value));
}

export function stepQuantity(value: number, delta: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value + delta));
}
