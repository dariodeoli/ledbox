import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clientWhatsappMessage,
  contactPhoneValid,
  countdownDays,
  countdownTone,
  daysUntilDue,
  formatCountdown,
  formatDayWhen,
  instagramHref,
  instagramLabel,
  inventoryAssignmentCountdown,
  normalizeContactPhone,
  normalizeInstagram,
  normalizeWebsite,
  paymentReminderMessage,
  websiteHref,
} from "../lib/admin-format";

/**
 * Cuenta regresiva compartida (issue #25): un solo texto y un solo tono para
 * todas las listas y fichas. Los días se calculan por día de Asunción, así que
 * los tests arman las fechas con el mismo calendario.
 */

const ASUNCION_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Asuncion",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Clave `YYYY-MM-DD` del día de Asunción a `offsetDays` de hoy (0 = hoy). */
function dayKeyIn(offsetDays: number): string {
  return ASUNCION_DAY.format(new Date(Date.now() + offsetDays * 86_400_000));
}

test("cuenta regresiva: hoy, mañana, faltan N días y vencido hace N días", () => {
  assert.equal(formatCountdown(dayKeyIn(0)), "hoy");
  assert.equal(formatCountdown(dayKeyIn(1)), "mañana");
  assert.equal(formatCountdown(dayKeyIn(3)), "faltan 3 días");
  assert.equal(formatCountdown(dayKeyIn(20)), "faltan 20 días");
  assert.equal(formatCountdown(dayKeyIn(-1)), "venció hace 1 día");
  assert.equal(formatCountdown(dayKeyIn(-2)), "venció hace 2 días");
  assert.equal(formatCountdown(dayKeyIn(-30)), "venció hace 30 días");
  assert.equal(formatCountdown(null), "—");
  assert.equal(formatCountdown("no-es-fecha"), "—");
});

test("cuenta regresiva: la clave de día no se corre de zona horaria", () => {
  // Un `YYYY-MM-DD` es un día puro: no debe interpretarse como medianoche UTC.
  assert.equal(countdownDays(dayKeyIn(3)), 3);
  assert.equal(countdownDays(dayKeyIn(-3)), -3);
  assert.equal(daysUntilDue(dayKeyIn(3)), 3);
  // Un instante real se resuelve por el día de Asunción.
  assert.equal(countdownDays(new Date()), 0);
  assert.equal(formatCountdown(new Date()), "hoy");
});

test("cuenta regresiva: variantes corta y del cliente", () => {
  assert.equal(formatCountdown(dayKeyIn(0), "short"), "hoy");
  assert.equal(formatCountdown(dayKeyIn(1), "short"), "mañana");
  assert.equal(formatCountdown(dayKeyIn(-1), "short"), "ayer");
  assert.equal(formatCountdown(dayKeyIn(3), "short"), "en 3 d");
  assert.equal(formatCountdown(dayKeyIn(-2), "short"), "hace 2 d");
  assert.equal(formatCountdown(dayKeyIn(0), "client"), "vence hoy");
  assert.equal(formatCountdown(dayKeyIn(1), "client"), "vence mañana");
  assert.equal(formatCountdown(dayKeyIn(4), "client"), "vence en 4 días");
  assert.equal(formatCountdown(dayKeyIn(-2), "client"), "venció hace 2 días");
});

test("tono de la cuenta regresiva: rojo vencido, ámbar hasta 7 días y neutro lejos", () => {
  assert.equal(countdownTone(dayKeyIn(-1)), "danger");
  assert.equal(countdownTone(dayKeyIn(-30)), "danger");
  assert.equal(countdownTone(dayKeyIn(0)), "warn");
  assert.equal(countdownTone(dayKeyIn(7)), "warn");
  assert.equal(countdownTone(dayKeyIn(8)), "neutral");
  assert.equal(countdownTone(dayKeyIn(40)), "neutral");
  assert.equal(countdownTone(null), "neutral");
});

test("formatDayWhen delega en el mismo lenguaje corto (calendario y avisos)", () => {
  for (const offset of [-30, -2, -1, 0, 1, 3, 20]) {
    assert.equal(formatDayWhen(dayKeyIn(offset)), formatCountdown(dayKeyIn(offset), "short"));
  }
  assert.equal(formatDayWhen("no-es-dia"), "—");
});

test("asignación de inventario: salida pendiente, devolución pendiente y cierre", () => {
  assert.deepEqual(
    inventoryAssignmentCountdown({ checkedOut: false, checkedIn: false, startsAt: dayKeyIn(3), endsAt: dayKeyIn(6) }),
    { at: dayKeyIn(3), title: "Salida pendiente" },
  );
  assert.deepEqual(
    inventoryAssignmentCountdown({ checkedOut: true, checkedIn: false, startsAt: dayKeyIn(-2), endsAt: dayKeyIn(2) }),
    { at: dayKeyIn(2), title: "Devolución pendiente" },
  );
  assert.equal(inventoryAssignmentCountdown({ checkedOut: true, checkedIn: true }), null);
  assert.equal(inventoryAssignmentCountdown({ checkedOut: false, checkedIn: false }), null);
});

test("el recordatorio de cobro usa la voz del cliente", () => {
  const message = paymentReminderMessage({
    client: "Countdown SA",
    amount: 250000,
    dueAt: new Date(`${dayKeyIn(3)}T12:00:00.000Z`),
    invoiceNumber: "001-001-1",
  });
  assert.match(message, /vence en 3 días/);
  assert.doesNotMatch(message, /faltan/);
});

/**
 * Datos de contacto del cliente (issue #36): el sitio web se normaliza con
 * esquema, el Instagram como usuario sin `@` y el teléfono acepta el formato
 * local con 0. Las mismas funciones las usa la UI y el API.
 */

test("sitio web: se guarda con esquema, sin barra final y solo si es válido", () => {
  assert.equal(normalizeWebsite("empresa.com.py"), "https://empresa.com.py");
  assert.equal(normalizeWebsite("  www.empresa.com.py/ "), "https://www.empresa.com.py");
  assert.equal(normalizeWebsite("http://empresa.com.py/"), "http://empresa.com.py");
  assert.equal(normalizeWebsite(""), "");
  assert.equal(websiteHref("empresa.com.py"), "https://empresa.com.py");
  assert.equal(websiteHref("no es una url"), null);
  assert.equal(websiteHref("https://sin-punto"), null);
  assert.equal(websiteHref(null), null);
});

test("instagram: se guarda como usuario sin arroba y el link va al perfil", () => {
  assert.equal(normalizeInstagram("@ledboxpy"), "ledboxpy");
  assert.equal(normalizeInstagram("https://www.instagram.com/ledboxpy/?hl=es"), "ledboxpy");
  assert.equal(instagramHref("@ledboxpy"), "https://www.instagram.com/ledboxpy");
  assert.equal(instagramLabel("ledboxpy"), "@ledboxpy");
  assert.equal(instagramHref("usuario con espacios"), null);
  assert.equal(instagramHref(""), null);
});

test("teléfono de contacto: normaliza el 0 local y rechaza lo inválido", () => {
  assert.equal(normalizeContactPhone("0981 123 456"), "+595 981123456");
  assert.equal(normalizeContactPhone("+595 981 123 456"), "+595 981123456");
  assert.equal(contactPhoneValid("0981 123 456"), true);
  assert.equal(contactPhoneValid("123"), false);
  assert.equal(contactPhoneValid(""), false);
});

test("el WhatsApp prellenado del cliente saluda por su nombre", () => {
  assert.equal(clientWhatsappMessage("María González"), "Hola María González: te escribimos de LedBox.");
  assert.equal(clientWhatsappMessage("  "), "Hola: te escribimos de LedBox.");
});
