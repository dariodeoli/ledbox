/** Un recinto se recuerda desde sus eventos guardados, sin otra ficha paralela. */
export const VENUE_FIELDS = ["location", "city", "department", "address", "addressReference", "locationUrl", "venueContactName", "venueContactPhone", "venueContactEmail"] as const;
export type EventVenue = { [K in typeof VENUE_FIELDS[number]]: string | null };
export function venueKey(location: string): string { return location.trim().replace(/\s+/g, " ").toLocaleLowerCase("es"); }
/** Entrada ordenada por edición descendente; conserva una ficha coherente, no mezcla eventos. */
export function rememberedVenues(rows: readonly EventVenue[]): EventVenue[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = venueKey(row.location ?? "");
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
