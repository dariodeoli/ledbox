import packageJson from "@/package.json";
import { NextResponse } from "next/server";
import { MCP_TOOL_CATALOG } from "@/lib/server/mcp-catalog";

export const dynamic = "force-dynamic";

/** Minimal public liveness probe; deliberately omits tenant and database details. */
export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "eventos-mcp",
    protocol: "streamable-http",
    endpoint: "/mcp",
    version: packageJson.version,
    oauthConfigured: false,
    toolsEnabled: MCP_TOOL_CATALOG.filter((tool) => tool.access === "read").length,
  }, { headers: { "Cache-Control": "no-store" } });
}
