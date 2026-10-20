import { z } from "zod";
import type { AdminRole } from "@prisma/client";
import { MCP_BASE_SCOPE, mcpScopeForToolCapability } from "@/lib/mcp-oauth";

/**
 * MCP tool contract for EventOS. The MCP adapter must create this context from
 * the authenticated membership (never from tool arguments or prompt content).
 */
export type McpActorContext = Readonly<{
  organizationId: string;
  actorId: string;
  role: AdminRole;
  scopes?: readonly string[];
}>;

export type McpToolName =
  | "company.read"
  | "catalog.read"
  | "inventory.read"
  | "clients.read"
  | "leads.read"
  | "budgets.read"
  | "events.read"
  | "prices.preview"
  | "prices.confirm"
  | "quantities.preview"
  | "quantities.confirm"
  | "company.preview"
  | "company.confirm"
  | "photos.preview"
  | "photos.confirm"
  | "budgets.preview"
  | "budgets.confirm";

export type McpCapability = "company.read" | "catalog.read" | "inventory.read" | "clients.read" | "leads.read" | "budgets.read" | "events.read" | "prices.write" | "quantities.write" | "company.write" | "photos.write" | "budgets.write";

const readOnly = ["OWNER", "ADMIN", "FINANCE", "OPERATIONS", "VIEWER"] as const satisfies readonly AdminRole[];
const ownerAdmin = ["OWNER", "ADMIN"] as const satisfies readonly AdminRole[];
const financeWriters = ["OWNER", "ADMIN", "FINANCE"] as const satisfies readonly AdminRole[];
const operationsWriters = ["OWNER", "ADMIN", "OPERATIONS"] as const satisfies readonly AdminRole[];

export type McpToolDefinition = Readonly<{
  name: McpToolName;
  title: string;
  description: string;
  capability: McpCapability;
  access: "read" | "preview" | "confirm";
  allowedRoles: readonly AdminRole[];
  /** Explicit field allowlist for returned data; internal cost/supplier fields are never included. */
  outputFields: readonly string[];
  inputSchema: z.ZodType;
}>;

const noArgs = z.object({}).strict();
const resourceId = z.string().trim().min(1).max(128);
const currencyAmount = z.number().int().nonnegative().max(2_000_000_000);
const imageMime = z.enum(["image/jpeg", "image/png", "image/webp"]);
const actionId = z.string().trim().min(16).max(128);
const idempotencyKey = z.string().trim().min(16).max(128);

const pricePreviewInput = z.object({ productId: resourceId, variantId: resourceId.optional(), price: currencyAmount, currency: z.string().length(3).default("PYG") }).strict();
const quantityPreviewInput = z.object({ productId: resourceId, unitId: resourceId.optional(), quantity: z.number().int().min(0).max(100_000), reason: z.string().trim().min(3).max(300) }).strict();
const companyPreviewInput = z.object({ name: z.string().trim().min(1).max(160).optional(), publicPhone: z.string().trim().max(40).nullable().optional(), publicEmail: z.string().trim().email().max(254).nullable().optional(), website: z.string().trim().url().max(500).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one company field");
const photoPreviewInput = z.object({ resourceType: z.enum(["product", "company"]), resourceId, fileName: z.string().trim().min(1).max(180), mimeType: imageMime, byteLength: z.number().int().positive().max(8 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
const budgetPreviewInput = z.object({ clientId: resourceId.optional(), title: z.string().trim().min(1).max(180), currency: z.string().length(3).default("PYG"), validUntil: z.string().date().nullable().optional(), lines: z.array(z.object({ productId: resourceId.optional(), description: z.string().trim().min(1).max(500), quantity: z.number().positive().max(100_000), unitPrice: currencyAmount }).strict()).min(1).max(200) }).strict();
const confirmInput = z.object({ previewId: actionId, idempotencyKey }).strict();

const safeCompany = ["id", "name", "slug", "publicPhone", "publicEmail", "website", "logoUrl"] as const;
const safeProduct = ["id", "sku", "name", "description", "category", "imageUrl", "rentalPrice", "salePrice", "currency", "variants"] as const;
const safeInventory = ["productId", "sku", "name", "availableQuantity", "totalQuantity", "unitStatus", "warehouseId"] as const;
const safeClient = ["id", "name", "email", "phone", "companyName"] as const;
const safeLead = ["id", "name", "email", "phone", "message", "createdAt", "status"] as const;
const safeBudget = ["id", "title", "status", "currency", "subtotal", "discount", "total", "validUntil", "clientName", "lines"] as const;
const safeEvent = ["id", "title", "status", "startsAt", "endsAt", "venueName", "clientName"] as const;

function definition(name: McpToolName, title: string, capability: McpCapability, access: McpToolDefinition["access"], allowedRoles: readonly AdminRole[], outputFields: readonly string[], inputSchema: z.ZodType, description: string): McpToolDefinition {
  return { name, title, capability, access, allowedRoles, outputFields, inputSchema, description };
}

/** Canonical list exposed to MCP clients. Returns are allowlisted and company scoped by the adapter. */
export const MCP_TOOL_CATALOG: readonly McpToolDefinition[] = [
  definition("company.read", "Read company profile", "company.read", "read", readOnly, safeCompany, noArgs, "Read public profile fields for the authenticated active company."),
  definition("catalog.read", "Search catalog", "catalog.read", "read", readOnly, safeProduct, z.object({ query: z.string().trim().max(120).optional(), category: z.string().trim().max(100).optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(), "Search products and variants. Internal costs, margins, suppliers and purchasing data are excluded."),
  definition("inventory.read", "Read inventory availability", "inventory.read", "read", readOnly, safeInventory, z.object({ productId: resourceId.optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(), "Read tenant-scoped quantities and availability. Internal costs and supplier details are excluded."),
  definition("clients.read", "Search clients", "clients.read", "read", readOnly, safeClient, z.object({ query: z.string().trim().max(120).optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(), "Search clients belonging to the authenticated active company."),
  definition("leads.read", "Read leads", "leads.read", "read", readOnly, safeLead, z.object({ status: z.enum(["NEW", "CONTACTED", "QUOTED", "WON", "LOST"]).optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(), "Read leads belonging to the authenticated active company; internal notes and consent metadata are excluded."),
  definition("budgets.read", "Read budgets", "budgets.read", "read", readOnly, safeBudget, z.object({ budgetId: resourceId.optional(), status: z.enum(["DRAFT", "SENT", "NEGOTIATING", "APPROVED", "LOST", "CANCELLED"]).optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(), "Read tenant-scoped budgets. Cost, margin, supplier and bank account internals are excluded."),
  definition("events.read", "Read events", "events.read", "read", readOnly, safeEvent, z.object({ eventId: resourceId.optional(), from: z.string().datetime().optional(), to: z.string().datetime().optional(), limit: z.number().int().min(1).max(50).default(20) }).strict(), "Read events belonging to the authenticated active company."),
  definition("prices.preview", "Preview price change", "prices.write", "preview", financeWriters, [], pricePreviewInput, "Show the exact before/after price and impact before confirmation; no write occurs."),
  definition("prices.confirm", "Confirm price change", "prices.write", "confirm", financeWriters, [], confirmInput, "Apply a previously reviewed price preview once, with an idempotency key."),
  definition("quantities.preview", "Preview quantity change", "quantities.write", "preview", operationsWriters, [], quantityPreviewInput, "Show current and proposed quantity before confirmation; no write occurs."),
  definition("quantities.confirm", "Confirm quantity change", "quantities.write", "confirm", operationsWriters, [], confirmInput, "Apply a previously reviewed quantity preview once, with an idempotency key."),
  definition("company.preview", "Preview company profile change", "company.write", "preview", ownerAdmin, [], companyPreviewInput, "Show the exact public profile changes before confirmation; no write occurs."),
  definition("company.confirm", "Confirm company profile change", "company.write", "confirm", ownerAdmin, [], confirmInput, "Apply a previously reviewed company profile preview once, with an idempotency key."),
  definition("photos.preview", "Preview photo upload", "photos.write", "preview", operationsWriters, [], photoPreviewInput, "Validate image type, size and digest and show destination before upload; no file is stored."),
  definition("photos.confirm", "Confirm photo upload", "photos.write", "confirm", operationsWriters, [], confirmInput, "Store a previously reviewed photo via existing tenant-scoped image storage once, with an idempotency key."),
  definition("budgets.preview", "Preview budget draft", "budgets.write", "preview", financeWriters, [], budgetPreviewInput, "Recalculate and compare totals, show the draft and unresolved fields; no budget is created or sent."),
  definition("budgets.confirm", "Confirm budget draft", "budgets.write", "confirm", financeWriters, [], confirmInput, "Create a draft from a reviewed preview once. Does not send, reserve inventory or record payment."),
];

const byName = new Map(MCP_TOOL_CATALOG.map((tool) => [tool.name, tool]));

export class McpAuthorizationError extends Error {
  readonly status = 403;
  constructor() { super("The active role cannot use this MCP tool."); this.name = "McpAuthorizationError"; }
}

/** Server-side gate. Call only after resolving the bearer credential to this trusted actor context. */
export function authorizeMcpTool(context: McpActorContext, name: string): McpToolDefinition {
  const tool = byName.get(name as McpToolName);
  if (!tool || !tool.allowedRoles.includes(context.role)) throw new McpAuthorizationError();
  if (context.scopes) {
    const requiredScope = mcpScopeForToolCapability(tool.capability);
    if (!context.scopes.includes(MCP_BASE_SCOPE) || !requiredScope || !context.scopes.includes(requiredScope)) throw new McpAuthorizationError();
  }
  return tool;
}

/** Strict parsing rejects caller-supplied organizationId/tenant scope and all unknown fields. */
export function parseMcpToolInput(name: string, input: unknown) {
  const tool = byName.get(name as McpToolName);
  if (!tool) throw new Error("Unknown MCP tool.");
  return tool.inputSchema.parse(input);
}

export function getMcpTool(name: string): McpToolDefinition | undefined {
  return byName.get(name as McpToolName);
}
