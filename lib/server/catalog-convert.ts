import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { budgetPaymentConditionPayload, resolveBudgetPaymentPlan } from "@/lib/budget-payment-plan";
import { CONVERTIBLE_STATUSES, isQuoteRequestStatus, referenceDailyPrice, rentalDaysBetween } from "@/lib/catalog-public";
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
 *   de referencia VIGENTE del inventario (si no hay, el que vio el cliente).
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
  if (!percent || percent <= 0 || total <= 0) return { advanceAmount: 0, installments: Prisma.DbNull, amount: 0 };
  const plan = resolveBudgetPaymentPlan(
    [
      { label: `Seña ${percent} %`, type: "percent", value: percent, moment: "Al aprobar el presupuesto" },
      { label: "Saldo", type: "remainder", moment: "Contra entrega" },
    ],
    total,
  );
  if (!plan.ok) return { advanceAmount: 0, installments: Prisma.DbNull, amount: 0 };
  return { advanceAmount: 0, installments: plan.rows.map(budgetPaymentConditionPayload) as unknown as Prisma.InputJsonValue, amount: plan.rows[0]?.amount ?? 0 };
}

export async function convertQuoteRequest(context: AdminContext, quoteRequestId: string): Promise<ConvertFailure | ConvertSuccess> {
  const { organizationId } = context;
  const quote = await db.quoteRequest.findFirst({
    where: { id: quoteRequestId, organizationId },
    include: { items: true, lead: true, budget: { select: { id: true } } },
  });
  if (!quote) return { ok: false, status: 404, error: "El pedido no existe en esta empresa." };
  if (quote.budget || quote.status === "CONVERTED") return { ok: false, status: 409, error: "Este pedido ya se convirtió en presupuesto." };
  if (!isQuoteRequestStatus(quote.status) || !CONVERTIBLE_STATUSES.includes(quote.status)) {
    return { ok: false, status: 409, error: "Este pedido está declinado o vencido: reabrilo antes de convertirlo." };
  }
  if (!quote.lead) return { ok: false, status: 422, error: "El pedido no tiene un contacto asociado para armar el presupuesto." };
  if (quote.items.length === 0) return { ok: false, status: 422, error: "El pedido no tiene artículos." };
  const lead = quote.lead;

  const settings = await getRentalSettings(organizationId);
  const days = quote.startsAt && quote.endsAt ? rentalDaysBetween(dayKeyOf(quote.startsAt), dayKeyOf(quote.endsAt)) : Math.max(1, quote.durationDays ?? 1);
  const inventoryIds = quote.items.flatMap((item) => (item.inventoryId ? [item.inventoryId] : []));
  const inventory = inventoryIds.length
    ? await db.inventoryItem.findMany({
        where: { organizationId, id: { in: inventoryIds } },
        select: { id: true, name: true, dailyCost: true, listPrice: true, listFromDays: true, listFromPrice: true },
      })
    : [];
  const inventoryById = new Map(inventory.map((row) => [row.id, row]));

  let unpricedLines = 0;
  const lines = quote.items.map((item, sortOrder) => {
    const linked = item.inventoryId ? inventoryById.get(item.inventoryId) : undefined;
    const unitPrice = (linked ? referenceDailyPrice(linked, days) : 0) || item.unitPrice || 0;
    if (unitPrice <= 0) unpricedLines += 1;
    const costPrice = linked?.dailyCost ?? 0;
    return {
      id: randomUUID(),
      sortOrder,
      name: (linked?.name ?? item.productName).slice(0, 200),
      quantity: item.quantity,
      days,
      unitPrice,
      costPrice,
      subtotal: unitPrice * item.quantity * days,
      inventoryId: linked?.id ?? null,
    };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const costEstimate = lines.reduce((sum, line) => sum + line.quantity * line.days * line.costPrice, 0);
  const plan = depositPlan(settings.depositPercent, subtotal);
  const noteLines = [
    quote.startsAt && quote.endsAt ? `Período: ${dayKeyOf(quote.startsAt)} al ${dayKeyOf(quote.endsAt)} (${days} ${days === 1 ? "día" : "días"})` : null,
    quote.location ? `Lugar: ${quote.location}` : null,
    lead.message ? `Notas del cliente: ${lead.message}` : null,
    "Nació de un pedido del catálogo público.",
  ].filter(Boolean);
  const title = `Pedido del catálogo · ${(lead.company || lead.name).trim()}`.slice(0, TITLE_MAX);

  try {
    return await db.$transaction(async (tx) => {
      // Candado del pedido: dos conversiones simultáneas se serializan acá.
      await tx.$queryRaw`SELECT "id" FROM "QuoteRequest" WHERE "id" = ${quote.id} FOR UPDATE`;
      const fresh = await tx.quoteRequest.findUniqueOrThrow({ where: { id: quote.id }, select: { status: true, budget: { select: { id: true } } } });
      if (fresh.budget || fresh.status === "CONVERTED") throw new ConvertConflict(409, "Este pedido ya se convirtió en presupuesto.");
      if (!isQuoteRequestStatus(fresh.status) || !CONVERTIBLE_STATUSES.includes(fresh.status)) throw new ConvertConflict(409, "Este pedido está declinado o vencido: reabrilo antes de convertirlo.");

      const resolved = await resolveClientFromLead(tx, organizationId, lead, { allowCreate: roleCan(context.user.role, "clients.write") });
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
    eventId = randomUUID();
    await db.event.create({
      data: {
        id: eventId,
        organizationId,
        clientId: budget.clientId,
        name: budget.title.slice(0, 160),
        location: budget.quoteRequest?.location ?? undefined,
        startsAt,
        endsAt,
        status: "DRAFT",
      },
    });
    await db.budget.update({ where: { id: budget.id }, data: { eventId } });
    createdEvent = true;
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
