import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("MCP sale-price preview is tenant/actor bound, stale-safe, audited and idempotent; quantity uses physical-unit service", { skip: !process.env.TEST_DATABASE_URL, timeout: 60000 }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "MCP integration tests require a local disposable database");
  process.env.DATABASE_URL = url.toString();
  const [{ db }, { previewSalesPrice, confirmSalesPrice, previewInventoryQuantity, confirmInventoryQuantity }] = await Promise.all([
    import("../lib/server/db"), import("../lib/server/mcp/mutations"),
  ]);
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const adminId = randomUUID();
  const otherAdminId = randomUUID();
  const context = (orgId: string, userId = adminId) => ({
    organizationId: orgId, role: "OWNER" as const, demo: false, sandbox: false,
    organization: { id: orgId, name: "MCP fixture", slug: `mcp-${orgId}`, planId: null },
    user: { id: userId, name: "MCP fixture actor", email: "mcp@example.test", role: "OWNER" as const },
    session: {} as never,
  });
  await db.organization.createMany({ data: [organizationId, otherOrganizationId].map((id) => ({ id, slug: `mcp-${id}`, name: "MCP fixture" })) });
  try {
    const productId = randomUUID();
    await db.salesProduct.create({ data: { id: productId, organizationId, sku: `MCP-${productId.slice(0, 8)}`, name: "Fixture sale product" } });
    const firstPreview = await previewSalesPrice(context(organizationId), { productId, price: 125000, currency: "PYG", audience: "RETAIL", minimumUnits: 1 });
    assert.equal(await db.salesProductPriceTier.count({ where: { productId, organizationId } }), 0, "preview must not write the business price");
    await assert.rejects(() => confirmSalesPrice(context(otherOrganizationId), { previewId: firstPreview.previewId, idempotencyKey: randomUUID() }));
    await assert.rejects(() => confirmSalesPrice(context(organizationId, otherAdminId), { previewId: firstPreview.previewId, idempotencyKey: randomUUID() }));
    const confirmKey = randomUUID();
    const confirmInput = { previewId: firstPreview.previewId, idempotencyKey: confirmKey };
    const applied = await confirmSalesPrice(context(organizationId), confirmInput);
    const replay = await confirmSalesPrice(context(organizationId), confirmInput);
    assert.equal((applied as { ok: boolean }).ok, true);
    assert.deepEqual(replay, applied, "a retry of the exact MCP confirmation returns the original result");
    const tier = await db.salesProductPriceTier.findFirstOrThrow({ where: { productId, organizationId } });
    assert.equal(tier.amount?.toString(), "125000");
    assert.equal(await db.salesProductPriceTier.count({ where: { productId, organizationId } }), 1, "replay must not create another price tier");
    const auditCount = await db.auditLog.count({ where: { organizationId, entity: "SalesProduct", entityId: productId } });
    assert.equal(auditCount, 1);

    const anotherPreview = await previewSalesPrice(context(organizationId), { productId, price: 128000, currency: "PYG", audience: "RETAIL", minimumUnits: 1 });
    await assert.rejects(
      () => confirmSalesPrice(context(organizationId), { previewId: anotherPreview.previewId, idempotencyKey: confirmKey }),
      (error: unknown) => Boolean(error && typeof error === "object" && "status" in error && error.status === 409),
      "reusing the same idempotency key for a different preview must conflict",
    );
    assert.equal((await db.salesProductPriceTier.findUniqueOrThrow({ where: { id: tier.id } })).amount?.toString(), "125000");
    assert.equal(await db.auditLog.count({ where: { organizationId, entity: "SalesProduct", entityId: productId } }), 1);

    const stalePreview = await previewSalesPrice(context(organizationId), { productId, price: 150000, currency: "PYG", audience: "RETAIL", minimumUnits: 1 });
    await db.salesProductPriceTier.update({ where: { id: tier.id }, data: { amount: 130000 } });
    await assert.rejects(() => confirmSalesPrice(context(organizationId), { previewId: stalePreview.previewId, idempotencyKey: randomUUID() }), /PREVIEW_STALE/);
    assert.equal((await db.salesProductPriceTier.findUniqueOrThrow({ where: { id: tier.id } })).amount?.toString(), "130000");

    const itemId = randomUUID();
    await db.inventoryItem.create({ data: { id: itemId, organizationId, name: "Fixture physical item", category: "Fixture", quantity: 0 } });
    const countPreview = await previewInventoryQuantity(context(organizationId), { productId: itemId, quantity: 2, reason: "Conteo físico verificado" });
    const quantityResult = await confirmInventoryQuantity(context(organizationId), { previewId: countPreview.previewId, idempotencyKey: randomUUID() });
    assert.equal((quantityResult as { quantity: number }).quantity, 2);
    assert.equal(await db.inventoryUnit.count({ where: { organizationId, inventoryId: itemId } }), 2);
    assert.equal(await db.auditLog.count({ where: { organizationId, entity: "InventoryItem", entityId: itemId } }), 1);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  }
});
