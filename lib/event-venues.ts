/** Campos predeterminados de un recinto; el evento guarda su propia copia al elegirlo. */
export const VENUE_FIELDS = ["location", "city", "department", "address", "addressReference", "locationUrl", "venueContactName", "venueContactPhone", "venueContactEmail"] as const;
export type EventVenue = { [K in typeof VENUE_FIELDS[number]]: string | null };
export type SavedEventVenue = EventVenue & { id: string; revision: number; needsReview: boolean };
export function venueKey(location: string): string { return location.trim().replace(/\s+/g, " ").toLocaleLowerCase("es"); }
/** Sólo copia datos del lugar: nunca cliente, responsable ni estado/fechas del evento. */
export function eventVenueSnapshot(row: Partial<EventVenue>): EventVenue {
  return Object.fromEntries(VENUE_FIELDS.map(key => [key, typeof row[key] === "string" ? row[key] : null])) as EventVenue;
}
export function venueDefaultsEqual(a: Partial<EventVenue>, b: Partial<EventVenue>): boolean {
  return VENUE_FIELDS.every(key => (a[key] ?? "").trim() === (b[key] ?? "").trim());
}
/** Recupera una ficha coherente; una edición sin contacto no borra el anterior conocido. */
export function recoverVenueDefaults(rows: readonly EventVenue[]): Array<{ venue: EventVenue; needsReview: boolean }> {
  const groups = new Map<string, EventVenue[]>();
  for (const row of rows) {
    const key = venueKey(row.location ?? ""); if (!key) continue;
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  const hasContact = (row: EventVenue) => [row.venueContactName, row.venueContactPhone, row.venueContactEmail].some(value => Boolean(value?.trim()));
  const completeContact = (row: EventVenue) => Boolean(row.venueContactName?.trim() && (row.venueContactPhone?.trim() || row.venueContactEmail?.trim()));
  return [...groups.values()].map(group => {
    const latest = group[0];
    const venue = hasContact(latest) ? latest : group.find(completeContact) ?? group.find(hasContact) ?? latest;
    return { venue, needsReview: venue !== latest };
  });
}
/** Compatibilidad de llamada histórica; sin mezcla de campos entre eventos. */
export function rememberedVenues(rows: readonly EventVenue[]): EventVenue[] { return recoverVenueDefaults(rows).map(row => row.venue); }
