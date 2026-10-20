import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AdminContext } from "@/lib/server/tenancy";
import { registerMcpToolCatalog } from "./dispatch";
import type { McpReadHandlers } from "./readers";

/** Register the catalog behind request-time authenticated actor context. */
export function createMcpServer(getContext: () => AdminContext, readers?: McpReadHandlers) {
  const server = new McpServer({
    name: "eventos-mcp",
    version: "1.0.0",
  }, {
    instructions: "EventOS MCP requiere una sesión autenticada o una API key de LedBox. Lecturas tenant-scoped disponibles; las mutaciones siguen deshabilitadas.",
  });
  registerMcpToolCatalog(server, getContext, readers);
  return server;
}
