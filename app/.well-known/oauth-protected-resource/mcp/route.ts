import { NextResponse } from "next/server";
import { mcpProtectedResourceMetadata } from "@/lib/mcp-oauth";

/** RFC 9728 metadata for the planned MCP resource. Authorization is not live yet. */
export function GET() {
  return NextResponse.json(mcpProtectedResourceMetadata(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
