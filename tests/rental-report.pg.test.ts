import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/rental-report.pg.test.ts
test("reporte de alquileres en PostgreSQL: los totales cuadran con SQL de control, sin mezclar empresas ni inventar ceros", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { getRentalReport } = await import("../lib/server/rental-report");

  const MONTH = "2033-03";
  // Asunción es UTC-3: el mes arranca el 1 a las 03:00 UTC.
  const d = (day: number, hour = 12, month = 3) => new Date(Date.UTC(2033, month - 1, day, hour));
  const NOW = d(20);
  // Los controles en SQL comparan contra columnas `timestamp` (UTC): se pasan como texto sin zona.
  const P0 = "2033-03-01T03:00:00";
  const P1 = "2033-04-01T03:00:00";
  const NOW_SQL = NOW.toISOString().slice(0, 19);

  async function org(label: string) {
    const id = randomUUID();
    await db.organization.create({ data: { id, name: `Reporte ${label}`, slug: `rr-${id}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: `Cliente ${label}` } });
    return { id, client: client.id };
  }
  async function item(organizationId: string, name: string, quantity: number, extra: Record<string, unknown> = {}) {
    return db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name, category: "Pantallas", quantity, ...extra } });
  }
  async function ev(o: { id: string; client: string }, name: string, extra: Record<string, unknown> = {}) {
    return db.event.create({ data: { id: randomUUID(), organizationId: o.id, clientId: o.client, name, startsAt: d(10), endsAt: d(12), ...extra } });
  }
  async function budget(o: { id: string; client: string }, extra: Record<string, unknown> = {}) {
    return db.budget.create({ data: { id: randomUUID(), organizationId: o.id, clientId: o.client, title: "Alquiler", subtotal: 1_000_000, total: 1_000_000, ...extra } });
  }
  // Una asignación por evento (único por evento+producto): cada una crea el suyo.
  async function assign(o: { id: string; client: string }, inventoryId: string, quantity: number, startsAt: Date, endsAt: Date, extra: Record<string, unknown> = {}, eventExtra: Record<string, unknown> = {}) {
    const event = await ev(o, "Evento de la asignación", eventExtra);
    return db.eventInventory.create({ data: { id: randomUUID(), organizationId: o.id, eventId: event.id, inventoryId, quantity, startsAt, endsAt, ...extra } });
  }

  const A = await org("A");
  const B = await org("B");

  // ── Ocupación ───────────────────────────────────────────────────────────────
  const pantalla = await item(A.id, "Pantalla P3", 4);
  const sinUso = await item(A.id, "Truss sin uso", 2);
  const conBuffer = await item(A.id, "Parlante con colchones", 1, { bufferBeforeMin: 720, bufferAfterMin: 720 });
  const enMantenimiento = await item(A.id, "Mixer con unidad dañada", 3);
  await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: A.id, inventoryId: enMantenimiento.id, code: "MIX-1", status: "DAMAGED" } });
  const combo = await item(A.id, "Kit combo", 1);
  await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: A.id, parentId: combo.id, componentId: pantalla.id, quantity: 1 } });
  const consumible = await item(A.id, "Cinta", 50, { kind: "CONSUMABLE" });

  await assign(A, pantalla.id, 2, d(10), d(12)); // 2 unidades × 2 días = 4
  await assign(A, pantalla.id, 1, d(1, 0, 2).constructor === Date ? new Date(Date.UTC(2033, 1, 28, 12)) : d(1), new Date(Date.UTC(2033, 2, 2, 3))); // cruza el inicio del mes: 1 día dentro
  await assign(A, pantalla.id, 1, d(15), d(17), { releasedAt: d(2) }); // liberada: no cuenta
  await assign(A, pantalla.id, 1, d(15), d(17), { holdExpiresAt: d(2) }); // retención vencida: no cuenta
  await assign(A, pantalla.id, 3, d(5), d(8), {}, { status: "CANCELLED", name: "Evento cancelado" }); // evento cancelado libera el stock
  await assign(A, pantalla.id, 1, new Date(Date.UTC(2033, 4, 1)), new Date(Date.UTC(2033, 4, 3))); // otro mes
  await assign(A, conBuffer.id, 1, d(10), d(11)); // 1 día + 12 h antes + 12 h después = 2 días
  await assign(A, consumible.id, 5, d(10), d(11)); // consumible: fuera del ranking
  // Empresa B usa el mismo mes con otro producto: no debe aparecer en A.
  const pantallaB = await item(B.id, "Pantalla B", 1);
  await assign(B, pantallaB.id, 1, d(1, 3), new Date(Date.UTC(2033, 3, 2)));

  // ── Catálogo ────────────────────────────────────────────────────────────────
  const quote = (o: { id: string }, status: string, createdAt: Date, respondBy: Date | null) =>
    db.quoteRequest.create({ data: { id: randomUUID(), organizationId: o.id, status, createdAt, respondBy } });
  for (let i = 0; i < 3; i++) await quote(A, "CONVERTED", d(2 + i), d(4 + i));
  await quote(A, "DECLINED", d(6), d(8));
  await quote(A, "EXPIRED", d(7), d(9));
  await quote(A, "NEW", d(8), d(10)); // sin responder y vencido a NOW
  await quote(A, "NEW", d(18), d(25)); // en plazo
  await quote(A, "QUOTED", d(9), d(11));
  await quote(A, "CONVERTED", new Date(Date.UTC(2033, 1, 10)), null); // febrero
  await quote(B, "CONVERTED", d(3), null);
  await quote(B, "CONVERTED", d(4), null);

  // ── Cancelaciones ───────────────────────────────────────────────────────────
  await ev(A, "Cancelado 2", { status: "CANCELLED", startsAt: d(22), endsAt: d(23) });
  await ev(A, "Cancelado en febrero", { status: "CANCELLED", startsAt: new Date(Date.UTC(2033, 1, 20)), endsAt: new Date(Date.UTC(2033, 1, 21)) });
  await ev(B, "Cancelado B", { status: "CANCELLED", startsAt: d(22), endsAt: d(23) });
  await budget(A, { status: "LOST", total: 1_000_000, updatedAt: d(12) });
  await budget(A, { status: "CANCELLED", total: 500_001, updatedAt: d(13) });
  await budget(A, { status: "LOST", total: 9_000_000, updatedAt: new Date(Date.UTC(2033, 1, 3)) });
  await budget(B, { status: "LOST", total: 7_000_000, updatedAt: d(12) });

  // ── Incidentes ──────────────────────────────────────────────────────────────
  const incident = (o: { id: string }, inventoryId: string, kind: string, status: string, cost: number | null, openedAt: Date) =>
    db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: o.id, inventoryId, kind: kind as never, status: status as never, quantity: 1, cost, openedAt } });
  await incident(A, pantalla.id, "DAMAGE", "OPEN", 100_000, d(11));
  await incident(A, pantalla.id, "DAMAGE", "OPEN", null, d(11));
  await incident(A, pantalla.id, "MISSING", "OPEN", null, d(12));
  await incident(A, sinUso.id, "REPAIR", "RESOLVED", 50_001, d(12));
  await incident(A, pantalla.id, "DAMAGE", "OPEN", 9_999_999, new Date(Date.UTC(2033, 1, 11))); // febrero
  await incident(B, pantallaB.id, "DAMAGE", "OPEN", 3_000_000, d(11));

  // ── Señas ───────────────────────────────────────────────────────────────────
  const expected = async (o: { id: string; client: string }, status: string, amount: number, paidAmount: number, extra: { concept?: string; dueAt?: Date | null; budgetStatus?: string } = {}) => {
    const b = await budget(o, { status: extra.budgetStatus ?? "APPROVED" });
    return db.expectedPayment.create({
      data: {
        id: randomUUID(), organizationId: o.id, budgetId: b.id, concept: (extra.concept ?? "advance") as never, slot: extra.concept === "installment" ? "installment:1" : "advance",
        label: "Anticipo", amount, paidAmount, status: status as never, dueAt: extra.dueAt === undefined ? d(5) : extra.dueAt,
      },
    });
  };
  await expected(A, "CONFIRMED", 500_000, 0); // fila anterior al cobro parcial: confirmada con paidAmount en 0
  await expected(A, "PARTIAL", 600_000, 200_000);
  await expected(A, "AWAITING", 300_000, 0);
  await expected(A, "PROOF", 100_000, 0);
  await expected(A, "AWAITING", 900_000, 0, { budgetStatus: "LOST" }); // presupuesto perdido: no espera plata
  await expected(A, "CANCELLED", 777_000, 0);
  await expected(A, "AWAITING", 123_000, 0, { concept: "installment" });
  await expected(A, "AWAITING", 456_000, 0, { dueAt: new Date(Date.UTC(2033, 5, 5)) });
  await expected(B, "AWAITING", 2_000_000, 0);
  await expected(B, "CONFIRMED", 4_000_000, 4_000_000);

  // ── Garantías ───────────────────────────────────────────────────────────────
  const guaranteeEvent = await ev(A, "Con garantías", { startsAt: d(14), endsAt: d(15) });
  const guarantee = (o: { id: string; client: string }, eventId: string | null, status: string, amount: number, retained: number | null, extra: Record<string, unknown> = {}) =>
    budget(o, { eventId, securityDeposit: amount, securityDepositStatus: status, securityDepositRetained: retained, ...extra });
  await guarantee(A, guaranteeEvent.id, "HELD", 2_000_000, null);
  await guarantee(A, guaranteeEvent.id, "RETURNED", 1_500_000, 0);
  await guarantee(A, guaranteeEvent.id, "KEPT_PARTIAL", 1_000_000, 400_001);
  await guarantee(A, guaranteeEvent.id, "KEPT", 700_000, 700_000);
  await guarantee(A, guaranteeEvent.id, "PENDING", 300_000, null);
  await budget(A, { eventId: guaranteeEvent.id }); // sin garantía
  const febEvent = await ev(A, "Garantía de febrero", { startsAt: new Date(Date.UTC(2033, 1, 14)), endsAt: new Date(Date.UTC(2033, 1, 15)) });
  await guarantee(A, febEvent.id, "KEPT", 5_555_555, 5_555_555);
  await guarantee(B, null, "RETURNED", 8_000_000, 0, { createdAt: d(9) });

  // ── Rentabilidad ────────────────────────────────────────────────────────────
  const approved = await budget(A, { status: "APPROVED", approvedAt: d(6) });
  const line = (budgetId: string, inventoryId: string | null, subtotal: number, excluded = false) =>
    db.budgetItem.create({ data: { id: randomUUID(), budgetId, inventoryId, name: "Línea", unitPrice: subtotal, subtotal, excluded } });
  await line(approved.id, pantalla.id, 3_000_000);
  await line(approved.id, pantalla.id, 2_000_001);
  await line(approved.id, pantalla.id, 999, true); // excluida
  await line(approved.id, null, 4_000_000); // sin producto: no es identificable
  await line(approved.id, sinUso.id, 800_000);
  const draft = await budget(A, { status: "DRAFT" });
  await line(draft.id, conBuffer.id, 9_000_000); // sin aprobar: no cuenta
  const approvedB = await budget(B, { status: "APPROVED", approvedAt: d(6) });
  await line(approvedB.id, pantallaB.id, 6_000_000);

  const A_REPORT = await getRentalReport(A.id, MONTH, NOW);
  const B_REPORT = await getRentalReport(B.id, MONTH, NOW);

  await t.test("ocupación: coincide con el SQL de control y respeta liberadas, retenciones vencidas, cancelados, combos y consumibles", async () => {
    // Control en SQL de la pantalla: rango recortado al mes de Asunción.
    const control = await db.$queryRaw<Array<{ days: number }>>`
      SELECT COALESCE(SUM(ei."quantity" * EXTRACT(EPOCH FROM (LEAST(ei."endsAt", ${P1}::timestamp) - GREATEST(ei."startsAt", ${P0}::timestamp))) / 86400.0), 0)::float AS days
      FROM "EventInventory" ei JOIN "Event" e ON e."id" = ei."eventId"
      WHERE ei."inventoryId" = ${pantalla.id} AND ei."releasedAt" IS NULL AND (ei."holdExpiresAt" IS NULL OR ei."holdExpiresAt" > ${NOW_SQL}::timestamp)
        AND e."status" <> 'CANCELLED'
        AND ei."endsAt" > ${P0}::timestamp AND ei."startsAt" < ${P1}::timestamp`;
    assert.equal(control[0].days, 5);
    const all = [...A_REPORT.occupancy.top, ...A_REPORT.occupancy.least];
    const row = all.find((r) => r.id === pantalla.id);
    assert.ok(row);
    assert.equal(row.committedDays, control[0].days);
    assert.equal(row.availableDays, 4 * 31);
    assert.equal(row.percent, 4);
    // Colchones del producto: 1 día + 12 h + 12 h.
    assert.equal(all.find((r) => r.id === conBuffer.id)?.committedDays, 2);
    // Unidad dañada descontada del disponible: (3 − 1) × 31.
    assert.equal(all.find((r) => r.id === enMantenimiento.id)?.availableDays, 62);
    assert.equal(all.find((r) => r.id === sinUso.id)?.percent, 0);
    // Combo y consumible no entran al ranking; la otra empresa tampoco.
    for (const excluded of [combo.id, consumible.id, pantallaB.id]) assert.ok(!all.some((r) => r.id === excluded), excluded);
    assert.deepEqual(A_REPORT.occupancy.top.map((r) => r.name), ["Parlante con colchones", "Pantalla P3"]);
    assert.ok(!A_REPORT.occupancy.least.some((r) => A_REPORT.occupancy.top.some((x) => x.id === r.id)));
    assert.equal(A_REPORT.occupancy.rankedItems, 4);
    assert.deepEqual(B_REPORT.occupancy.top.map((r) => r.name), ["Pantalla B"]);
    assert.equal(B_REPORT.occupancy.top[0].percent, 100);
  });

  await t.test("catálogo: recibidos, convertidos, declinados, vencidos y tasa coinciden con el SQL", async () => {
    const [control] = await db.$queryRaw<Array<{ received: bigint; converted: bigint }>>`
      SELECT COUNT(*) AS received, COUNT(*) FILTER (WHERE "status" = 'CONVERTED') AS converted FROM "QuoteRequest"
      WHERE "organizationId" = ${A.id} AND "createdAt" >= ${P0}::timestamp AND "createdAt" < ${P1}::timestamp`;
    assert.equal(A_REPORT.catalog.received, Number(control.received));
    assert.equal(A_REPORT.catalog.converted, Number(control.converted));
    assert.deepEqual(A_REPORT.catalog, { received: 8, converted: 3, declined: 1, expired: 2, open: 2, conversionRate: 37.5 });
    assert.deepEqual(B_REPORT.catalog, { received: 2, converted: 2, declined: 0, expired: 0, open: 0, conversionRate: 100 });
  });

  await t.test("cancelaciones: eventos del período y presupuestos perdidos o cancelados, por empresa", async () => {
    assert.equal(A_REPORT.cancellations.events.count, 2);
    assert.deepEqual(A_REPORT.cancellations.events.rows.map((r) => r.name).sort(), ["Cancelado 2", "Evento cancelado"]);
    assert.equal(A_REPORT.cancellations.budgets.lost, 1);
    assert.equal(A_REPORT.cancellations.budgets.cancelled, 1);
    assert.equal(A_REPORT.cancellations.budgets.amount, 1_500_001);
    assert.equal(B_REPORT.cancellations.events.count, 1);
    assert.equal(B_REPORT.cancellations.budgets.amount, 7_000_000);
  });

  await t.test("daños y faltantes: por tipo y estado, costo conocido y lo desconocido nunca como 0", async () => {
    const find = (kind: string, status: string) => A_REPORT.incidents.rows.find((r) => r.kind === kind && r.status === status);
    assert.deepEqual(find("DAMAGE", "OPEN"), { kind: "DAMAGE", status: "OPEN", count: 2, quantity: 2, knownCost: 100_000, unknownCostCount: 1 });
    assert.deepEqual(find("MISSING", "OPEN"), { kind: "MISSING", status: "OPEN", count: 1, quantity: 1, knownCost: null, unknownCostCount: 1 });
    assert.equal(find("REPAIR", "RESOLVED")?.knownCost, 50_001);
    assert.equal(A_REPORT.incidents.total, 4);
    assert.equal(A_REPORT.incidents.knownCost, 150_001);
    assert.equal(A_REPORT.incidents.unknownCostCount, 2);
    const [control] = await db.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT SUM("cost") AS total FROM "InventoryIncident" WHERE "organizationId" = ${A.id} AND "openedAt" >= ${P0}::timestamp AND "openedAt" < ${P1}::timestamp`;
    assert.equal(A_REPORT.incidents.knownCost, Number(control.total));
    assert.equal(B_REPORT.incidents.knownCost, 3_000_000);
  });

  await t.test("señas y garantías: cobrado, pendiente y estados de la garantía con sus montos", async () => {
    assert.equal(A_REPORT.deposits.advances.collected, 700_000);
    assert.equal(A_REPORT.deposits.advances.pending, 800_000);
    assert.equal(A_REPORT.deposits.advances.proofInReview, 100_000);
    assert.equal(A_REPORT.deposits.advances.count, 5);
    const [control] = await db.$queryRaw<Array<{ paid: bigint; open: bigint }>>`
      SELECT COALESCE(SUM(CASE WHEN "status" = 'CONFIRMED' THEN "amount" ELSE "paidAmount" END), 0) AS paid,
             COALESCE(SUM("amount" - "paidAmount") FILTER (WHERE "status" IN ('AWAITING','PROOF','PARTIAL') AND "budgetId" IN (SELECT "id" FROM "Budget" WHERE "status" NOT IN ('LOST','CANCELLED'))), 0) AS open
      FROM "ExpectedPayment" WHERE "organizationId" = ${A.id} AND "concept" = 'advance' AND "status" <> 'CANCELLED'
        AND "dueAt" >= ${P0}::timestamp AND "dueAt" < ${P1}::timestamp`;
    assert.equal(A_REPORT.deposits.advances.collected, Number(control.paid));
    assert.equal(A_REPORT.deposits.advances.pending, Number(control.open));
    const g = (status: string) => A_REPORT.deposits.guarantees.find((r) => r.status === status);
    assert.deepEqual(g("KEPT_PARTIAL"), { status: "KEPT_PARTIAL", count: 1, amount: 1_000_000, retained: 400_001, returned: 599_999 });
    assert.deepEqual(g("KEPT"), { status: "KEPT", count: 1, amount: 700_000, retained: 700_000, returned: 0 });
    assert.deepEqual(g("RETURNED"), { status: "RETURNED", count: 1, amount: 1_500_000, retained: 0, returned: 1_500_000 });
    assert.equal(g("HELD")?.amount, 2_000_000);
    assert.equal(g("PENDING")?.amount, 300_000);
    assert.equal(A_REPORT.deposits.guarantees.reduce((s, r) => s + r.count, 0), 5);
    // Empresa B: sus montos no se suman a A.
    assert.equal(B_REPORT.deposits.advances.collected, 4_000_000);
    assert.equal(B_REPORT.deposits.advances.pending, 2_000_000);
    assert.equal(B_REPORT.deposits.guarantees.length, 1);
    assert.equal(B_REPORT.deposits.guarantees[0].returned, 8_000_000);
  });

  await t.test("rentabilidad: ingresos de líneas aprobadas vinculadas menos incidentes con costo; sin datos no aparece", async () => {
    assert.ok(A_REPORT.profitability);
    const rows = A_REPORT.profitability.rows;
    const p = rows.find((r) => r.inventoryId === pantalla.id);
    assert.deepEqual(p, { inventoryId: pantalla.id, name: "Pantalla P3", revenue: 5_000_001, incidentCost: 100_000, unknownCostCount: 2, net: 4_900_001 });
    const q = rows.find((r) => r.inventoryId === sinUso.id);
    assert.equal(q?.revenue, 800_000);
    assert.equal(q?.incidentCost, 50_001);
    assert.ok(!rows.some((r) => r.inventoryId === conBuffer.id), "un borrador no es ingreso");
    const [control] = await db.$queryRaw<Array<{ revenue: bigint }>>`
      SELECT SUM(bi."subtotal") AS revenue FROM "BudgetItem" bi JOIN "Budget" b ON b."id" = bi."budgetId"
      WHERE b."organizationId" = ${A.id} AND b."status" = 'APPROVED' AND bi."excluded" = false AND bi."inventoryId" = ${pantalla.id}
        AND b."approvedAt" >= ${P0}::timestamp AND b."approvedAt" < ${P1}::timestamp`;
    assert.equal(p?.revenue, Number(control.revenue));
    assert.equal(B_REPORT.profitability?.rows.length, 1);
    assert.equal(B_REPORT.profitability?.rows[0].revenue, 6_000_000);
    assert.equal(B_REPORT.profitability?.rows[0].incidentCost, 3_000_000);
  });

  await t.test("una empresa sin datos no inventa nada: ceros solo donde se cuenta, null donde falta el dato", async () => {
    const empty = await org("vacía");
    const report = await getRentalReport(empty.id, MONTH, NOW);
    assert.deepEqual(report.occupancy, { rankedItems: 0, top: [], least: [], truncated: false });
    assert.deepEqual(report.catalog, { received: 0, converted: 0, declined: 0, expired: 0, open: 0, conversionRate: null });
    assert.equal(report.incidents.total, 0);
    assert.equal(report.incidents.knownCost, null);
    assert.deepEqual(report.deposits, { advances: { collected: 0, pending: 0, proofInReview: 0, count: 0 }, guarantees: [] });
    assert.equal(report.profitability, null);
  });
});
