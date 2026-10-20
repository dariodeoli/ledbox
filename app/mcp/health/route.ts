import packageJson from "@/package.json";
import { NextResponse } from "next/server";

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
    toolsEnabled: 0,
  }, { headers: { "Cache-Control": "no-store" } });
}
