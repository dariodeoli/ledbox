import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/inventory-concurrency.pg.test.ts
// Sin TEST_DATABASE_URL se saltea (el CI offline no lo corre). Solo hosts locales.
test("compromiso de stock atómico en PostgreSQL (sin sobreventa)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { commitInventoryAssignment, reserveBudgetInventory } = await import("../lib/server/inventory-availability");
  const { portalAuditContext } = await import("../lib/server/audit");

  const day = (n: number) => new Date(Date.UTC(2031, 0, n, 12));
  const orgs: string[] = [];
  async function seed(stock = 5) {
    const org = randomUUID();
    orgs.push(org);
    const client = randomUUID();
    await db.organization.create({ data: { id: org, name: "Stock QA", slug: `stock-qa-${org}` } });
    await db.client.create({ data: { id: client, organizationId: org, name: "Cliente" } });
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Pantalla LED", category: "QA", quantity: stock } });
    const event = (name: string, extra: Record<string, unknown> = {}) =>
      db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client, name, setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13), ...extra } });
    return { org, client, item, event };
  }
  const commit = (org: string, eventId: string, inventoryId: string, quantity: number, range = true) =>
    commitInventoryAssignment({ organizationId: org, eventId, inventoryId, quantity, ...(range ? { startsAt: day(10), endsAt: day(13) } : {}) });

  try {
    await t.test("dos asignaciones concurrentes de 3 sobre stock 5: entra una sola", async () => {
      for (let round = 0; round < 8; round++) {
        const { org, item, event } = await seed(5);
        const [a, b] = await Promise.all([event("A"), event("B")]);
        const results = await Promise.all([commit(org, a.id, item.id, 3), commit(org, b.id, item.id, 3)]);
        assert.equal(results.filter((r) => r.ok).length, 1, `ronda ${round}`);
        const rejected = results.find((r) => !r.ok);
        assert.equal(rejected && !rejected.ok && rejected.reason, "insufficient");
        const committed = await db.eventInventory.aggregate({ where: { inventoryId: item.id }, _sum: { quantity: true } });
        assert.equal(committed._sum.quantity, 3);
      }
    });

    await t.test("un evento CANCELLED deja su stock libre", async () => {
      const { org, item, event } = await seed(5);
      const [a, b] = await Promise.all([event("A"), event("B")]);
      assert.ok((await commit(org, a.id, item.id, 4)).ok);
      const blocked = await commit(org, b.id, item.id, 4);
      assert.equal(!blocked.ok && blocked.reason, "insufficient");
      await db.event.update({ where: { id: a.id }, data: { status: "CANCELLED" } });
      assert.ok((await commit(org, b.id, item.id, 4)).ok);
    });

    await t.test("equipo afuera (checkedOut sin checkedIn) sigue comprometido aunque el evento se cancele", async () => {
      const { org, item, event } = await seed(5);
      const [a, b] = await Promise.all([event("A"), event("B")]);
      const first = await commit(org, a.id, item.id, 4);
      assert.ok(first.ok);
      await db.eventInventory.update({ where: { id: first.assignment.id }, data: { checkedOut: true, checkedOutAt: day(10) } });
      await db.event.update({ where: { id: a.id }, data: { status: "CANCELLED" } });
      const blocked = await commit(org, b.id, item.id, 4);
      assert.equal(!blocked.ok && blocked.reason, "insufficient", "el equipo sigue afuera");
      await db.eventInventory.update({ where: { id: first.assignment.id }, data: { checkedIn: true, checkedInAt: day(14) } });
      assert.ok((await commit(org, b.id, item.id, 4)).ok, "devuelto: se libera");
    });

    await t.test("presupuestos todos LOST liberan; uno aprobado sigue comprometiendo", async () => {
      const { org, client, item, event } = await seed(5);
      const [a, b, c] = await Promise.all([event("A"), event("B"), event("C")]);
      assert.ok((await commit(org, a.id, item.id, 5)).ok);
      const budget = (eventId: string, status: "LOST" | "APPROVED") =>
        db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client, eventId, title: "P", status } });
      await budget(a.id, "LOST");
      assert.ok((await commit(org, b.id, item.id, 5)).ok, "A perdido libera el stock");
      await budget(b.id, "APPROVED");
      const again = await commit(org, c.id, item.id, 1);
      assert.equal(!again.ok && again.reason, "insufficient", "B aprobado sigue comprometiendo");
    });

    await t.test("event-ops (sin rango propio) con cantidad mayor a la disponible: rechazo y no escribe", async () => {
      const { org, item, event } = await seed(5);
      const [a, b] = await Promise.all([event("A"), event("B")]);
      assert.ok((await commit(org, a.id, item.id, 4)).ok);
      const before = await db.eventInventory.count({ where: { inventoryId: item.id } });
      const over = await commit(org, b.id, item.id, 2, false);
      assert.equal(!over.ok && over.reason, "insufficient");
      assert.equal(await db.eventInventory.count({ where: { inventoryId: item.id } }), before);
      const ok = await commit(org, b.id, item.id, 1, false);
      assert.ok(ok.ok && ok.assignment.startsAt === null, "no inventa un rango propio");
    });

    await t.test("una empresa no compromete ítems ni eventos de otra", async () => {
      const a = await seed(5);
      const b = await seed(5);
      const ea = await a.event("EA");
      const eb = await b.event("EB");
      const r1 = await commit(b.org, eb.id, a.item.id, 1);
      assert.equal(!r1.ok && r1.reason, "item-missing");
      const r2 = await commit(b.org, ea.id, b.item.id, 1);
      assert.equal(!r2.ok && r2.reason, "event-missing");
      assert.equal(await db.eventInventory.count({ where: { OR: [{ inventoryId: a.item.id }, { eventId: ea.id }] } }), 0);
    });

    await t.test("reserva al aprobar + asignación manual concurrentes no sobrevenden", async () => {
      for (let round = 0; round < 6; round++) {
        const { org, client, item, event } = await seed(5);
        const [manual, approved] = await Promise.all([event("Manual"), event("Aprobado")]);
        const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client, eventId: approved.id, title: "P", status: "APPROVED" } });
        await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Pantalla", quantity: 3, days: 1, unitPrice: 1000, subtotal: 3000, inventoryId: item.id } });
        const [m, reservation] = await Promise.all([
          commit(org, manual.id, item.id, 3),
          reserveBudgetInventory({ organizationId: org, budgetId: budget.id, context: portalAuditContext(org, "QA") }),
        ]);
        assert.equal(reservation.failed, false);
        const total = (await db.eventInventory.aggregate({ where: { inventoryId: item.id }, _sum: { quantity: true } }))._sum.quantity ?? 0;
        assert.ok(total <= 5, `ronda ${round}: comprometido ${total} de 5`);
        // Quien perdió la carrera queda pendiente (la aprobación no se rompe).
        if (m.ok) assert.ok(reservation.reserved <= 2);
        else assert.equal(reservation.reserved, 3);
      }
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
