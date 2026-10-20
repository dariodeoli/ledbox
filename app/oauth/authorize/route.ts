import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { mcpScopesForRole, loadMcpOAuthConfig } from "@/lib/mcp-oauth";
import { rateLimit, rateLimitResponse, getClientIp } from "@/lib/server/rate-limit";
import { db } from "@/lib/server/db";
import { safeLocalReturnTo } from "@/lib/local-return-to";
import { currentMcpBrowserIdentity, digestOAuthValue, escapeOAuthHtml, makeOAuthRedirect, newOAuthValue, oauthError, parseMcpAuthorizeRequest } from "@/lib/server/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirect(url: string) {
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}

function authError(error: string, status: number, redirectUri?: string, state?: string) {
  if (redirectUri && state) return redirect(makeOAuthRedirect(redirectUri, { error, state }));
  return oauthError(error, status);
}

function consentPage(input: { id: string; csrf: string; clientName: string; organizationName: string; scopes: string[] }) {
  const scopes = input.scopes.map((scope) => `<label><input type="checkbox" name="scope" value="${escapeOAuthHtml(scope)}" checked> ${escapeOAuthHtml(scope)}</label>`).join("");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Autorizar MCP · EventOS</title><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;background:#f4f6f8;color:#17191c;margin:0;min-height:100vh;display:grid;place-items:center;padding:20px}main{background:white;border:1px solid #d8dde3;border-radius:16px;padding:24px;width:min(100%,520px);box-sizing:border-box}h1{font-size:1.4rem;margin:0 0 8px}p{color:#4d5965}fieldset{border:1px solid #d8dde3;border-radius:12px;padding:12px;display:grid;gap:10px;margin:20px 0}button{border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:650;cursor:pointer}.allow{background:#096a88;color:white}.deny{background:transparent;border:1px solid #aab2bb;color:inherit;margin-left:8px}label{display:flex;gap:8px;align-items:center}@media(prefers-color-scheme:dark){body{background:#111820;color:#eff4f7}main{background:#17212a;border-color:#33414d}fieldset{border-color:#33414d}}</style></head><body><main><h1>Conectar ${escapeOAuthHtml(input.clientName)}</h1><p>La aplicación solicita acceso a <strong>${escapeOAuthHtml(input.organizationName)}</strong>. Revisá los permisos antes de continuar.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="request_id" value="${escapeOAuthHtml(input.id)}"><input type="hidden" name="csrf_token" value="${escapeOAuthHtml(input.csrf)}"><fieldset><legend>Permisos solicitados</legend>${scopes}</fieldset><button class="allow" name="decision" value="allow">Autorizar</button><button class="deny" name="decision" value="deny">Denegar</button></form></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "Referrer-Policy": "no-referrer" } });
}

export async function GET(request: Request) {
  const limited = await rateLimit(`mcp-oauth-authorize:${getClientIp(request)}`, 30);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const config = loadMcpOAuthConfig();
  if (!config) return oauthError("server_error", 503);
  const parsed = parseMcpAuthorizeRequest(new URL(request.url), config);
  if (!parsed.ok) return authError(parsed.error, 400, parsed.redirectUri, parsed.state);
  const identity = await currentMcpBrowserIdentity();
  if (!identity) {
    const localNext = safeLocalReturnTo(`${new URL(request.url).pathname}${new URL(request.url).search}`);
    const login = new URL("/login", config.issuer);
    if (localNext) login.searchParams.set("next", localNext);
    return redirect(login.toString());
  }
  const roleScopes = mcpScopesForRole(identity.role);
  if (parsed.value.scopes.some((scope) => !roleScopes.includes(scope))) return authError("invalid_scope", 403, parsed.value.redirectUri, parsed.value.state);
  const csrf = newOAuthValue("mcp_csrf_");
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  await db.mcpOAuthAuthorization.create({ data: {
    id,
    clientId: parsed.value.client.clientId,
    redirectUri: parsed.value.redirectUri,
    responseState: parsed.value.state,
    resource: parsed.value.resource,
    requestedScopes: parsed.value.scopes,
    codeChallenge: parsed.value.codeChallenge,
    codeChallengeMethod: "S256",
    consentTokenHash: digestOAuthValue(csrf),
    userId: identity.userId,
    organizationId: identity.organizationId,
    consentExpiresAt: expiresAt,
  } });
  return consentPage({ id, csrf, clientName: parsed.value.client.name, organizationName: identity.organizationName, scopes: parsed.value.scopes });
}

export async function POST(request: Request) {
  const limited = await rateLimit(`mcp-oauth-consent:${getClientIp(request)}`, 30);
  if (!limited.allowed) return rateLimitResponse(limited.retryAfter);
  const config = loadMcpOAuthConfig();
  if (!config) return oauthError("server_error", 503);
  if (request.headers.get("origin") !== config.issuer) return oauthError("invalid_request", 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) return oauthError("invalid_request", 415);
  const identity = await currentMcpBrowserIdentity();
  if (!identity) return redirect(new URL("/login", config.issuer).toString());
  let form: URLSearchParams;
  try { form = new URLSearchParams(await request.text()); } catch { return oauthError("invalid_request", 400); }
  const id = form.get("request_id") ?? "";
  const csrf = form.get("csrf_token") ?? "";
  const decision = form.get("decision");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !csrf.startsWith("mcp_csrf_") || csrf.length > 128 || !["allow", "deny"].includes(decision ?? "")) return oauthError("invalid_request", 400);
  const authorization = await db.mcpOAuthAuthorization.findFirst({ where: { id, consentTokenHash: digestOAuthValue(csrf), consentExpiresAt: { gt: new Date() }, codeHash: null, consumedAt: null } });
  if (!authorization || authorization.userId !== identity.userId || authorization.organizationId !== identity.organizationId) return oauthError("invalid_request", 400);
  const redirectUri = authorization.redirectUri;
  const state = authorization.responseState;
  if (decision === "deny") {
    await db.mcpOAuthAuthorization.updateMany({ where: { id, codeHash: null, consumedAt: null }, data: { consumedAt: new Date() } });
    return redirect(makeOAuthRedirect(redirectUri, { error: "access_denied", state }));
  }
  const client = config.clients.find((entry) => entry.clientId === authorization.clientId);
  const roleScopes = mcpScopesForRole(identity.role);
  const grantedScopes = [...new Set(form.getAll("scope"))];
  if (!client || !grantedScopes.includes("mcp:connect") || grantedScopes.some((scope) => !authorization.requestedScopes.includes(scope) || !roleScopes.includes(scope) || !client.scopes.includes(scope))) return oauthError("invalid_scope", 400);
  const code = newOAuthValue("mcp_code_");
  const now = new Date();
  const updated = await db.mcpOAuthAuthorization.updateMany({
    where: { id, consentTokenHash: digestOAuthValue(csrf), consentExpiresAt: { gt: now }, codeHash: null, consumedAt: null },
    data: { approvedScopes: grantedScopes, codeHash: digestOAuthValue(code), codeExpiresAt: new Date(now.getTime() + 5 * 60_000) },
  });
  if (updated.count !== 1) return oauthError("invalid_request", 400);
  return redirect(makeOAuthRedirect(redirectUri, { code, state }));
}
