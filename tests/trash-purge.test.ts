import assert from "node:assert/strict";
import { test } from "node:test";
import { isTrashPurgeDays, purgeStatusText, daysUntilPurge, trashPurgeCutoff } from "../lib/trash-shared";
import { parseRentalSettingsPatch, RENTAL_SETTINGS_DEFAULTS } from "../lib/server/rental-settings";
import { autoPurgeReason, PURGE_BATCH_LIMIT } from "../lib/server/trash-purge";

const NOW = new Date("2026-10-13T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString();

test("daysUntilPurge: faltan N días, 0 si ya venció y null con la purga apagada", () => {
  assert.equal(daysUntilPurge(daysAgo(0), 30, NOW), 30);
  assert.equal(daysUntilPurge(daysAgo(10), 30, NOW), 20);
  assert.equal(daysUntilPurge(daysAgo(29.5), 30, NOW), 1); // redondea hacia arriba
  assert.equal(daysUntilPurge(daysAgo(30), 30, NOW), 0);
  assert.equal(daysUntilPurge(daysAgo(200), 30, NOW), 0);
  assert.equal(daysUntilPurge(daysAgo(5), null, NOW), null);
  assert.equal(daysUntilPurge(daysAgo(5), 0, NOW), null);
  assert.equal(daysUntilPurge("no-es-fecha", 30, NOW), null);
});

test("trashPurgeCutoff resta N días exactos", () => {
  assert.equal(trashPurgeCutoff(60, NOW).toISOString(), daysAgo(60));
});

test("opciones de vaciado: nunca (null), 30, 60, 90 o 180; el default es apagado", () => {
  for (const days of [30, 60, 90, 180]) assert.equal(isTrashPurgeDays(days), true);
  for (const bad of [0, 1, 45, 365, "30", null, undefined, 30.5]) assert.equal(isTrashPurgeDays(bad), false);
  assert.equal(RENTAL_SETTINGS_DEFAULTS.trashPurgeDays, null);
});

test("el PATCH de ajustes valida trashPurgeDays y permite apagarlo", () => {
  const ok = parseRentalSettingsPatch({ trashPurgeDays: 90 });
  assert.ok(ok.ok && ok.data.trashPurgeDays === 90);
  const off = parseRentalSettingsPatch({ trashPurgeDays: null });
  assert.ok(off.ok && off.data.trashPurgeDays === null);
  assert.equal(parseRentalSettingsPatch({ trashPurgeDays: 45 }).ok, false);
  assert.equal(parseRentalSettingsPatch({ trashPurgeDays: "30" }).ok, false);
  const untouched = parseRentalSettingsPatch({ depositPercent: 10 });
  assert.ok(untouched.ok && untouched.data.trashPurgeDays === undefined);
});

test("textos de la columna Vaciado", () => {
  assert.equal(purgeStatusText({ purgeInDays: 12, retained: false, anonymized: false }), "Elegible para vaciado en 12 días");
  assert.equal(purgeStatusText({ purgeInDays: 1, retained: false, anonymized: false }), "Elegible para vaciado en 1 día");
  assert.equal(purgeStatusText({ purgeInDays: 0, retained: false, anonymized: false }), "Plazo cumplido; pendiente de vaciado");
  assert.equal(purgeStatusText({ purgeInDays: null, retained: true, anonymized: false }), "Conservado (contable)");
  assert.equal(purgeStatusText({ purgeInDays: null, retained: false, anonymized: false }), null);
  assert.equal(purgeStatusText({ purgeInDays: null, retained: true, anonymized: true }), null);
});

test("el motivo de auditoría y el tope por pasada", () => {
  assert.equal(autoPurgeReason(90), "Vaciado automático a 90 días");
  assert.ok(PURGE_BATCH_LIMIT > 0 && PURGE_BATCH_LIMIT <= 50);
});
