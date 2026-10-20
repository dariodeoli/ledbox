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

test("mutation confirmation is explicit and never pretends to write", async () => {
  const response = await dispatchMcpTool("prices.confirm", { previewId: "1234567890123456", idempotencyKey: "abcdefghijklmnop" }, context(), {});
  assert.equal(response.isError, true);
  assert.match(response.content[0].text, /NOT_IMPLEMENTED/);
  assert.match(response.content[0].text, /no change was made/);
});

test("dispatch maps unknown tools and reader failures to safe errors", async () => {
  const unknown = await dispatchMcpTool("unknown.tool", {}, context(), {});
  assert.match(unknown.content[0].text, /NOT_FOUND/);
  const failed = await dispatchMcpTool("company.read", {}, context(), { "company.read": async () => { throw new Error("sensitive database detail"); } });
  assert.match(failed.content[0].text, /READ_FAILED/);
  assert.doesNotMatch(failed.content[0].text, /sensitive database detail/);
});
