import type { PlanChangeRequestStatus } from "@prisma/client";
import { planRow, loadPlanUsage, resolveOrganizationPlan } from "@/lib/server/plan-limits";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Plan de la empresa activa (issue #42).
 *
 * `GET` es lectura para todos los roles (incluido `VIEWER` y la demo): plan
 * vigente con su inicio, catálogo completo para la comparación y consumo real
 * del mes (usuarios e invitaciones, y eventos creados). Los datos salen de filas
 * reales; el precio en PYG lo dibuja la UI.
 *
 * El cambio de plan **no** se aplica desde acá: el equipo lo solicita en
 * `POST /api/admin/plan/requests` y lo efectiviza Owncoding.
 */

const REQUEST_STATUSES: readonly PlanChangeRequestStatus[] = ["pending", "approved", "rejected", "cancelled"];

function requestRow(entry: {
  id: string;
  planId: string;
  status: PlanChangeRequestStatus;
  note: string | null;
  requestedByName: string;
  requestedByEmail: string | null;
  decidedAt: Date | null;
  decidedByName: string | null;
  createdAt: Date;
  plan: { code: string; name: string };
}) {
  return {
    id: entry.id,
    planId: entry.planId,
    planCode: entry.plan.code,
    planName: entry.plan.name,
    status: REQUEST_STATUSES.includes(entry.status) ? entry.status : "pending",
    note: entry.note,
    requestedByName: entry.requestedByName,
    requestedByEmail: entry.requestedByEmail,
    decidedAt: entry.decidedAt?.toISOString() ?? null,
    decidedByName: entry.decidedByName,
    createdAt: entry.createdAt.toISOString(),
  };
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId, organization } = auth.context;

  const [plan, catalog, organizationRecord, pending] = await Promise.all([
    resolveOrganizationPlan(organizationId, organization.planId),
    db.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    db.organization.findUnique({ where: { id: organizationId }, select: { planStartedAt: true } }),
    db.planChangeRequest.findFirst({
      where: { organizationId, status: "pending" },
      orderBy: { createdAt: "desc" },
      include: { plan: { select: { code: true, name: true } } },
    }),
  ]);
  const [usage, history] = await Promise.all([
    plan ? loadPlanUsage({ organizationId, plan }) : Promise.resolve(null),
    db.planChangeRequest.findMany({
      where: { organizationId, ...(pending ? { id: { not: pending.id } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { plan: { select: { code: true, name: true } } },
    }),
  ]);

  return Response.json({
    plan: plan ? planRow(plan) : null,
    planStartedAt: organizationRecord?.planStartedAt?.toISOString() ?? null,
    catalog: catalog.map(planRow),
    usage,
    pendingRequest: pending ? requestRow(pending) : null,
    requests: history.map(requestRow),
  });
}
