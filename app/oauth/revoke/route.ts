import { loadMcpOAuthConfig } from "@/lib/mcp-oauth";
import { rateLimit, rateLimitResponse, getClientIp } from "@/lib/server/rate-limit";
import { oauthError, oauthJson, revokeMcpAccessToken } from "@/lib/server/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await rateLimit(`mcp-oauth-revoke:${getClientIp(request)}`, 30);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const config = loadMcpOAuthConfig();
  if (!config) return oauthError("server_error", 503);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return oauthError("invalid_request", 415);
  let form: URLSearchParams;
  try { form = new URLSearchParams(await request.text()); } catch { return oauthError("invalid_request", 400); }
  const token = form.get("token") ?? "";
  const clientId = form.get("client_id") ?? "";
  const typeHint = form.get("token_type_hint");
  if (!config.clients.some((entry) => entry.clientId === clientId) || (typeHint && typeHint !== "access_token") || token.length > 128) return oauthError("invalid_client", 401);
  await revokeMcpAccessToken(token, clientId, config);
  // RFC 7009 returns success even when a token is unknown or already revoked.
  return oauthJson({});
}
