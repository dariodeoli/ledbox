import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { recordAudit, type AuditContext } from "./audit";
import { lockedEventLimitViolation, resolveOrganizationPlan } from "./plan-limits";
import { reserveBudgetInventory, type BudgetReservation } from "./inventory-availability";
import { QuoteComparisonError } from "./quote-comparison";
import { clientDisplayName } from "../client-identity";
import { budgetReference } from "../admin-format";
import { eventDataFromBudget } from "../budget-event";

/**
 * Presupuesto aprobado → evento (servidor). Una sola implementación para el
 * botón «Crear evento» y para la creación automática al aprobar (portal, panel,
 * comparativas y firma de alternativas).
 */

export class PlanLimitError extends Error {
  constructor(readonly violation: { error: string; code: string }) {
    super(violation.error);
  }
}

/** Empresa sobre la que se aplica el límite del plan (subconjunto de `AdminContext`). */
export type EventPlanContext = {
  organizationId: string;
  organization: { id: string; name: string; slug: string; planId: string | null };
};

export type CreateEventOutcome = "created" | "confirmed" | "unchanged";

export type CreateEventForBudgetResult = {
  outcome: CreateEventOutcome;
  event: { id: string; name: string; status: string; startsAt: Date | null };
  budget: { id: string; title: string; client: Parameters<typeof clientDisplayName>[0] };
};

/**
 * Deja el evento del presupuesto aprobado listo, dentro de `tx`, bajo `FOR UPDATE`
 * sobre el presupuesto (dos llamadas simultáneas crean UN solo evento):
 * - sin evento → lo crea `CONFIRMED` (con el chequeo del plan bajo lock);
 * - evento en `DRAFT` → lo pasa a `CONFIRMED` (con `confirmDraft`);
 * - ya confirmado → no hace nada.
 * Con `confirmDraft: false` (botón manual) un evento existente es un 409.
 * No reserva inventario ni audita: eso lo hace quien llama después del commit.
 */
export async function createEventForBudget(
  tx: Prisma.TransactionClient,
  ctx: EventPlanContext,
  budgetId: string,
  options: { confirmDraft?: boolean } = {},
): Promise<CreateEventForBudgetResult> {
  const { organizationId } = ctx;
  // Un evento existente siempre se bloquea ANTES del presupuesto (misma guarda
  // que el renombre público). Nunca esperar Event mientras se retiene Budget.
  const initial = await tx.budget.findFirst({ where: { id: budgetId, organizationId }, select: { eventId: true } });
  if (initial?.eventId) await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${initial.eventId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${budgetId} AND "organizationId" = ${organizationId} FOR UPDATE`;
  const budget = await tx.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: {
      id: true, title: true, status: true, eventId: true, clientId: true, deliveryAt: true,
      client: { select: { name: true, company: true, tradeName: true, legalName: true } },
    },
  });
  if (!budget) throw new QuoteComparisonError(404, "Presupuesto no encontrado.");
  if (budget.status !== "APPROVED") throw new QuoteComparisonError(409, "Solo se crea el evento de un presupuesto aprobado.");
  if (budget.eventId !== initial?.eventId) {
    // Otro creador pudo ganar mientras esperábamos Budget. No se toma otro lock
    // en orden inverso; devolver el evento ya confirmado es seguro e idempotente.
    const winner = budget.eventId ? await tx.event.findFirst({ where: { id: budget.eventId, organizationId } }) : null;
    if (winner && winner.status !== "DRAFT" && options.confirmDraft !== false) return { outcome: "unchanged", event: winner, budget: { id: budget.id, title: budget.title, client: budget.client } };
    throw new QuoteComparisonError(409, "El evento asociado cambió. Actualizá y reintentá.");
  }
  const summary = { id: budget.id, title: budget.title, client: budget.client };

  if (budget.eventId) {
    if (options.confirmDraft === false) throw new QuoteComparisonError(409, "El presupuesto ya tiene un evento.");
    const current = await tx.event.findFirst({ where: { id: budget.eventId, organizationId } });
    if (!current) throw new QuoteComparisonError(404, "Evento no encontrado.");
    if (current.status !== "DRAFT") return { outcome: "unchanged", event: current, budget: summary };
    const event = await tx.event.update({ where: { id: current.id }, data: { status: "CONFIRMED" } });
    return { outcome: "confirmed", event, budget: summary };
  }

  // Dos aprobaciones de presupuestos distintos de la misma empresa no se serializan por el
  // lock del presupuesto: se toma el lock de la empresa y se repite el chequeo del plan
  // dentro de la transacción, para que ninguna pase del tope mensual.
  const lockedLimit = await lockedEventLimitViolation(tx, ctx);
  if (lockedLimit) throw new PlanLimitError(lockedLimit);
  const data = eventDataFromBudget(budget);
  const event = await tx.event.create({
    data: {
      id: randomUUID(),
      organizationId,
      clientId: budget.clientId,
      ...data,
      tasks: {
        create: [
          { id: randomUUID(), type: "SETUP", title: "Confirmar montaje y acceso al lugar" },
          { id: randomUUID(), type: "EVENT", title: "Verificar equipos y operación del evento" },
          { id: randomUUID(), type: "STRIKE", title: "Coordinar desmontaje y devolución" },
          { id: randomUUID(), type: "COLLECTION", title: "Confirmar cobro / saldo" },
        ],
      },
    },
  });
  await tx.budget.update({ where: { id: budget.id }, data: { eventId: event.id } });
  return { outcome: "created", event, budget: summary };
}

/** Audita un evento creado o confirmado desde un presupuesto. */
export async function auditBudgetEvent(context: AuditContext, result: CreateEventForBudgetResult, via: string) {
  if (result.outcome === "unchanged") return;
  const ref = `PRES-${budgetReference(result.budget.id)} «${result.budget.title}» del cliente «${clientDisplayName(result.budget.client)}»`;
  await recordAudit({
    context,
    action: result.outcome === "created" ? "create" : "status",
    entity: "Event",
    entityId: result.event.id,
    summary: result.outcome === "created"
      ? `Creó el evento «${result.event.name}» desde el presupuesto ${ref}${via}`
      : `Confirmó el evento «${result.event.name}» al aprobarse el presupuesto ${ref}${via}`,
    detail: { fields: { budgetId: result.budget.id, status: result.event.status, startsAt: result.event.startsAt?.toISOString() ?? null } },
  });
}

/** Contexto de plan "de sistema" para la empresa del presupuesto (el portal no tiene sesión del panel). */
export async function systemPlanContext(organizationId: string): Promise<EventPlanContext | null> {
  const organization = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true, planId: true } });
  return organization ? { organizationId, organization } : null;
}

export type AutoEventResult = {
  event: CreateEventOutcome | "failed";
  reservations: BudgetReservation | null;
};

/**
 * Creación automática del evento al aprobar (portal, panel, comparativas, firma).
 * Corre DESPUÉS de que la aprobación quedó confirmada, en su propia transacción:
 * si falla (límite del plan, etc.) la aprobación NO se revierte, el motivo queda
 * en la auditoría y el panel sigue mostrando «Crear evento» como respaldo.
 * Nunca lanza. Idempotente. `actor` es quien aprobó (portal: «Portal del cliente»
 * vía `portalAuditContext`; panel: el usuario). Si ok, reserva el inventario.
 *
 * Stock (P1-3): esta función corre DESPUÉS de aprobar, así que no decide si se aprueba. La
 * verificación previa con lock es `checkStockBeforeApproval` (portal, comparativas y panel);
 * acá la reserva es la de siempre (idempotente: lo ya reservado por esa verificación queda
 * «sin cambios») y un faltante se audita, nunca se oculta. Un evento sin rango completo no
 * reserva nada, así que tampoco puede sobrevender.
 */
export async function ensureEventForApprovedBudget(options: {
  organizationId: string;
  budgetId: string;
  actor: AuditContext;
  /** Contexto con plan ya resuelto (panel); si falta se carga el de la empresa. */
  plan?: EventPlanContext;
  /** Solo para tests: reemplaza la reserva de inventario. */
  reserve?: typeof reserveBudgetInventory;
}): Promise<AutoEventResult> {
  const { organizationId, budgetId, actor } = options;
  const reserve = options.reserve ?? reserveBudgetInventory;
  const via = actor.user.id === "portal" ? " (automático, aprobación del cliente)" : " (automático, aprobación del equipo)";
  let result: CreateEventForBudgetResult;
  try {
    const plan = options.plan ?? (await systemPlanContext(organizationId));
    if (!plan) throw new QuoteComparisonError(404, "Empresa no encontrada.");
    // Se resuelve (y fija) el plan ANTES de la transacción: `resolveOrganizationPlan` escribe sobre
    // Organization con otra conexión y, bajo el FOR NO KEY UPDATE de `lockedEventLimitViolation`,
    // quedaría esperando su propio lock hasta vencer la transacción.
    const resolved = await resolveOrganizationPlan(organizationId, plan.organization.planId);
    const locked: EventPlanContext = { ...plan, organization: { ...plan.organization, planId: resolved?.id ?? plan.organization.planId } };
    // Un evento en DRAFT que pasa a CONFIRMED no chequea el límite del plan: el borrador ya cuenta
    // en el consumo mensual, confirmarlo no suma un evento nuevo.
    result = await db.$transaction((tx) => createEventForBudget(tx, locked, budgetId));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido";
    console.error("[budget-event] no se pudo crear el evento automático", { budgetId, organizationId, error });
    await recordAudit({
      context: actor,
      action: "status",
      entity: "Budget",
      entityId: budgetId,
      summary: `No se creó el evento automáticamente al aprobar el presupuesto: ${reason}`,
      detail: { fields: { eventAuto: "failed", reason, code: error instanceof PlanLimitError ? error.violation.code : null } },
    });
    return { event: "failed", reservations: null };
  }
  await auditBudgetEvent(actor, result, via);
  try {
    const reservations = await reserve({ organizationId, budgetId, context: actor });
    return { event: result.outcome, reservations };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido";
    console.error("[budget-event] el evento quedó creado pero la reserva falló", { budgetId, organizationId, error });
    await recordAudit({
      context: actor,
      action: "status",
      entity: "Budget",
      entityId: budgetId,
      summary: `Evento creado; la reserva de equipos quedó pendiente: ${reason}`,
      detail: { fields: { eventId: result.event.id, reservation: "pending", reason } },
    });
    return { event: result.outcome, reservations: null };
  }
}
