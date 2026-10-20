import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeMcpTool, getMcpTool, MCP_TOOL_CATALOG, McpAuthorizationError, parseMcpToolInput, type McpActorContext } from "../lib/server/mcp-catalog";
import type { AdminRole } from "@prisma/client";

const actor = (role: AdminRole, organizationId = "org_a"): McpActorContext => ({ role, organizationId, actorId: "user_a" });

test("catalog exposes tenant-safe read tools to all roles, including read-only VIEWER", () => {
  const reads = MCP_TOOL_CATALOG.filter((tool) => tool.access === "read");
  assert.deepEqual(reads.map((tool) => tool.name), ["company.read", "catalog.read", "inventory.read", "clients.read", "leads.read", "budgets.read", "events.read"]);
  for (const role of ["OWNER", "ADMIN", "FINANCE", "OPERATIONS", "VIEWER"] as const) {
    for (const tool of reads) assert.equal(authorizeMcpTool(actor(role), tool.name).name, tool.name);
  }
  const allFields = reads.flatMap((tool) => tool.outputFields).join(" ").toLowerCase();
  assert.doesNotMatch(allFields, /cost|margin|supplier|proveedor|bank/);
});

test("write permissions separate prices, quantities, company profile, photos and budget drafts", () => {
  const allowed: Record<string, readonly AdminRole[]> = {
    "prices.preview": ["OWNER", "ADMIN", "FINANCE"], "prices.confirm": ["OWNER", "ADMIN", "FINANCE"],
    "quantities.preview": ["OWNER", "ADMIN", "OPERATIONS"], "quantities.confirm": ["OWNER", "ADMIN", "OPERATIONS"],
    "company.preview": ["OWNER", "ADMIN"], "company.confirm": ["OWNER", "ADMIN"],
    "photos.preview": ["OWNER", "ADMIN", "OPERATIONS"], "photos.confirm": ["OWNER", "ADMIN", "OPERATIONS"],
    "budgets.preview": ["OWNER", "ADMIN", "FINANCE"], "budgets.confirm": ["OWNER", "ADMIN", "FINANCE"],
  };
  for (const [name, roles] of Object.entries(allowed)) {
    for (const role of ["OWNER", "ADMIN", "FINANCE", "OPERATIONS", "VIEWER"] as const) {
      if (roles.includes(role)) assert.equal(authorizeMcpTool(actor(role), name).name, name);
      else assert.throws(() => authorizeMcpTool(actor(role), name), McpAuthorizationError);
    }
  }
  for (const tool of MCP_TOOL_CATALOG.filter((item) => item.access !== "read")) {
    assert.throws(() => authorizeMcpTool(actor("VIEWER"), tool.name), McpAuthorizationError);
  }
});

test("input schemas reject caller-selected tenant scope and malformed confirmation", () => {
  assert.throws(() => parseMcpToolInput("catalog.read", { organizationId: "org_b", limit: 10 }));
  assert.throws(() => parseMcpToolInput("prices.preview", { organizationId: "org_b", productId: "p1", price: 200000, currency: "PYG" }));
  assert.throws(() => parseMcpToolInput("prices.confirm", { previewId: "preview_123456789", idempotencyKey: "too-short" }));
  assert.deepEqual(parseMcpToolInput("prices.confirm", { previewId: "preview_123456789", idempotencyKey: "idempotency_key_1234" }), { previewId: "preview_123456789", idempotencyKey: "idempotency_key_1234" });
});

test("budget and photo write schemas are bounded and previews do not accept hidden internals", () => {
  const budget = getMcpTool("budgets.preview");
  assert.ok(budget);
  assert.throws(() => parseMcpToolInput("budgets.preview", { title: "Presupuesto", lines: [{ description: "Pantalla", quantity: 1, unitPrice: 100000, purchaseCost: 30000 }] }));
  assert.throws(() => parseMcpToolInput("photos.preview", { resourceType: "product", resourceId: "p1", fileName: "x.svg", mimeType: "image/svg+xml", byteLength: 12, sha256: "a".repeat(64) }));
  assert.equal(getMcpTool("unlisted.tool"), undefined);
});
