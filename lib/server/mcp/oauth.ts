import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { AdminRole } from "@prisma/client";
import { db } from "@/lib/server/db";
import { getAuthenticatedAdmin } from "@/lib/server/auth";
import { isDemoOrganizationSlug } from "@/lib/server/demo-data";
import { isSandboxOrg } from "@/lib/server/demo-sandbox";
import { mcpAccessTokenUsable, mcpAudienceMatches, mcpScopesForRole, verifyMcpPkce, type McpOAuthClient, type McpOAuthConfig } from "@/lib/mcp-oauth";
import type { AdminContext } from "@/lib/server/tenancy";

export const MCP_OAUTH_CODE_TTL_MS = 5 * 60_000;
export const MCP_OAUTH_CONSENT_TTL_MS = 10 * 60_000;
export const MCP_OAUTH_ACCESS_TTL_SECONDS = 600;

export type McpAuthorizeRequest = {
  client: McpOAuthClient;
  redirectUri: string;
  state: string;
  resource: string;
  scopes: string[];
  codeChallenge: string;
};

export function digestOAuthValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function newOAuthValue(prefix: "mcp_code_" | "mcp_at_" | "mcp_csrf_"): string {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function parseMcpAuthorizeRequest(url: URL, config: McpOAuthConfig): { ok: true; value: McpAuthorizeRequest } | { ok: false; error: string; client?: McpOAuthClient; redirectUri?: string; state?: string } {
  const client = config.clients.find((item) => item.clientId === url.searchParams.get("client_id"));
  const redirectUri = url.searchParams.get("redirect_uri") ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!client) return { ok: false, error: "invalid_client" };
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, error: "invalid_request" };
  const safeState = /^[A-Za-z0-9._~-]{16,512}$/.test(state) ? state : "";
  const responseType = url.searchParams.get("response_type");
  const resource = url.searchParams.get("resource") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method");
  const rawScopes = url.searchParams.get("scope")?.trim() ?? "";
  const scopes = rawScopes ? rawScopes.split(/\s+/) : [];
  if (!scopes.includes("mcp:connect")) scopes.unshift("mcp:connect");
  if (!safeState || responseType !== "code" || codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) || !mcpAudienceMatches(resource, config.resource)) {
    return { ok: false, error: "invalid_request", client, redirectUri, ...(safeState ? { state: safeState } : {}) };
  }
  if (new Set(scopes).size !== scopes.length || scopes.some((scope) => !client.scopes.includes(scope))) {
    return { ok: false, error: "invalid_scope", client, redirectUri, state: safeState };
  }
  return { ok: true, value: { client, redirectUri, state: safeState, resource, scopes, codeChallenge } };
}

export function makeOAuthRedirect(redirectUri: string, params: Record<string, string>): string {
  const target = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return target.toString();
}

export function oauthJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}

export function oauthError(error: string, status: number): Response {
  return oauthJson({ error }, status);
}

export function escapeOAuthHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export async function currentMcpBrowserIdentity(): Promise<{
  userId: string; userName: string; userEmail: string; organizationId: string; organizationName: string; organizationSlug: string; role: AdminRole;
} | null> {
  const authenticated = await getAuthenticatedAdmin();
  if (!authenticated || authenticated.session.lockedAt) return null;
  const base = { adminUserId: authenticated.user.id, active: true, organization: { active: true } } as const;
  const current = authenticated.session.activeOrganizationId
    ? await db.adminMembership.findFirst({ where: { ...base, organizationId: authenticated.session.activeOrganizationId }, include: { organization: { select: { id: true, name: true, slug: true, isDemo: true, demoParentId: true } } } })
    : null;
  // Consent is for the organization explicitly active in the web session. Do
  // not silently fall back to another tenant if that binding is missing/stale.
  const membership = current;
  if (!membership || (membership.organization.isDemo && membership.organization.demoParentId) || (await isSandboxOrg(membership.organization.id))) return null;
  return { userId: authenticated.user.id, userName: authenticated.user.name, userEmail: authenticated.user.email, organizationId: membership.organization.id, organizationName: membership.organization.name, organizationSlug: membership.organization.slug, role: membership.role };
}

export async function resolveMcpOAuthAccessToken(rawToken: string, config: McpOAuthConfig): Promise<{ ok: true; context: AdminContext } | { ok: false }> {
  if (!rawToken.startsWith("mcp_at_") || rawToken.length > 128) return { ok: false };
  const now = new Date();
  const token = await db.mcpOAuthAccessToken.findUnique({ where: { tokenHash: digestOAuthValue(rawToken) } });
  const client = token && config.clients.find((entry) => entry.clientId === token.clientId);
  if (!token || !client || !mcpAccessTokenUsable(token, { resource: config.resource, clientId: client.clientId }, now) || !mcpAudienceMatches(token.resource, config.resource)) return { ok: false };
  const membership = await db.adminMembership.findFirst({
    where: { adminUserId: token.userId, organizationId: token.organizationId, active: true, organization: { active: true }, user: { active: true } },
    include: { user: true, organization: { select: { id: true, name: true, slug: true, planId: true, isDemo: true, demoParentId: true } } },
  });
  if (!membership) return { ok: false };
  const allowed = mcpScopesForRole(membership.role);
  if (token.scopes.some((scope) => !allowed.includes(scope))) return { ok: false };
  const sandbox = Boolean(membership.organization.isDemo && membership.organization.demoParentId);
  if (sandbox) return { ok: false };
  const demo = isDemoOrganizationSlug(membership.organization.slug);
  return {
    ok: true,
    context: {
      user: { id: membership.user.id, name: membership.user.name, email: membership.user.email, role: membership.role },
      session: { id: `mcp-oauth:${token.id}`, userId: token.userId, activeOrganizationId: token.organizationId, expiresAt: token.expiresAt, revokedAt: token.revokedAt, lockedAt: null, lockAttempts: 0, lockReason: null, createdAt: token.createdAt },
      organization: { id: membership.organization.id, name: membership.organization.name, slug: membership.organization.slug, planId: membership.organization.planId },
      role: membership.role,
      organizationId: token.organizationId,
      demo,
      sandbox: false,
      mcpScopes: token.scopes,
    },
  };
}

export async function createMcpAccessToken(input: {
  authorizationId: string;
  code: string;
  verifier: string;
  clientId: string;
  redirectUri: string;
  resource: string;
}, config: McpOAuthConfig, now = new Date()): Promise<{ access_token: string; token_type: "Bearer"; expires_in: number; scope: string } | null> {
  const authorization = await db.mcpOAuthAuthorization.findFirst({
    where: { id: input.authorizationId, codeHash: digestOAuthValue(input.code), codeExpiresAt: { gt: now }, consumedAt: null },
  });
  if (!authorization || authorization.clientId !== input.clientId || authorization.redirectUri !== input.redirectUri || authorization.resource !== input.resource || !mcpAudienceMatches(input.resource, config.resource)) return null;
  if (!verifyMcpPkce(input.verifier, authorization.codeChallengeMethod, authorization.codeChallenge)) return null;
  const client = config.clients.find((item) => item.clientId === input.clientId);
  if (!client) return null;
  const membership = await db.adminMembership.findFirst({
    where: { adminUserId: authorization.userId, organizationId: authorization.organizationId, active: true, organization: { active: true }, user: { active: true } },
  });
  if (!membership || authorization.approvedScopes.some((scope) => !mcpScopesForRole(membership.role).includes(scope)) || authorization.approvedScopes.some((scope) => !client.scopes.includes(scope))) return null;
  const rawToken = newOAuthValue("mcp_at_");
  const accessToken = { id: randomUUID(), tokenHash: digestOAuthValue(rawToken), clientId: input.clientId, resource: input.resource, scopes: authorization.approvedScopes, userId: authorization.userId, organizationId: authorization.organizationId, expiresAt: new Date(now.getTime() + MCP_OAUTH_ACCESS_TTL_SECONDS * 1000) };
  try {
    await db.$transaction(async (tx) => {
      const consumed = await tx.mcpOAuthAuthorization.updateMany({ where: { id: authorization.id, codeHash: digestOAuthValue(input.code), codeExpiresAt: { gt: now }, consumedAt: null }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw new Error("invalid_grant");
      await tx.mcpOAuthAccessToken.create({ data: accessToken });
    });
  } catch {
    return null;
  }
  return { access_token: rawToken, token_type: "Bearer", expires_in: MCP_OAUTH_ACCESS_TTL_SECONDS, scope: authorization.approvedScopes.join(" ") };
}

export async function revokeMcpAccessToken(rawToken: string, clientId: string, config: McpOAuthConfig): Promise<void> {
  if (!rawToken.startsWith("mcp_at_") || rawToken.length > 128 || !config.clients.some((client) => client.clientId === clientId)) return;
  await db.mcpOAuthAccessToken.updateMany({ where: { tokenHash: digestOAuthValue(rawToken), clientId, revokedAt: null }, data: { revokedAt: new Date() } });
}
