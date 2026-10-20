import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Keep tool registration modular. No business tools are enabled until each
 * tool has an explicit role/capability policy and tenant-isolation tests. */
export function createMcpServer() {
  return new McpServer({
    name: "eventos-mcp",
    version: "1.0.0",
  }, {
    instructions: "EventOS MCP requiere una sesión autenticada o una API key de LedBox. No hay herramientas de negocio habilitadas en esta etapa.",
  });
}
