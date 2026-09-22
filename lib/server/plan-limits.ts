import type { Plan } from "@prisma/client";
import {
  DEFAULT_PLAN_CODE,
  monthKeyOf,
  monthLabel,
  nextMonthStartKey,
  planLimitMessage,
  planLimitReached,
  planUsageLevel,
  planUsagePercent,
  type PlanResource,
} from "@/lib/plan-rules";
import type { AdminContext } from "./tenancy";
import { db } from "./db";
import { expireDueInvitations } from "./invitations";
import { dayKeyOf, dayStart } from "./notifications";

/**
 * Planes por empresa (issue #42), capa server: resuelve el plan vigente, mide el
 * consumo real del mes y decide si una alta supera el tope.
 *
 * - **Nunca oculta datos**: los límites solo frenan altas nuevas. El consumo se
 *   calcula sobre filas reales (membresías activas + invitaciones pendientes, y
 *   eventos creados en el mes calendario de Asunción).
 * - **Mensaje único**: el 403 explicado sale de `planLimitMessage` (mismo texto
 *   que dibuja la UI con su acceso a `/plan`).
 * - La empresa sin plan recibe el plan por defecto de forma idempotente
 *   (`ensureOrganizationPlan`), así ninguna empresa queda sin límites por error.
 * - Aceptar una invitación no vuelve a chequear el cupo: la invitación **reserva
 *   su lugar al crearse** (por eso el consumo de usuarios las suma), y una
 *   invitación vieja nunca deja afuera a la persona que ya fue invitada.
 */

/** Fila de plan tal como la consume la UI (features siempre lista). */
export function planRow(plan: Plan) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    maxUsers: plan.maxUsers,
    maxEventsPerMonth: plan.maxEventsPerMonth,
    priceMonthly: plan.priceMonthly,
    features: Array.isArray(plan.features) ? plan.features.map((feature) => String(feature)) : [],
    sortOrder: plan.sortOrder,
    active: plan.active,
  };
}

/** Plan por defecto del catálogo (el código de arranque). */
export async function defaultPlanRecord(): Promise<Plan | null> {
  return db.plan.findUnique({ where: { code: DEFAULT_PLAN_CODE } });
}

/**
 * Plan vigente de una empresa: el asignado o, si todavía no tiene, el por
 * defecto del catálogo (la misma regla que fija `ensureOrganizationPlan`).
 */
export async function resolveOrganizationPlan(organizationId: string, planId: string | null): Promise<Plan | null> {
  if (planId) {
    const plan = await db.plan.findUnique({ where: { id: planId } });
    if (plan) return plan;
  }
  const fallback = await defaultPlanRecord();
  if (fallback) {
    // La empresa sin plan queda con el por defecto (idempotente y best-effort:
    // si falla, los límites se aplican igual con el plan devuelto).
    await ensureOrganizationPlan(organizationId, fallback.id);
  }
  return fallback;
}

/**
 * Asigna el plan por defecto (o el indicado) a una empresa que todavía no tiene
 * ninguno y devuelve el planId vigente. Idempotente y best-effort: la usa la capa
 * de tenancy la primera vez y el alta de la demo; nunca pisa un plan ya asignado.
 */
export async function ensureOrganizationPlan(organizationId: string, planId?: string): Promise<string | null> {
  try {
    const target = planId ?? (await defaultPlanRecord())?.id;
    if (!target) return null;
    await db.organization.updateMany({
      where: { id: organizationId, planId: null },
      data: { planId: target, planStartedAt: new Date() },
    });
    const organization = await db.organization.findUnique({
      where: { id: organizationId },
      select: { planId: true },
    });
    return organization?.planId ?? null;
  } catch (error) {
    console.error(
      `[planes] No se pudo asignar el plan por defecto a ${organizationId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export type PlanUsageRow = {
  used: number;
  limit: number | null;
  level: "none" | "ok" | "warn" | "danger";
  percent: number | null;
};

/**
 * Consumo real del mes: usuarios (membresías activas + invitaciones pendientes)
 * y eventos creados en el mes calendario de Asunción.
 */
export async function loadPlanUsage(input: {
  organizationId: string;
  plan: Pick<Plan, "maxUsers" | "maxEventsPerMonth">;
}): Promise<{
  users: PlanUsageRow & { pendingInvitations: number };
  events: PlanUsageRow & { periodLabel: string };
}> {
  const { organizationId, plan } = input;
  const todayKey = dayKeyOf(new Date());
  const monthStart = dayStart(`${monthKeyOf(todayKey)}-01`);
  const monthEnd = dayStart(nextMonthStartKey(todayKey));
  await expireDueInvitations(organizationId);
  const [members, pendingInvitations, events] = await Promise.all([
    db.adminMembership.count({ where: { organizationId, active: true } }),
    db.teamInvitation.count({ where: { organizationId, status: "pending" } }),
    db.event.count({ where: { organizationId, createdAt: { gte: monthStart, lt: monthEnd } } }),
  ]);
  const usersUsed = members + pendingInvitations;
  return {
    users: {
      used: usersUsed,
      pendingInvitations,
      limit: plan.maxUsers,
      level: planUsageLevel(usersUsed, plan.maxUsers),
      percent: planUsagePercent(usersUsed, plan.maxUsers),
    },
    events: {
      used: events,
      limit: plan.maxEventsPerMonth,
      level: planUsageLevel(events, plan.maxEventsPerMonth),
      percent: planUsagePercent(events, plan.maxEventsPerMonth),
      periodLabel: monthLabel(monthKeyOf(todayKey)),
    },
  };
}

export type PlanLimitViolation = { error: string; code: "plan_limit" };

/**
 * ¿La empresa activa llegó al tope del recurso? Devuelve el 403 explicado con su
 * código (`plan_limit`) o `null` si puede seguir. Se evalúa **antes** de crear
 * nada: un alta rechazada no deja efectos.
 */
export async function planLimitViolation(
  context: Pick<AdminContext, "organizationId" | "organization">,
  resource: PlanResource,
): Promise<PlanLimitViolation | null> {
  const plan = await resolveOrganizationPlan(context.organizationId, context.organization.planId ?? null);
  if (!plan) return null;

  if (resource === "events") {
    const limit = plan.maxEventsPerMonth;
    if (limit === null) return null;
    const todayKey = dayKeyOf(new Date());
    const monthStart = dayStart(`${monthKeyOf(todayKey)}-01`);
    const monthEnd = dayStart(nextMonthStartKey(todayKey));
    const used = await db.event.count({
      where: { organizationId: context.organizationId, createdAt: { gte: monthStart, lt: monthEnd } },
    });
    if (!planLimitReached(limit, used)) return null;
    return {
      error: planLimitMessage({
        planName: plan.name,
        resource,
        limit,
        used,
        periodLabel: monthLabel(monthKeyOf(todayKey)),
      }),
      code: "plan_limit",
    };
  }

  const limit = plan.maxUsers;
  if (limit === null) return null;
  await expireDueInvitations(context.organizationId);
  const [members, pendingInvitations] = await Promise.all([
    db.adminMembership.count({ where: { organizationId: context.organizationId, active: true } }),
    db.teamInvitation.count({ where: { organizationId: context.organizationId, status: "pending" } }),
  ]);
  const used = members + pendingInvitations;
  if (!planLimitReached(limit, used)) return null;
  return {
    error: planLimitMessage({ planName: plan.name, resource, limit, used }),
    code: "plan_limit",
  };
}
