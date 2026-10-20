import type { AdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { listInventoryGrid } from "@/lib/server/inventory-grid";
import { readOrgProfile } from "@/lib/org-profile";
import type { McpActorContext, McpToolName } from "@/lib/server/mcp-catalog";

export type McpReadHandler = (context: McpActorContext, input: Record<string, unknown>) => Promise<unknown>;
export type McpReadHandlers = Partial<Record<McpToolName, McpReadHandler>>;

export const mcpReadHandlers: McpReadHandlers = {
  "company.read": async ({ organizationId }) => {
    const organization = await db.organization.findFirst({
      where: { id: organizationId, active: true },
      select: { id: true, name: true, slug: true, profile: true },
    });
    if (!organization) throw new Error("NOT_FOUND");
    const profile = readOrgProfile(organization.profile);
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      publicPhone: profile.contact.phone,
      publicEmail: profile.contact.email,
      website: profile.contact.website,
      logoUrl: null,
    };
  },

  "catalog.read": async ({ organizationId }, input) => {
    const query = typeof input.query === "string" ? input.query : "";
    const category = typeof input.category === "string" ? input.category : undefined;
    const limit = Number(input.limit ?? 20);
    const products = await db.salesProduct.findMany({
      where: {
        organizationId,
        archivedAt: null,
        ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
        ...(query ? { OR: [
          { sku: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ] } : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        category: true,
        variantOptions: true,
        dimensions: true,
        family: { select: { id: true, code: true, name: true, axes: true } },
        priceTiers: {
          where: { audience: "RETAIL", minimumUnits: 1 },
          select: { amount: true, currency: true },
          take: 1,
        },
        images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
      },
    });
    return { products: products.map((product) => ({
      id: product.id,
      sku: product.sku,
      name: product.name,
      description: product.description,
      category: product.category,
      imageUrl: product.images[0]?.url ?? null,
      salePrice: product.priceTiers[0]?.amount?.toString() ?? null,
      currency: product.priceTiers[0]?.currency ?? null,
      variants: product.family ? { familyId: product.family.id, code: product.family.code, name: product.family.name, axes: product.family.axes, options: product.variantOptions } : null,
    })) };
  },

  "inventory.read": async ({ organizationId }, input) => {
    const page = await listInventoryGrid({
      organizationId,
      productId: typeof input.productId === "string" ? input.productId : undefined,
      limit: Number(input.limit ?? 20),
    });
    return { inventory: page.inventory.map((item) => ({
      productId: item.id,
      sku: item.sku,
      name: item.name,
      availableQuantity: item.availability.availableNow,
      totalQuantity: item.quantity,
      unitStatus: item.status,
      warehouseId: item.defaultWarehouseId,
    })) };
  },

  "clients.read": async ({ organizationId }, input) => {
    const query = typeof input.query === "string" ? input.query : "";
    const limit = Number(input.limit ?? 20);
    const clients = await db.client.findMany({
      where: { organizationId, ...(query ? { OR: [
        { name: { contains: query, mode: "insensitive" } },
        { company: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ] } : {}) },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: limit,
      select: { id: true, name: true, email: true, phone: true, company: true },
    });
    return { clients: clients.map((client) => ({ id: client.id, name: client.name, email: client.email, phone: client.phone, companyName: client.company })) };
  },

  "leads.read": async ({ organizationId }, input) => {
    const leads = await db.lead.findMany({
      where: { organizationId, ...(typeof input.status === "string" ? { status: input.status as never } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Number(input.limit ?? 20),
      select: { id: true, name: true, email: true, phone: true, message: true, createdAt: true, status: true },
    });
    return { leads };
  },

  "budgets.read": async ({ organizationId }, input) => {
    const budgets = await db.budget.findMany({
      where: {
        organizationId,
        ...(typeof input.budgetId === "string" ? { id: input.budgetId } : {}),
        ...(typeof input.status === "string" ? { status: input.status as never } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Number(input.limit ?? 20),
      select: {
        id: true, title: true, status: true, subtotal: true, discount: true, total: true, validUntil: true,
        client: { select: { name: true } },
        items: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { name: true, quantity: true, days: true, unitPrice: true, subtotal: true } },
      },
    });
    return { budgets: budgets.map((budget) => ({
      id: budget.id, title: budget.title, status: budget.status, currency: "PYG",
      subtotal: budget.subtotal, discount: budget.discount, total: budget.total,
      validUntil: budget.validUntil, clientName: budget.client.name, lines: budget.items,
    })) };
  },

  "events.read": async ({ organizationId }, input) => {
    const from = typeof input.from === "string" ? new Date(input.from) : undefined;
    const to = typeof input.to === "string" ? new Date(input.to) : undefined;
    if (from && to && from > to) throw new Error("INVALID_RANGE");
    const events = await db.event.findMany({
      where: {
        organizationId,
        ...(typeof input.eventId === "string" ? { id: input.eventId } : {}),
        ...(from || to ? { startsAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: Number(input.limit ?? 20),
      select: { id: true, name: true, status: true, startsAt: true, endsAt: true, location: true, client: { select: { name: true } } },
    });
    return { events: events.map((event) => ({ id: event.id, title: event.name, status: event.status, startsAt: event.startsAt, endsAt: event.endsAt, venueName: event.location, clientName: event.client.name })) };
  },
};

/** Convert the trusted tenancy context into the narrow context the MCP catalog accepts. */
export function mcpActorContext(context: AdminContext): McpActorContext {
  return { organizationId: context.organizationId, actorId: context.user.id, role: context.role };
}
