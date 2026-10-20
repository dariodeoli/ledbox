import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_BASE_SCOPE,
  MCP_SUPPORTED_SCOPES,
  canonicalMcpResource,
  mcpAudienceMatches,
  mcpProtectedResourceMetadata,
  mcpScopesForRole,
  mcpAuthorizationServerMetadata,
  mcpAccessTokenUsable,
  loadMcpOAuthConfig,
  pkceS256Challenge,
  verifyMcpPkce,
  mcpScopeForToolCapability,
} from "@/lib/mcp-oauth";
import { parseMcpAuthorizeRequest } from "@/lib/server/mcp/oauth";
import { safeLocalReturnTo } from "@/lib/local-return-to";
import { GET as authorizationServerMetadata } from "../app/.well-known/oauth-authorization-server/route";
import { GET as protectedResourceMetadata } from "../app/.well-known/oauth-protected-resource/mcp/route";

test("resource URI is canonical and rejects unsafe origins", () => {
  assert.equal(canonicalMcpResource("https://app.eventoss.online/"), "https://app.eventoss.online/mcp");
  assert.equal(canonicalMcpResource("http://localhost:3000"), "http://localhost:3000/mcp");
  assert.throws(() => canonicalMcpResource("http://app.eventoss.online"), /HTTPS/);
  assert.throws(() => canonicalMcpResource("https://user:pass@app.eventoss.online"), /credentials/);
  assert.throws(() => canonicalMcpResource("https://app.eventoss.online/?host=evil"), /credentials/);
});

test("protected-resource metadata advertises the configured resource and only a configured AS", () => {
  const config = { issuer: "https://app.eventoss.online", resource: "https://app.eventoss.online/mcp", clients: [] };
  assert.deepEqual(mcpProtectedResourceMetadata("https://app.eventoss.online"), {
    resource: "https://app.eventoss.online/mcp",
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
  });
  assert.deepEqual(mcpProtectedResourceMetadata("https://app.eventoss.online", config).authorization_servers, [config.issuer]);
  assert.deepEqual(mcpAuthorizationServerMetadata(config).code_challenge_methods_supported, ["S256"]);
});

test("well-known discovery is fail-closed unless the AS is explicitly configured", async () => {
  const prior = { enabled: process.env.MCP_OAUTH_ENABLED, issuer: process.env.MCP_OAUTH_ISSUER, clients: process.env.MCP_OAUTH_CLIENTS };
  try {
    delete process.env.MCP_OAUTH_ENABLED;
    delete process.env.MCP_OAUTH_ISSUER;
    delete process.env.MCP_OAUTH_CLIENTS;
    assert.equal(authorizationServerMetadata().status, 503);
    assert.deepEqual((await protectedResourceMetadata().json()).authorization_servers, undefined);
    process.env.MCP_OAUTH_ENABLED = "true";
    process.env.MCP_OAUTH_ISSUER = "https://app.ledbox.online";
    process.env.MCP_OAUTH_CLIENTS = JSON.stringify([{ clientId: "qa-client", name: "QA client", redirectUris: ["https://qa.example/callback"] }]);
    const response = authorizationServerMetadata();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).code_challenge_methods_supported, ["S256"]);
    assert.deepEqual((await protectedResourceMetadata().json()).authorization_servers, ["https://app.ledbox.online"]);
  } finally {
    for (const [name, value] of Object.entries({ MCP_OAUTH_ENABLED: prior.enabled, MCP_OAUTH_ISSUER: prior.issuer, MCP_OAUTH_CLIENTS: prior.clients })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("MCP scopes are capped by the existing server role matrix", () => {
  assert.deepEqual(mcpScopesForRole("VIEWER"), [MCP_BASE_SCOPE, "company:read", "catalog:read", "inventory:read", "clients:read", "leads:read", "budgets:read", "events:read"]);
  assert.deepEqual(mcpScopesForRole("OPERATIONS"), [
    MCP_BASE_SCOPE,
    "company:read", "catalog:read", "inventory:read", "clients:read", "leads:read", "budgets:read", "events:read",
    "clients:write", "events:write", "inventory:write", "inventory:costs:read", "promoters:write",
  ]);
  assert.deepEqual(mcpScopesForRole("FINANCE"), [
    MCP_BASE_SCOPE,
    "company:read", "catalog:read", "inventory:read", "clients:read", "leads:read", "budgets:read", "events:read",
    "inventory:costs:read", "budgets:write", "finance:write", "finance:read", "suppliers:write",
  ]);
  assert.ok(mcpScopesForRole("OWNER").includes("users:manage"));
  assert.equal(mcpScopeForToolCapability("inventory.read"), "inventory:read");
  assert.equal(mcpScopeForToolCapability("budgets.write"), "budgets:write");
  assert.ok(!MCP_SUPPORTED_SCOPES.some((scope) => /api.?keys|trash|profile/i.test(scope)));
});

test("authorization request requires exact redirect URI, resource, state and S256 PKCE", () => {
  const config = { issuer: "https://app.eventoss.online", resource: "https://app.eventoss.online/mcp", clients: [{ clientId: "test-client", name: "Test", redirectUris: ["https://client.example/callback"], scopes: [...MCP_SUPPORTED_SCOPES] }] };
  const valid = new URL("https://app.eventoss.online/oauth/authorize?response_type=code&client_id=test-client&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback&state=state_value_0123456789&resource=https%3A%2F%2Fapp.eventoss.online%2Fmcp&scope=mcp%3Aconnect%20catalog%3Aread&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256");
  assert.equal(parseMcpAuthorizeRequest(valid, config).ok, true);
  const openRedirect = new URL(valid); openRedirect.searchParams.set("redirect_uri", "https://evil.example/callback");
  assert.equal(parseMcpAuthorizeRequest(openRedirect, config).ok, false);
  const noPkce = new URL(valid); noPkce.searchParams.set("code_challenge_method", "plain");
  assert.equal(parseMcpAuthorizeRequest(noPkce, config).ok, false);
  const wrongResource = new URL(valid); wrongResource.searchParams.set("resource", "https://other.example/mcp");
  assert.equal(parseMcpAuthorizeRequest(wrongResource, config).ok, false);
});

test("login return target cannot escape the current origin", () => {
  assert.equal(safeLocalReturnTo("/oauth/authorize?state=a"), "/oauth/authorize?state=a");
  assert.equal(safeLocalReturnTo("//evil.example/path"), null);
  assert.equal(safeLocalReturnTo("/\\evil.example"), null);
  assert.equal(safeLocalReturnTo("https://evil.example"), null);
});

test("resource audience matching is exact", () => {
  const resource = "https://app.eventoss.online/mcp";
  assert.equal(mcpAudienceMatches(resource, resource), true);
  assert.equal(mcpAudienceMatches(["https://other.example/mcp", resource], resource), true);
  assert.equal(mcpAudienceMatches("https://app.eventoss.online.evil/mcp", resource), false);
  assert.equal(mcpAudienceMatches(undefined, resource), false);
});

test("PKCE implements RFC 7636 S256 only", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  assert.equal(pkceS256Challenge(verifier), challenge);
  assert.equal(verifyMcpPkce(verifier, "S256", challenge), true);
  assert.equal(verifyMcpPkce(verifier, "plain", verifier), false);
  assert.equal(pkceS256Challenge("short"), null);
  assert.equal(verifyMcpPkce(verifier, "S256", "malformed"), false);
});

test("opaque access token expires on its boundary and revocation takes effect immediately", () => {
  const now = new Date("2026-10-20T12:00:00.000Z");
  const active = { expiresAt: new Date(now.getTime() + 1), revokedAt: null, resource: "https://app.eventoss.online/mcp", clientId: "client-a" };
  const expected = { resource: active.resource, clientId: active.clientId };
  assert.equal(mcpAccessTokenUsable(active, expected, now), true);
  assert.equal(mcpAccessTokenUsable(active, expected, new Date(now.getTime() + 1)), false);
  assert.equal(mcpAccessTokenUsable({ ...active, revokedAt: now }, expected, now), false);
  assert.equal(mcpAccessTokenUsable(active, { ...expected, resource: "https://other.example/mcp" }, now), false);
  assert.equal(mcpAccessTokenUsable(active, { ...expected, clientId: "other-client" }, now), false);
});

test("OAuth configuration fails closed when disabled, incomplete, or not on the app origin", () => {
  assert.equal(loadMcpOAuthConfig({}), null);
  const clients = JSON.stringify([{ clientId: "test-client", name: "Test MCP client", redirectUris: ["https://client.example/callback"] }]);
  assert.equal(loadMcpOAuthConfig({ MCP_OAUTH_ENABLED: "true", MCP_OAUTH_ISSUER: "https://app.eventoss.online", NEXT_PUBLIC_ADMIN_URL: "https://app.eventoss.online", MCP_OAUTH_CLIENTS: clients })?.clients[0]?.clientId, "test-client");
  assert.equal(loadMcpOAuthConfig({ MCP_OAUTH_ENABLED: "true", MCP_OAUTH_ISSUER: "https://evil.example", MCP_OAUTH_CLIENTS: clients }), null);
  assert.equal(loadMcpOAuthConfig({ MCP_OAUTH_ENABLED: "true", MCP_OAUTH_ISSUER: "https://app.eventoss.online", MCP_OAUTH_CLIENTS: "not-json" }), null);
});
