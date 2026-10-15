import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { AdminContext } from "../lib/server/tenancy";

test("reabrir presupuesto vuelve a comprometer stock sin sobreventa", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { setBudgetCommercialStatus } = await import("../lib/server/budget-approval");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { availabilityForRange } = await import("../lib/server/inventory-availability");
  const id = randomUUID();
  const organization = await db.organization.create({ data: { id, name: "QA reapertura 132", slug: `reopen132-${id}` } });
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: "Cliente ficticio" } });
  const context = { ...portalAuditContext(id, "QA local"), organization, role: "FINANCE", demo: false, sandbox: false } as AdminContext;
  const start = new Date("2035-02-01T10:00:00Z"), end = new Date("2035-02-02T10:00:00Z");
  async function fixture(status: "LOST" | "CANCELLED", stock = 1) {
    const inventory = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: "Proyector único", category: "QA", quantity: stock } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, name: "Evento original", status: "CONFIRMED", startsAt: start, endsAt: end } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, eventId: event.id, title: "Evento cerrado", status, total: 1000, subtotal: 1000 } });
    await db.eventInventory.create({ data: { id: randomUUID(), eventId: event.id, inventoryId: inventory.id, quantity: 1 } });
    return { inventory, event, budget };
  }
  try {
    await t.test("reapertura con stock ya ocupado devuelve 409 y conserva LOST/CANCELLED", async () => {
      for (const status of ["LOST", "CANCELLED"] as const) {
        const f = await fixture(status);
        const occupied = await db.event.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, name: "Otro evento activo", status: "CONFIRMED", startsAt: start, endsAt: end } });
        await db.eventInventory.create({ data: { id: randomUUID(), eventId: occupied.id, inventoryId: f.inventory.id, quantity: 1 } });
        const response = await setBudgetCommercialStatus(context, { budgetId: f.budget.id, status: "DRAFT" });
        assert.equal(response.status, 409, await response.clone().text());
        assert.equal((await db.budget.findUniqueOrThrow({ where: { id: f.budget.id } })).status, status);
        const available = await availabilityForRange({ organizationId: id, item: { ...f.inventory, maintenance: 0 }, startsAt: start, endsAt: end });
        assert.equal(available.available, 0);
      }
    });
    await t.test("reapertura con disponibilidad libre funciona y ocupa su reserva", async () => {
      const f = await fixture("LOST");
      const response = await setBudgetCommercialStatus(context, { budgetId: f.budget.id, status: "DRAFT" });
      assert.equal(response.status, 200, await response.clone().text());
      const available = await availabilityForRange({ organizationId: id, item: { ...f.inventory, maintenance: 0 }, startsAt: start, endsAt: end });
      assert.equal(available.available, 0);
    });

    await t.test("dos presupuestos cerrados del mismo evento: uno reactiva, el otro no duplica stock", async () => {
      const f = await fixture("LOST");
      const second = await db.budget.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, eventId: f.event.id, title: "Segunda alternativa", status: "CANCELLED" } });
      assert.equal((await setBudgetCommercialStatus(context, { budgetId: f.budget.id, status: "DRAFT" })).status, 200);
      assert.equal((await setBudgetCommercialStatus(context, { budgetId: second.id, status: "SENT" })).status, 200);
      const available = await availabilityForRange({ organizationId: id, item: { ...f.inventory, maintenance: 0 }, startsAt: start, endsAt: end });
      assert.equal(available.available, 0);
      assert.equal(await db.eventInventory.count({ where: { eventId: f.event.id } }), 1);
    });
    await t.test("una alternativa activa ya compromete el evento: reabrir otra no exige stock adicional", async () => {
      const f = await fixture("CANCELLED");
      await db.budget.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, eventId: f.event.id, title: "Alternativa activa", status: "SENT" } });
      const response = await setBudgetCommercialStatus(context, { budgetId: f.budget.id, status: "NEGOTIATING" });
      assert.equal(response.status, 200, await response.clone().text());
    });
    await t.test("respeta el rango propio de la reserva aunque difiera de las fechas del evento", async () => {
      const f = await fixture("LOST");
      const ownStart = new Date("2035-03-01T10:00:00Z"), ownEnd = new Date("2035-03-02T10:00:00Z");
      await db.eventInventory.updateMany({ where: { eventId: f.event.id }, data: { startsAt: ownStart, endsAt: ownEnd } });
      const occupied = await db.event.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, name: "Conflicto sólo del rango propio", status: "CONFIRMED", startsAt: ownStart, endsAt: ownEnd } });
      await db.eventInventory.create({ data: { id: randomUUID(), eventId: occupied.id, inventoryId: f.inventory.id, quantity: 1 } });
      assert.equal((await setBudgetCommercialStatus(context, { budgetId: f.budget.id, status: "DRAFT" })).status, 409);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: f.budget.id } })).status, "LOST");
    });
    await t.test("dos eventos reabiertos concurrentemente disputan el mismo último equipo", async () => {
      const f = await fixture("LOST");
      const otherEvent = await db.event.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, name: "Otro evento cerrado", status: "CONFIRMED", startsAt: start, endsAt: end } });
      const otherBudget = await db.budget.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, eventId: otherEvent.id, title: "Otro presupuesto cerrado", status: "CANCELLED" } });
      await db.eventInventory.create({ data: { id: randomUUID(), eventId: otherEvent.id, inventoryId: f.inventory.id, quantity: 1 } });
      const responses = await Promise.all([f.budget.id, otherBudget.id].map(budgetId => setBudgetCommercialStatus(context, { budgetId, status: "DRAFT" })));
      assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
      assert.equal(await db.budget.count({ where: { id: { in: [f.budget.id, otherBudget.id] }, status: "DRAFT" } }), 1);
    });
    await t.test("fallo conserva plan de cobros y firma; tenant ajeno devuelve 404", async () => {
      const f = await fixture("LOST", 0);
      const expected = await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: id, budgetId: f.budget.id, slot: "advance", concept: "advance", label: "Seña", amount: 1000, status: "CANCELLED" } });
      assert.equal((await setBudgetCommercialStatus(context, { budgetId: f.budget.id, status: "DRAFT" })).status, 409);
      assert.equal((await db.expectedPayment.findUniqueOrThrow({ where: { id: expected.id } })).status, "CANCELLED");
      assert.equal((await setBudgetCommercialStatus({ ...context, organizationId: randomUUID() }, { budgetId: f.budget.id, status: "DRAFT" })).status, 404);
      await db.signatureRequest.create({ data: { id: randomUUID(), organizationId: id, budgetId: f.budget.id, publicCode: randomUUID(), title: "Firma ficticia", senderName: "QA", recipientName: "Cliente ficticio", status: "SIGNED", expiresAt: new Date("2036-01-01"), documentHash: "snapshot132", documentHashCapturedAt: new Date() } });
      assert.equal((await setBudgetCommercialStatus(context, { budgetId: f.budget.id, status: "DRAFT" })).status, 409);
      assert.equal((await db.signatureRequest.findFirstOrThrow({ where: { budgetId: f.budget.id } })).documentHash, "snapshot132");
    });
  } finally {
    await db.organization.delete({ where: { id } });
    await db.$disconnect();
  }
});
