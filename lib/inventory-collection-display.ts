/** Presentación de familia/combos en tablas y tarjetas sin alterar sus columnas. */
export function inventoryVariantSummary(options: Record<string, string> | null | undefined): string | null {
  if (!options) return null;
  const entries = Object.entries(options)
    .filter(([key, value]) => key.trim() !== "" && typeof value === "string" && value.trim() !== "")
    .map(([key, value]) => `${key.replace(/[-_]+/g, " ")}: ${value.trim()}`);
  return entries.length ? entries.join(" · ") : null;
}

/** Null/ausente significa desconocido; cero es un valor confirmado y visible. */
export function inventoryKnownQuantity(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : String(value);
}

export function inventoryComboSummary(
  components: readonly { name: string; quantity: number | null | undefined }[] | null | undefined,
): string | null {
  if (!components?.length) return null;
  const entries = components
    .filter((component) => component.name.trim() !== "")
    .map((component) => `${component.name.trim()} × ${inventoryKnownQuantity(component.quantity)}`);
  return entries.length ? entries.join(" · ") : null;
}
