import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("send availability uses real dryRun and leaves assignments, combo contributions, units and audits unchanged", { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { checkBudgetSendAvailability } = await import("../lib/server/budget-send-availability");
  const org = randomUUID(), other = randomUUID();
  const context = { organizationId: org, user: { id: randomUUID(), name: "QA disponibilidad", email: "qa@example.invalid", role: "OWNER" } } as never;
  const start = new Date("2035-10-15T12:00:00Z"), end = new Date("2035-10-16T12:00:00Z");
  async function snap() { return {
    assignments: await db.eventInventory.findMany({ where: { event: { organizationId: org } }, orderBy: { id: "asc" } }),
    units: await db.inventoryUnit.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }),
    audit: await db.auditLog.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }),
  }; }
  try {
    await db.organization.create({ data: { id: org, name: "QA250", slug: `qa250-${org}` } });
    await db.organization.create({ data: { id: other, name: "Otra QA250", slug: `qa250-${other}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente ficticio" } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Evento ficticio", startsAt: start, endsAt: end } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, eventId: event.id, title: "QA250", publicToken: randomUUID(), subtotal: 4000, total: 4000 } });
    const stock = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Silla QA250", category: "QA", quantity: 5 } });
    const line = await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Silla", inventoryId: stock.id, quantity: 4, days: 1, unitPrice: 1000, subtotal: 4000 } });
    const check = () => checkBudgetSendAvailability({ organizationId: org, budgetId: budget.id, expectedUpdatedAt: budget.updatedAt, context });
    await t.test("available dry-run rolls back all tentative writes and does not audit", async () => {
      const before = await snap(); const result = await check(); assert.equal(result.review.state, "available"); assert.deepEqual(await snap(), before);
      await assert.rejects(checkBudgetSendAvailability({ organizationId: other, budgetId: budget.id, expectedUpdatedAt: budget.updatedAt, context }), /disponible/);
    });
    await t.test("duplicate linked lines retain the existing MAX contract, not an invented sum", async () => {
      const duplicate = await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Otra línea misma silla", inventoryId: stock.id, quantity: 4, days: 1, unitPrice: 1000, subtotal: 4000 } });
      const before = await snap(); const result = await check(); assert.equal(result.review.state, "available"); assert.deepEqual(await snap(), before);
      assert.equal(result.review.lines.length, 2); assert.ok(result.review.lines.every(row => row.sharedGroup && row.groupRequested === 4 && row.available === 5));
      await db.budgetItem.delete({ where: { id: duplicate.id } });
    });
    await t.test("maintenance and holds use the engine; expired holds do not change persisted rows", async () => {
      const unit = await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: org, inventoryId: stock.id, code: randomUUID(), status: "MAINTENANCE" } });
      const competing = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "PRIVATE_OTHER_EVENT", startsAt: start, endsAt: end } });
      const hold = await db.eventInventory.create({ data: { id: randomUUID(), organizationId: org, eventId: competing.id, inventoryId: stock.id, quantity: 2, startsAt: start, endsAt: end, holdExpiresAt: new Date(Date.now() + 86400000) } });
      const before = await snap(); const result = await check(); assert.equal(result.review.state, "shortage"); assert.equal(result.review.warnings.find(w => w.code === "shortage")?.available, 2); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_OTHER_EVENT/); assert.deepEqual(await snap(), before);
      await db.eventInventory.update({ where: { id: hold.id }, data: { holdExpiresAt: new Date("2000-01-01") } });
      const expired = await snap(); assert.equal((await check()).review.state, "available"); assert.deepEqual(await snap(), expired);
      await db.inventoryUnit.delete({ where: { id: unit.id } });
    });
    await t.test("combo plus loose piece shares capacity and rolls back contributions", async () => {
      const combo = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Juego QA", category: "QA", quantity: 0 } });
      await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: org, parentId: combo.id, componentId: stock.id, quantity: 2 } });
      const comboLine = await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Juego", inventoryId: combo.id, quantity: 2, days: 1, unitPrice: 1000, subtotal: 2000 } });
      await db.budgetItem.update({ where: { id: line.id }, data: { quantity: 2 } });
      const combo2 = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Segundo juego QA", category: "QA", quantity: 0 } });
      await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: org, parentId: combo2.id, componentId: stock.id, quantity: 2 } });
      const secondLine = await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Segundo juego", inventoryId: combo2.id, quantity: 1, days: 1, unitPrice: 1000, subtotal: 1000 } });
      const excludedLine = await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Excluida", inventoryId: stock.id, quantity: 100, days: 1, unitPrice: 1000, subtotal: 0, excluded: true } });
      const before = await snap(); const result = await check(); assert.equal(result.review.state, "shortage"); assert.deepEqual(await snap(), before);
      const projected = new Map(result.review.lines.map(row => [row.itemId, row]));
      assert.equal(projected.size, 4);
      const comboRows = [projected.get(comboLine.id)!, projected.get(secondLine.id)!];
      assert.ok(comboRows.some(row => row.state === "available")); assert.ok(comboRows.some(row => row.state === "shortage"));
      assert.equal(comboRows.reduce((sum, row) => sum + (row.covered ?? 0), 0), 2, "los dos juegos sólo cubren dos grupos, cuatro piezas, en total");
      assert.equal(projected.get(line.id)?.state, "shortage"); assert.equal(projected.get(line.id)?.available, 1, "las piezas comprometidas provisionalmente por ambos combos no se cuentan como libres del suelto");
      assert.equal(projected.get(excludedLine.id)?.state, "excluded"); assert.equal(projected.get(excludedLine.id)?.available, null);
      await db.inventoryItem.update({ where: { id: stock.id }, data: { stockCountStatus: "PENDING_COUNT" } });
      const pending = await check(); assert.equal(pending.review.state, "unverified"); assert.equal(pending.review.warnings.filter(w => w.code === "pending_count").length, 3); assert.ok(pending.review.warnings.every(w => w.available == null));
      await db.inventoryItem.update({ where: { id: stock.id }, data: { stockCountStatus: "CONFIRMED" } });
      await db.budgetItem.deleteMany({ where: { id: { in: [comboLine.id, secondLine.id, excludedLine.id] } } });
      await db.inventoryComponent.deleteMany({ where: { parentId: { in: [combo.id, combo2.id] } } });
    });
    await t.test("own reservations and movement never present kept coverage as extra free stock", async () => {
      const assignment = await db.eventInventory.create({ data: { id: randomUUID(), organizationId: org, eventId: event.id, inventoryId: stock.id, quantity: 4, startsAt: start, endsAt: end } });
      const own = await check(); assert.equal(own.review.lines[0].available, 5); assert.equal(own.review.lines[0].state, "available");
      await db.eventInventory.update({ where: { id: assignment.id }, data: { checkedOut: true } });
      const before = await snap(); const movement = await check(); assert.equal(movement.review.state, "unverified"); assert.equal(movement.review.lines[0].available, null); assert.equal(movement.review.lines[0].covered, 4); assert.match(movement.review.lines[0].reason, /salida o devolución/); assert.deepEqual(await snap(), before);
      await db.eventInventory.delete({ where: { id: assignment.id } });
    });
    await t.test("unknown differs from zero; manual lines/dates cannot certify availability", async () => {
      await db.inventoryItem.update({ where: { id: stock.id }, data: { quantity: 0 } });
      const zero = await check(); assert.equal(zero.review.state, "shortage"); assert.equal(zero.review.warnings[0].available, 0);
      await db.inventoryItem.update({ where: { id: stock.id }, data: { stockCountStatus: "PENDING_COUNT" } });
      const pending = await check(); assert.equal(pending.review.state, "unverified"); assert.equal(pending.review.warnings[0].available, null);
      await db.budgetItem.update({ where: { id: line.id }, data: { inventoryId: null } });
      assert.equal((await check()).review.state, "unverified");
      await db.event.update({ where: { id: event.id }, data: { endsAt: null } }); assert.equal((await check()).review.range, null);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } }); await db.$disconnect();
  }
});
