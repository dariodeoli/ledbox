import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { defaultDepositPlanRows } from "@/lib/budget-payment-plan";
import { CONVERTIBLE_STATUSES, isQuoteRequestStatus, quoteItemActive, rentalDaysBetween } from "@/lib/catalog-public";
import { deliveryExtraApplies, deliveryFee, deliveryLineName, orderPieces } from "@/lib/delivery-zones";
import { catalogLineAmounts, loadPricedItems, totalTierNote } from "./line-pricing";
import { db } from "./db";
import { commitInventoryAssignment, insufficientMessage } from "./inventory-availability";
import { leadStatusAfterBudget, resolveClientFromLead } from "./lead-client";
import { dayKeyOf } from "./notifications";
import { roleCan } from "./permissions";
import { planLimitViolation } from "./plan-limits";
import { getRentalSettings } from "./rental-settings";
import type { AdminContext } from "./tenancy";

/**
 * Pedido del catálogo → presupuesto (alquileres fase 3).
 *
 * - Un pedido se convierte UNA sola vez: `Budget.quoteRequestId` es único y la
 *   conversión toma `FOR UPDATE` sobre el pedido; la segunda responde 409.
 * - Las líneas copian el artículo, la cantidad, los días del período y el precio
 *   VIGENTE del inventario en la lista del pedido (cliente final o mayorista; si no
 *   hay, el que vio el cliente). Un pedido mayorista cotiza SIEMPRE con precios mayoristas.
 * - Un pedido mayorista ya trae su cliente (el del link privado): no se crea otro.
 * - La seña sale de `depositPercent` de la empresa por el plan de pagos
 *   existente (anticipo porcentual + saldo); sin política, no hay seña.
 * - La retención de stock es un paso aparte (`holdQuoteRequestStock`) que usa el
 *   motor de disponibilidad con `hold: true`.
 */

const TITLE_MAX = 160;
const NOTES_MAX = 2000;

export type ConvertFailure = { ok: false; status: number; error: string };
export type ConvertSuccess = {
  ok: true;
  budget: { id: string; title: string; subtotal: number; total: number; advanceAmount: number; status: string; eventId: string | null };
  deposit: { percent: number | null; amount: number };
  clientCreated: boolean;
  client: { id: string; name: string; company: string | null };
  leadId: string | null;
  leadStatus: string | null;
  unpricedLines: number;
};

class ConvertConflict extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isUnique(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "P2002";
}

/** Plan de la seña: porcentaje del total final + saldo. Sin política (o total 0) no hay plan. */
export function depositPlan(percent: number | null, total: number): { advanceAmount: number; installments: Prisma.InputJsonValue | typeof Prisma.DbNull; amount: number } {
  const rows = defaultDepositPlanRows(percent, total);
  if (!rows) return { advanceAmount: 0, installments: Prisma.DbNull, amount: 0 };
  return { advanceAmount: 0, installments: rows as unknown as Prisma.InputJsonValue, amount: rows[0]?.amount ?? 0 };
}

export async function convertQuoteRequest(context: AdminContext, quoteRequestId: string): Promise<ConvertFailure | ConvertSuccess> {
  const { organizationId } = context;
  const quote = await db.quoteRequest.findFirst({
    where: { id: quoteRequestId, organizationId },
    include: { items: true, lead: true, budget: { select: { id: true } } },
  });
  if (!quote) return { ok: false, status: 404, error: "El pedido no existe en esta empresa." };
  if (quote.budget || quote.status === "CONVERTED") return { ok: false, status: 409, error: "Este pedido ya se convirtió en presupuesto." };
  if (quote.status === "PROPOSED") return { ok: false, status: 409, error: "Este pedido espera la aprobación del cliente: aceptalo cuando apruebe tu propuesta." };
  if (!isQuoteRequestStatus(quote.status) || !CONVERTIBLE_STATUSES.includes(quote.status)) {
    return { ok: false, status: 409, error: "Este pedido está declinado o vencido: reabrilo antes de convertirlo." };
  }
  if (!quote.lead) return { ok: false, status: 422, error: "El pedido no tiene un contacto asociado para armar el presupuesto." };
  // Las líneas quitadas o marcadas «ya no lo tengo» no entran al presupuesto (el cliente ya las vio así).
  const activeItems = quote.items.filter((item) => quoteItemActive(item.state));
  if (activeItems.length === 0) return { ok: false, status: 422, error: "El pedido no tiene artículos." };
  const lead = quote.lead;

  const settings = await getRentalSettings(organizationId);
  const periodDays = quote.startsAt && quote.endsAt ? rentalDaysBetween(dayKeyOf(quote.startsAt), dayKeyOf(quote.endsAt)) : Math.max(1, quote.durationDays ?? 1);
  const inventoryIds = activeItems.flatMap((item) => (item.inventoryId ? [item.inventoryId] : []));
  const inventory = inventoryIds.length
    ? await db.inventoryItem.findMany({ where: { organizationId, id: { in: inventoryIds } }, select: { id: true, dailyCost: true } })
    : [];
  const costById = new Map(inventory.map((row) => [row.id, row.dailyCost]));
  // Mismo cálculo que la tienda: escalones por días y paquetes de `lib/price-tiers.ts`.
  const priced = await loadPricedItems(organizationId, inventoryIds);

  const wholesale = quote.priceList === "WHOLESALE";
  const priceList = wholesale ? "WHOLESALE" : "RETAIL";
  let unpricedLines = 0;
  const lines = activeItems.map((item, sortOrder) => {
    const linked = item.inventoryId ? priced.get(item.inventoryId) : undefined;
    // El piso de venta es interno: la tienda nunca lo muestra, así que la conversión no lo aplica.
    const { fromStore, unitPrice, days, subtotal } = catalogLineAmounts(linked, item.unitPrice, item.quantity, periodDays, priceList);
    if (unitPrice <= 0) unpricedLines += 1;
    const costPrice = (linked ? costById.get(linked.id) : 0) ?? 0;
    return {
      id: randomUUID(),
      sortOrder,
      name: (linked?.name ?? item.productName).slice(0, 200),
      quantity: item.quantity,
      days,
      unitPrice,
      costPrice,
      subtotal,
      inventoryId: linked?.id ?? null,
      ...(fromStore?.pricing.mode === "TOTAL" ? { notes: totalTierNote(periodDays) } : {}),
      ...(fromStore ? { pricingSnapshot: fromStore.snapshot as unknown as Prisma.InputJsonValue } : {}),
    };
  });
  // Flete por zona: línea calculada con la regla de `lib/delivery-zones.ts`, editable a mano en el presupuesto.
  const zone = quote.deliveryZoneId ? await db.deliveryZone.findFirst({ where: { id: quote.deliveryZoneId, organizationId }, select: { id: true, name: true, basePrice: true, volumeThreshold: true, extraPrice: true } }) : null;
  const zoneName = zone?.name ?? quote.deliveryZoneName;
  const pieces = orderPieces(lines);
  // Si la zona se borró entre el pedido y la conversión no se inventa un monto: queda «a coordinar».
  if (zone) {
    const fee = deliveryFee(zone, pieces);
    lines.push({
      id: randomUUID(),
      sortOrder: lines.length,
      name: deliveryLineName(zone.name),
      quantity: 1,
      days: 1,
      unitPrice: fee,
      costPrice: 0,
      subtotal: fee,
      inventoryId: null,
      notes: deliveryExtraApplies(zone, pieces) ? `Incluye recargo por volumen (${pieces} piezas)` : `${pieces} ${pieces === 1 ? "pieza" : "piezas"}`,
    });
  }
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const costEstimate = lines.reduce((sum, line) => sum + line.quantity * line.days * line.costPrice, 0);
  const plan = depositPlan(settings.depositPercent, subtotal);
  const noteLines = [
    quote.startsAt && quote.endsAt ? `Período: ${dayKeyOf(quote.startsAt)} al ${dayKeyOf(quote.endsAt)} (${periodDays} ${periodDays === 1 ? "día" : "días"})` : null,
    quote.location ? `Lugar: ${quote.location}` : null,
    lead.message ? `Notas del cliente: ${lead.message}` : null,
    wholesale ? "Nació de un pedido del catálogo mayorista (precios mayoristas)." : "Nació de un pedido del catálogo público.",
    zone ? null : quote.deliveryCoordinate ? "Flete: a coordinar con el cliente." : zoneName ? `Flete: la zona «${zoneName}» ya no existe; coordinar y cargar la línea a mano.` : null,
    quote.proposalApprovedAt ? "Pedido ajustado por la empresa y aprobado por el cliente desde su seguimiento." : null,
  ].filter(Boolean);
  const title = `${wholesale ? "Pedido mayorista" : "Pedido del catálogo"} · ${(lead.company || lead.name).trim()}`.slice(0, TITLE_MAX);

  try {
    return await db.$transaction(async (tx) => {
      // Candado del pedido: dos conversiones simultáneas se serializan acá.
      await tx.$queryRaw`SELECT "id" FROM "QuoteRequest" WHERE "id" = ${quote.id} FOR UPDATE`;
      const fresh = await tx.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, select: { status: true, budget: { select: { id: true } } } });
      if (fresh.budget || fresh.status === "CONVERTED") throw new ConvertConflict(409, "Este pedido ya se convirtió en presupuesto.");
      if (fresh.status === "PROPOSED") throw new ConvertConflict(409, "Este pedido espera la aprobación del cliente: aceptalo cuando apruebe tu propuesta.");
      if (!isQuoteRequestStatus(fresh.status) || !CONVERTIBLE_STATUSES.includes(fresh.status)) throw new ConvertConflict(409, "Este pedido está declinado o vencido: reabrilo antes de convertirlo.");

      // Pedido mayorista: el cliente es el del link privado (misma empresa); si ya no existe, no se inventa otro.
      const linkedClient = wholesale && quote.clientId
        ? await tx.client.findFirst({ where: { id: quote.clientId, organizationId }, select: { id: true, name: true, company: true } })
        : null;
      if (wholesale && quote.clientId && !linkedClient) throw new ConvertConflict(409, "El cliente mayorista de este pedido ya no existe en la empresa.");
      const resolved = linkedClient
        ? { client: linkedClient, created: false }
        : await resolveClientFromLead(tx, organizationId, lead, { allowCreate: roleCan(context.user.role, "clients.write") });
      if (!resolved) throw new ConvertConflict(403, "Tu rol no puede crear clientes y este contacto todavía no tiene uno. Pedile a un administrador que lo convierta en cliente.");

      const budget = await tx.budget.create({
        data: {
          id: randomUUID(),
          organizationId,
          clientId: resolved.client.id,
          leadId: lead.id,
          quoteRequestId: quote.id,
          title,
          status: "DRAFT",
          subtotal,
          discount: 0,
          total: subtotal,
          costEstimate,
          advanceAmount: plan.advanceAmount,
          installmentsJson: plan.installments,
          // Garantía por defecto de la empresa: aparte del total, nace pendiente.
          securityDeposit: settings.securityDepositDefault,
          securityDepositStatus: settings.securityDepositDefault ? "PENDING" : null,
          notes: noteLines.join("\n").slice(0, NOTES_MAX),
          items: { create: lines },
        },
        select: { id: true, title: true, subtotal: true, total: true, advanceAmount: true, status: true, eventId: true },
      });
      await tx.quoteRequest.update({ where: { id: quote.id }, data: { status: "CONVERTED", clientId: resolved.client.id } });
      const nextStatus = leadStatusAfterBudget(lead.status);
      if (nextStatus !== lead.status) await tx.lead.update({ where: { id: lead.id }, data: { status: nextStatus } });
      return {
        ok: true as const,
        budget,
        deposit: { percent: settings.depositPercent && plan.amount > 0 ? settings.depositPercent : null, amount: plan.amount },
        clientCreated: resolved.created,
        client: resolved.client,
        leadId: lead.id,
        leadStatus: nextStatus,
        unpricedLines,
      };
    }, { timeout: 20_000 });
  } catch (error) {
    if (error instanceof ConvertConflict) return { ok: false, status: error.status, error: error.message };
    if (isUnique(error)) return { ok: false, status: 409, error: "Este pedido ya se convirtió en presupuesto." };
    throw error;
  }
}

export type HoldResult =
  | { ok: true; eventId: string; held: number; hours: number }
  | ConvertFailure;

/**
 * Retiene el stock del pedido convertido por la vigencia de retención de la
 * empresa: crea (o reutiliza) un evento BORRADOR del presupuesto y compromete cada
 * artículo con `hold: true` bajo el candado del motor. Todo o nada: si alguno no
 * alcanza, se deshace lo retenido en esta llamada.
 */
export async function holdQuoteRequestStock(context: AdminContext, quoteRequestId: string): Promise<HoldResult> {
  const { organizationId } = context;
  const budget = await db.budget.findFirst({
    where: { quoteRequestId, organizationId },
    include: {
      quoteRequest: { select: { startsAt: true, endsAt: true, location: true } },
      items: { where: { excluded: false, inventoryId: { not: null } }, select: { inventoryId: true, quantity: true } },
      event: { select: { id: true, status: true } },
    },
  });
  if (!budget) return { ok: false, status: 409, error: "Convertí el pedido en presupuesto antes de retener el stock." };
  const startsAt = budget.quoteRequest?.startsAt ?? null;
  const endsAt = budget.quoteRequest?.endsAt ?? null;
  if (!startsAt || !endsAt) return { ok: false, status: 422, error: "El pedido no tiene fechas: no se puede retener stock sin un período." };
  if (budget.items.length === 0) return { ok: false, status: 422, error: "El presupuesto no tiene artículos de inventario para retener." };
  if (budget.event && budget.event.status !== "DRAFT") return { ok: false, status: 409, error: "El evento del presupuesto ya no está en borrador." };

  const settings = await getRentalSettings(organizationId);
  let eventId = budget.event?.id ?? null;
  let createdEvent = false;
  if (!eventId) {
    const limit = await planLimitViolation(context, "events");
    if (limit) return { ok: false, status: 403, error: limit.error };
    // Dos retenciones simultáneas no crean dos eventos: el vínculo es condicional
    // (solo si el presupuesto sigue sin evento) y el perdedor reutiliza el del ganador.
    const draftId = randomUUID();
    const linked = await db.$transaction(async (tx) => {
      await tx.event.create({
        data: {
          id: draftId,
          organizationId,
          clientId: budget.clientId,
          name: budget.title.slice(0, 160),
          location: budget.quoteRequest?.location ?? undefined,
          startsAt,
          endsAt,
          status: "DRAFT",
        },
      });
      const { count } = await tx.budget.updateMany({ where: { id: budget.id, organizationId, eventId: null }, data: { eventId: draftId } });
      if (count === 1) return draftId;
      await tx.event.delete({ where: { id: draftId } });
      const current = await tx.budget.findFirst({ where: { id: budget.id, organizationId }, select: { eventId: true } });
      return current?.eventId ?? null;
    });
    if (!linked) return { ok: false, status: 409, error: "El presupuesto cambió mientras se retenía el stock. Probá de nuevo." };
    eventId = linked;
    createdEvent = linked === draftId;
  }

  const quantities = new Map<string, number>();
  for (const item of budget.items) if (item.inventoryId) quantities.set(item.inventoryId, (quantities.get(item.inventoryId) ?? 0) + item.quantity);
  const before = new Set((await db.eventInventory.findMany({ where: { eventId, organizationId }, select: { inventoryId: true } })).map((row) => row.inventoryId));
  const created: string[] = [];
  for (const [inventoryId, quantity] of quantities) {
    const result = await commitInventoryAssignment({ organizationId, eventId, inventoryId, quantity, startsAt, endsAt, hold: true, budgetId: budget.id });
    if (!result.ok) {
      // Todo o nada: se deshace lo retenido ahora y, si el evento nació acá, también el evento.
      await db.eventInventory.deleteMany({ where: { eventId, organizationId, inventoryId: { in: created.filter((id) => !before.has(id)) } } });
      if (createdEvent) {
        await db.budget.update({ where: { id: budget.id }, data: { eventId: null } });
        await db.event.delete({ where: { id: eventId } });
      }
      const message =
        result.reason === "insufficient" ? insufficientMessage(result)
          : result.reason === "blocked" ? `«${result.item.name}» no está disponible para alquilar.`
            : "Un artículo del pedido ya no existe en el inventario.";
      return { ok: false, status: 409, error: message };
    }
    created.push(inventoryId);
  }
  return { ok: true, eventId, held: created.length, hours: Math.round(settings.holdTtlMinutes / 60) };
}
