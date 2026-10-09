import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  diasHasta,
  fechaLista,
  fechaListaCorta,
  hayVersionNueva,
  partesVersion,
  registroConsentimiento,
  tonoVencimiento,
} from "owncoding-ui/utils";
import { APP_VERSION, nuevaVersionDisponible, partesVersion as partesVersionApp } from "../lib/version";
import { countdownDays, countdownTone } from "../lib/admin-format";

/**
 * Tanda 1 del plan #100 (issue #105): los utils puros entran por el subcamino
 * `owncoding-ui/utils` y las adopciones sin UI conservan el contrato que ya
 * consumían el panel, el portal y los imprimibles. Estas guardas fallan si
 * alguien vuelve al entry root para lo migrado.
 *
 * No se testean acá `claveTelefonoCliente`/`coincideTelefonoCliente` ni los
 * helpers de proveedores/cuentas: v0.55.0 todavía **no los publica por el
 * subcamino** (solo por el root). Quedan anotados como pedido upstream en el
 * handover del #105; el dedup de `/api/leads` conserva su clave local con la
 * guarda de los números cortos hasta esa publicación.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("los utils migrados entran por owncoding-ui/utils, no por el root", () => {
  for (const file of ["lib/admin-format.ts", "lib/bank-mark.ts", "lib/qr.ts"]) {
    const source = repoFile(file);
    assert.match(source, /from "owncoding-ui\/utils"/, `${file}: falta el subcamino de utils`);
    assert.doesNotMatch(source, /from "owncoding-ui";/, `${file}: no debe importar del root`);
  }
  // Ninguna regla server-side puede ejecutar el entry "use client".
  const rules = repoFile("lib/field-rules.ts");
  const rootImports = rules.match(/from "owncoding-ui";/g) ?? [];
  assert.equal(rootImports.length, 0, "field-rules no puede ejecutar helpers del entry cliente");
});

test("limpiarPercent sigue pendiente en utils; el kit conserva una regla pura", () => {
  const rules = repoFile("lib/field-rules.ts");
  assert.match(rules, /export function percentInput/);
  const library = repoFile("node_modules/owncoding-ui/src/utils/index.js");
  assert.doesNotMatch(library, /limpiarPercent/, "si upstream la publica en utils, migrar y borrar la excepción");
});

test("qrDataUrl delega en la librería y conserva las opciones del QR", () => {
  const qr = repoFile("lib/qr.ts");
  assert.match(qr, /qrDataUrlDeLibreria\(text, \{ ancho: size \}\)/);
  assert.match(qr, /import \{ QR_OPCIONES, qrDataUrl as qrDataUrlDeLibreria \} from "owncoding-ui\/utils"/);
});

test("countdownDays and countdownTone share the canonical Paraguay calendar", (t) => {
  assert.equal(diasHasta("2026-10-03", { hoy: "2026-10-01" }), 2);
  assert.equal(diasHasta("2026-02-31"), null, "un día inexistente ya no se corre de fecha");
  assert.equal(tonoVencimiento("2026-09-29", { hoy: "2026-09-30" }), "bad");
  assert.equal(tonoVencimiento("2026-10-03", { hoy: "2026-09-30" }), "warn");
  assert.equal(tonoVencimiento("2026-11-30", { hoy: "2026-09-30" }), "");
  const format = repoFile("lib/admin-format.ts");
  assert.match(format, /diasHasta\(value, \{ timeZone: TIME_ZONE \}\)/);
  const now = new Date("2026-10-09T01:54:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  for (const [date, expectedDays, expectedTone] of [
    ["2026-10-07", -1, "danger"],
    ["2026-10-08", 0, "warn"],
    ["2026-10-15", 7, "warn"],
    ["2026-10-16", 8, "neutral"],
    ["2026-02-31", null, "neutral"],
  ] as const) {
    const canonicalDays = diasHasta(date, { hoy: now, timeZone: "America/Asuncion" });
    assert.equal(canonicalDays, expectedDays);
    assert.equal(countdownDays(date), canonicalDays);
    assert.equal(countdownTone(date), expectedTone);
  }
});

test("el RUC del lead y del cliente se guarda con los helpers de la librería", () => {
  const rules = repoFile("lib/field-rules.ts");
  assert.match(rules, /export function rucDocument/, "el RUC guardado tiene una sola regla");
  assert.match(rules, /export function rucValid/, "la validación suave vive con las reglas del panel");
  assert.match(rules, /export \{ RUC_RE \}/, "el patrón de la librería queda disponible");
  const leads = repoFile("app/api/leads/route.ts");
  assert.match(leads, /ruc: rucDocument\(leadData\.ruc\) \|\| undefined/);
  const fields = repoFile("app/api/admin/clients/client-fields.ts");
  assert.match(fields, /data\.ruc = rucDocument\(record\.ruc\)/);
});

test("registroConsentimiento normaliza la constancia del lead", () => {
  const constancia = registroConsentimiento({
    finalidad: "consulta",
    aceptado: true,
    version: "2.1.52",
    canal: "sitio-web",
    fecha: new Date("2026-09-30T12:00:00.000Z"),
  });
  assert.deepEqual(constancia, {
    finalidad: "consulta",
    aceptado: true,
    version: "2.1.52",
    canal: "sitio-web",
    fecha: "2026-09-30T12:00:00.000Z",
    titular: "",
  });
  assert.equal(registroConsentimiento({ fecha: "no-es-fecha" }).fecha, "", "una fecha inválida no se inventa");
  const leads = repoFile("app/api/leads/route.ts");
  assert.match(leads, /registroConsentimiento\(/);
  assert.match(leads, /consentChannel: consentimiento\.canal/);
  assert.match(leads, /consentVersion: consentimiento\.version/);
});

test("la versión se compara con la librería", () => {
  assert.deepEqual(partesVersion("v2.1.52+abc"), [2, 1, 52]);
  assert.deepEqual(partesVersionApp("v2.1.52+abc"), [2, 1, 52]);
  assert.equal(hayVersionNueva("2.1.52", "2.1.60"), true);
  assert.equal(hayVersionNueva("2.1.52", "2.1.52"), false);
  assert.equal(nuevaVersionDisponible(APP_VERSION), false, "la versión de la app no es «nueva» contra sí misma");
  assert.equal(nuevaVersionDisponible(""), false);
});

test("fechaLista y fechaListaCorta de la librería quedan verificadas (formatos comparados)", () => {
  // El panel conserva sus propios formateadores (mismo tipeo en pantalla y en
  // los imprimibles: «16-sept.» con punto y año, «17 sept. 2026»); la
  // comparación de formatos quedó en el handover del #105.
  assert.equal(fechaListaCorta("2026-09-16T02:30:00.000Z", "—", { timeZone: "America/Asuncion" }), "15-sept");
  assert.equal(fechaLista("2026-09-16T02:30:00.000Z", "—", { timeZone: "America/Asuncion" }), "15 sept 26 · 23:30");
  const format = repoFile("lib/admin-format.ts");
  assert.doesNotMatch(format, /fechaLista\b/, "los formateadores propios no se reemplazan: cambia el tipeo");
});
