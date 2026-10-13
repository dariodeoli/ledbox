import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignmentUnitDays,
  knownCostTotal,
  occupancyRow,
  percentOf,
  profitRow,
  rankOccupancy,
  reportPeriod,
} from "../lib/server/rental-report";
import { costLabel, NO_DATA, rentalCsvBlocks } from "../app/(admin)/(print)/_components/RentalReportSection";
import type { AdminRentalReport } from "../lib/admin-types";

const at = (iso: string) => new Date(iso);
const noBuffers = { beforeMin: 0, afterMin: 0 };
const event = { id: "e1", name: "Expo", startsAt: null, endsAt: null, setupAt: null, strikeAt: null };

test("el período es el mes de Asunción (UTC-3) y cuenta sus días", () => {
  const march = reportPeriod("2033-03");
  assert.equal(march.start.toISOString(), "2033-03-01T03:00:00.000Z");
  assert.equal(march.end.toISOString(), "2033-04-01T03:00:00.000Z");
  assert.equal(march.days, 31);
  assert.equal(reportPeriod("2032-02").days, 29);
  assert.equal(reportPeriod("2033-12").end.toISOString(), "2034-01-01T03:00:00.000Z");
  assert.throws(() => reportPeriod("2033-13"));
});

test("percentOf: sin base devuelve null, no 0", () => {
  assert.equal(percentOf(0, 0), null);
  assert.equal(percentOf(3, 8), 37.5);
  assert.equal(percentOf(150, 100, true), 100);
  assert.equal(percentOf(150, 100), 150);
});

test("días-unidad: cantidad × rango recortado al período, con los colchones del motor", () => {
  const period = reportPeriod("2033-03");
  const row = { quantity: 2, startsAt: at("2033-03-10T12:00:00Z"), endsAt: at("2033-03-12T12:00:00Z"), event, checkedInAt: null };
  assert.equal(assignmentUnitDays(row, noBuffers, period), 4);
  // 12 h antes y 12 h después: 3 días × 2 unidades.
  assert.equal(assignmentUnitDays(row, { beforeMin: 720, afterMin: 720 }, period), 6);
  // Recorte al inicio del período: solo el día que cae dentro.
  const straddle = { ...row, quantity: 1, startsAt: at("2033-02-28T12:00:00Z"), endsAt: at("2033-03-02T03:00:00Z") };
  assert.equal(assignmentUnitDays(straddle, noBuffers, period), 1);
  // Fuera del período: 0.
  assert.equal(assignmentUnitDays({ ...row, startsAt: at("2033-05-01T00:00:00Z"), endsAt: at("2033-05-02T00:00:00Z") }, noBuffers, period), 0);
  // Devuelto tarde: la limpieza corre desde la devolución real.
  const late = { ...row, quantity: 1, checkedInAt: at("2033-03-13T12:00:00Z") };
  assert.equal(assignmentUnitDays(late, noBuffers, period), 3);
  // Rango abierto: ocupa todo el período.
  assert.equal(assignmentUnitDays({ quantity: 1, startsAt: null, endsAt: null, event, checkedInAt: null }, noBuffers, period), 31);
});

test("ocupación: descuenta mantenimiento, no hay producto sin disponible y el % tiene tope 100", () => {
  const period = reportPeriod("2033-03");
  const row = { quantity: 1, startsAt: at("2033-03-10T12:00:00Z"), endsAt: at("2033-03-11T12:00:00Z"), event, checkedInAt: null };
  const item = { id: "i1", name: "Pantalla", quantity: 4, maintenance: 2, buffers: noBuffers };
  const result = occupancyRow(item, [row, row], period);
  assert.deepEqual(result, { id: "i1", name: "Pantalla", committedDays: 2, availableDays: 62, percent: 3.2 });
  assert.equal(occupancyRow({ ...item, maintenance: 4 }, [row], period), null);
  const over = occupancyRow({ ...item, quantity: 1, maintenance: 0 }, Array.from({ length: 40 }, () => row), period);
  assert.equal(over?.percent, 100);
});

test("ranking: top solo con uso, menos usados sin repetir y orden estable", () => {
  const make = (id: string, percent: number, committedDays = percent) => ({ id, name: id, committedDays, availableDays: 100, percent });
  const rows = [make("a", 50), make("b", 0), make("c", 10), make("d", 0), make("e", 80)];
  const { top, least } = rankOccupancy(rows, 2);
  assert.deepEqual(top.map((r) => r.id), ["e", "a"]);
  assert.deepEqual(least.map((r) => r.id), ["b", "d"]);
  const all = rankOccupancy(rows, 10);
  assert.deepEqual(all.top.map((r) => r.id), ["e", "a", "c"]);
  assert.deepEqual(all.least.map((r) => r.id), ["b", "d"]);
  assert.deepEqual(rankOccupancy([], 10), { top: [], least: [] });
});

test("costo desconocido nunca es 0", () => {
  assert.equal(knownCostTotal(null, 0), null);
  assert.equal(knownCostTotal(0, 0), null);
  assert.equal(knownCostTotal(0, 1), 0);
  assert.equal(knownCostTotal(150_000, 2), 150_000);
  assert.equal(costLabel(null, 3), NO_DATA);
  assert.match(costLabel(100_000, 2), /\+ 2 sin dato$/);
  assert.doesNotMatch(costLabel(100_000, 0), /sin dato/);
});

test("rentabilidad: ingresos menos costo conocido; sin costo cargado no resta ni inventa", () => {
  const withCost = profitRow({ inventoryId: "p", name: "P", revenue: 5_000_001, costSum: 100_000, incidentCount: 2, incidentsWithCost: 1 });
  assert.deepEqual(withCost, { inventoryId: "p", name: "P", revenue: 5_000_001, incidentCost: 100_000, unknownCostCount: 1, net: 4_900_001 });
  const noCost = profitRow({ inventoryId: "q", name: "Q", revenue: 800_000, costSum: null, incidentCount: 1, incidentsWithCost: 0 });
  assert.equal(noCost.incidentCost, null);
  assert.equal(noCost.unknownCostCount, 1);
  assert.equal(noCost.net, 800_000);
});

test("el CSV de alquileres escribe «sin dato» y omite la rentabilidad cuando no hay datos", () => {
  const rentals: AdminRentalReport = {
    days: 31,
    occupancy: { rankedItems: 0, top: [], least: [], truncated: false },
    catalog: { received: 0, converted: 0, declined: 0, expired: 0, open: 0, conversionRate: null },
    cancellations: { events: { count: 0, rows: [] }, budgets: { lost: 0, cancelled: 0, amount: 0, rows: [] } },
    incidents: { total: 1, rows: [{ kind: "MISSING", status: "OPEN", count: 1, quantity: 1, knownCost: null, unknownCostCount: 1 }], knownCost: null, unknownCostCount: 1 },
    deposits: { advances: { collected: 0, pending: 0, proofInReview: 0, count: 0 }, guarantees: [] },
    profitability: null,
  };
  const blocks = rentalCsvBlocks(rentals);
  assert.ok(!blocks.some((b) => (b.title ?? "").includes("rentabilidad")));
  const incidents = blocks.find((b) => (b.title ?? "").includes("daños"));
  assert.equal(incidents?.rows[0][4], NO_DATA);
  assert.equal(blocks.find((b) => (b.title ?? "").includes("conversión"))?.rows.at(-1)?.[1], "");
});
