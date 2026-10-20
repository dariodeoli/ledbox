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
  "finance:read": "finance.write",
  "suppliers:write": "suppliers.write",
  "users:manage": "users.manage",
} as const satisfies Record<string, AdminCapability>;

export const MCP_READ_SCOPES = [
  "company:read", "catalog:read", "inventory:read", "clients:read",
  "leads:read", "budgets:read", "events:read",
] as const;

export const MCP_BASE_SCOPE = "mcp:connect";
export const MCP_SUPPORTED_SCOPES = [
  MCP_BASE_SCOPE,
  ...MCP_READ_SCOPES,
  ...Object.keys(MCP_SCOPE_CAPABILITIES),
] as const;

export type McpOAuthClient = { clientId: string; name: string; redirectUris: string[]; scopes: string[] };
export type McpOAuthConfig = { issuer: string; resource: string; clients: McpOAuthClient[] };

/** Public client registry from deployment config. No client secrets are accepted. */
export function loadMcpOAuthConfig(env: Partial<NodeJS.ProcessEnv> = process.env): McpOAuthConfig | null {
  if (env.MCP_OAUTH_ENABLED !== "true" || !env.MCP_OAUTH_ISSUER || !env.MCP_OAUTH_CLIENTS) return null;
  try {
    const issuerUrl = new URL(env.MCP_OAUTH_ISSUER);
    const adminUrl = new URL(env.NEXT_PUBLIC_ADMIN_URL || publicConfig.adminUrl);
    if (issuerUrl.protocol !== "https:" && !(issuerUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(issuerUrl.hostname))) return null;
    if (issuerUrl.username || issuerUrl.password || issuerUrl.search || issuerUrl.hash || issuerUrl.pathname !== "/") return null;
    if (issuerUrl.origin !== adminUrl.origin) return null;
    const rawClients: unknown = JSON.parse(env.MCP_OAUTH_CLIENTS);
    if (!Array.isArray(rawClients) || rawClients.length < 1 || rawClients.length > 100) return null;
    const clients: McpOAuthClient[] = [];
    const ids = new Set<string>();
    for (const raw of rawClients) {
      if (!raw || typeof raw !== "object") return null;
      const candidate = raw as Record<string, unknown>;
      const clientId = candidate.clientId;
      const name = candidate.name;
      const redirectUris = candidate.redirectUris;
      const scopes = candidate.scopes === undefined ? [...MCP_SUPPORTED_SCOPES] : candidate.scopes;
      if (typeof clientId !== "string" || !/^[A-Za-z0-9._:-]{3,128}$/.test(clientId) || ids.has(clientId)) return null;
      if (typeof name !== "string" || name.trim().length < 1 || name.length > 120) return null;
      if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 20 || !redirectUris.every(validRedirectUri)) return null;
      if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string" || !(MCP_SUPPORTED_SCOPES as readonly string[]).includes(scope))) return null;
      ids.add(clientId);
      clients.push({ clientId, name: name.trim(), redirectUris: [...new Set(redirectUris as string[])], scopes: [...new Set(scopes as string[])] });
    }
    return { issuer: issuerUrl.origin, resource: canonicalMcpResource(adminUrl.origin), clients };
  } catch {
    return null;
  }
}

function validRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  } catch {
    return false;
  }
}

/**
 * Scopes are an OAuth consent ceiling only. The effective membership role must
 * still be re-read server-side for each tool call; caller/prompt org IDs are
 * never an authority source.
 */
export function mcpScopesForRole(role: AdminRole): string[] {
  return [
    MCP_BASE_SCOPE,
    ...MCP_READ_SCOPES,
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
  authorization_servers?: string[];
};

/** RFC 9728 resource metadata groundwork; no authorization server is advertised yet. */
export function mcpProtectedResourceMetadata(adminUrl = publicConfig.adminUrl, config = loadMcpOAuthConfig()): McpProtectedResourceMetadata {
  return {
    resource: canonicalMcpResource(adminUrl),
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
    bearer_methods_supported: ["header"],
    ...(config ? { authorization_servers: [config.issuer] } : {}),
  };
}

export function mcpAuthorizationServerMetadata(config: McpOAuthConfig): Record<string, unknown> {
  return {
    issuer: config.issuer,
    authorization_endpoint: `${config.issuer}/oauth/authorize`,
    token_endpoint: `${config.issuer}/oauth/token`,
    revocation_endpoint: `${config.issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...MCP_SUPPORTED_SCOPES],
  };
}

const MCP_TOOL_SCOPES: Record<string, string> = {
  "company.read": "company:read", "catalog.read": "catalog:read", "inventory.read": "inventory:read",
  "clients.read": "clients:read", "leads.read": "leads:read", "budgets.read": "budgets:read", "events.read": "events:read",
  "treasury.read": "finance:read", "payments.read": "finance:read", "reports.read": "finance:read",
  "clients.write": "clients:write", "events.write": "events:write",
  "finance.write": "finance:write",
  "prices.write": "inventory:write", "quantities.write": "inventory:write", "company.write": "organization:write",
  "photos.write": "inventory:write", "budgets.write": "budgets:write",
};

export function mcpScopeForToolCapability(capability: string): string | null {
  return MCP_TOOL_SCOPES[capability] ?? null;
}

export function mcpAccessTokenUsable(token: { expiresAt: Date; revokedAt: Date | null; resource: string; clientId: string }, expected: { resource: string; clientId: string }, now = new Date()): boolean {
  return token.revokedAt === null && token.expiresAt.getTime() > now.getTime() && token.resource === expected.resource && token.clientId === expected.clientId;
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
