import type { InventoryIncidentKind, InventoryIncidentStatus, Prisma } from "@prisma/client";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import {
  INCIDENT_KINDS,
  INCIDENT_TRANSITIONS,
  createIncident,
  transitionIncident,
  type IncidentTransition,
} from "@/lib/server/inventory-operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Incidentes de inventario (alquileres fase 4, issue #179).
 *
 * - `GET ?status=open|closed|all|OPEN,IN_REPAIR…&eventId&inventoryId&unitId&assignmentId`: incidentes de la
 *   empresa activa con ítem, unidad y evento. Es el historial de la unidad y de la reserva.
 * - `GET ?units=<inventoryId>`: unidades con código elegibles para marcar dañadas o faltantes.
 * - `POST {kind:"create"}`: alta manual (reparación o limpieza de una unidad o cantidad).
 * - `POST {kind:"transition", id, to:"IN_REPAIR"|"RESOLVED"|"WRITTEN_OFF", cost?, notes?}`.
 *
 * Los daños y faltantes de una devolución se abren desde `POST /api/admin/inventory`
 * (`kind:"checkin"`), en la misma transacción que la devolución.
 */

const STATUSES: readonly InventoryIncidentStatus[] = ["OPEN", "IN_REPAIR", "RESOLVED", "WRITTEN_OFF"];
const MAX_LIST = 300;

function readStatuses(raw: string | null): InventoryIncidentStatus[] | null {
  const value = (raw ?? "open").trim();
  if (value === "all") return null;
  if (value === "open") return ["OPEN", "IN_REPAIR"];
  if (value === "closed") return ["RESOLVED", "WRITTEN_OFF"];
  const parsed = value.split(",").map((part) => part.trim().toUpperCase());
  return parsed.filter((part): part is InventoryIncidentStatus => (STATUSES as readonly string[]).includes(part));
}

function readCost(value: unknown): number | null | false {
  if (value === undefined || value === null || value === "") return null;
  const cost = Number(value);
  return Number.isInteger(cost) && cost >= 0 && cost <= 2_000_000_000 ? cost : false;
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const params = new URL(request.url).searchParams;
  // `?units=<inventoryId>`: unidades con código que se pueden marcar dañadas o faltantes
  // (las que ya figuran dañadas, perdidas o retiradas no se ofrecen).
  const unitsOf = params.get("units");
  if (unitsOf) {
    const units = await db.inventoryUnit.findMany({
      where: { organizationId, inventoryId: unitsOf, status: { in: ["AVAILABLE", "MAINTENANCE"] } },
      orderBy: { code: "asc" },
      take: 500,
      select: { id: true, code: true, status: true },
    });
    return Response.json({ units });
  }
  const statuses = readStatuses(params.get("status"));
  const where: Prisma.InventoryIncidentWhereInput = { organizationId };
  if (statuses) where.status = { in: statuses };
  for (const field of ["eventId", "inventoryId", "unitId", "assignmentId"] as const) {
    const value = params.get(field);
    if (value) where[field] = value;
  }
  const incidents = await db.inventoryIncident.findMany({
    where,
    orderBy: [{ openedAt: "desc" }],
    take: MAX_LIST,
    include: {
      inventory: { select: { id: true, name: true, sku: true, _count: { select: { units: true } } } },
      unit: { select: { id: true, code: true, status: true } },
      event: { select: { id: true, name: true } },
    },
  });
  return Response.json({ incidents });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";

  if (kind === "create") {
    const inventoryId = typeof body.inventoryId === "string" ? body.inventoryId : "";
    if (!inventoryId) return jsonError("Elegí el ítem de inventario.", 400);
    const incidentKind = typeof body.incidentKind === "string" ? body.incidentKind : "";
    if (!(INCIDENT_KINDS as readonly string[]).includes(incidentKind)) return jsonError("El tipo de incidente no es válido.", 400);
    const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) return jsonError("La cantidad debe ser un entero mayor a cero.", 400);
    const cost = readCost(body.cost);
    if (cost === false) return jsonError("Ingresá un costo válido en guaraníes.", 400);
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length > 400) return jsonError("Las notas no pueden superar 400 caracteres.", 400);
    const str = (value: unknown) => (typeof value === "string" && value ? value : null);
    const result = await createIncident({
      organizationId,
      inventoryId,
      kind: incidentKind as InventoryIncidentKind,
      quantity,
      unitId: str(body.unitId),
      eventId: str(body.eventId),
      assignmentId: str(body.assignmentId),
      notes,
      cost,
      actorId: auth.context.user.id,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "InventoryIncident",
      entityId: result.incident.id,
      summary: `Abrió un incidente de ${incidentKind === "DAMAGE" ? "daño" : incidentKind === "MISSING" ? "faltante" : incidentKind === "REPAIR" ? "reparación" : "limpieza"} en «${result.itemName}»`,
      detail: { fields: { kind: incidentKind, quantity: result.incident.quantity, unitId: result.incident.unitId, eventId: result.incident.eventId } },
    });
    return Response.json({ incident: result.incident }, { status: 201 });
  }

  if (kind === "transition") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta el incidente.", 400);
    const to = typeof body.to === "string" ? body.to : "";
    if (!(INCIDENT_TRANSITIONS as readonly string[]).includes(to)) return jsonError("El estado destino no es válido.", 400);
    const cost = readCost(body.cost);
    if (cost === false) return jsonError("Ingresá un costo válido en guaraníes.", 400);
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length > 400) return jsonError("Las notas no pueden superar 400 caracteres.", 400);
    const result = await transitionIncident({
      organizationId,
      incidentId: id,
      to: to as IncidentTransition,
      cost,
      notes,
      actorId: auth.context.user.id,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    const label = to === "IN_REPAIR" ? "pasó a reparación" : to === "RESOLVED" ? "se resolvió" : "se dio de baja";
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "InventoryIncident",
      entityId: result.incident.id,
      summary: `El incidente de «${result.before.inventory.name}»${result.before.unit ? ` (${result.before.unit.code})` : ""} ${label}`,
      detail: { changes: { status: { from: result.before.status, to: result.incident.status } }, fields: { cost: result.incident.cost } },
    });
    return Response.json({ incident: result.incident });
  }

  return jsonError("Operación de incidentes desconocida.", 400);
}
