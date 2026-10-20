import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { GET as health } from "../app/mcp/health/route";
import { handleMcpHttpRequest, resetMcpSessionsForTests } from "../lib/server/mcp/http";
import type { McpAuthProvider } from "../lib/server/mcp/auth";

const authenticated: McpAuthProvider = async () => ({ ok: true, context: {
  organizationId: "org-1", role: "OWNER", user: { id: "actor-1" }, session: { id: "session-1" },
} as never });

function rpcRequest(body: unknown, sessionId?: string) {
  return new Request("https://example.test/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId, "mcp-protocol-version": "2025-03-26" } : {}),
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => resetMcpSessionsForTests());

test("la sonda MCP informa estado sin datos de empresa", async () => {
  const response = health();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.service, "eventos-mcp");
  assert.equal(body.protocol, "streamable-http");
  assert.equal(body.oauthConfigured, false);
  assert.equal(body.toolsEnabled, 7);
  assert.equal("organization" in body, false);
});

test("el endpoint completa initialize y ping sobre Streamable HTTP", async () => {
  const initialize = await handleMcpHttpRequest(rpcRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test-client", version: "1" } },
  }), { authenticate: authenticated });

  assert.equal(initialize.status, 200);
  const sessionId = initialize.headers.get("mcp-session-id");
  assert.ok(sessionId);
  assert.match(await initialize.text(), /eventos-mcp/);

  const ping = await handleMcpHttpRequest(rpcRequest({ jsonrpc: "2.0", id: 2, method: "ping", params: {} }, sessionId), { authenticate: authenticated });
  assert.equal(ping.status, 200);
  assert.match(await ping.text(), /"result":\{\}/);

  const unauthorized: McpAuthProvider = async () => ({ ok: false, response: new Response("Unauthorized", { status: 401 }) });
  const deniedAfterHandshake = await handleMcpHttpRequest(rpcRequest({ jsonrpc: "2.0", id: 3, method: "ping", params: {} }, sessionId), { authenticate: unauthorized });
  assert.equal(deniedAfterHandshake.status, 401);
});

test("cada request protege MCP con auth y una sesión no autoriza por sí sola", async () => {
  const unauthorized: McpAuthProvider = async () => ({ ok: false, response: new Response("Unauthorized", { status: 401 }) });
  const denied = await handleMcpHttpRequest(rpcRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), { authenticate: unauthorized });
  assert.equal(denied.status, 401);

  const missingSession = await handleMcpHttpRequest(rpcRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, "unknown"), { authenticate: authenticated });
  assert.equal(missingSession.status, 404);
});
