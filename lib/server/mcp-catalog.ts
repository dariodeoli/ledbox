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
  | "treasury.read"
  | "payments.read"
  | "reports.read"
  | "prices.preview"
  | "prices.confirm"
  | "rental-prices.preview"
  | "rental-prices.confirm"
  | "quantities.preview"
  | "quantities.confirm"
  | "company.preview"
  | "company.confirm"
  | "photos.preview"
  | "photos.confirm"
  | "budgets.preview"
  | "budgets.confirm"
  | "budgets.edit.preview"
  | "budgets.edit.confirm"
  | "budgets.compare.preview"
  | "budgets.compare.confirm"
  | "clients.preview"
  | "clients.confirm"
  | "leads.preview"
  | "leads.confirm"
  | "events.preview"
  | "events.confirm";

export type McpCapability = "company.read" | "catalog.read" | "inventory.read" | "clients.read" | "leads.read" | "budgets.read" | "events.read" | "clients.write" | "events.write" | "finance.read" | "prices.write" | "quantities.write" | "company.write" | "photos.write" | "budgets.write";

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

const pricePreviewInput = z.object({ productId: resourceId, price: currencyAmount, currency: z.string().length(3).default("PYG"), audience: z.enum(["RETAIL", "WHOLESALE"]).default("RETAIL"), minimumUnits: z.number().int().min(1).max(100_000).default(1) }).strict();
const rentalPricePreviewInput = z.object({ productId: resourceId, price: currencyAmount }).strict();
const quantityPreviewInput = z.object({ productId: resourceId, unitId: resourceId.optional(), quantity: z.number().int().min(0).max(100_000), reason: z.string().trim().min(3).max(300) }).strict();
const companyPreviewInput = z.object({ name: z.string().trim().min(1).max(160).optional(), publicPhone: z.string().trim().max(40).nullable().optional(), publicEmail: z.string().trim().email().max(254).nullable().optional(), website: z.string().trim().url().max(500).nullable().optional(), tagline: z.string().trim().max(180).nullable().optional(), accent: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one company field");
const photoPreviewInput = z.object({ resourceType: z.enum(["product", "company"]), resourceId, variant: z.enum(["light", "dark"]).optional(), fileName: z.string().trim().min(1).max(180), mimeType: imageMime, byteLength: z.number().int().positive().max(1 * 1024 * 1024), sha256: z.string().regex(/^[a-f0-9]{64}$/i), data: z.string().max(1_400_000) }).strict().refine((v) => (v.resourceType === "company") === Boolean(v.variant), "Company photos require a logo variant; product photos cannot include one");
const budgetPreviewInput = z.object({ clientId: resourceId, title: z.string().trim().min(1).max(160), currency: z.literal("PYG").default("PYG"), validUntil: z.string().date().nullable().optional(), lines: z.array(z.object({ productId: resourceId.optional(), description: z.string().trim().min(1).max(500), quantity: z.number().int().min(1).max(100_000), unitPrice: currencyAmount }).strict()).min(1).max(200) }).strict();
const clientPreviewInput = z.object({ id: resourceId.optional(), type: z.enum(["FINAL", "RESELLER"]).optional(), name: z.string().trim().min(1).max(160).optional(), company: z.string().trim().max(160).nullable().optional(), ruc: z.string().trim().max(32).nullable().optional(), tradeName: z.string().trim().max(160).nullable().optional(), legalName: z.string().trim().max(200).nullable().optional(), email: z.string().trim().email().max(254).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), city: z.string().trim().max(120).nullable().optional(), department: z.string().trim().max(120).nullable().optional(), address: z.string().trim().max(300).nullable().optional(), website: z.string().trim().url().max(500).nullable().optional(), instagram: z.string().trim().max(100).nullable().optional(), whatsapp: z.string().trim().max(40).nullable().optional() }).strict().refine((value) => Object.keys(value).some((key) => key !== "id"), "Provide at least one client field").refine((value) => Boolean(value.id) || Boolean(value.name), "New clients require a name");
const leadPreviewInput = z.object({ id: resourceId.optional(), name: z.string().trim().min(1).max(160).optional(), phone: z.string().trim().min(1).max(40).optional(), email: z.string().trim().email().max(254).optional(), company: z.string().trim().max(160).nullable().optional(), ruc: z.string().trim().max(32).nullable().optional(), reason: z.string().trim().max(240).nullable().optional(), eventDate: z.string().datetime().nullable().optional(), location: z.string().trim().max(300).nullable().optional(), message: z.string().trim().max(4000).nullable().optional(), status: z.enum(["NEW", "CONTACTED", "QUOTED", "WON", "LOST"]).optional(), consentAt: z.string().datetime().optional(), consentChannel: z.string().trim().min(2).max(80).optional(), consentVersion: z.string().trim().min(1).max(80).optional() }).strict().refine((value) => Object.keys(value).some((key) => key !== "id"), "Provide at least one lead field").refine((value) => Boolean(value.id) || (Boolean(value.name && value.phone && value.email && value.consentAt && value.consentChannel && value.consentVersion)), "New leads require contact data and explicit consent evidence").refine((value) => !value.id || (!value.consentAt && !value.consentChannel && !value.consentVersion), "Consent evidence is immutable on lead edits");
const eventPreviewInput = z.object({ id: resourceId.optional(), clientId: resourceId.optional(), name: z.string().trim().min(1).max(200).optional(), location: z.string().trim().max(300).nullable().optional(), city: z.string().trim().max(120).nullable().optional(), department: z.string().trim().max(120).nullable().optional(), address: z.string().trim().max(300).nullable().optional(), addressReference: z.string().trim().max(300).nullable().optional(), locationUrl: z.string().trim().url().max(500).nullable().optional(), venueContactName: z.string().trim().max(160).nullable().optional(), venueContactPhone: z.string().trim().max(40).nullable().optional(), venueContactEmail: z.string().trim().email().max(254).nullable().optional(), responsibleName: z.string().trim().max(160).nullable().optional(), responsiblePhone: z.string().trim().max(40).nullable().optional(), responsibleEmail: z.string().trim().email().max(254).nullable().optional(), modality: z.string().trim().max(120).nullable().optional(), attendees: z.number().int().min(0).max(1_000_000).nullable().optional(), setupAt: z.string().datetime().nullable().optional(), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional(), strikeAt: z.string().datetime().nullable().optional(), status: z.enum(["DRAFT", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(), notes: z.string().trim().max(4000).nullable().optional() }).strict().refine((value) => Object.keys(value).some((key) => key !== "id"), "Provide at least one event field").refine((value) => Boolean(value.id) || Boolean(value.clientId && value.name), "New events require a client and name").refine((value) => !value.startsAt || !value.endsAt || new Date(value.startsAt) <= new Date(value.endsAt), "Event start must be before its end");
const confirmInput = z.object({ previewId: actionId, idempotencyKey }).strict();
const paymentCondition = z.object({ label: z.string().trim().min(1).max(60), amount: currencyAmount.optional(), dueAt: z.string().date().nullable().optional(), type: z.enum(["fixed", "percent", "remainder"]).optional(), value: z.number().min(0).max(2_147_483_647).optional(), moment: z.string().trim().max(120).nullable().optional(), accountId: resourceId.nullable().optional() }).strict();
const budgetEditPreviewInput = z.object({ budgetId: resourceId, title: z.string().trim().min(1).max(160).optional(), validUntil: z.string().date().nullable().optional(), advanceAmount: currencyAmount.optional(), paymentTerms: z.string().trim().max(600).nullable().optional(), installmentsJson: z.array(paymentCondition).max(12).optional() }).strict().refine((v) => Object.keys(v).some((key) => key !== "budgetId"), "Provide at least one budget change");
const budgetComparePreviewInput = z.object({ title: z.string().trim().min(1).max(120), expiresAt: z.string().datetime(), alternatives: z.array(z.object({ budgetId: resourceId, label: z.string().trim().min(1).max(80) }).strict()).min(2).max(5) }).strict();

const safeCompany = ["id", "name", "slug", "publicPhone", "publicEmail", "website", "logoUrl"] as const;
const safeProduct = ["id", "sku", "name", "description", "category", "imageUrl", "rentalPrice", "salePrice", "currency", "variants"] as const;
const safeInventory = ["productId", "sku", "name", "availableQuantity", "totalQuantity", "unitStatus", "warehouseId"] as const;
const safeClient = ["id", "name", "email", "phone", "companyName"] as const;
const safeLead = ["id", "name", "email", "phone", "message", "createdAt", "status"] as const;
const safeBudget = ["id", "title", "status", "currency", "subtotal", "discount", "total", "validUntil", "clientName", "lines"] as const;
const safeEvent = ["id", "title", "status", "startsAt", "endsAt", "venueName", "clientName"] as const;
const safeTreasury = ["id", "name", "type", "bank", "number", "alias", "currency", "openingBalance", "balance", "active"] as const;
const safePayment = ["id", "amount", "status", "paidAt", "collectedAt", "method", "reference", "dueAt", "clientName", "budgetTitle", "accountName"] as const;
const safeReport = ["period", "budgets", "payments", "received", "pending", "events"] as const;

const readCollectionKeys: Partial<Record<McpToolName, string>> = {
  "catalog.read": "products", "inventory.read": "inventory", "clients.read": "clients",
  "leads.read": "leads", "budgets.read": "budgets", "events.read": "events",
  "treasury.read": "accounts", "payments.read": "payments",
};

/**
 * Enforce the output allowlist at the dispatch boundary as defense in depth.
 * Reader implementations should still use narrow database `select`s.
 */
export function sanitizeMcpReadOutput(name: McpToolName, value: unknown): unknown {
  const tool = byName.get(name);
  if (!tool || tool.access !== "read") return undefined;
  const collectionKey = readCollectionKeys[name];
  if (collectionKey && value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const rows = record[collectionKey];
    if (!Array.isArray(rows)) return { [collectionKey]: [] };
    return { [collectionKey]: rows.map((row) => sanitizeReadRecord(tool.outputFields, row)) };
  }
  return sanitizeReadRecord(tool.outputFields, value);
}

function sanitizeReadRecord(fields: readonly string[], value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sanitizeReadRecord(fields, entry));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in source)) continue;
    const nested = source[field];
    if (field === "lines" && Array.isArray(nested)) {
      result[field] = nested.map((line) => sanitizeReadRecord(["name", "description", "quantity", "days", "unitPrice", "subtotal"], line));
    } else if (field === "variants" && nested && typeof nested === "object") {
      result[field] = sanitizeReadRecord(["familyId", "code", "name", "axes", "options"], nested);
    } else if (field === "axes" || field === "options") {
      // Variant metadata is user-authored JSON; recursively retain descriptive
      // choice data but reject internal cost/supplier keys by explicit schema.
      result[field] = sanitizeVariantMetadata(nested);
    } else if (field === "requestedItems" && Array.isArray(nested)) {
      result[field] = nested.map((item) => sanitizeReadRecord(["name", "sku", "quantity", "days", "notes", "imageUrl"], item));
    } else {
      result[field] = nested;
    }
  }
  return result;
}

function sanitizeVariantMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeVariantMetadata);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const allowed = ["id", "name", "label", "code", "sku", "value", "values", "type", "required", "position", "price", "amount", "currency", "imageUrl"];
  return Object.fromEntries(allowed.filter((key) => key in source).map((key) => [key, sanitizeVariantMetadata(source[key])]));
}

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
  definition("treasury.read", "Read bank and treasury accounts", "finance.read", "read", financeWriters, safeTreasury, z.object({ activeOnly: z.boolean().default(true), limit: z.number().int().min(1).max(50).default(50) }).strict(), "Read the company's treasury accounts and derived balances. Restricted to finance roles."),
  definition("payments.read", "Read client payments", "finance.read", "read", financeWriters, safePayment, z.object({ clientId: resourceId.optional(), budgetId: resourceId.optional(), status: z.enum(["PENDING", "RECEIVED", "CANCELLED"]).optional(), limit: z.number().int().min(1).max(100).default(50) }).strict(), "Read client payment records and their account assignment. Restricted to finance roles."),
  definition("reports.read", "Read commercial and cash summary", "finance.read", "read", financeWriters, safeReport, z.object({ from: z.string().date(), to: z.string().date() }).strict(), "Return aggregate budget, payment and event totals for a date range. No internal costs or supplier data."),
  definition("prices.preview", "Preview price change", "prices.write", "preview", financeWriters, [], pricePreviewInput, "Show the exact before/after price and impact before confirmation; no write occurs."),
  definition("prices.confirm", "Confirm price change", "prices.write", "confirm", financeWriters, [], confirmInput, "Apply a previously reviewed price preview once, with an idempotency key."),
  definition("rental-prices.preview", "Preview rental price change", "prices.write", "preview", financeWriters, [], rentalPricePreviewInput, "Preview a rental tariff change only; inventory quantities and sale prices are untouched."),
  definition("rental-prices.confirm", "Confirm rental price change", "prices.write", "confirm", financeWriters, [], confirmInput, "Apply a reviewed rental tariff once, with idempotency and audit."),
  definition("quantities.preview", "Preview quantity change", "quantities.write", "preview", operationsWriters, [], quantityPreviewInput, "Show current and proposed quantity before confirmation; no write occurs."),
  definition("quantities.confirm", "Confirm quantity change", "quantities.write", "confirm", operationsWriters, [], confirmInput, "Apply a previously reviewed quantity preview once, with an idempotency key."),
  definition("company.preview", "Preview company profile change", "company.write", "preview", ownerAdmin, [], companyPreviewInput, "Show the exact public profile changes before confirmation; no write occurs."),
  definition("company.confirm", "Confirm company profile change", "company.write", "confirm", ownerAdmin, [], confirmInput, "Apply a previously reviewed company profile preview once, with an idempotency key."),
  definition("photos.preview", "Preview photo upload", "photos.write", "preview", operationsWriters, [], photoPreviewInput, "Validate image type, size and digest and show destination before upload; no file is stored."),
  definition("photos.confirm", "Confirm photo upload", "photos.write", "confirm", operationsWriters, [], confirmInput, "Store a previously reviewed photo via existing tenant-scoped image storage once, with an idempotency key."),
  definition("budgets.preview", "Preview budget draft", "budgets.write", "preview", financeWriters, [], budgetPreviewInput, "Recalculate and compare totals, show the draft and unresolved fields; no budget is created or sent."),
  definition("budgets.confirm", "Confirm budget draft", "budgets.write", "confirm", financeWriters, [], confirmInput, "Create a draft from a reviewed preview once. Does not send, reserve inventory or record payment."),
  definition("budgets.edit.preview", "Preview draft budget update", "budgets.write", "preview", financeWriters, [], budgetEditPreviewInput, "Preview changes to a draft's title, validity or payment conditions, including validated tenant bank accounts; no change is made."),
  definition("budgets.edit.confirm", "Confirm draft budget update", "budgets.write", "confirm", financeWriters, [], confirmInput, "Apply an actor-bound draft edit once, with stale-preview protection, payment-plan validation and audit."),
  definition("budgets.compare.preview", "Preview budget alternatives", "budgets.write", "preview", financeWriters, [], budgetComparePreviewInput, "Validate 2 to 5 active budgets for the same tenant and client before creating a comparison link."),
  definition("budgets.compare.confirm", "Confirm budget alternatives", "budgets.write", "confirm", financeWriters, [], confirmInput, "Create a client comparison from a reviewed preview once, with tenant checks and audit."),
  definition("clients.preview", "Preview client create or edit", "clients.write", "preview", operationsWriters, [], clientPreviewInput, "Review client contact changes in the active company before applying them."),
  definition("clients.confirm", "Confirm client create or edit", "clients.write", "confirm", operationsWriters, [], confirmInput, "Apply a reviewed client change once, with tenant scope, stale checks and audit."),
  definition("leads.preview", "Preview lead create or edit", "clients.write", "preview", operationsWriters, [], leadPreviewInput, "Review a lead change. New leads require explicitly supplied consent evidence; internal notes are not accepted."),
  definition("leads.confirm", "Confirm lead create or edit", "clients.write", "confirm", operationsWriters, [], confirmInput, "Apply a reviewed lead change once, with tenant scope, stale checks and audit."),
  definition("events.preview", "Preview event create or edit", "events.write", "preview", operationsWriters, [], eventPreviewInput, "Review an event change linked to a client in the active company."),
  definition("events.confirm", "Confirm event create or edit", "events.write", "confirm", operationsWriters, [], confirmInput, "Apply a reviewed event change once, with tenant scope, stale checks and audit."),
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
