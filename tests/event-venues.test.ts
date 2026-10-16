import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogCity } from "../lib/field-rules";
import { parseEventFields } from "../app/api/admin/events/event-fields";
import { EMPTY_EVENT_QUICK, eventQuickError } from "../components/admin/modules/OperationQuickRules";
import { rememberedVenues, recoverVenueDefaults, eventVenueSnapshot, venueDefaultsEqual, venueKey, type EventVenue } from "../lib/event-venues";

test("ciudad sólo catálogo: normaliza opción válida y rechaza sufijos, preservando histórico sin cambios", () => {
  assert.equal(catalogCity("  asuncion ")?.ciudad, "Asunción");
  assert.equal(catalogCity("Asunciónx"), null);
  assert.equal(parseEventFields({ city: "Asunciónx" }).ok, false);
  assert.deepEqual(parseEventFields({ city: "asuncion" }), { ok: true, data: { city: "Asunción", department: "Asunción" } });
  assert.deepEqual(parseEventFields({ city: "Ciudad histórica", name: "Edición" }, "Ciudad histórica"), { ok: true, data: { city: "Ciudad histórica", name: "Edición" } });
  assert.equal(parseEventFields({ city: "Otra inexistente" }, "Ciudad histórica").ok, false);
  assert.equal(eventQuickError({ ...EMPTY_EVENT_QUICK, name: "Evento", city: "Asunciónx" }), "Elegí una ciudad de la lista.");
  assert.equal(eventQuickError({ ...EMPTY_EVENT_QUICK, name: "Evento", city: "Ciudad histórica" }, "Ciudad histórica"), "");
});

test("libreta recupera una ficha anterior coherente cuando la última perdió todo contacto", () => {
  const venue = (location: string | null, address: string | null, venueContactName: string | null): EventVenue => ({ location, address, venueContactName, city: null, department: null, addressReference: null, locationUrl: null, venueContactPhone: null, venueContactEmail: null });
  const current = venue("  Salón Aurora ", "Nueva dirección", null);
  const previous = venue("salón   aurora", "Dirección antigua", "Contacto anterior");
  const other = venue("Jardín", "Calle Uno", "Ana");
  assert.deepEqual(rememberedVenues([current, previous, venue(" ", "", ""), other]), [previous, other]);
  assert.equal(rememberedVenues([current, previous])[0].venueContactName, "Contacto anterior");
  assert.deepEqual(recoverVenueDefaults([current, previous]), [{ venue: previous, needsReview: true }]);
});


test("última ficha con contacto propio prevalece; no mezcla personas ni datos de lugar", () => {
  const base = eventVenueSnapshot({ location: "Salón", city: "Asunción", address: "Calle actual", venueContactName: "Persona nueva" });
  const older = { ...base, address: "Calle anterior", venueContactName: "Persona anterior", venueContactEmail: "anterior@example.invalid" };
  assert.deepEqual(recoverVenueDefaults([base, older]), [{ venue: base, needsReview: false }]);
  const empty = { ...base, venueContactName: null };
  assert.deepEqual(recoverVenueDefaults([empty, older]), [{ venue: older, needsReview: true }]);
  assert.equal(rememberedVenues([empty, older])[0].address, "Calle anterior", "recupera toda una ficha, no injerta otro contacto");
});

test("snapshot estricto y clave coherente: no arrastra responsable ni cliente", () => {
  const input = { ...eventVenueSnapshot({ location: " Salón  Aurora " }), responsibleName: "Privado", clientId: "privado" };
  assert.equal((eventVenueSnapshot(input) as any).responsibleName, undefined);
  assert.equal((eventVenueSnapshot(input) as any).clientId, undefined);
  assert.equal(venueKey("\t SALÓN\u00a0  Aurora \n"), "salón aurora");
  assert.equal(venueDefaultsEqual(input, { ...input, venueContactName: "" }), true);
});
