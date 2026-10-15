import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { live } from "./trash-filter";
import { assignmentRange, EVENT_RANGE_SELECT } from "./inventory-availability";

/**
 * Alertas de alquiler (P1-3), con datos reales de la empresa activa:
 * - devoluciones vencidas: salió y no volvió, y el fin planeado ya pasó;
 * - retenciones de la tienda (pedido convertido, stock retenido) que vencen en pocas horas.
 */

/** Ventana del aviso de retención por vencer. */
export const HOLD_WARNING_HOURS = 6;

export type OverdueReturn = {
  assignmentId: string;
  eventId: string;
  eventName: string;
  clientName: string | null;
  inventoryId: string;
  inventoryName: string;
  /** Unidades que siguen afuera (despachadas menos devueltas). */
  pending: number;
  /** Fin planeado de la asignación (ISO). */
  dueAt: string;
  /** Horas de atraso, redondeadas hacia abajo (≥ 0). */
  hoursLate: number;
};

export type ExpiringHold = {
  budgetId: string;
  budgetTitle: string;
  eventId: string;
  eventName: string;
  clientName: string | null;
  /** Vencimiento más próximo de las retenciones del pedido (ISO). */
  expiresAt: string;
  /** Horas que faltan, redondeadas hacia arriba (≥ 1 mientras no venza). */
  hoursLeft: number;
  items: number;
};

const MAX_ROWS = 500;

/** Salió y no volvió con el fin planeado en el pasado. Pura, para probar sin base. */
export function overdueReturnOf(
  row: {
    id: string;
    inventoryId: string;
    quantity: number;
    checkoutQuantity: number;
    returnedQuantity: number;
    checkedOut: boolean;
    checkedIn: boolean;
    checkedInAt: Date | null;
    startsAt: Date | null;
    endsAt: Date | null;
    event: Parameters<typeof assignmentRange>[0]["event"] & { client?: { name: string; company: string | null } | null };
    inventory: { name: string };
  },
  now: Date,
): OverdueReturn | null {
  if (!row.checkedOut || row.checkedIn || row.checkedInAt) return null;
  const { end } = assignmentRange(row);
  if (!end || end.getTime() >= now.getTime()) return null;
  const out = row.checkoutQuantity > 0 ? row.checkoutQuantity : row.quantity;
  const pending = Math.max(0, out - row.returnedQuantity);
  if (pending <= 0) return null;
  const client = row.event.client;
  return {
    assignmentId: row.id,
    eventId: row.event.id,
    eventName: row.event.name,
    clientName: client ? client.company?.trim() || client.name : null,
    inventoryId: row.inventoryId,
    inventoryName: row.inventory.name,
    pending,
    dueAt: end.toISOString(),
    hoursLate: Math.floor((now.getTime() - end.getTime()) / 3_600_000),
  };
}

/** Lo que salió y venció sin volver, lo más atrasado primero. Acotado a la empresa. */
export async function listOverdueReturns(organizationId: string, now: Date = new Date()): Promise<OverdueReturn[]> {
  const rows = await db.eventInventory.findMany({
    where: {
      event: { organizationId, deletedAt: null },
      checkedOut: true,
      checkedIn: false,
      checkedInAt: null,
    },
    take: MAX_ROWS,
    orderBy: { checkedOutAt: "asc" },
    select: {
      id: true,
      inventoryId: true,
      quantity: true,
      checkoutQuantity: true,
      returnedQuantity: true,
      checkedOut: true,
      checkedIn: true,
      checkedInAt: true,
      startsAt: true,
      endsAt: true,
      inventory: { select: { name: true } },
      event: { select: { ...EVENT_RANGE_SELECT, client: { select: { name: true, company: true } } } },
    },
  });
  return rows
    .flatMap((row) => {
      const overdue = overdueReturnOf(row, now);
      return overdue ? [overdue] : [];
    })
    .sort((a, b) => b.hoursLate - a.hoursLate);
}

/**
 * Retenciones de pedidos de la tienda (presupuesto nacido de un `QuoteRequest`) que vencen
 * dentro de `HOLD_WARNING_HOURS` horas: se agrupan por presupuesto, la más próxima manda.
 */
export async function listExpiringHolds(organizationId: string, now: Date = new Date(), hours: number = HOLD_WARNING_HOURS): Promise<ExpiringHold[]> {
  const limit = new Date(now.getTime() + hours * 3_600_000);
  const heldBudget = { organizationId, quoteRequestId: { not: null }, status: { notIn: ["APPROVED", "LOST", "CANCELLED"] } } satisfies Prisma.BudgetWhereInput;
  const rows = await db.eventInventory.findMany({
    where: {
      releasedAt: null,
      holdExpiresAt: { gt: now, lte: limit },
      event: { organizationId, deletedAt: null, status: { not: "CANCELLED" }, budgets: { some: heldBudget } },
    },
    take: MAX_ROWS,
    orderBy: { holdExpiresAt: "asc" },
    select: {
      holdExpiresAt: true,
      event: {
        select: {
          id: true,
          name: true,
          budgets: { where: { ...live, ...heldBudget }, take: 1, select: { id: true, title: true, client: { select: { name: true, company: true } } } },
        },
      },
    },
  });
  const byBudget = new Map<string, ExpiringHold>();
  for (const row of rows) {
    const budget = row.event.budgets[0];
    if (!budget || !row.holdExpiresAt) continue;
    const current = byBudget.get(budget.id);
    if (current) {
      current.items += 1;
      continue;
    }
    byBudget.set(budget.id, {
      budgetId: budget.id,
      budgetTitle: budget.title,
      eventId: row.event.id,
      eventName: row.event.name,
      clientName: budget.client.company?.trim() || budget.client.name,
      expiresAt: row.holdExpiresAt.toISOString(),
      hoursLeft: Math.max(1, Math.ceil((row.holdExpiresAt.getTime() - now.getTime()) / 3_600_000)),
      items: 1,
    });
  }
  return [...byBudget.values()];
}
