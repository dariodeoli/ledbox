import { NextResponse } from "next/server";
import { loadMcpOAuthConfig, mcpProtectedResourceMetadata } from "@/lib/mcp-oauth";

/** RFC 9728 metadata for the planned MCP resource. Authorization is not live yet. */
export function GET() {
  return NextResponse.json(mcpProtectedResourceMetadata(undefined, loadMcpOAuthConfig()), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
