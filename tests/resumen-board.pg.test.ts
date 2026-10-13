import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/resumen-board.pg.test.ts
test("tablero del Inicio en PostgreSQL: los totales cuadran con SQL de control y dos empresas no se mezclan", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { getResumenBoard } = await import("../lib/server/resumen-board");

  const DAY = 86_400_000;
  // 20-03-2033 12:00 en Asunción (UTC-3): hoy arranca a las 03:00 UTC.
  const NOW = new Date(Date.UTC(2033, 2, 20, 15));
  const TODAY = Date.UTC(2033, 2, 20, 3);
  const inDays = (days: number, hour = 12) => new Date(TODAY + days * DAY + hour * 3_600_000);
  const sql = (date: Date) => date.toISOString().slice(0, 19);

  async function org(label: string) {
    const id = randomUUID();
    await db.organization.create({ data: { id, name: `Tablero ${label}`, slug: `tb-${id}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: `Cliente ${label}` } });
    return { id, client: client.id };
  }
  async function budget(o: { id: string; client: string }, status: "SENT" | "NEGOTIATING" | "DRAFT" | "APPROVED", total: number, extra: Record<string, unknown> = {}) {
    return db.budget.create({ data: { id: randomUUID(), organizationId: o.id, clientId: o.client, title: `Presupuesto ${total}`, status, subtotal: total, total, ...extra } });
  }
  async function expected(o: { id: string }, budgetId: string, amount: number, dueAt: Date | null, status: "AWAITING" | "PROOF" | "PARTIAL" | "CONFIRMED" | "CANCELLED", paidAmount = 0) {
    const id = randomUUID();
    await db.expectedPayment.create({ data: { id, organizationId: o.id, budgetId, concept: "installment", slot: `installment:${id}`, label: "Cuota", amount, paidAmount, dueAt, status } });
  }
  async function payment(o: { id: string; client: string }, amount: number, status: "PENDING" | "RECEIVED", extra: Record<string, unknown> = {}) {
    await db.clientPayment.create({ data: { id: randomUUID(), organizationId: o.id, clientId: o.client, amount, status, ...extra } });
  }
  async function event(o: { id: string; client: string }, startsAt: Date, status: "CONFIRMED" | "CANCELLED" | "COMPLETED" = "CONFIRMED") {
    await db.event.create({ data: { id: randomUUID(), organizationId: o.id, clientId: o.client, name: "Evento", startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), status } });
  }

  const A = await org("A");
  const B = await org("B");

  // ── Pagos esperados (A) ──
  const approvedA = await budget(A, "APPROVED", 20_000_000, { approvedAt: inDays(-1) });
  await expected(A, approvedA.id, 1_000_000, inDays(1), "AWAITING"); // semana 0, pendiente
  await expected(A, approvedA.id, 2_000_000, inDays(10), "PARTIAL", 500_000); // semana 1: resta 1,5 M
  await expected(A, approvedA.id, 700_000, inDays(3), "PROOF"); // semana 0, con comprobante
  await expected(A, approvedA.id, 400_000, inDays(-5), "AWAITING"); // mora
  await expected(A, approvedA.id, 900_000, inDays(40), "AWAITING"); // semana 5
  await expected(A, approvedA.id, 5_000_000, inDays(100), "AWAITING"); // más allá de 90 días: no cuenta
  await expected(A, approvedA.id, 3_000_000, inDays(2), "CONFIRMED", 3_000_000); // ya cobrado: no cuenta
  await expected(A, approvedA.id, 6_000_000, inDays(2), "CANCELLED"); // cancelado: no cuenta
  await expected(A, approvedA.id, 250_000, null, "AWAITING"); // sin fecha
  // La empresa B tiene los suyos y nunca deben sumarse a A.
  const approvedB = await budget(B, "APPROVED", 9_000_000, { approvedAt: inDays(-2) });
  await expected(B, approvedB.id, 9_000_000, inDays(1), "AWAITING");

  // ── Cobros a plazo pendientes (A y B) ──
  await payment(A, 100_000, "PENDING", { dueAt: inDays(2) }); // al día
  await payment(A, 50_000, "PENDING", { dueAt: null }); // sin vencimiento: al día
  await payment(A, 200_000, "PENDING", { dueAt: inDays(-10) }); // 1-30
  await payment(A, 300_000, "PENDING", { dueAt: inDays(-45) }); // 31-60
  await payment(A, 400_000, "PENDING", { dueAt: inDays(-90) }); // más de 60
  await payment(A, 999_000, "RECEIVED", { dueAt: inDays(-90), paidAt: inDays(-1), collectedAt: inDays(-1) }); // cobrado: no es pendiente
  await payment(B, 7_000_000, "PENDING", { dueAt: inDays(-90) });

  // ── Presupuestos en juego ──
  const sent = await budget(A, "SENT", 3_000_000, { createdAt: inDays(-8) });
  await budget(A, "NEGOTIATING", 5_000_000, { createdAt: inDays(-3) });
  await budget(A, "DRAFT", 7_000_000);
  await budget(B, "SENT", 11_000_000);

  // ── Tendencia: venta por aprobación y cobrado por fecha de cobro ──
  await budget(A, "APPROVED", 4_000_000, { approvedAt: new Date(Date.UTC(2033, 1, 10, 15)) }); // febrero
  await budget(A, "APPROVED", 1_500_000, { approvedAt: new Date(Date.UTC(2033, 0, 31, 23)) }); // 31-01 20:00 en Asunción: enero
  await budget(A, "APPROVED", 1_100_000, { approvedAt: new Date(Date.UTC(2033, 1, 1, 2)) }); // 31-01 23:00 en Asunción: enero (borde)
  await payment(A, 600_000, "RECEIVED", { collectedAt: new Date(Date.UTC(2033, 2, 2, 12)), paidAt: new Date(Date.UTC(2033, 2, 2, 12)) }); // marzo
  await payment(A, 250_000, "RECEIVED", { collectedAt: null, paidAt: new Date(Date.UTC(2033, 1, 20, 12)) }); // sin collectedAt: usa paidAt, febrero

  // ── Eventos próximos ──
  await event(A, inDays(1));
  await event(A, inDays(6));
  await event(A, inDays(8));
  await event(A, inDays(2), "CANCELLED"); // no cuenta
  await event(A, inDays(3), "COMPLETED"); // no cuenta
  await event(A, inDays(30)); // fuera de las 4 semanas
  await event(B, inDays(1));
  await event(B, inDays(15));

  // ── Inventario ──
  await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: B.id, name: "Equipo de B", category: "Pantallas", quantity: 3 } });
  const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: A.id, name: "Pantalla de A", category: "Pantallas", quantity: 2 } });
  const ev = await db.event.create({ data: { id: randomUUID(), organizationId: A.id, clientId: A.client, name: "Evento con equipos", startsAt: inDays(1), endsAt: inDays(3), status: "CONFIRMED" } });
  await db.eventInventory.create({ data: { id: randomUUID(), organizationId: A.id, eventId: ev.id, inventoryId: item.id, quantity: 1, startsAt: inDays(1), endsAt: inDays(3) } });

  const board = await getResumenBoard(A.id, NOW);
  const other = await getResumenBoard(B.id, NOW);

  // ── Previsibilidad ──
  const week = board.forecast.weeks;
  assert.deepEqual([week[0].pending, week[0].proof, week[0].overdue], [1_000_000, 700_000, 400_000]);
  assert.equal(week[1].pending, 1_500_000, "la seña parcial ya cobrada se resta");
  assert.equal(week[5].pending, 900_000);
  assert.deepEqual(board.forecast.undated, { count: 1, amount: 250_000 });
  assert.equal(board.forecast.overdueTotal, 400_000);
  const [control] = await db.$queryRawUnsafe<Array<{ d30: bigint; d90: bigint }>>(
    `SELECT COALESCE(SUM(CASE WHEN "dueAt" < $2::timestamp THEN "amount" - "paidAmount" END), 0)::bigint AS d30,
            COALESCE(SUM(CASE WHEN "dueAt" < $3::timestamp THEN "amount" - "paidAmount" END), 0)::bigint AS d90
     FROM "ExpectedPayment" WHERE "organizationId" = $1 AND "status" IN ('AWAITING','PROOF','PARTIAL') AND "dueAt" IS NOT NULL`,
    A.id,
    sql(new Date(TODAY + 30 * DAY)),
    sql(new Date(TODAY + 90 * DAY)),
  );
  assert.equal(board.forecast.totals.d30, Number(control.d30));
  assert.equal(board.forecast.totals.d90, Number(control.d90));
  assert.equal(board.forecast.totals.d30, 1_000_000 + 700_000 + 400_000 + 1_500_000);
  assert.equal(board.forecast.totals.d60, board.forecast.totals.d30 + 900_000);
  assert.equal(board.forecast.totals.d90, board.forecast.totals.d60);
  assert.equal(other.forecast.totals.d30, 9_000_000, "B ve solo lo suyo");

  // ── Antigüedad ──
  assert.deepEqual(board.aging.map((bucket) => [bucket.key, bucket.amount, bucket.count]), [
    ["current", 150_000, 2],
    ["d1_30", 200_000, 1],
    ["d31_60", 300_000, 1],
    ["d60plus", 400_000, 1],
  ]);
  const [pending] = await db.$queryRawUnsafe<Array<{ amount: bigint; count: number }>>(
    `SELECT SUM("amount")::bigint AS amount, COUNT(*)::int AS count FROM "ClientPayment" WHERE "organizationId" = $1 AND "status" = 'PENDING'`,
    A.id,
  );
  assert.equal(board.aging.reduce((sum, bucket) => sum + bucket.amount, 0), Number(pending.amount));
  assert.equal(board.aging.reduce((sum, bucket) => sum + bucket.count, 0), pending.count);
  assert.equal(other.aging[3].amount, 7_000_000);
  assert.equal(other.aging[0].amount, 0);

  // ── Presupuestos en juego ──
  assert.equal(board.budgets.count, 2);
  assert.equal(board.budgets.amount, 8_000_000);
  assert.equal(board.budgets.oldestDays, 8);
  assert.deepEqual(board.budgets.top.map((row) => [row.amount, row.status]), [[5_000_000, "NEGOTIATING"], [3_000_000, "SENT"]]);
  assert.equal(board.budgets.top[1].id, sent.id);
  assert.equal(other.budgets.amount, 11_000_000);
  assert.ok(!other.budgets.top.some((row) => row.id === sent.id), "un presupuesto ajeno no aparece");

  // ── Tendencia ──
  const month = (key: string) => board.trend.find((row) => row.month === key)!;
  assert.deepEqual(board.trend.map((row) => row.month), ["2032-10", "2032-11", "2032-12", "2033-01", "2033-02", "2033-03"]);
  assert.equal(month("2033-01").sales, 2_600_000, "el borde del mes usa la hora de Asunción");
  assert.equal(month("2033-02").sales, 4_000_000);
  assert.equal(month("2033-03").sales, 20_000_000);
  assert.equal(month("2033-02").collected, 250_000);
  assert.equal(month("2033-03").collected, 600_000 + 999_000);
  assert.equal(month("2033-03").current, true);
  assert.equal(month("2032-11").sales, 0);
  const [sales] = await db.$queryRawUnsafe<Array<{ total: bigint }>>(
    `SELECT COALESCE(SUM("total"), 0)::bigint AS total FROM "Budget" WHERE "organizationId" = $1 AND "status" = 'APPROVED' AND "approvedAt" >= $2::timestamp AND "approvedAt" < $3::timestamp`,
    A.id,
    "2032-10-01T03:00:00",
    "2033-04-01T03:00:00",
  );
  assert.equal(board.trend.reduce((sum, row) => sum + row.sales, 0), Number(sales.total));
  assert.equal(other.trend.reduce((sum, row) => sum + row.sales, 0), 9_000_000);

  // ── Eventos ──
  assert.deepEqual(board.events.map((row) => row.count), [3, 1, 0, 0], "A: los de la semana 0 incluyen el evento con equipos");
  assert.deepEqual(other.events.map((row) => row.count), [1, 0, 1, 0]);

  // ── Ocupación ──
  assert.equal(board.occupancy.items, 1);
  assert.equal(other.occupancy.items, 1);
  assert.equal(board.occupancy.top.length, 1);
  assert.equal(board.occupancy.top[0].name, "Pantalla de A");
  assert.ok(board.occupancy.percent !== null && board.occupancy.percent > 0 && board.occupancy.percent <= 100);
  assert.equal(other.occupancy.percent, 0, "B tiene un producto sin reservas: 0 real, no vacío");
  assert.deepEqual(other.occupancy.top, []);
});
