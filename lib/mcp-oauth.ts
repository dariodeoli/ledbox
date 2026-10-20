import { createHash, timingSafeEqual } from "node:crypto";
import type { AdminRole } from "@prisma/client";
import { publicConfig } from "@/lib/public-config";
import { roleCan, type AdminCapability } from "@/lib/server/permissions";

/** Minimal MCP grants derived from the server's single role/capability matrix. */
const MCP_SCOPE_CAPABILITIES = {
  "organization:write": "org.manage",
  "clients:write": "clients.write",
  "events:write": "events.write",
  "inventory:write": "inventory.write",
  "inventory:costs:read": "inventory.costs",
  "promoters:write": "promoters.write",
  "budgets:write": "budgets.write",
  "finance:write": "finance.write",
  "suppliers:write": "suppliers.write",
  "users:manage": "users.manage",
} as const satisfies Record<string, AdminCapability>;

export const MCP_BASE_SCOPE = "mcp:connect";
export const MCP_SUPPORTED_SCOPES = [
  MCP_BASE_SCOPE,
  ...Object.keys(MCP_SCOPE_CAPABILITIES),
] as const;

/**
 * Scopes are an OAuth consent ceiling only. The effective membership role must
 * still be re-read server-side for each tool call; caller/prompt org IDs are
 * never an authority source.
 */
export function mcpScopesForRole(role: AdminRole): string[] {
  return [
    MCP_BASE_SCOPE,
    ...Object.entries(MCP_SCOPE_CAPABILITIES)
      .filter(([, capability]) => roleCan(role, capability))
      .map(([scope]) => scope),
  ];
}

export function canonicalMcpResource(adminUrl = publicConfig.adminUrl): string {
  const admin = new URL(adminUrl);
  if (admin.protocol !== "https:" && !(admin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(admin.hostname))) {
    throw new Error("MCP admin origin must use HTTPS (except localhost development)");
  }
  if (admin.username || admin.password || admin.search || admin.hash) throw new Error("MCP admin origin must not contain credentials, query, or fragment");
  return new URL("/mcp", admin.origin).toString();
}

export type McpProtectedResourceMetadata = {
  resource: string;
  scopes_supported: string[];
  bearer_methods_supported: ["header"];
};

/** RFC 9728 resource metadata groundwork; no authorization server is advertised yet. */
export function mcpProtectedResourceMetadata(adminUrl = publicConfig.adminUrl): McpProtectedResourceMetadata {
  return {
    resource: canonicalMcpResource(adminUrl),
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

function validVerifier(verifier: string): boolean {
  return verifier.length >= 43 && verifier.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(verifier);
}

/** RFC 7636 S256 only; plain PKCE and malformed verifier/challenge fail closed. */
export function pkceS256Challenge(verifier: string): string | null {
  if (!validVerifier(verifier)) return null;
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyMcpPkce(verifier: string, method: string, expectedChallenge: string): boolean {
  if (method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(expectedChallenge)) return false;
  const actual = pkceS256Challenge(verifier);
  if (!actual) return false;
  const actualBytes = Buffer.from(actual, "ascii");
  const expectedBytes = Buffer.from(expectedChallenge, "ascii");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Resource indicator / audience binding uses exact canonical URI equality. */
export function mcpAudienceMatches(audience: string | string[] | undefined, expectedResource: string): boolean {
  const values = Array.isArray(audience) ? audience : audience ? [audience] : [];
  return values.includes(expectedResource);
}
