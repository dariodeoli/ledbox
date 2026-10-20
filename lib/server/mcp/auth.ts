import { requireAdminContext, type AdminContext } from "@/lib/server/tenancy";
import { loadMcpOAuthConfig } from "@/lib/mcp-oauth";
import { resolveMcpOAuthAccessToken } from "./oauth";

/** Adapter boundary for future OAuth 2.1/PKCE. Current release accepts only
 * the application's existing session cookie or scoped API bearer token. */
export type McpAuthProvider = (request: Request) => Promise<
  | { ok: true; context: AdminContext }
  | { ok: false; response: Response }
>;

export const resolveMcpCaller: McpAuthProvider = async (request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] ?? "";
  if (bearer.startsWith("mcp_at_")) {
    const config = loadMcpOAuthConfig();
    const resolved = config ? await resolveMcpOAuthAccessToken(bearer, config) : { ok: false as const };
    if (resolved.ok) return { ok: true, context: resolved.context };
    const resourceMetadata = new URL("/.well-known/oauth-protected-resource/mcp", request.url).toString();
    return { ok: false, response: new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata=\"${resourceMetadata}\"`, "Cache-Control": "no-store" } }) };
  }
  return requireAdminContext();
};
