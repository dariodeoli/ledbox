import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { logAndSanitizeDiagnostic, sanitizeDiagnosticMessage } from "../lib/system-diagnostics";

/**
 * Sanitización del detalle técnico de /estado/sistema (issue #169): el panel y
 * el correo de alerta no muestran hostname interno, URLs de conexión ni
 * versiones de PostgreSQL; el texto crudo queda en los logs del servidor.
 */

const PG_DUMP_ERROR =
  "pg_dump terminó con código 1 (ledbox_app@db-interno-coolify-01:5432/ledbox): " +
  "pg_dump: error: server version: 18.6; pg_dump version: 15.4 · " +
  "pg_dump: error: aborting because of server version mismatch";

test("el error de pg_dump pierde hostname, usuario, puerto y versiones", () => {
  const clean = sanitizeDiagnosticMessage(PG_DUMP_ERROR);
  assert.ok(clean);
  assert.doesNotMatch(clean, /db-interno/);
  assert.doesNotMatch(clean, /coolify/);
  assert.doesNotMatch(clean, /5432/);
  assert.doesNotMatch(clean, /ledbox_app/);
  assert.doesNotMatch(clean, /18\.6|15\.4/);
  assert.doesNotMatch(clean, /server version\s*:/);
  // Lo útil del mensaje sigue leyéndose.
  assert.match(clean, /la base de datos/);
  assert.match(clean, /versión del motor/);
  assert.match(clean, /código 1/);
  assert.match(clean, /desajuste de versiones/);
});

test("la URL de conexión completa (con credenciales) también se recorta", () => {
  const clean = sanitizeDiagnosticMessage(
    "Can't reach database server at postgresql://ledbox:secreto@10.0.0.5:6432/ledbox?schema=public",
  );
  assert.ok(clean);
  assert.doesNotMatch(clean, /secreto|10\.0\.0\.5|6432|postgresql:\/\//i);
  assert.match(clean, /la base de datos/);
});

test("host:puerto suelto y rutas absolutas del contenedor se ocultan", () => {
  const clean = sanitizeDiagnosticMessage("No se pudo leer /data/backups/backup-state.json desde db-interno:5432");
  assert.ok(clean);
  assert.doesNotMatch(clean, /\/data\/backups/);
  assert.doesNotMatch(clean, /db-interno|5432/);
  assert.match(clean, /ruta interna/);
  assert.match(clean, /el servidor/);
});

test("un mensaje sin detalle técnico queda intacto", () => {
  assert.equal(sanitizeDiagnosticMessage("El respaldo terminó sin archivo."), "El respaldo terminó sin archivo.");
  assert.equal(sanitizeDiagnosticMessage("Última corrida a las 12:30, tardó 5 s."), "Última corrida a las 12:30, tardó 5 s.");
});

test("vacío es null y un mensaje larguísimo se corta", () => {
  assert.equal(sanitizeDiagnosticMessage(null), null);
  assert.equal(sanitizeDiagnosticMessage(undefined), null);
  assert.equal(sanitizeDiagnosticMessage("   "), null);
  const largo = sanitizeDiagnosticMessage("x".repeat(500));
  assert.ok(largo);
  assert.ok(largo.length <= 240, `largo ${largo.length}`);
  assert.ok(largo.endsWith("…"));
});

test("el helper registra el crudo y devuelve el sanitizado", () => {
  const clean = logAndSanitizeDiagnostic("prueba", PG_DUMP_ERROR);
  assert.ok(clean);
  assert.doesNotMatch(clean, /db-interno|18\.6/);
  // Sin detalle técnico no hay nada que registrar: devuelve el mismo texto.
  assert.equal(logAndSanitizeDiagnostic("prueba", "Sin novedades."), "Sin novedades.");
});

test("#169: el estado del sistema sanitiza base, respaldo y estado del respaldo", () => {
  const server = readFileSync(new URL("../lib/server/system-status.ts", import.meta.url), "utf8");
  assert.match(server, /logAndSanitizeDiagnostic\("respaldo"/);
  assert.match(server, /logAndSanitizeDiagnostic\("base de datos"/);
  assert.match(server, /logAndSanitizeDiagnostic\(\s*"estado del respaldo"/);
  // El detalle crudo no vuelve a viajar al cliente por ningún camino.
  assert.doesNotMatch(server, /error: message\(caught\)/);
  assert.doesNotMatch(server, /error: asText\(raw\.error\)/);
});

test("#169: la pantalla de Sistema no expone el motor y avisa dónde está el detalle", () => {
  const ui = readFileSync(new URL("../components/admin/modules/SistemaModule.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /PostgreSQL · Prisma/, "el panel ya no rotula el motor");
  assert.match(ui, /Base de datos · Prisma/);
  assert.match(ui, /logs del servidor/);
});


test("#169: libpq quoted hosts, IPv4/IPv6, separate ports and authentication details never reach the UI", () => {
  const cases = [
    'pg_dump: error: connection to server at "db-interno-coolify-01" (10.0.0.5), port 5432 failed: Connection refused',
    'getaddrinfo ENOTFOUND db-interno-coolify-01',
    'connect ECONNREFUSED 10.0.0.5:5432',
    'could not translate host name "db-interno-coolify-01" to address: Name does not resolve',
    'connection to server at "::1", port 5432 failed: Connection refused',
    'host=db-interno-coolify-01 hostaddr=10.0.0.5 port=5432 dbname=tenant_db user=internal_user password=topsecret',
    `host='db-interno-coolify-01' password='secret with spaces' PGPASSWORD="escaped\\\"secret"`,
    'address [2001:db8::7]:5432 unavailable; server version: 18.6',
    'password authentication failed for user "internal_user"; database "tenant_db" unavailable',
    '{"password":"topsecret", "access_token":"hidden-token", "host":"db-interno-coolify-01"}',
    'Authorization: Bearer hidden-token; api_key=private-key',
  ];
  for (const raw of cases) {
    const clean = sanitizeDiagnosticMessage(raw); assert.ok(clean);
    assert.doesNotMatch(clean, /db-interno|10\.0\.0\.5|5432|::1|2001:db8|internal_user|tenant_db|topsecret|secret with spaces|escaped|hidden-token|private-key|18\.6/i, raw);
  }
  assert.equal(sanitizeDiagnosticMessage("Última corrida a las 12:30:45, tardó 5 s."), "Última corrida a las 12:30:45, tardó 5 s.");
});
