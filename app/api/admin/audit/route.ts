import type { Prisma } from "@prisma/client";
import { AUDIT_ENTITIES } from "@/lib/admin-types";
import { auditDayStart, auditNextDayStart, isAuditDayKey } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Historial de cambios de la empresa activa.
 *
 * Solo OWNER y ADMIN leen la auditoría (el resto responde 403) y la consulta
 * siempre se acota a `organizationId`: ninguna empresa ve la actividad de otra.
 * Filtros: `entity`, `entityId`, `actor` (id), `from`/`to` (días de Asunción,
 * ambos inclusive) y `q` (resumen, actor o id del registro). Paginado con
 * `page`/`pageSize` (máx. 100) y devuelve el total para dibujar la navegación.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_ACTORS = 100;

function positiveIntParam(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  if (auth.context.role !== "OWNER" && auth.context.role !== "ADMIN") return jsonError("Forbidden", 403);

  const params = new URL(request.url).searchParams;
  const entity = (params.get("entity") ?? "").trim();
  const entityId = (params.get("entityId") ?? "").trim();
  const actorId = (params.get("actor") ?? "").trim();
  const query = (params.get("q") ?? "").trim();
  const from = (params.get("from") ?? "").trim();
  const to = (params.get("to") ?? "").trim();
  const page = positiveIntParam(params.get("page"), 1);
  const pageSize = Math.min(positiveIntParam(params.get("pageSize"), DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

  if (entity && !(AUDIT_ENTITIES as readonly string[]).includes(entity)) return jsonError("Unknown audit entity.", 400);
  if (from && !isAuditDayKey(from)) return jsonError("Invalid from date.", 400);
  if (to && !isAuditDayKey(to)) return jsonError("Invalid to date.", 400);

  const where: Prisma.AuditLogWhereInput = { organizationId: auth.context.organizationId };
  if (entity) where.entity = entity;
  if (entityId) where.entityId = entityId;
  if (actorId) where.actorId = actorId;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: auditDayStart(from) } : {}),
      ...(to ? { lt: auditNextDayStart(to) } : {}),
    };
  }
  if (query) {
    where.OR = [
      { summary: { contains: query, mode: "insensitive" } },
      { actorName: { contains: query, mode: "insensitive" } },
      { actorEmail: { contains: query, mode: "insensitive" } },
      { entityId: { contains: query, mode: "insensitive" } },
    ];
  }

  const [logs, total, actors] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        actorId: true,
        actorName: true,
        actorEmail: true,
        action: true,
        entity: true,
        entityId: true,
        summary: true,
        detail: true,
        createdAt: true,
      },
    }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({
      by: ["actorId", "actorName", "actorEmail"],
      where: { organizationId: auth.context.organizationId },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: "desc" } },
      take: MAX_ACTORS,
    }),
  ]);

  return Response.json({
    auditLogs: logs,
    auditActors: actors.map((actor) => ({ id: actor.actorId, name: actor.actorName, email: actor.actorEmail })),
    auditTotal: total,
    auditPage: page,
    auditPageSize: pageSize,
  });
}
