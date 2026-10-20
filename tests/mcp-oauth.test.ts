import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_BASE_SCOPE,
  MCP_SUPPORTED_SCOPES,
  canonicalMcpResource,
  mcpAudienceMatches,
  mcpProtectedResourceMetadata,
  mcpScopesForRole,
  pkceS256Challenge,
  verifyMcpPkce,
} from "@/lib/mcp-oauth";

test("resource URI is canonical and rejects unsafe origins", () => {
  assert.equal(canonicalMcpResource("https://app.eventoss.online/"), "https://app.eventoss.online/mcp");
  assert.equal(canonicalMcpResource("http://localhost:3000"), "http://localhost:3000/mcp");
  assert.throws(() => canonicalMcpResource("http://app.eventoss.online"), /HTTPS/);
  assert.throws(() => canonicalMcpResource("https://user:pass@app.eventoss.online"), /credentials/);
  assert.throws(() => canonicalMcpResource("https://app.eventoss.online/?host=evil"), /credentials/);
});

test("protected-resource metadata advertises the configured resource, supported scopes, and header bearer only", () => {
  assert.deepEqual(mcpProtectedResourceMetadata("https://app.eventoss.online"), {
    resource: "https://app.eventoss.online/mcp",
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
  });
  // No Google IdP or placeholder authorization server: EventOS has no AS/token exchange yet.
});

test("MCP scopes are capped by the existing server role matrix", () => {
  assert.deepEqual(mcpScopesForRole("VIEWER"), [MCP_BASE_SCOPE]);
  assert.deepEqual(mcpScopesForRole("OPERATIONS"), [
    MCP_BASE_SCOPE,
    "clients:write", "events:write", "inventory:write", "inventory:costs:read", "promoters:write",
  ]);
  assert.deepEqual(mcpScopesForRole("FINANCE"), [
    MCP_BASE_SCOPE,
    "inventory:costs:read", "budgets:write", "finance:write", "suppliers:write",
  ]);
  assert.ok(mcpScopesForRole("OWNER").includes("users:manage"));
  assert.ok(!MCP_SUPPORTED_SCOPES.some((scope) => /api.?keys|trash|profile/i.test(scope)));
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
