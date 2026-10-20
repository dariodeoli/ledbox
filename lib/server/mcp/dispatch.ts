import type { AdminContext } from "@/lib/server/tenancy";
import { getMcpTool, MCP_TOOL_CATALOG, McpAuthorizationError, authorizeMcpTool, parseMcpToolInput } from "@/lib/server/mcp-catalog";
import { mcpReadHandlers, type McpReadHandlers } from "./readers";

type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function result(value: unknown, isError = false): TextResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

/** Shared MCP dispatch gate: schema parse, trusted actor/role check, then tenant-scoped reader. */
export async function dispatchMcpTool(
  name: string,
  rawInput: unknown,
  context: AdminContext,
  readers: McpReadHandlers = mcpReadHandlers,
): Promise<TextResult> {
  try {
    const tool = getMcpTool(name);
    if (!tool) return result({ code: "NOT_FOUND", message: "Unknown MCP tool." }, true);
    const parsed = parseMcpToolInput(name, rawInput);
    authorizeMcpTool({ organizationId: context.organizationId, actorId: context.user.id, role: context.role, ...(context.mcpScopes ? { scopes: context.mcpScopes } : {}) }, name as never);
    if (tool.access === "confirm") {
      return result({ code: "NOT_IMPLEMENTED", message: "This confirmation handler is not enabled; no change was made." }, true);
    }
    if (tool.access === "preview") {
      return result({ code: "PREVIEW_NOT_IMPLEMENTED", message: "This preview handler is not enabled; no change was made." }, true);
    }
    const reader = readers[tool.name];
    if (!reader) return result({ code: "NOT_IMPLEMENTED", message: "No read service is registered for this tool." }, true);
    const data = await reader({ organizationId: context.organizationId, actorId: context.user.id, role: context.role }, parsed as Record<string, unknown>);
    return result(data);
  } catch (error) {
    if (error instanceof McpAuthorizationError) return result({ code: "FORBIDDEN", message: error.message }, true);
    if (error instanceof Error && error.name === "ZodError") return result({ code: "INVALID_ARGUMENTS", message: error.message }, true);
    if (error instanceof Error && (error.message === "NOT_FOUND" || error.message === "INVALID_RANGE")) {
      return result({ code: error.message, message: error.message === "INVALID_RANGE" ? "The requested date range is invalid." : "The resource was not found in the active company." }, true);
    }
    return result({ code: "READ_FAILED", message: "The MCP read could not be completed." }, true);
  }
}

export function registerMcpToolCatalog(server: import("@modelcontextprotocol/sdk/server/mcp.js").McpServer, getContext: () => AdminContext, readers: McpReadHandlers = mcpReadHandlers) {
  for (const tool of MCP_TOOL_CATALOG) {
    server.registerTool(tool.name, {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: { readOnlyHint: tool.access === "read", destructiveHint: false },
    }, async (input) => dispatchMcpTool(tool.name, input, getContext(), readers));
  }
}
