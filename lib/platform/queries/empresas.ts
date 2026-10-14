import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";
import { loadPlanUsage, resolveOrganizationPlan, type PlanUsageRow } from "@/lib/server/plan-limits";
import type { PeriodRange } from "@/lib/platform/periods";
import { utc } from "@/lib/platform/aggregate";
import { PAGE_SIZE, likePattern, type TableParams } from "@/lib/platform/tablas";
import { orgDemo, orgReal } from "@/lib/platform/sin-demo";

/**
 * Tabla de empresas de plataforma (docs/SUPERADMIN.md §3). Solo empresas reales (la demo se
 * cuenta aparte). Todo parametrizado: el texto de búsqueda va como parámetro `ILIKE`, el orden
 * sale de una lista cerrada. Nunca devuelve hashes ni tokens.
 */

export const EMPRESA_SORTS = ["nombre", "alta", "miembros", "eventos", "monto", "actividad"] as const;

const ORDER_SQL: Record<(typeof EMPRESA_SORTS)[number], Prisma.Sql> = {
  nombre: Prisma.sql`o."name"`,
  alta: Prisma.sql`o."createdAt"`,
  miembros: Prisma.sql`COALESCE(m.n, 0)`,
  eventos: Prisma.sql`COALESCE(e.n, 0)`,
  monto: Prisma.sql`COALESCE(b.amt, 0)`,
  actividad: Prisma.sql`a."last"`,
};

export type EmpresaRow = {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  active: boolean;
  createdAt: Date;
  members: number;
  events: number;
  /** Monto aprobado del período (Gs), con lo eliminado incluido. */
  approved: number;
  lastActivity: Date | null;
};

export type EmpresasPage = { rows: EmpresaRow[]; total: number; page: number; pageSize: number; demoOrgs: number };

type RawRow = {
  id: string; name: string; slug: string; plan: string | null; active: boolean; createdAt: Date;
  miembros: number; eventos: number; monto: number; ultima: Date | null;
};

function where(params: TableParams): Prisma.Sql {
  const parts: Prisma.Sql[] = [orgReal("o", "id")];
  if (params.q) {
    const like = likePattern(params.q);
    parts.push(Prisma.sql`(o."name" ILIKE ${like} ESCAPE '\\' OR o."slug" ILIKE ${like} ESCAPE '\\')`);
  }
  if (params.filters.activa === "si") parts.push(Prisma.sql`o."active" = true`);
  if (params.filters.activa === "no") parts.push(Prisma.sql`o."active" = false`);
  if (params.filters.plan) parts.push(Prisma.sql`p."code" = ${params.filters.plan}`);
  return Prisma.join(parts, " AND ");
}

export async function loadEmpresas(range: PeriodRange, params: TableParams, options: { pageSize?: number } = {}): Promise<EmpresasPage> {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  const key = (EMPRESA_SORTS as readonly string[]).includes(params.sort) ? (params.sort as keyof typeof ORDER_SQL) : "nombre";
  const direction = params.dir === "desc" ? Prisma.raw("DESC") : Prisma.raw("ASC");
  const offset = (params.page - 1) * pageSize;
  const cond = where(params);
  const [rows, count, demo] = await Promise.all([
    db.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT o."id", o."name", o."slug", p."name" AS plan, o."active", o."createdAt",
             COALESCE(m.n, 0)::int AS miembros, COALESCE(e.n, 0)::int AS eventos,
             COALESCE(b.amt, 0)::float8 AS monto, a."last" AS ultima
      FROM "Organization" o
      LEFT JOIN "Plan" p ON p."id" = o."planId"
      LEFT JOIN (SELECT "organizationId", COUNT(*) AS n FROM "AdminMembership" WHERE "active" = true GROUP BY "organizationId") m ON m."organizationId" = o."id"
      LEFT JOIN (SELECT "organizationId", COUNT(*) AS n FROM "Event" WHERE "deletedAt" IS NULL GROUP BY "organizationId") e ON e."organizationId" = o."id"
      LEFT JOIN (SELECT "organizationId", SUM("total") AS amt FROM "Budget"
                 WHERE "approvedAt" >= ${utc(range.start)} AND "approvedAt" < ${utc(range.end)} GROUP BY "organizationId") b ON b."organizationId" = o."id"
      LEFT JOIN (SELECT "organizationId", MAX("createdAt") AS "last" FROM "AuditLog" GROUP BY "organizationId") a ON a."organizationId" = o."id"
      WHERE ${cond}
      ORDER BY ${ORDER_SQL[key]} ${direction} NULLS LAST, o."id" ASC
      LIMIT ${pageSize} OFFSET ${offset}`),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "Organization" o LEFT JOIN "Plan" p ON p."id" = o."planId"
      WHERE ${cond} GROUP BY (o."id" IS NOT NULL)`),
    db.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM "Organization" o WHERE ${orgDemo("o", "id")} GROUP BY (o."id" IS NOT NULL)`),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id, name: r.name, slug: r.slug, plan: r.plan, active: r.active, createdAt: r.createdAt,
      members: r.miembros, events: r.eventos, approved: r.monto, lastActivity: r.ultima,
    })),
    total: count[0]?.n ?? 0,
    page: params.page,
    pageSize,
    demoOrgs: demo[0]?.n ?? 0,
  };
}

/** Planes para el filtro (catálogo global, sin datos de empresas). */
export async function loadPlanOptions(): Promise<Array<{ code: string; name: string }>> {
  const plans = await db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true } });
  return plans;
}

export type EmpresaDetail = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: Date;
  plan: { name: string; maxUsers: number | null; maxEventsPerMonth: number | null } | null;
  usage: {
    users: PlanUsageRow & { pendingInvitations: number };
    events: PlanUsageRow & { periodLabel: string };
  } | null;
  pendingRequests: Array<{ id: string; planName: string; requestedBy: string; createdAt: Date }>;
};

/** Detalle de una empresa REAL; una demo o un id inexistente devuelve `null`. */
export async function loadEmpresaDetail(id: string): Promise<EmpresaDetail | null> {
  const found = await db.$queryRaw<Array<{ id: string; name: string; slug: string; active: boolean; createdAt: Date; planId: string | null }>>(Prisma.sql`
    SELECT o."id", o."name", o."slug", o."active", o."createdAt", o."planId"
    FROM "Organization" o WHERE o."id" = ${id} AND ${orgReal("o", "id")}`);
  const org = found[0];
  if (!org) return null;
  const plan = await resolveOrganizationPlan(org.id, org.planId);
  const [usage, requests] = await Promise.all([
    plan ? loadPlanUsage({ organizationId: org.id, plan }) : Promise.resolve(null),
    db.planChangeRequest.findMany({
      where: { organizationId: org.id, status: "pending" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, requestedByName: true, createdAt: true, plan: { select: { name: true } } },
    }),
  ]);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    active: org.active,
    createdAt: org.createdAt,
    plan: plan ? { name: plan.name, maxUsers: plan.maxUsers, maxEventsPerMonth: plan.maxEventsPerMonth } : null,
    usage,
    pendingRequests: requests.map((r) => ({ id: r.id, planName: r.plan.name, requestedBy: r.requestedByName, createdAt: r.createdAt })),
  };
}
