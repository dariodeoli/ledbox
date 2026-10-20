import { loadMcpOAuthConfig, mcpAuthorizationServerMetadata } from "@/lib/mcp-oauth";
import { oauthError, oauthJson } from "@/lib/server/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const config = loadMcpOAuthConfig();
  if (!config) return oauthError("server_error", 503);
  return oauthJson(mcpAuthorizationServerMetadata(config));
}
