import assert from "node:assert/strict";
import { test } from "node:test";

/** Fixtures propias: no resetea la vitrina ni ninguna sandbox ajena. */
test("demo alquileres en Postgres: seed completo aislado, motor y tesorería consistentes", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo Postgres descartable local");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { seedSandboxData } = await import("../lib/server/demo-data");
  const { newSandboxNs, makeSeedIds } = await import("../lib/server/demo-ns");
  const { purgeSandbox } = await import("../lib/server/demo-sandboxes");
  const engine = await import("../lib/server/inventory-availability");
  const orgIds: string[] = [];
  t.after(async () => { for (const id of orgIds) await purgeSandbox(id); await db.$disconnect(); });
  const create = async () => {
    const ns = newSandboxNs();
    const ids = makeSeedIds(ns);
    const id = ids.sid("org");
    orgIds.push(id);
    await db.organization.create({ data: { id, name: "Alquileres · Prueba demo", slug: `demo-${ns}`, isDemo: true, demoParentId: "org_demo" } });
    await db.adminUser.create({ data: { id: ids.sid("visitor"), name: "Visitante demo", email: `visitor-${ns}@ledbox.demo`, passwordHash: "test-only", role: "OWNER", demoOrganizationId: id } });
    const started = Date.now();
    await seedSandboxData(id, ns);
    t.diagnostic(`seed completo ${Date.now() - started} ms`);
    return { id, ns, sid: ids.sid };
  };
  const first = await create();
  const second = await create();
  const org = { organizationId: first.id };
  await t.test("cada tenant conserva productos, familias, clientes y presupuestos propios", async () => {
    assert.equal(await db.client.count({ where: { ...org, id: { startsWith: first.sid("client_rental_") } } }), 6);
    assert.equal(await db.inventoryItem.count({ where: { ...org, id: { startsWith: first.sid("inv_rental_") } } }), 14);
    assert.equal(await db.inventoryFamily.count({ where: org }), 4);
    assert.equal(await db.eventTask.count({ where: { event: { organizationId: first.id }, id: { startsWith: first.sid("event_rental_") } } }), 12);
    assert.equal(await db.budget.count({ where: { ...org, id: { startsWith: first.sid("budget_rental_") } } }), 6);
    assert.equal(await db.inventoryItem.count({ where: { ...org, id: { startsWith: second.sid("") } } }), 0);
    for (const item of await db.inventoryItem.findMany({ where: org, include: { units: true, components: true, family: true } })) {
      if (!item.components.length) assert.equal(item.quantity, item.units.filter((unit) => unit.status !== "RETIRED").length, item.name);
      if (item.family) assert.equal(item.categoryId, item.family.categoryId, item.name);
    }
  });
  await t.test("mantenimiento, daño y devolución afectan disponibilidad real", async () => {
    const base = (await db.event.findUniqueOrThrow({ where: { id: first.sid("event_rental_catering") } })).startsAt!;
    const available = async (key: string, day: number) => {
      const item = await db.inventoryItem.findUniqueOrThrow({ where: { id: first.sid(`inv_rental_${key}`) }, include: { _count: { select: engine.MAINTENANCE_UNITS_SELECT } } });
      return engine.availabilityForRange({ organizationId: first.id, item: { ...item, maintenance: engine.maintenanceUnits(item) }, startsAt: new Date(base.getTime() + day * 86_400_000 + 10 * 3_600_000), endsAt: new Date(base.getTime() + day * 86_400_000 + 11 * 3_600_000) });
    };
    assert.equal((await available("alfombra", 0)).available, 0);
    assert.equal((await available("chafing", 0)).available, 1, "4 activas menos una en reparación menos dos entregadas");
    assert.equal((await available("copa_agua", 0)).available, 47, "la copa astillada no vuelve al stock libre");
    assert.equal((await available("mesa_redonda", 12)).available, 9, "12 activas menos3 reservadas; la retirada no cuenta");
  });
  await t.test("pagos esperados y recibidos nunca duplican ni inventan fondos", async () => {
    const budgets = await db.budget.findMany({ where: { ...org, id: { startsWith: first.sid("budget_rental_") } }, include: { payments: true, expectedPayments: true } });
    for (const budget of budgets) {
      if (budget.status !== "APPROVED") { assert.equal(budget.expectedPayments.length, 0); assert.equal(budget.payments.length, 0); continue; }
      assert.ok(budget.approvedAt && budget.eventId);
      assert.equal(budget.expectedPayments.reduce((sum, row) => sum + row.amount, 0), budget.total);
      const paid = budget.payments.filter((row) => row.status === "RECEIVED");
      assert.equal(budget.expectedPayments.reduce((sum, row) => sum + row.paidAmount, 0), paid.reduce((sum, row) => sum + row.amount, 0));
      for (const payment of paid) {
        const movement = await db.treasuryMovement.findMany({ where: { ...org, origin: "client_payment", sourceId: payment.id } });
        assert.equal(movement.length, 1);
        assert.equal(movement[0].amount, payment.amount);
      }
    }
  });
});
