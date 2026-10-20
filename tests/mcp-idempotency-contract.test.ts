import assert from "node:assert/strict";
import { test } from "node:test";
import { requestHashOf, readIdempotencyKey } from "../lib/server/idempotency";
import { parseMcpToolInput } from "../lib/server/mcp-catalog";

test("MCP confirm requires a caller-provided idempotency key and preview reference", () => {
  const confirm = { previewId: "preview-reference-1234", idempotencyKey: "retry-safe-key-123456" };
  for (const tool of ["prices.confirm", "quantities.confirm", "company.confirm", "photos.confirm", "budgets.confirm"]) {
    assert.deepEqual(parseMcpToolInput(tool, confirm), confirm, tool);
    assert.throws(() => parseMcpToolInput(tool, { previewId: confirm.previewId }), tool);
    assert.throws(() => parseMcpToolInput(tool, { ...confirm, organizationId: "other-tenant" }), tool);
  }
});

test("idempotency request fingerprint ignores only the retry key and remains payload-sensitive", () => {
  const a = requestHashOf({ previewId: "preview-a", idempotencyKey: "retry-key-a", amount: 120000 });
  const sameOperation = requestHashOf({ amount: 120000, idempotencyKey: "retry-key-b", previewId: "preview-a" });
  const changedOperation = requestHashOf({ previewId: "preview-a", idempotencyKey: "retry-key-a", amount: 125000 });
  assert.equal(a, sameOperation, "retries with reordered data and a fresh transport key describe the same operation");
  assert.notEqual(a, changedOperation, "the same key must not authorize a different payload");
  assert.equal(readIdempotencyKey(new Request("https://mcp.test", { headers: { "Idempotency-Key": " retry-key-123456 " } }), {}), "retry-key-123456");
  assert.equal(readIdempotencyKey(new Request("https://mcp.test"), {}), null);
});
