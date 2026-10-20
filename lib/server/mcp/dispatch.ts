import type { AdminContext } from "@/lib/server/tenancy";
import { getMcpTool, MCP_TOOL_CATALOG, McpAuthorizationError, authorizeMcpTool, parseMcpToolInput, sanitizeMcpReadOutput } from "@/lib/server/mcp-catalog";
import { mcpReadHandlers, type McpReadHandlers } from "./readers";
import { confirmInventoryQuantity, confirmSalesPrice, previewInventoryQuantity, previewSalesPrice } from "./mutations";

type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
export type McpMutationHandlers = {
  pricePreview: typeof previewSalesPrice;
  priceConfirm: typeof confirmSalesPrice;
  quantityPreview: typeof previewInventoryQuantity;
  quantityConfirm: typeof confirmInventoryQuantity;
};
const mcpMutationHandlers: McpMutationHandlers = { pricePreview: previewSalesPrice, priceConfirm: confirmSalesPrice, quantityPreview: previewInventoryQuantity, quantityConfirm: confirmInventoryQuantity };

function result(value: unknown, isError = false): TextResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

/** Shared MCP dispatch gate: schema parse, trusted actor/role check, then tenant-scoped reader. */
export async function dispatchMcpTool(
  name: string,
  rawInput: unknown,
  context: AdminContext,
  readers: McpReadHandlers = mcpReadHandlers,
  mutations: McpMutationHandlers = mcpMutationHandlers,
): Promise<TextResult> {
  try {
    const tool = getMcpTool(name);
    if (!tool) return result({ code: "NOT_FOUND", message: "Unknown MCP tool." }, true);
    const parsed = parseMcpToolInput(name, rawInput);
    authorizeMcpTool({ organizationId: context.organizationId, actorId: context.user.id, role: context.role }, name as never);
    if (tool.access === "confirm") {
      if (tool.name === "prices.confirm") return result(await mutations.priceConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      if (tool.name === "quantities.confirm") return result(await mutations.quantityConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      return result({ code: "NOT_IMPLEMENTED", message: "This confirmation handler is not enabled; no change was made." }, true);
    }
    if (tool.access === "preview") {
      if (tool.name === "prices.preview") return result(await mutations.pricePreview(context, parsed as { productId: string; price: number; currency: string; audience: "RETAIL" | "WHOLESALE"; minimumUnits: number }));
      if (tool.name === "quantities.preview") return result(await mutations.quantityPreview(context, parsed as { productId: string; quantity: number; reason: string }));
      return result({ code: "PREVIEW_NOT_IMPLEMENTED", message: "This preview handler is not enabled; no change was made." }, true);
    }
    const reader = readers[tool.name];
    if (!reader) return result({ code: "NOT_IMPLEMENTED", message: "No read service is registered for this tool." }, true);
    const data = await reader({ organizationId: context.organizationId, actorId: context.user.id, role: context.role }, parsed as Record<string, unknown>);
    return result(sanitizeMcpReadOutput(tool.name, data));
  } catch (error) {
    if (error instanceof McpAuthorizationError) return result({ code: "FORBIDDEN", message: error.message }, true);
    if (error instanceof Error && error.message === "FORBIDDEN") return result({ code: "FORBIDDEN", message: "The active role lacks the required capability." }, true);
    if (error instanceof Error && error.message === "MUTATION_BLOCKED") return result({ code: "MUTATION_BLOCKED", message: "Mutations are disabled in demo and sandbox companies." }, true);
    if (error instanceof Error && error.message === "NOT_FOUND") return result({ code: "NOT_FOUND", message: "The resource was not found in the active company." }, true);
    if (error instanceof Error && error.message === "PREVIEW_EXPIRED") return result({ code: "PREVIEW_EXPIRED", message: "The preview is missing or expired; review a new preview." }, true);
    if (error instanceof Error && error.message === "PREVIEW_STALE") return result({ code: "PREVIEW_STALE", message: "The resource changed after preview; review a new preview." }, true);
    if (error instanceof Error && ["QUANTITY_DECREASE_BLOCKED", "COMBO_STOCK_BLOCKED", "PREVIEW_INVALID"].includes(error.message)) return result({ code: error.message, message: "This operation cannot be safely applied; no change was made." }, true);
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
