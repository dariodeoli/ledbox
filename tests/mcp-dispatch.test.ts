import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminContext } from "../lib/server/tenancy";
import { dispatchMcpTool, type McpMutationHandlers } from "../lib/server/mcp/dispatch";
import type { McpReadHandlers } from "../lib/server/mcp/readers";

const context = (role: "OWNER" | "VIEWER" = "OWNER"): AdminContext => ({
  organizationId: "org-trusted", role, user: { id: "actor-1" } as never,
} as unknown as AdminContext);

test("dispatch supplies trusted tenant context and schema defaults to read handlers", async () => {
  let seen: unknown;
  const readers: McpReadHandlers = { "catalog.read": async (actor, input) => { seen = { actor, input }; return { products: [] }; } };
  const response = await dispatchMcpTool("catalog.read", { query: "lamp" }, context(), readers);
  assert.equal(response.isError, undefined);
  assert.deepEqual(JSON.parse(response.content[0].text), { products: [] });
  assert.deepEqual(seen, { actor: { organizationId: "org-trusted", actorId: "actor-1", role: "OWNER" }, input: { query: "lamp", limit: 20 } });
});

test("two authenticated companies get only their own trusted context; prompt cannot switch tenant", async () => {
  const seenTenants: string[] = [];
  const readers: McpReadHandlers = { "clients.read": async (actor) => { seenTenants.push(actor.organizationId); return { clients: [{ id: actor.organizationId, name: "Tenant client" }] }; } };
  const orgA = await dispatchMcpTool("clients.read", { query: "same client" }, context(), readers);
  const contextB: AdminContext = { ...context(), organizationId: "org-b" };
  const orgB = await dispatchMcpTool("clients.read", { query: "same client" }, contextB, readers);
  const spoofed = await dispatchMcpTool("clients.read", { organizationId: "org-b", query: "same client" }, context(), readers);
  assert.deepEqual(seenTenants, ["org-trusted", "org-b"]);
  assert.deepEqual(JSON.parse(orgA.content[0].text), { clients: [{ id: "org-trusted", name: "Tenant client" }] });
  assert.deepEqual(JSON.parse(orgB.content[0].text), { clients: [{ id: "org-b", name: "Tenant client" }] });
  assert.equal(spoofed.isError, true);
  assert.match(spoofed.content[0].text, /INVALID_ARGUMENTS/);
});

test("dispatch rejects caller tenant scope and denied roles before reading", async () => {
  let called = false;
  const readers: McpReadHandlers = { "catalog.read": async () => { called = true; return {}; } };
  const invalid = await dispatchMcpTool("catalog.read", { organizationId: "other-org" }, context(), readers);
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /INVALID_ARGUMENTS/);
  const forbidden = await dispatchMcpTool("catalog.read", {}, context("VIEWER"), readers);
  assert.equal(forbidden.isError, undefined); // VIEWER is allowed to read.
  assert.equal(called, true);
  const denied = await dispatchMcpTool("prices.confirm", { previewId: "1234567890123456", idempotencyKey: "abcdefghijklmnop" }, context("VIEWER"), readers);
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /FORBIDDEN/);
});

test("confirmation without a persisted preview fails closed", async () => {
  const response = await dispatchMcpTool("prices.confirm", { previewId: "1234567890123456", idempotencyKey: "abcdefghijklmnop" }, context(), {}, {
    priceConfirm: async () => { throw new Error("PREVIEW_EXPIRED"); },
    pricePreview: async () => ({ previewId: "12345678-1234-4234-8234-123456789012", expiresInSeconds: 3600, changes: {} } as never),
    quantityConfirm: async () => ({}), quantityPreview: async () => ({ previewId: "12345678-1234-4234-8234-123456789012", expiresInSeconds: 3600, changes: {} } as never),
    rentalPricePreview: async () => ({} as never), rentalPriceConfirm: async () => ({}),
    companyPreview: async () => ({} as never), companyConfirm: async () => ({}),
    photoPreview: async () => ({} as never), photoConfirm: async () => ({}),
    budgetPreview: async () => ({} as never), budgetConfirm: async () => ({}),
    budgetEditPreview: async () => ({} as never), budgetEditConfirm: async () => ({}),
    budgetComparePreview: async () => ({} as never), budgetCompareConfirm: async () => ({}),
    clientPreview: async () => ({} as never), clientConfirm: async () => ({}),
    leadPreview: async () => ({} as never), leadConfirm: async () => ({}),
    eventPreview: async () => ({} as never), eventConfirm: async () => ({}),
  });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /PREVIEW_EXPIRED/);
});

test("profile, rental, photo and budget mutation tools dispatch to their scoped handlers", async () => {
  const calls: string[] = [];
  const mutations = {
    priceConfirm: async () => ({}), pricePreview: async () => ({}), quantityConfirm: async () => ({}), quantityPreview: async () => ({}),
    rentalPriceConfirm: async () => { calls.push("rental.confirm"); return { ok: true }; },
    rentalPricePreview: async () => { calls.push("rental.preview"); return { previewId: "preview-id-123456" }; },
    companyPreview: async () => { calls.push("company.preview"); return { previewId: "preview-id-123456" }; },
    companyConfirm: async () => { calls.push("company.confirm"); return { ok: true }; },
    photoPreview: async () => { calls.push("photo.preview"); return { previewId: "preview-id-123456" }; },
    photoConfirm: async () => { calls.push("photo.confirm"); return { ok: true }; },
    budgetPreview: async () => { calls.push("budget.preview"); return { previewId: "preview-id-123456" }; },
    budgetConfirm: async () => { calls.push("budget.confirm"); return { ok: true }; },
    budgetEditPreview: async () => { calls.push("budget.edit.preview"); return { previewId: "preview-id-123456" }; },
    budgetEditConfirm: async () => { calls.push("budget.edit.confirm"); return { ok: true }; },
    budgetComparePreview: async () => { calls.push("budget.compare.preview"); return { previewId: "preview-id-123456" }; },
    budgetCompareConfirm: async () => { calls.push("budget.compare.confirm"); return { ok: true }; },
    clientPreview: async () => { calls.push("client.preview"); return { previewId: "preview-id-123456" }; },
    clientConfirm: async () => { calls.push("client.confirm"); return { ok: true }; },
    leadPreview: async () => { calls.push("lead.preview"); return { previewId: "preview-id-123456" }; },
    leadConfirm: async () => { calls.push("lead.confirm"); return { ok: true }; },
    eventPreview: async () => { calls.push("event.preview"); return { previewId: "preview-id-123456" }; },
    eventConfirm: async () => { calls.push("event.confirm"); return { ok: true }; },
  } as unknown as McpMutationHandlers;
  await dispatchMcpTool("rental-prices.preview", { productId: "item-1", price: 120000 }, context(), {}, mutations);
  await dispatchMcpTool("rental-prices.confirm", { previewId: "preview-id-123456", idempotencyKey: "key-idempotency-123" }, context(), {}, mutations);
  await dispatchMcpTool("company.preview", { name: "New name" }, context(), {}, mutations);
  await dispatchMcpTool("company.confirm", { previewId: "preview-id-123456", idempotencyKey: "key-idempotency-123" }, context(), {}, mutations);
  await dispatchMcpTool("photos.preview", { resourceType: "product", resourceId: "item-1", fileName: "item.png", mimeType: "image/png", byteLength: 512, sha256: "a".repeat(64), data: "YQ==" }, context(), {}, mutations);
  await dispatchMcpTool("photos.confirm", { previewId: "preview-id-123456", idempotencyKey: "key-idempotency-123" }, context(), {}, mutations);
  await dispatchMcpTool("budgets.preview", { clientId: "client-1", title: "Draft", lines: [{ description: "Item", quantity: 1, unitPrice: 1000 }] }, context(), {}, mutations);
  await dispatchMcpTool("budgets.confirm", { previewId: "preview-id-123456", idempotencyKey: "key-idempotency-123" }, context(), {}, mutations);
  await dispatchMcpTool("budgets.edit.preview", { budgetId: "budget-1", title: "Nuevo título" }, context(), {}, mutations);
  await dispatchMcpTool("budgets.edit.confirm", { previewId: "preview-id-123456", idempotencyKey: "key-idempotency-123" }, context(), {}, mutations);
  await dispatchMcpTool("budgets.compare.preview", { title: "Opciones", expiresAt: "2026-12-01T00:00:00.000Z", alternatives: [{ budgetId: "b1", label: "A" }, { budgetId: "b2", label: "B" }] }, context(), {}, mutations);
  await dispatchMcpTool("budgets.compare.confirm", { previewId: "preview-id-123456", idempotencyKey: "key-idempotency-123" }, context(), {}, mutations);
  await dispatchMcpTool("clients.preview", { name: "Client" }, context(), {}, mutations);
  await dispatchMcpTool("clients.confirm", { previewId: "preview-id-123456", idempotencyKey: "key-idempotency-123" }, context(), {}, mutations);
  await dispatchMcpTool("leads.preview", { id: "lead-123", status: "CONTACTED" }, context(), {}, mutations);
  await dispatchMcpTool("leads.confirm", { previewId: "preview-id-123456", idempotencyKey: "key-idempotency-123" }, context(), {}, mutations);
  await dispatchMcpTool("events.preview", { clientId: "client-1", name: "Event" }, context(), {}, mutations);
  await dispatchMcpTool("events.confirm", { previewId: "preview-id-123456", idempotencyKey: "key-idempotency-123" }, context(), {}, mutations);
  assert.deepEqual(calls, ["rental.preview", "rental.confirm", "company.preview", "company.confirm", "photo.preview", "photo.confirm", "budget.preview", "budget.confirm", "budget.edit.preview", "budget.edit.confirm", "budget.compare.preview", "budget.compare.confirm", "client.preview", "client.confirm", "lead.preview", "lead.confirm", "event.preview", "event.confirm"]);
});

test("role matrix is rechecked for every confirm tool", async () => {
  const inputs: Record<string, unknown> = {
    "prices.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "rental-prices.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "quantities.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "company.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "photos.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "budgets.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "budgets.edit.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "budgets.compare.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "clients.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "leads.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "events.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
  };
  for (const [tool, input] of Object.entries(inputs)) {
    const denied = await dispatchMcpTool(tool, input, context("VIEWER"), {});
    assert.equal(denied.isError, true, tool);
    assert.match(denied.content[0].text, /FORBIDDEN/, tool);
  }
});

test("dispatch response uses the catalog allowlist even if a reader returns internal fields", async () => {
  const response = await dispatchMcpTool("catalog.read", {}, context(), {
    "catalog.read": async () => ({ products: [{ id: "p1", sku: "SKU-1", name: "Panel", salePrice: "100000", purchaseCost: "50000", supplier: "Internal", marginPercent: 50 }] }),
  });
  assert.deepEqual(JSON.parse(response.content[0].text), { products: [{ id: "p1", sku: "SKU-1", name: "Panel", salePrice: "100000" }] });
});

test("dispatch maps unknown tools and reader failures to safe errors", async () => {
  const unknown = await dispatchMcpTool("unknown.tool", {}, context(), {});
  assert.match(unknown.content[0].text, /NOT_FOUND/);
  const failed = await dispatchMcpTool("company.read", {}, context(), { "company.read": async () => { throw new Error("sensitive database detail"); } });
  assert.match(failed.content[0].text, /READ_FAILED/);
  assert.doesNotMatch(failed.content[0].text, /sensitive database detail/);
});
