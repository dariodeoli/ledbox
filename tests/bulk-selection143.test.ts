import assert from "node:assert/strict";
import { test } from "node:test";
import { readBulkSelection, BulkSelectionError } from "../lib/server/bulk-selection";
process.env.AUTH_SECRET = "qa143-bulk-offline-only";
const context: any = { organizationId: "org", role: "OWNER", user: { id: "actor" } };
const request = (query = "") => new Request(`https://example.invalid/api/admin/clients?fields=bulk-selection${query}`);

test("bulk cursor freezes discovery and binds tenant/actor/type/filter; no arbitrary client where", async () => {
  const first = await readBulkSelection(request("&q=Ana"), context, "Client"); assert.ok(first);
  const rows = Array.from({ length: 201 }, (_, n) => ({ id: String(n).padStart(4, "0") }));
  const page = await first.finish(rows, 350); assert.equal(page.items.length, 200); assert.equal(page.meta.complete, false); assert.ok(page.meta.nextCursor);
  const next = await readBulkSelection(request(`&q=Ana&cursor=${encodeURIComponent(page.meta.nextCursor!)}`), context, "Client"); assert.ok(next);
  assert.equal(next.at.toISOString(), first.at.toISOString()); assert.equal(next.after, "0199"); assert.equal(next.total, 350); assert.deepEqual(next.where.id, { gt: "0199" });
  assert.equal(next.watermark.createdAt.lte.toISOString(), page.meta.snapshotAt);
  for (const [query, ctx, type] of [["&q=Otra", context, "Client"], ["&q=Ana", { ...context, organizationId: "foreign" }, "Client"], ["&q=Ana", { ...context, user: { id: "other" } }, "Client"], ["&q=Ana", context, "Supplier"]] as const) {
    await assert.rejects(readBulkSelection(request(`${query}&cursor=${encodeURIComponent(page.meta.nextCursor!)}`), ctx as never, type), error => error instanceof BulkSelectionError && error.status === 409);
  }
});

test("bulk selection requires entity write; FINANCE gains no trash.manage or inventory access", async () => {
  for (const type of ["Client", "Supplier", "Promoter", "Budget", "Event", "InventoryItem"] as const) await assert.rejects(readBulkSelection(request(), { ...context, role: "VIEWER" } as never, type), error => error instanceof BulkSelectionError && error.status === 403);
  await assert.rejects(readBulkSelection(request(), { ...context, role: "FINANCE" } as never, "InventoryItem"));
  assert.ok(await readBulkSelection(request(), { ...context, role: "FINANCE" } as never, "Budget"));
  assert.equal(await readBulkSelection(new Request("https://example.invalid/api/admin/clients"), context, "Client"), null);
});
