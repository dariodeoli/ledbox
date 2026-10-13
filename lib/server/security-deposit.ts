import type { Prisma } from "@prisma/client";
import { budgetMoneyValid } from "../budget-payment-plan";
import {
  SECURITY_DEPOSIT_LABEL,
  securityDepositAmountValid,
  securityDepositTransition,
  type SecurityDepositStatus,
} from "../budget-security-deposit";
import { recordAudit, type AuditContext } from "./audit";
import { db } from "./db";

/**
 * Depósito de garantía del presupuesto (alquileres). Dos operaciones, ambas
 * acotadas a la empresa del contexto y auditadas:
 *
 * - `setBudgetSecurityDeposit`: define o quita el monto mientras la garantía no
 *   se recibió (sin garantía o PENDING).
 * - `transitionBudgetSecurityDeposit`: cambia el estado (ver
 *   `lib/budget-security-deposit.ts`). Es el punto de entrada para la devolución
 *   de equipos: la Fase 4 (InventoryIncident) puede llamarla con
 *   `to: "KEPT_PARTIAL"`, `retainedAmount` = costo del incidente y
 *   `reason` = «Incidente <id>», sin depender de este módulo de UI.
 *
 * La garantía NUNCA toca `Budget.total`, el plan de pagos ni los cobros.
 * Un presupuesto de otra empresa responde 404.
 */
export class SecurityDepositError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type SecurityDepositRow = { id: string; securityDeposit: number | null; securityDepositStatus: string | null; securityDepositRetained: number | null };
const SELECT = { id: true, title: true, securityDeposit: true, securityDepositStatus: true, securityDepositRetained: true } as const;

async function lockBudget(tx: Prisma.TransactionClient, budgetId: string, organizationId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Budget" WHERE "id" = ${budgetId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  if (locked.length === 0) throw new SecurityDepositError(404, "Presupuesto no encontrado.");
  return tx.budget.findUniqueOrThrow({ where: { id: budgetId }, select: SELECT });
}

export async function setBudgetSecurityDeposit(context: AuditContext, budgetId: string, amount: number | null): Promise<SecurityDepositRow> {
  if (amount !== null && !securityDepositAmountValid(amount)) throw new SecurityDepositError(400, "La garantía debe ser un monto entero en guaraníes mayor a cero.");
  const result = await db.$transaction(async (tx) => {
    const current = await lockBudget(tx, budgetId, context.organizationId);
    if (current.securityDepositStatus && current.securityDepositStatus !== "PENDING") {
      throw new SecurityDepositError(409, "La garantía ya fue recibida: cambiá su estado en lugar de su monto.");
    }
    if (current.securityDeposit === amount) return { before: current, after: current, changed: false };
    const after = await tx.budget.update({
      where: { id: budgetId },
      data: { securityDeposit: amount, securityDepositStatus: amount === null ? null : "PENDING", securityDepositRetained: null },
      select: SELECT,
    });
    return { before: current, after, changed: true };
  });
  if (result.changed) {
    await recordAudit({
      context,
      action: "update",
      entity: "Budget",
      entityId: budgetId,
      summary: amount === null ? `Quitó el depósito de garantía del presupuesto «${result.after.title}»` : `Definió el depósito de garantía del presupuesto «${result.after.title}»`,
      detail: { changes: { securityDeposit: { from: result.before.securityDeposit, to: amount } } },
    });
  }
  return result.after;
}

export type SecurityDepositTransitionInput = {
  to: SecurityDepositStatus;
  /** Solo para KEPT_PARTIAL: monto retenido (entero, 0 < monto < garantía). */
  retainedAmount?: number;
  /** Motivo legible (por ejemplo «Incidente <id>»); va a la auditoría. */
  reason?: string | null;
};

export async function transitionBudgetSecurityDeposit(context: AuditContext, budgetId: string, input: SecurityDepositTransitionInput): Promise<SecurityDepositRow & { returned: number }> {
  const result = await db.$transaction(async (tx) => {
    const current = await lockBudget(tx, budgetId, context.organizationId);
    const next = securityDepositTransition({ amount: current.securityDeposit, status: current.securityDepositStatus, retained: current.securityDepositRetained }, input.to, input.retainedAmount);
    if (!next.ok) throw new SecurityDepositError(409, next.error);
    if (next.retained !== null && !budgetMoneyValid(next.retained)) throw new SecurityDepositError(400, "El monto retenido no es válido.");
    const after = await tx.budget.update({
      where: { id: budgetId },
      data: { securityDepositStatus: next.status, securityDepositRetained: next.retained },
      select: SELECT,
    });
    return { before: current, after, returned: next.returned };
  });
  const reason = input.reason?.trim().slice(0, 300) || null;
  await recordAudit({
    context,
    action: "status",
    entity: "Budget",
    entityId: budgetId,
    summary: `Cambió la garantía del presupuesto «${result.after.title}» a ${SECURITY_DEPOSIT_LABEL[input.to].toLowerCase()}`,
    detail: {
      changes: {
        securityDepositStatus: { from: result.before.securityDepositStatus, to: result.after.securityDepositStatus },
        ...(result.after.securityDepositRetained !== result.before.securityDepositRetained ? { securityDepositRetained: { from: result.before.securityDepositRetained, to: result.after.securityDepositRetained } } : {}),
      },
      fields: { garantia: result.after.securityDeposit, devuelto: result.returned, ...(reason ? { motivo: reason } : {}) },
    },
  });
  return { ...result.after, returned: result.returned };
}

export type EquipmentReturnState = "clean" | "incidents" | "pending";

/**
 * Estado de la devolución de equipos de cada evento de la empresa: `clean` (todo
 * volvió sin daños ni faltantes: se ofrece «Devolver garantía»), `incidents`
 * (hay dañados o faltantes: se ofrece «Retener parcial») o `pending`. Los
 * eventos sin equipos asignados no aparecen en el mapa.
 */
export async function equipmentReturnByEvent(organizationId: string, eventIds: string[]): Promise<Map<string, EquipmentReturnState>> {
  const result = new Map<string, EquipmentReturnState>();
  if (eventIds.length === 0) return result;
  const rows = await db.eventInventory.findMany({
    where: { eventId: { in: eventIds }, event: { organizationId }, releasedAt: null },
    select: { eventId: true, checkedIn: true, damagedQuantity: true, missingQuantity: true },
  });
  const byEvent = new Map<string, typeof rows>();
  for (const row of rows) byEvent.set(row.eventId, [...(byEvent.get(row.eventId) ?? []), row]);
  for (const [eventId, list] of byEvent) {
    if (list.some((row) => row.damagedQuantity > 0 || row.missingQuantity > 0)) result.set(eventId, "incidents");
    else result.set(eventId, list.every((row) => row.checkedIn) ? "clean" : "pending");
  }
  return result;
}
