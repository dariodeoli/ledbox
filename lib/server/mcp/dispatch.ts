import type { AdminContext } from "@/lib/server/tenancy";
import { getMcpTool, MCP_TOOL_CATALOG, McpAuthorizationError, authorizeMcpTool, parseMcpToolInput, sanitizeMcpReadOutput } from "@/lib/server/mcp-catalog";
import { mcpReadHandlers, type McpReadHandlers } from "./readers";
import { confirmBudgetDraft, confirmBudgetEdit, confirmBudgetComparison, confirmCompanyPhoto, confirmCompanyProfile, confirmInventoryQuantity, confirmRentalPrice, confirmSalesPrice, previewBudgetDraft, previewBudgetEdit, previewBudgetComparison, previewCompanyPhoto, previewCompanyProfile, previewInventoryQuantity, previewRentalPrice, previewSalesPrice } from "./mutations";

type TextResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
export type McpMutationHandlers = {
  pricePreview: typeof previewSalesPrice;
  priceConfirm: typeof confirmSalesPrice;
  rentalPricePreview: typeof previewRentalPrice;
  rentalPriceConfirm: typeof confirmRentalPrice;
  quantityPreview: typeof previewInventoryQuantity;
  quantityConfirm: typeof confirmInventoryQuantity;
  companyPreview: typeof previewCompanyProfile;
  companyConfirm: typeof confirmCompanyProfile;
  photoPreview: typeof previewCompanyPhoto;
  photoConfirm: typeof confirmCompanyPhoto;
  budgetPreview: typeof previewBudgetDraft;
  budgetConfirm: typeof confirmBudgetDraft;
  budgetEditPreview: typeof previewBudgetEdit;
  budgetEditConfirm: typeof confirmBudgetEdit;
  budgetComparePreview: typeof previewBudgetComparison;
  budgetCompareConfirm: typeof confirmBudgetComparison;
};
const mcpMutationHandlers: McpMutationHandlers = { pricePreview: previewSalesPrice, priceConfirm: confirmSalesPrice, rentalPricePreview: previewRentalPrice, rentalPriceConfirm: confirmRentalPrice, quantityPreview: previewInventoryQuantity, quantityConfirm: confirmInventoryQuantity, companyPreview: previewCompanyProfile, companyConfirm: confirmCompanyProfile, photoPreview: previewCompanyPhoto, photoConfirm: confirmCompanyPhoto, budgetPreview: previewBudgetDraft, budgetConfirm: confirmBudgetDraft, budgetEditPreview: previewBudgetEdit, budgetEditConfirm: confirmBudgetEdit, budgetComparePreview: previewBudgetComparison, budgetCompareConfirm: confirmBudgetComparison };

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
    authorizeMcpTool({ organizationId: context.organizationId, actorId: context.user.id, role: context.role, ...(context.mcpScopes ? { scopes: context.mcpScopes } : {}) }, name as never);
    if (tool.access === "confirm") {
      if (tool.name === "prices.confirm") return result(await mutations.priceConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      if (tool.name === "rental-prices.confirm") return result(await mutations.rentalPriceConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      if (tool.name === "quantities.confirm") return result(await mutations.quantityConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      if (tool.name === "company.confirm") return result(await mutations.companyConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      if (tool.name === "photos.confirm") return result(await mutations.photoConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      if (tool.name === "budgets.confirm") return result(await mutations.budgetConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      if (tool.name === "budgets.edit.confirm") return result(await mutations.budgetEditConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      if (tool.name === "budgets.compare.confirm") return result(await mutations.budgetCompareConfirm(context, parsed as { previewId: string; idempotencyKey: string }));
      return result({ code: "NOT_IMPLEMENTED", message: "This confirmation handler is not enabled; no change was made." }, true);
    }
    if (tool.access === "preview") {
      if (tool.name === "prices.preview") return result(await mutations.pricePreview(context, parsed as { productId: string; price: number; currency: string; audience: "RETAIL" | "WHOLESALE"; minimumUnits: number }));
      if (tool.name === "rental-prices.preview") return result(await mutations.rentalPricePreview(context, parsed as { productId: string; price: number }));
      if (tool.name === "quantities.preview") return result(await mutations.quantityPreview(context, parsed as { productId: string; quantity: number; reason: string }));
      if (tool.name === "company.preview") return result(await mutations.companyPreview(context, parsed as Parameters<typeof mutations.companyPreview>[1]));
      if (tool.name === "photos.preview") return result(await mutations.photoPreview(context, parsed as Parameters<typeof mutations.photoPreview>[1]));
      if (tool.name === "budgets.preview") return result(await mutations.budgetPreview(context, parsed as Parameters<typeof mutations.budgetPreview>[1]));
      if (tool.name === "budgets.edit.preview") return result(await mutations.budgetEditPreview(context, parsed as Parameters<typeof mutations.budgetEditPreview>[1]));
      if (tool.name === "budgets.compare.preview") return result(await mutations.budgetComparePreview(context, parsed as Parameters<typeof mutations.budgetComparePreview>[1]));
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
    if (error instanceof Error && error.message === "PHOTO_INVALID") return result({ code: "PHOTO_INVALID", message: "The image bytes, size or digest are invalid; no change was made." }, true);
    if (error instanceof Error && error.message === "NOT_FOUND") return result({ code: "NOT_FOUND", message: "The resource was not found in the active company." }, true);
    if (error instanceof Error && ["CLIENT_REQUIRED", "INVALID_CURRENCY", "INVALID_BUDGET_LINE", "INVALID_BUDGET_TOTAL"].includes(error.message)) return result({ code: error.message, message: "Review the client, currency and line amounts. No budget was created." }, true);
    if (error instanceof Error && ["BUDGET_NOT_DRAFT", "INVALID_PAYMENT_PLAN", "INVALID_COMPARISON", "COMPARISON_NOT_ALLOWED"].includes(error.message)) return result({ code: error.message, message: "The budget operation could not be safely applied. Review the terms and current budget state." }, true);
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
