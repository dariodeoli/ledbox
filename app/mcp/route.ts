import { resolveMcpCaller } from "@/lib/server/mcp/auth";
import { handleMcpHttpRequest } from "@/lib/server/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handle(request: Request) {
  return handleMcpHttpRequest(request, { authenticate: resolveMcpCaller });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
