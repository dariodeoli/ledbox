import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizeMcpTool, getMcpTool, MCP_TOOL_CATALOG, McpAuthorizationError, parseMcpToolInput, sanitizeMcpReadOutput, type McpActorContext } from "../lib/server/mcp-catalog";
import type { AdminRole } from "@prisma/client";

const actor = (role: AdminRole, organizationId = "org_a"): McpActorContext => ({ role, organizationId, actorId: "user_a" });

test("catalog exposes tenant-safe read tools to all roles, including read-only VIEWER", () => {
  const reads = MCP_TOOL_CATALOG.filter((tool) => tool.access === "read");
  assert.deepEqual(reads.map((tool) => tool.name), ["company.read", "catalog.read", "inventory.read", "clients.read", "leads.read", "budgets.read", "events.read", "treasury.read", "payments.read", "reports.read"]);
  for (const role of ["OWNER", "ADMIN", "FINANCE", "OPERATIONS", "VIEWER"] as const) {
    for (const tool of reads) {
      if (["treasury.read", "payments.read", "reports.read"].includes(tool.name)) {
        if (["OWNER", "ADMIN", "FINANCE"].includes(role)) assert.equal(authorizeMcpTool(actor(role), tool.name).name, tool.name);
        else assert.throws(() => authorizeMcpTool(actor(role), tool.name), McpAuthorizationError);
      } else assert.equal(authorizeMcpTool(actor(role), tool.name).name, tool.name);
    }
  }
  const allFields = reads.filter((tool) => !["treasury.read", "payments.read"].includes(tool.name)).flatMap((tool) => tool.outputFields).join(" ").toLowerCase();
  assert.doesNotMatch(allFields, /cost|margin|supplier|proveedor|bank/);
});

test("write permissions separate prices, quantities, company profile, photos and budget drafts", () => {
  const allowed: Record<string, readonly AdminRole[]> = {
    "prices.preview": ["OWNER", "ADMIN", "FINANCE"], "prices.confirm": ["OWNER", "ADMIN", "FINANCE"],
    "rental-prices.preview": ["OWNER", "ADMIN", "FINANCE"], "rental-prices.confirm": ["OWNER", "ADMIN", "FINANCE"],
    "quantities.preview": ["OWNER", "ADMIN", "OPERATIONS"], "quantities.confirm": ["OWNER", "ADMIN", "OPERATIONS"],
    "company.preview": ["OWNER", "ADMIN"], "company.confirm": ["OWNER", "ADMIN"],
    "photos.preview": ["OWNER", "ADMIN", "OPERATIONS"], "photos.confirm": ["OWNER", "ADMIN", "OPERATIONS"],
    "budgets.preview": ["OWNER", "ADMIN", "FINANCE"], "budgets.confirm": ["OWNER", "ADMIN", "FINANCE"],
    "budgets.edit.preview": ["OWNER", "ADMIN", "FINANCE"], "budgets.edit.confirm": ["OWNER", "ADMIN", "FINANCE"],
    "budgets.compare.preview": ["OWNER", "ADMIN", "FINANCE"], "budgets.compare.confirm": ["OWNER", "ADMIN", "FINANCE"],
    "clients.preview": ["OWNER", "ADMIN", "OPERATIONS"], "clients.confirm": ["OWNER", "ADMIN", "OPERATIONS"],
    "leads.preview": ["OWNER", "ADMIN", "OPERATIONS"], "leads.confirm": ["OWNER", "ADMIN", "OPERATIONS"],
    "events.preview": ["OWNER", "ADMIN", "OPERATIONS"], "events.confirm": ["OWNER", "ADMIN", "OPERATIONS"],
    "treasury.preview": ["OWNER", "ADMIN", "FINANCE"], "treasury.confirm": ["OWNER", "ADMIN", "FINANCE"],
    "payments.preview": ["OWNER", "ADMIN", "FINANCE"], "payments.confirm": ["OWNER", "ADMIN", "FINANCE"],
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

test("budget edit and comparison schemas accept only bounded payment terms and alternatives", () => {
  const edit = { budgetId: "budget-1", paymentTerms: "50% al aprobar", installmentsJson: [{ label: "Seña", type: "percent", value: 50, moment: "Al aprobar", accountId: "account-1" }] };
  assert.deepEqual(parseMcpToolInput("budgets.edit.preview", edit), edit);
  assert.throws(() => parseMcpToolInput("budgets.edit.preview", { ...edit, organizationId: "other" }));
  assert.throws(() => parseMcpToolInput("budgets.edit.preview", { budgetId: "budget-1", installmentsJson: [{ label: "X", accountId: "other", internalCost: 2000 }] }));
  const comparison = { title: "Opciones", expiresAt: "2026-11-01T12:00:00.000Z", alternatives: [{ budgetId: "b1", label: "A" }, { budgetId: "b2", label: "B" }] };
  assert.deepEqual(parseMcpToolInput("budgets.compare.preview", comparison), comparison);
  assert.throws(() => parseMcpToolInput("budgets.compare.preview", { ...comparison, alternatives: [{ budgetId: "b1", label: "A" }] }));
});

test("treasury and payment previews are strict and require tenant resource IDs", () => {
  const create = { name: "Cuenta principal", type: "BANK", bank: "Banco de prueba", number: "001234", alias: "empresa.py", openingBalance: 0 };
  assert.deepEqual(parseMcpToolInput("treasury.preview", create), create);
  assert.throws(() => parseMcpToolInput("treasury.preview", { ...create, organizationId: "other" }));
  assert.throws(() => parseMcpToolInput("treasury.preview", { accountId: "account-1" }));
  const edit = { accountId: "account-1", active: false };
  assert.deepEqual(parseMcpToolInput("treasury.preview", edit), edit);
  const payment = { expectedPaymentId: "expected-1", amount: 250000, accountId: "account-1", method: "Transferencia" };
  assert.deepEqual(parseMcpToolInput("payments.preview", payment), payment);
  assert.throws(() => parseMcpToolInput("payments.preview", { ...payment, amount: 1.5 }));
  assert.throws(() => parseMcpToolInput("payments.preview", { ...payment, organizationId: "other" }));
  assert.throws(() => authorizeMcpTool({ ...actor("FINANCE"), scopes: ["mcp:connect", "finance:read"] }, "treasury.preview"), McpAuthorizationError);
  assert.equal(authorizeMcpTool({ ...actor("FINANCE"), scopes: ["mcp:connect", "finance:write"] }, "payments.confirm").name, "payments.confirm");
});

test("input schemas reject caller-selected tenant scope and malformed confirmation", () => {
  assert.throws(() => parseMcpToolInput("catalog.read", { organizationId: "org_b", limit: 10 }));
  assert.throws(() => parseMcpToolInput("prices.preview", { organizationId: "org_b", productId: "p1", price: 200000, currency: "PYG" }));
  assert.deepEqual(parseMcpToolInput("prices.preview", { productId: "p1", price: 200000 }), { productId: "p1", price: 200000, currency: "PYG", audience: "RETAIL", minimumUnits: 1 });
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

test("MCP record write schemas are strict and lead creation needs explicit consent evidence", () => {
  assert.deepEqual(parseMcpToolInput("clients.preview", { name: "Cliente", email: "c@example.com" }), { name: "Cliente", email: "c@example.com" });
  assert.throws(() => parseMcpToolInput("clients.preview", { name: "Cliente", organizationId: "other" }));
  assert.throws(() => parseMcpToolInput("clients.preview", { name: "" }));
  assert.throws(() => parseMcpToolInput("leads.preview", { name: "Lead", phone: "0981", email: "l@example.com" }));
  const lead = { name: "Lead", phone: "0981", email: "l@example.com", consentAt: "2026-10-20T12:00:00.000Z", consentChannel: "web-form", consentVersion: "v1" };
  assert.deepEqual(parseMcpToolInput("leads.preview", lead), lead);
  assert.throws(() => parseMcpToolInput("leads.preview", { id: "lead-123", status: "NEW", internalNotes: "private" }));
  assert.throws(() => parseMcpToolInput("leads.preview", { id: "lead-123", consentAt: lead.consentAt }));
  assert.throws(() => parseMcpToolInput("events.preview", { clientId: "client-1", name: "Event", startsAt: "2026-10-22T12:00:00.000Z", endsAt: "2026-10-21T12:00:00.000Z" }));
  assert.throws(() => parseMcpToolInput("events.preview", { clientId: "client-1", name: "Event", organizationId: "other" }));
});

test("photo preview requires bounded image bytes and a company logo variant", () => {
  const valid = { resourceType: "product", resourceId: "p1", fileName: "panel.webp", mimeType: "image/webp", byteLength: 1024 * 1024, sha256: "a".repeat(64), data: "A".repeat(1_400_000) };
  assert.equal((parseMcpToolInput("photos.preview", valid) as { byteLength: number }).byteLength, 1024 * 1024);
  assert.throws(() => parseMcpToolInput("photos.preview", { ...valid, byteLength: 1024 * 1024 + 1 }));
  assert.throws(() => parseMcpToolInput("photos.preview", { ...valid, mimeType: "image/svg+xml" }));
  assert.throws(() => parseMcpToolInput("photos.preview", { ...valid, sha256: "not-a-digest" }));
  assert.throws(() => parseMcpToolInput("photos.preview", { ...valid, fileName: "x.png", organizationId: "org_b" }));
  assert.throws(() => parseMcpToolInput("photos.preview", { ...valid, resourceType: "company" }));
  assert.doesNotThrow(() => parseMcpToolInput("photos.preview", { ...valid, resourceType: "company", variant: "dark" }));
});

test("read output allowlists remove internal cost, margin, supplier and bank fields recursively", () => {
  const safe = sanitizeMcpReadOutput("catalog.read", { products: [{ id: "p1", name: "Panel", salePrice: "100000", purchaseCost: "50000", marginPercent: 50, supplier: { name: "Hidden" }, variants: { name: "Familia", options: [{ label: "32 pulgadas", price: 100000, cost: 50000, supplierId: "s1" }] }, unexpectedInternal: true }] });
  assert.deepEqual(safe, { products: [{ id: "p1", name: "Panel", salePrice: "100000", variants: { name: "Familia", options: [{ label: "32 pulgadas", price: 100000 }] } }] });
  const budget = sanitizeMcpReadOutput("budgets.read", { budgets: [{ id: "b1", total: 900000, supplier: "Hidden", internalCost: 300000, lines: [{ name: "LED", quantity: 1, unitPrice: 900000, subtotal: 900000, purchaseCost: 500000 }] }] });
  assert.deepEqual(budget, { budgets: [{ id: "b1", total: 900000, lines: [{ name: "LED", quantity: 1, unitPrice: 900000, subtotal: 900000 }] }] });
});
