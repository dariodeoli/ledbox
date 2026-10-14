import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PERIOD_KEYS,
  asuncionDayKey,
  asuncionMidnight,
  computeDelta,
  formatDelta,
  parsePeriod,
  periodHref,
  resolvePeriod,
} from "../lib/platform/periods";

// 14-10-2026 15:00 en Asunción (UTC-3 todo el año desde 2024).
const NOW = new Date("2026-10-14T18:00:00Z");
const midnight = (day: string) => asuncionMidnight(day).toISOString();

test("parsePeriod acepta los 6 chips y cae a 30d con basura", () => {
  for (const key of PERIOD_KEYS) assert.equal(parsePeriod(key), key);
  assert.equal(parsePeriod("xx"), "30d");
  assert.equal(parsePeriod(undefined), "30d");
  assert.equal(parsePeriod(["7d", "90d"]), "7d");
});

test("medianoche de Asunción en UTC", () => {
  assert.equal(midnight("2026-10-14"), "2026-10-14T03:00:00.000Z");
  assert.equal(midnight("2026-01-01"), "2026-01-01T03:00:00.000Z");
});

test("los 6 períodos: límites en medianoche de Asunción y anterior de igual duración", () => {
  const expected: Record<string, { start: string; end: string; days: number }> = {
    hoy: { start: "2026-10-14", end: "2026-10-15", days: 1 },
    "7d": { start: "2026-10-08", end: "2026-10-15", days: 7 },
    "30d": { start: "2026-09-15", end: "2026-10-15", days: 30 },
    "90d": { start: "2026-07-17", end: "2026-10-15", days: 90 },
    mes: { start: "2026-10-01", end: "2026-10-15", days: 14 },
    "mes-anterior": { start: "2026-09-01", end: "2026-10-01", days: 30 },
  };
  for (const key of PERIOD_KEYS) {
    const range = resolvePeriod(key, NOW);
    const want = expected[key];
    assert.equal(range.start.toISOString(), midnight(want.start), `${key} inicio`);
    assert.equal(range.end.toISOString(), midnight(want.end), `${key} fin`);
    assert.equal(range.days.length, want.days, `${key} días`);
    assert.equal(range.prevDays.length, range.days.length, `${key} igual duración`);
    assert.equal(range.prevEnd.getTime(), range.start.getTime(), `${key} el anterior termina donde empieza el actual`);
    assert.equal(range.prevEnd.getTime() - range.prevStart.getTime(), range.end.getTime() - range.start.getTime(), `${key} ms`);
    assert.equal(range.days[0], want.start);
  }
});

test("borde de Asunción: 02:30 UTC todavía es el día anterior", () => {
  const justAfterUtcMidnight = new Date("2026-10-14T02:30:00Z");
  assert.equal(asuncionDayKey(justAfterUtcMidnight), "2026-10-13");
  assert.equal(resolvePeriod("hoy", justAfterUtcMidnight).days[0], "2026-10-13");
  const afterLocalMidnight = new Date("2026-10-14T03:00:00Z");
  assert.equal(asuncionDayKey(afterLocalMidnight), "2026-10-14");
  assert.equal(resolvePeriod("hoy", afterLocalMidnight).days[0], "2026-10-14");
});

test("cruce de año: mes-anterior en enero y 7d", () => {
  const range = resolvePeriod("mes-anterior", new Date("2027-01-10T12:00:00Z"));
  assert.equal(range.days[0], "2026-12-01");
  assert.equal(range.days.length, 31);
  assert.equal(resolvePeriod("7d", new Date("2027-01-03T12:00:00Z")).days[0], "2026-12-28");
});

test("delta: anterior 0 es «nuevo», nunca infinito", () => {
  assert.deepEqual(computeDelta(5, 0), { kind: "nuevo" });
  assert.deepEqual(computeDelta(0, 0), { kind: "igual" });
  assert.deepEqual(computeDelta(15, 10), { kind: "pct", pct: 50, direction: "up" });
  assert.deepEqual(computeDelta(5, 10), { kind: "pct", pct: 50, direction: "down" });
  assert.equal(formatDelta({ kind: "nuevo" }), "nuevo");
  assert.match(formatDelta(computeDelta(15, 10)), /^\+50/);
  assert.match(formatDelta(computeDelta(5, 10)), /^-50/);
});

test("los chips conservan los demás parámetros y cambian solo p", () => {
  const href = periodHref("/superadmin/actividad", { q: "ab c", p: "7d", f: ["1", "2"], z: undefined }, "90d");
  const url = new URL(href, "http://x");
  assert.equal(url.pathname, "/superadmin/actividad");
  assert.equal(url.searchParams.get("p"), "90d");
  assert.equal(url.searchParams.get("q"), "ab c");
  assert.deepEqual(url.searchParams.getAll("f"), ["1", "2"]);
  assert.equal(url.searchParams.has("z"), false);
});
