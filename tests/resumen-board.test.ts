import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAxisCount, formatAxisMoney, niceStep, niceTicks, scaleLinear } from "../lib/chart-scale";
import {
  agingKeyOf,
  bucketAging,
  buildEventWeeks,
  buildForecast,
  buildTrend,
  conversionRate,
  lastMonthKeys,
  lateDaysOf,
  parseAgingParam,
  shiftKey,
} from "../lib/resumen-board";

/** Tablero del Inicio: agrupaciones puras (semanas, antigüedad, meses) y escalas de los gráficos. */

test("previsibilidad: la mora y lo vencido caen en la semana 0 y los totales acumulan 30/60/90 días", () => {
  const forecast = buildForecast(
    [
      { category: "overdue", offset: -5, amount: 400, count: 1 },
      { category: "pending", offset: 0, amount: 100, count: 1 },
      { category: "pending", offset: 6, amount: 50, count: 1 },
      { category: "proof", offset: 7, amount: 700, count: 1 },
      { category: "proof", offset: -2, amount: 30, count: 1 },
      { category: "pending", offset: 29, amount: 1000, count: 2 },
      { category: "pending", offset: 30, amount: 10, count: 1 },
      { category: "pending", offset: 59, amount: 20, count: 1 },
      { category: "pending", offset: 60, amount: 40, count: 1 },
      { category: "pending", offset: 89, amount: 80, count: 1 },
    ],
    "2033-03-20",
    { count: 1, amount: 250 },
  );
  assert.equal(forecast.weeks.length, 8);
  assert.equal(forecast.weeks[0].start, "2033-03-20");
  assert.equal(forecast.weeks[1].start, "2033-03-27");
  assert.deepEqual([forecast.weeks[0].overdue, forecast.weeks[0].pending, forecast.weeks[0].proof], [400, 150, 30]);
  assert.deepEqual([forecast.weeks[1].overdue, forecast.weeks[1].pending, forecast.weeks[1].proof], [0, 0, 700]);
  // offset 29 → semana 4; offset 30 → semana 4; offset 59 → semana 8 (fuera del gráfico).
  assert.equal(forecast.weeks[4].pending, 1010);
  assert.equal(forecast.weeks[7].pending, 0);
  assert.deepEqual(forecast.totals, { d30: 400 + 100 + 50 + 700 + 30 + 1000, d60: 400 + 100 + 50 + 700 + 30 + 1000 + 10 + 20, d90: 2310 + 40 + 80 });
  assert.equal(forecast.overdueTotal, 400);
  assert.deepEqual(forecast.undated, { count: 1, amount: 250 });
});

test("previsibilidad: sin pagos esperados todo queda en 0 y las 8 semanas existen", () => {
  const forecast = buildForecast([], "2033-12-28");
  assert.equal(forecast.weeks.length, 8);
  assert.equal(forecast.weeks[1].start, "2034-01-04");
  assert.deepEqual(forecast.totals, { d30: 0, d60: 0, d90: 0 });
});

test("antigüedad: los tramos son al día, 1-30, 31-60 y más de 60, con sus bordes", () => {
  assert.deepEqual([-3, 0, 1, 30, 31, 60, 61, 400].map(agingKeyOf), ["current", "current", "d1_30", "d1_30", "d31_60", "d31_60", "d60plus", "d60plus"]);
  const buckets = bucketAging([
    { lateDays: 0, amount: 100, count: 2 },
    { lateDays: -4, amount: 50, count: 1 },
    { lateDays: 30, amount: 10, count: 1 },
    { lateDays: 31, amount: 20, count: 1 },
    { lateDays: 90, amount: 5, count: 1 },
  ]);
  assert.deepEqual(
    buckets.map((bucket) => [bucket.key, bucket.amount, bucket.count]),
    [["current", 150, 3], ["d1_30", 10, 1], ["d31_60", 20, 1], ["d60plus", 5, 1]],
  );
  assert.equal(bucketAging([]).length, 4, "siempre los cuatro tramos, aunque estén vacíos");
});

test("antigüedad: los días de atraso del cliente coinciden con la regla del servidor y el filtro ?vence= se valida", () => {
  const now = new Date("2033-03-20T15:00:00Z"); // 12:00 en Asunción; el día arranca a las 03:00 UTC
  assert.equal(lateDaysOf("2033-03-20T12:00:00Z", now), 0, "vence hoy: al día");
  assert.equal(lateDaysOf("2033-03-19T15:00:00Z", now), 1);
  assert.equal(lateDaysOf("2033-03-19T03:00:00Z", now), 1);
  assert.equal(lateDaysOf("2033-02-18T03:00:00Z", now), 30);
  assert.equal(lateDaysOf("2033-02-17T15:00:00Z", now), 31);
  assert.equal(lateDaysOf(null, now), 0);
  assert.equal(parseAgingParam("1-30"), "d1_30");
  assert.equal(parseAgingParam("60-mas"), "d60plus");
  assert.equal(parseAgingParam("otro"), null);
  assert.equal(parseAgingParam(null), null);
});

test("tendencia: seis meses terminando en el actual, con 0 real en los meses sin filas", () => {
  assert.deepEqual(lastMonthKeys("2033-03-20", 6), ["2032-10", "2032-11", "2032-12", "2033-01", "2033-02", "2033-03"]);
  const trend = buildTrend(
    lastMonthKeys("2033-03-20", 3),
    [{ month: "2033-03", amount: 900, count: 2 }],
    [{ month: "2033-02", amount: 300, count: 1 }, { month: "2033-03", amount: 200, count: 1 }],
  );
  assert.deepEqual(trend.map((month) => [month.month, month.sales, month.collected, month.current]), [
    ["2033-01", 0, 0, false],
    ["2033-02", 0, 300, false],
    ["2033-03", 900, 200, true],
  ]);
});

test("eventos por semana y tasa de conversión", () => {
  const weeks = buildEventWeeks([{ week: 0, count: 3 }, { week: 2, count: 1 }, { week: 9, count: 5 }], "2033-03-20", 4);
  assert.deepEqual(weeks.map((week) => week.count), [3, 0, 1, 0]);
  assert.equal(weeks[3].start, shiftKey("2033-03-20", 21));
  assert.equal(conversionRate(8, 2), 25);
  assert.equal(conversionRate(3, 1), 33.3);
  assert.equal(conversionRate(0, 4), null, "sin base no hay tasa");
});

test("escalas: marcas lindas desde 0 que cubren el máximo, y ejes en millones", () => {
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(7), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(14_457_000), [0, 5_000_000, 10_000_000, 15_000_000]);
  const ticks = niceTicks(47_920_000);
  assert.ok(ticks[ticks.length - 1] >= 47_920_000 && ticks[0] === 0 && ticks.length <= 6);
  assert.equal(niceStep(100, 4), 25);
  assert.equal(scaleLinear(5, 10), 0.5);
  assert.equal(scaleLinear(50, 10), 1, "se acota al dominio");
  assert.equal(scaleLinear(-1, 10), 0);
  assert.equal(scaleLinear(5, 0), 0);
  assert.equal(formatAxisMoney(0), "0");
  assert.equal(formatAxisMoney(500_000), "500 mil");
  assert.equal(formatAxisMoney(1_500_000), "1,5 M");
  assert.equal(formatAxisMoney(15_000_000), "15 M");
  assert.equal(formatAxisCount(1234), new Intl.NumberFormat("es-PY").format(1234));
});

test("accesibilidad: el SVG de los gráficos es decorativo y siempre hay tabla o lista equivalente", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const bars = read("components/admin/charts/ChartBars.tsx");
  assert.match(bars, /aria-hidden="true"/);
  assert.match(bars, /<table className="sr-only">[\s\S]*<caption>/, "la tabla va fuera del condicional del ancho: existe aunque el SVG no se dibuje");
  const list = read("components/admin/charts/ChartBarList.tsx");
  assert.match(list, /<ul className="admin-barlist" aria-label/);
  assert.match(list, /admin-barlist-label[\s\S]*admin-barlist-value/, "la barra SVG acompaña texto real");
  // Los 6 bloques dibujan solo con ChartBars (tabla) o ChartBarList (lista) y texto; ninguno usa <svg> suelto.
  assert.doesNotMatch(read("components/admin/modules/ResumenBoard.tsx"), /<svg/);
});
