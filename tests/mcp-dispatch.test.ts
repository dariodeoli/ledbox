import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminContext } from "../lib/server/tenancy";
import { dispatchMcpTool } from "../lib/server/mcp/dispatch";
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
  });
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /PREVIEW_EXPIRED/);
});

test("unsupported mutation families stay explicitly blocked", async () => {
  const cases: Array<[string, unknown]> = [
    ["company.preview", { name: "New name" }],
    ["photos.preview", { resourceType: "company", resourceId: "org-1", fileName: "logo.webp", mimeType: "image/webp", byteLength: 512, sha256: "a".repeat(64) }],
    ["budgets.preview", { title: "Draft", lines: [{ description: "Item", quantity: 1, unitPrice: 1000 }] }],
  ];
  for (const [tool, input] of cases) {
    const result = await dispatchMcpTool(tool, input, context(), {});
    assert.match(result.content[0].text, /PREVIEW_NOT_IMPLEMENTED/, tool);
  }
});

test("role matrix is rechecked for every confirm tool", async () => {
  const inputs: Record<string, unknown> = {
    "prices.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "quantities.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "company.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "photos.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
    "budgets.confirm": { previewId: "preview-id-123456", idempotencyKey: "stable-key-1234567" },
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
