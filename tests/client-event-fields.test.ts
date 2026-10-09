import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientFields } from "../app/api/admin/clients/client-fields";
import { eventDateViolation, parseEventFields } from "../app/api/admin/events/event-fields";
import { FIELD_LIMITS } from "../lib/field-rules";

test("PATCH inválido no borra datos: tipos erróneos rechazados y ausente/null diferenciados", () => {
  const fields = ["contactName", "company", "contactRole", "notes", "website", "instagram", "phone", "contactPhone", "whatsapp", "ruc", "email", "contactEmail", "billingEmail"];
  for (const field of fields) {
    for (const value of [123, true, {}, []]) assert.equal(parseClientFields({ [field]: value }).ok, false, `${field} no debe borrar/ignorar ${JSON.stringify(value)}`);
    assert.deepEqual(parseClientFields({ [field]: undefined }), { ok: true, data: {} });
    assert.deepEqual(parseClientFields({ [field]: null }), { ok: true, data: { [field]: null } });
    assert.deepEqual(parseClientFields({ [field]: "  " }), { ok: true, data: { [field]: null } });
  }
  for (const value of [null, [], true, 123]) assert.equal(parseClientFields(value).ok, false);
});

test("textos excedidos se rechazan antes de normalizar, nunca se truncan", () => {
  for (const [field, max] of Object.entries({ company: FIELD_LIMITS.company, notes: FIELD_LIMITS.notes, contactRole: 120, contactName: 120, website: 200, instagram: 200, ruc: 30 })) {
    assert.equal(parseClientFields({ [field]: "x".repeat(max + 1) }).ok, false, field);
  }
  assert.equal(parseClientFields({ contacts: [{ name: "x".repeat(121) }] }).ok, false);
  assert.equal(parseClientFields({ contacts: [{ name: "Ana QA", role: "x".repeat(121) }] }).ok, false);
  assert.deepEqual(parseClientFields({ notes: "x".repeat(FIELD_LIMITS.notes) }), { ok: true, data: { notes: "x".repeat(FIELD_LIMITS.notes) } });
});

test("fantasía empresarial independiente: 200 caracteres, sin conversión de historia/contacto", () => {
  const parsed = parseClientFields({ tradeName: "  SCALE   STRATEGY GROUP EAS  ", legalName: "RAZÓN SOCIAL OFICIAL S.A.", city: "Asunción", department: "Capital" });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.data, { tradeName: "SCALE STRATEGY GROUP EAS", legalName: "RAZÓN SOCIAL OFICIAL S.A.", city: "Asunción", department: "Capital" });
  assert.equal(parseClientFields({ tradeName: "x".repeat(200) }).ok, true);
  assert.equal(parseClientFields({ name: "x".repeat(200) }).ok, true);
  assert.equal(parseClientFields({ name: "x".repeat(201) }).ok, false);
  assert.equal(parseClientFields({ tradeName: "x".repeat(201) }).ok, false);
  assert.equal(parseClientFields({ tradeName: 123 }).ok, false);
  assert.deepEqual(parseClientFields({ tradeName: "", department: null }), { ok: true, data: { tradeName: null, department: null } });
});

test("contactos por función normalizados sin inferir campos principales", () => {
  const result = parseClientFields({ billingEmail: "  FACTURA@EXAMPLE.COM ", contacts: [{ name: " Ana  Pérez ", role: "Compras", phone: "+595 981123456", email: "ANA@EXAMPLE.COM" }] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.billingEmail, "factura@example.com");
  assert.deepEqual(result.data.contacts, [{ name: "Ana Pérez", role: "Compras", phone: "+595 981123456", email: "ana@example.com" }]);
  assert.equal(result.data.contactName, undefined);
  const foreign = parseClientFields({ contacts: [{ name: "Ana QA", phone: "+54 91112345678" }] });
  assert.equal(foreign.ok, true);
  if (foreign.ok) assert.equal(foreign.data.contacts?.[0].phone, "+54 91112345678", "preserva país explícito, no fuerza +595");
  for (const contacts of [[{ name: "" }], [{ name: "Ana", email: "no-correo" }], [{ name: "Ana", phone: "inválido" }], [{ name: "Ana", email: {} }], Array(21).fill({ name: "Ana" }), {}]) {
    assert.equal(parseClientFields({ contacts }).ok, false);
  }
  assert.equal(parseClientFields({ billingEmail: "x".repeat(255) + "@example.com" }).ok, false);
});

test("enlaces de ubicación HTTP/HTTPS, nunca código o credenciales; locality manual explícita", () => {
  assert.deepEqual(parseClientFields({ locationUrl: "maps.example.com/punto", city: "Ciudad manual", department: null }), { ok: true, data: { locationUrl: "https://maps.example.com/punto", city: "Ciudad manual", department: null } });
  for (const locationUrl of ["javascript:alert(1)", "ftp://example.com", "https://user:secret@example.com", {}]) {
    assert.equal(parseClientFields({ locationUrl }).ok, false);
    assert.equal(parseEventFields({ locationUrl }).ok, false);
  }
});

test("evento rápido opcional y edición parcial conservan recinto separado de localidad", () => {
  assert.deepEqual(parseEventFields({ name: " Evento  empresarial ", city: "Asunción", department: "Capital", location: "Recinto QA", attendees: 0, startsAt: "" }), { ok: true, data: { name: "Evento empresarial", city: "Asunción", department: "Capital", location: "Recinto QA", attendees: 0, startsAt: null } });
  assert.deepEqual(parseEventFields({ department: null }), { ok: true, data: { department: null } });
  for (const attendees of [-1, 1.5, "10", 2147483648]) assert.equal(parseEventFields({ attendees }).ok, false);
  assert.equal(parseEventFields({ name: "  " }).ok, false);
  assert.equal(parseEventFields({ startsAt: "no-fecha" }).ok, false);
  assert.equal(parseEventFields({ startsAt: "2030-02-30T12:00" }).ok, false);
  assert.equal(parseEventFields({ startsAt: "2030-01-01T24:00" }).ok, false);
  assert.equal(parseEventFields({ venueContactEmail: "inválido" }).ok, false);
  assert.equal(parseEventFields({ responsiblePhone: "inválido" }).ok, false);
  assert.equal(eventDateViolation({ startsAt: new Date("2030-01-02"), endsAt: new Date("2030-01-01") }), "El fin del evento no puede ser anterior al inicio.");
  assert.equal(eventDateViolation({ setupAt: new Date("2030-01-03"), startsAt: new Date("2030-01-02") }), "El montaje no puede ser posterior al inicio.");
});
