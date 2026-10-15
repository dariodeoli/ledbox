import { recordAudit, type AuditContext } from "./audit";
import { db } from "./db";
import type { AdminRole } from "@prisma/client";
import { reserveBudgetInventory, type BudgetReservation } from "./inventory-availability";
import { canApproveWithoutStock } from "./permissions";

/**
 * Verificación de stock ANTES de aprobar un presupuesto (alquileres P1-3).
 *
 * Reutiliza el motor de reservas en modo estricto: bajo el mismo lock de ítems
 * (`lockInventoryItems`) calcula la disponibilidad del rango del evento y, si todo
 * alcanza, deja el stock reservado; si algo no alcanza, deshace todo y no reserva
 * nada. Dos aprobaciones simultáneas del último stock se serializan en ese lock:
 * una reserva y aprueba, la otra recibe el faltante y queda en revisión.
 *
 * Sin evento o sin rango completo no hay nada que verificar: no bloquea (la reserva
 * queda pendiente como siempre y el panel lo avisa).
 */

/** Mensaje público (portal): sin cantidades ni nombres internos. */
export const PORTAL_STOCK_MESSAGE = "Hay piezas sin disponibilidad para esas fechas; el equipo te contacta.";

/** Nota que queda en el presupuesto en revisión (la lee el cliente en su portal). */
export const PORTAL_REVIEW_NOTE = PORTAL_STOCK_MESSAGE;

export type StockGate =
  | { ok: true; reservation: BudgetReservation | null }
  | { ok: false; reservation: BudgetReservation; lines: string[]; message: string };

/** Una línea legible por ítem faltante: «Copa (piden 12, hay 8)». */
export function shortageLines(reservation: Pick<BudgetReservation, "outcomes">): string[] {
  return reservation.outcomes.map((outcome) => `${outcome.inventoryName} (piden ${outcome.quantity}, hay ${outcome.available})`);
}

export async function checkStockBeforeApproval(options: {
  organizationId: string;
  budgetId: string;
  context: AuditContext;
  /** Solo para tests. */
  reserve?: typeof reserveBudgetInventory;
}): Promise<StockGate> {
  const reserve = options.reserve ?? reserveBudgetInventory;
  const reservation = await reserve({ organizationId: options.organizationId, budgetId: options.budgetId, context: options.context, strict: true });
  if (reservation.failed) {
    // La reserva nunca lanza: si falló no se pudo verificar. No se frena una aprobación
    // por un error temporal; queda logueado y la reserva se completa después a mano.
    console.error("[aprobación] no se pudo verificar el stock antes de aprobar", { budgetId: options.budgetId });
    return { ok: true, reservation: null };
  }
  if (!reservation.blocked) return { ok: true, reservation };
  const lines = shortageLines(reservation);
  return { ok: false, reservation, lines, message: `Falta stock para aprobar: ${lines.join(" · ")}.` };
}

export type StockDecision =
  | { kind: "proceed" }
  | { kind: "forced"; lines: string[] }
  | { kind: "blocked"; message: string; canForce: boolean }
  | { kind: "forbidden"; message: string };

/**
 * Panel: qué hacer con el resultado de la verificación según `force` («Aprobar igual») y el
 * rol del actor. Solo OWNER y ADMIN pueden saltar el bloqueo; los demás reciben 403.
 */
export function decideStockApproval(gate: StockGate, force: boolean, role: AdminRole): StockDecision {
  if (gate.ok) return { kind: "proceed" };
  const canForce = canApproveWithoutStock(role);
  if (!force) {
    return {
      kind: "blocked",
      canForce,
      message: `${gate.message} ${canForce ? "Podés aprobar igual si asumís el faltante." : "Pedile a un administrador que apruebe igual o resolvé el faltante."}`,
    };
  }
  if (!canForce) return { kind: "forbidden", message: "Solo el dueño o un administrador pueden aprobar un presupuesto sin stock." };
  return { kind: "forced", lines: gate.lines };
}

/**
 * Portal: el presupuesto no se aprueba ni reserva. Queda en negociación con un
 * pedido de revisión para el equipo (visible en el panel) y la causa auditada con
 * el detalle interno. Idempotente: no pisa un presupuesto ya aprobado o cerrado.
 */
export async function sendBudgetToReviewForStock(options: {
  organizationId: string;
  budgetId: string;
  title: string;
  actor: AuditContext;
  lines: string[];
}): Promise<void> {
  const moved = await db.budget.updateMany({
    where: { id: options.budgetId, organizationId: options.organizationId, approvedAt: null, status: { notIn: ["APPROVED", "LOST", "CANCELLED"] } },
    data: { status: "NEGOTIATING", revisionRequestedAt: new Date(), revisionNote: PORTAL_REVIEW_NOTE },
  });
  await recordAudit({
    context: options.actor,
    action: "status",
    entity: "Budget",
    entityId: options.budgetId,
    summary: `La aprobación de «${options.title}» quedó en revisión: no hay stock para esas fechas (${options.lines.join(" · ")})`,
    detail: { fields: { stock: "insufficient", enRevision: moved.count > 0, faltantes: options.lines } },
  });
}
