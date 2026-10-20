import { NextResponse } from "next/server";
import { loadMcpOAuthConfig } from "@/lib/mcp-oauth";
import { db } from "@/lib/server/db";
import { rateLimit, rateLimitResponse, getClientIp } from "@/lib/server/rate-limit";
import { createMcpAccessToken, digestOAuthValue, oauthError, oauthJson } from "@/lib/server/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await rateLimit(`mcp-oauth-token:${getClientIp(request)}`, 30);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const config = loadMcpOAuthConfig();
  if (!config) return oauthError("server_error", 503);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return oauthError("invalid_request", 415);
  let form: URLSearchParams;
  try { form = new URLSearchParams(await request.text()); } catch { return oauthError("invalid_request", 400); }
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id") ?? "";
  const code = form.get("code") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const verifier = form.get("code_verifier") ?? "";
  const resource = form.get("resource") ?? "";
  const client = config.clients.find((entry) => entry.clientId === clientId);
  if (form.has("client_secret") || !client || grantType !== "authorization_code" || !client.redirectUris.includes(redirectUri) || code.length > 128 || !code.startsWith("mcp_code_") || verifier.length > 128 || !resource || resource !== config.resource) return oauthError("invalid_grant", 400);
  const authorization = await db.mcpOAuthAuthorization.findFirst({ where: { codeHash: digestOAuthValue(code), clientId, redirectUri, resource, consumedAt: null } });
  if (!authorization) return oauthError("invalid_grant", 400);
  const token = await createMcpAccessToken({ authorizationId: authorization.id, code, verifier, clientId, redirectUri, resource }, config);
  if (!token) return oauthError("invalid_grant", 400);
  return oauthJson(token);
}
