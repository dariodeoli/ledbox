import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { backupStatusOf, formatAgeLabel } from "../lib/backup-status";

/**
 * Estado del respaldo (issue #43): la regla que decide qué dice el panel y
 * cuándo se dispara la alerta. Se prueba la prioridad entre problemas: un
 * intento fallido manda sobre un archivo ausente y sobre un vencimiento.
 */

test("estado del respaldo: sin respaldos, al día, vencido, fallido y archivo ausente", () => {
  const base = { fileExists: true, ageHours: 3.4, maxAgeHours: 26 };
  assert.equal(backupStatusOf({ lastRunStatus: null, hasSuccess: false, fileExists: null, ageHours: null, maxAgeHours: 26 }), "never");
  assert.equal(backupStatusOf({ lastRunStatus: "ok", hasSuccess: true, ...base }), "ok");
  // El umbral es inclusivo: justo en el límite todavía está al día.
  assert.equal(backupStatusOf({ lastRunStatus: "ok", hasSuccess: true, fileExists: true, ageHours: 26, maxAgeHours: 26 }), "ok");
  assert.equal(backupStatusOf({ lastRunStatus: "ok", hasSuccess: true, fileExists: true, ageHours: 26.1, maxAgeHours: 26 }), "stale");
  assert.equal(backupStatusOf({ lastRunStatus: "failed", hasSuccess: true, ...base }), "failed");
  assert.equal(backupStatusOf({ lastRunStatus: "failed", hasSuccess: true, fileExists: false, ageHours: 40, maxAgeHours: 26 }), "failed");
  assert.equal(backupStatusOf({ lastRunStatus: "ok", hasSuccess: true, fileExists: false, ageHours: 1, maxAgeHours: 26 }), "missing");
  // Un respaldo viejo sin archivo se reporta como archivo ausente (es lo accionable).
  assert.equal(backupStatusOf({ lastRunStatus: "ok", hasSuccess: true, fileExists: false, ageHours: 40, maxAgeHours: 26 }), "missing");
});

test("antigüedad legible del respaldo: horas con coma y días", () => {
  assert.equal(formatAgeLabel(0), "0 h");
  assert.equal(formatAgeLabel(3.4), "3,4 h");
  assert.equal(formatAgeLabel(47.9), "47,9 h");
  assert.equal(formatAgeLabel(48), "2 días");
  assert.equal(formatAgeLabel(100), "4 días");
  assert.equal(formatAgeLabel(null), "sin datos");
  assert.equal(formatAgeLabel(-1), "sin datos");
});

test("el respaldo resuelve solas las versiones de pg_dump (issue #71)", () => {
  // Aserción de fuente: el script no puede quedar atado a `pg_dump` del PATH
  // (en el contenedor el del sistema puede ser más viejo que la base) ni a una
  // ruta fija de versión (cuando la base sube de mayor, el hook instala la
  // nueva y el script tiene que encontrarla solo).
  const script = readFileSync(new URL("../scripts/backup.mjs", import.meta.url), "utf8");
  assert.match(script, /\/usr\/lib\/postgresql/, "busca el cliente por versión mayor instalada");
  assert.match(script, /PG_DUMP_BIN/, "PG_DUMP_BIN sigue mandando si está");
  assert.match(script, /resolvePgDump/, "la resolución está aislada y es explícita");
  assert.match(script, /server version mismatch/, "espera y reintenta si el cliente es más viejo que la base");
  assert.match(script, /MISMATCH_ATTEMPTS/);
  // El instalador del deploy existe y es idempotente.
  const installer = readFileSync(new URL("../scripts/install-pgdump.sh", import.meta.url), "utf8");
  assert.match(installer, /set -eu/);
  assert.match(installer, /if \[ -x "\$PG_DUMP" \]/, "si el binario ya está, no reinstala");
  assert.match(installer, /postgresql-client-\$\{PG_MAJOR\}/);
});
