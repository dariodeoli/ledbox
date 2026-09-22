import assert from "node:assert/strict";
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
