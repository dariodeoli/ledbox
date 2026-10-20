import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("MCP budget draft preview is read-only, tenant/actor bound, stale-safe, audited and idempotent", { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "MCP integration tests require a local disposable database");
  process.env.DATABASE_URL = url.toString();
  const [{ db }, { previewBudgetDraft, confirmBudgetDraft }] = await Promise.all([import("../lib/server/db"), import("../lib/server/mcp/mutations")]);
  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const actorId = randomUUID();
  const otherActorId = randomUUID();
  const context = (orgId: string, userId = actorId) => ({
    organizationId: orgId, role: "OWNER" as const, demo: false, sandbox: false,
    organization: { id: orgId, name: "MCP draft fixture", slug: `mcp-${orgId}`, planId: null },
    user: { id: userId, name: "MCP draft actor", email: "mcp@example.test", role: "OWNER" as const }, session: {} as never,
  });
  await db.organization.createMany({ data: [organizationId, foreignOrganizationId].map((id) => ({ id, slug: `mcp-${id}`, name: "MCP draft fixture" })) });
  try {
    const clientId = randomUUID();
    const productId = randomUUID();
    await db.client.create({ data: { id: clientId, organizationId, name: "MCP draft client" } });
    await db.inventoryItem.create({ data: { id: productId, organizationId, name: "MCP draft chair", category: "Fixture", quantity: 4, listPrice: 50000 } });
    const before = { budgets: await db.budget.count({ where: { organizationId } }), audits: await db.auditLog.count({ where: { organizationId } }), quantity: (await db.inventoryItem.findUniqueOrThrow({ where: { id: productId } })).quantity };
    const preview = await previewBudgetDraft(context(organizationId), { clientId, title: "MCP proposal", currency: "PYG", lines: [{ productId, description: "MCP draft chair", quantity: 2, unitPrice: 50000 }] });
    assert.equal(await db.budget.count({ where: { organizationId } }), before.budgets, "preview creates no budget");
    await assert.rejects(() => confirmBudgetDraft(context(foreignOrganizationId), { previewId: preview.previewId, idempotencyKey: randomUUID() }));
    await assert.rejects(() => confirmBudgetDraft(context(organizationId, otherActorId), { previewId: preview.previewId, idempotencyKey: randomUUID() }));

    const input = { previewId: preview.previewId, idempotencyKey: randomUUID() };
    const created = await confirmBudgetDraft(context(organizationId), input);
    const replay = await confirmBudgetDraft(context(organizationId), input);
    assert.deepEqual(replay, created, "an exact retry returns the original budget");
    const result = created as { budget: { id: string; status: string; total: number } };
    assert.equal(result.budget.status, "DRAFT");
    assert.equal(result.budget.total, 100000);
    assert.equal(await db.budget.count({ where: { organizationId } }), before.budgets + 1);
    assert.equal(await db.budgetItem.count({ where: { budgetId: result.budget.id } }), 1);
    assert.equal(await db.expectedPayment.count({ where: { budgetId: result.budget.id } }), 0, "draft confirmation creates no payment plan rows");
    assert.equal(await db.clientPayment.count({ where: { budgetId: result.budget.id } }), 0, "draft confirmation creates no payment");
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: productId } })).quantity, before.quantity, "draft confirmation leaves stock unchanged");
    assert.equal(await db.auditLog.count({ where: { organizationId, entity: "Budget", entityId: result.budget.id } }), 1);

    const stale = await previewBudgetDraft(context(organizationId), { clientId, title: "Stale proposal", currency: "PYG", lines: [{ description: "Service", quantity: 1, unitPrice: 9000 }] });
    await db.client.update({ where: { id: clientId }, data: { phone: "0981000000" } });
    await assert.rejects(() => confirmBudgetDraft(context(organizationId), { previewId: stale.previewId, idempotencyKey: randomUUID() }), /PREVIEW_STALE/);
    assert.equal(await db.budget.count({ where: { organizationId } }), before.budgets + 1, "stale preview creates no budget");
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [organizationId, foreignOrganizationId] } } });
  }
});
