import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { findMatchingClient } from "@/lib/server/lead-client";
import { leadBudgetDraft } from "@/lib/lead-budget-draft";
import { quoteItemActive, rentalDaysBetween } from "@/lib/catalog-public";
import { leadBudgetPrefillItems, type LeadBudgetPrefillLine } from "@/lib/lead-budget-prefill";
import { inventoryImageUrl } from "@/lib/server/inventory-images";
import { catalogLineAmounts, loadPricedItems, totalTierNote } from "@/lib/server/line-pricing";
import { dayKeyOf } from "@/lib/server/notifications";
import { roleCan } from "@/lib/server/permissions";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/budgets/lead-draft?leadId=…` (Lead → Presupuesto).
 *
 * Datos para precargar el alta de presupuesto desde un lead: título, notas,
 * líneas activas de la preorden más reciente, cliente ya existente (sin crearlo)
 * y presupuestos previos. Exige `budgets.write` y limita cada consulta de
 * inventario a la empresa activa. Leer esta ruta no modifica ni retiene stock.
 */
export async function GET(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId, user } = auth.context;
  const leadId = new URL(request.url).searchParams.get("leadId")?.trim() ?? "";
  if (!leadId) return jsonError("Falta el lead.", 400);
  const lead = await db.lead.findFirst({
    where: { id: leadId, organizationId },
    include: { quoteRequests: { orderBy: { createdAt: "desc" }, take: 1, select: {
      id: true, status: true, durationDays: true, eventDate: true, location: true, createdAt: true,
      startsAt: true, endsAt: true, priceList: true,
      items: { orderBy: { id: "asc" }, select: { id: true, productSlug: true, productName: true, quantity: true, duration: true, billingUnit: true, unitPrice: true, notes: true, inventoryId: true, state: true } },
    } } },
  });
  if (!lead) return jsonError("El lead no existe en esta empresa.", 404);
  const quote = lead.quoteRequests[0] ?? null;
  const activeItems = quote?.items.filter((item) => quoteItemActive(item.state)) ?? [];
  const requestedInventoryIds = [...new Set(activeItems.flatMap((item) => item.inventoryId ? [item.inventoryId] : []))];
  const [candidates, existingBudgets, inventoryRows] = await Promise.all([
    db.client.findMany({
      where: { organizationId, OR: [{ email: { not: null } }, { phone: { not: null } }] },
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { id: true, name: true, company: true, email: true, phone: true },
    }),
    db.budget.findMany({ where: { organizationId, leadId: lead.id }, orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, createdAt: true } }),
    requestedInventoryIds.length ? db.inventoryItem.findMany({
      where: { organizationId, id: { in: requestedInventoryIds } },
      select: {
        id: true, name: true, sku: true, category: true, quantity: true, status: true,
        stockCountStatus: true, imageUrl: true, imageMime: true, updatedAt: true,
        billingUnit: true, listPrice: true,
        priceTiers: { where: { audience: "RETAIL" }, select: { audience: true, fromDays: true, mode: true, price: true }, orderBy: { fromDays: "asc" } },
        _count: { select: { components: true } },
      },
    }) : Promise.resolve([]),
  ]);
  const match = findMatchingClient(candidates, lead);
  const draft = leadBudgetDraft({
    name: lead.name,
    company: lead.company,
    reason: lead.reason,
    message: lead.message,
    eventDate: lead.eventDate ?? lead.quoteRequests[0]?.eventDate ?? null,
    location: lead.location ?? lead.quoteRequests[0]?.location ?? null,
  });
  const periodDays = quote
    ? quote.startsAt && quote.endsAt
      ? rentalDaysBetween(dayKeyOf(quote.startsAt), dayKeyOf(quote.endsAt))
      : Math.max(1, quote.durationDays ?? 1)
    : 1;
  const inventoryById = new Map(inventoryRows.map((item) => [item.id, item]));
  const priceList = quote?.priceList === "WHOLESALE" ? "WHOLESALE" : "RETAIL";
  const linkedIds = requestedInventoryIds.filter((id) => inventoryById.has(id));
  const pricedItems = await loadPricedItems(organizationId, linkedIds);
  const prefillLines: LeadBudgetPrefillLine[] = activeItems.map((item) => {
    const inventory = item.inventoryId ? inventoryById.get(item.inventoryId) : undefined;
    const priced = item.inventoryId ? pricedItems.get(item.inventoryId) : undefined;
    const itemDays = Number.isInteger(item.duration) && item.duration && item.duration > 0 ? item.duration : periodDays;
    const amounts = catalogLineAmounts(priced, item.unitPrice, item.quantity, itemDays, priceList);
    const link = inventory ? {
      stockCountStatus: inventory.stockCountStatus,
      id: inventory.id,
      name: inventory.name,
      sku: inventory.sku,
      category: inventory.category,
      quantity: inventory.quantity,
      status: inventory.status,
      imageUrl: inventoryImageUrl(inventory),
      ...(priceList === "RETAIL" ? {
        listPrice: inventory.listPrice,
        priceTiers: inventory.priceTiers,
      } : {}),
      ...(inventory.billingUnit ? { billingUnit: inventory.billingUnit } : {}),
      _count: { components: inventory._count.components },
    } : null;
    const notes = [item.notes, amounts.fromStore?.pricing.mode === "TOTAL" ? totalTierNote(itemDays) : null].filter(Boolean).join("\n");
    return {
      state: item.state,
      productName: item.productName,
      quantity: item.quantity,
      days: amounts.days,
      unitPrice: amounts.unitPrice > 0 ? amounts.unitPrice : null,
      notes: notes || null,
      inventory: link,
      priceSource: amounts.fromStore ? "catalog" : amounts.unitPrice > 0 ? "request" : "pending",
      // Wholesale lines keep a fixed amount in this retail-only editor; avoid
      // attaching a retail pricing snapshot or recalculating them silently.
      snapshotDays: priceList === "RETAIL" && amounts.fromStore ? itemDays : null,
    };
  });
  const items = leadBudgetPrefillItems(prefillLines);
  const pricing = {
    fromCatalog: prefillLines.filter((item) => item.priceSource === "catalog").length,
    fromRequest: prefillLines.filter((item) => item.priceSource === "request").length,
    pending: prefillLines.filter((item) => item.priceSource === "pending").length,
  };
  return Response.json({
    lead: { id: lead.id, name: lead.name, company: lead.company, status: lead.status, createdAt: lead.createdAt },
    title: draft.title,
    notes: draft.notes,
    eventDate: draft.eventDate,
    quoteRange: quote?.startsAt && quote.endsAt ? { startsAt: quote.startsAt.toISOString(), endsAt: quote.endsAt.toISOString() } : null,
    items,
    pricing,
    client: match ? { id: match.id, name: match.name, company: match.company } : null,
    canCreateClient: roleCan(user.role, "clients.write"),
    existingBudgets,
  });
}
