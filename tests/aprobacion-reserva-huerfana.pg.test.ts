import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
test("aprobación: la reserva de la verificación se libera si la aprobación falla o pierde la carrera (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { checkStockBeforeApproval, releaseOrphanedGateReservation, snapshotEventAssignments } = await import("../lib/server/approval-stock");
  const { portalAuditContext } = await import("../lib/server/audit");

  const orgId = randomUUID();
  await db.organization.create({ data: { id: orgId, name: "Reserva huérfana", slug: `rh-${orgId.slice(0, 8)}` } });
  const ctx = portalAuditContext(orgId, "Equipo");
  const copa = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: orgId, name: "Copa", category: "QA", quantity: 1 } });
  const day = (n: number) => new Date(Date.UTC(2033, 0, n, 12));
  async function scenario(label: string) {
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: orgId, name: `Cliente ${label}` } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: orgId, clientId: client.id, name: `Evento ${label}`, setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13), status: "CONFIRMED" } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: orgId, clientId: client.id, eventId: event.id, title: `Presu ${label}`, status: "SENT", subtotal: 1, total: 1 } });
    await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Copa", quantity: 1, days: 1, unitPrice: 1, subtotal: 1, inventoryId: copa.id } });
    return { budget, event };
  }

  try {
    await t.test("si la aprobación no se concreta, el stock reservado por la verificación vuelve a estar libre", async () => {
      const a = await scenario("A");
      const b = await scenario("B");
      const before = await snapshotEventAssignments(orgId, a.event.id);
      const gate = await checkStockBeforeApproval({ organizationId: orgId, budgetId: a.budget.id, context: ctx });
      assert.equal(gate.ok, true);
      assert.equal(await db.eventInventory.count({ where: { eventId: a.event.id } }), 1, "la verificación reservó");
      assert.equal((await checkStockBeforeApproval({ organizationId: orgId, budgetId: b.budget.id, context: ctx })).ok, false, "mientras tanto B no tiene stock");

      // La aprobación de A falló: se libera.
      assert.equal(await releaseOrphanedGateReservation({ organizationId: orgId, budgetId: a.budget.id, eventId: a.event.id, before }), 1);
      assert.equal(await db.eventInventory.count({ where: { eventId: a.event.id } }), 0);
      assert.equal((await checkStockBeforeApproval({ organizationId: orgId, budgetId: b.budget.id, context: ctx })).ok, true, "B ahora sí puede aprobar");
      await db.eventInventory.deleteMany({ where: { inventoryId: copa.id } });
    });

    await t.test("si otro pedido ya aprobó el presupuesto, la reserva es suya y no se toca", async () => {
      const c = await scenario("C");
      const before = await snapshotEventAssignments(orgId, c.event.id);
      await checkStockBeforeApproval({ organizationId: orgId, budgetId: c.budget.id, context: ctx });
      await db.budget.update({ where: { id: c.budget.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      assert.equal(await releaseOrphanedGateReservation({ organizationId: orgId, budgetId: c.budget.id, eventId: c.event.id, before }), 0);
      assert.equal(await db.eventInventory.count({ where: { eventId: c.event.id } }), 1);
    });
  } finally {
    await db.organization.delete({ where: { id: orgId } }).catch((error) => console.error("limpieza", error));
    await db.$disconnect();
  }
});
