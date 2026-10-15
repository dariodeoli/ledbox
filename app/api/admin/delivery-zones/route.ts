import { randomUUID } from "node:crypto";
import { readDeliveryZoneInput } from "@/lib/delivery-zones";
import { auditChanges, recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { listDeliveryZones, zoneView } from "@/lib/server/delivery-zones";
import { jsonError, readJson } from "@/lib/server/http";
import { isUniqueConstraintError } from "@/lib/server/inventory-units";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Zonas de flete de la empresa activa (alquileres P2).
 *
 * - `GET`: cualquier rol con sesión ve las zonas de SU empresa (`?archived=1` suma las archivadas).
 * - `POST`: alta. `PATCH`: edita, archiva (`action: "archive"`) o restaura (`action: "restore"`).
 *   Los montos son plata: requieren `budgets.write` (OWNER, ADMIN, FINANCE); OPERATIONS y VIEWER reciben 403.
 * - Archivar no borra: los presupuestos ya armados conservan su línea de flete (es un snapshot) y
 *   el nombre es único por empresa. Una zona ajena responde 404.
 */

const ZONE_SELECT = { id: true, name: true, basePrice: true, volumeThreshold: true, extraPrice: true, notes: true, sortOrder: true, archivedAt: true } as const;

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const includeArchived = new URL(request.url).searchParams.get("archived") === "1";
  return Response.json({ zones: await listDeliveryZones(auth.context.organizationId, { includeArchived }) });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  const parsed = readDeliveryZoneInput(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  try {
    const zone = await db.deliveryZone.create({ data: { id: randomUUID(), organizationId, ...parsed.value }, select: ZONE_SELECT });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "DeliveryZone",
      entityId: zone.id,
      summary: `Creó la zona de flete «${zone.name}»`,
      detail: { fields: { name: zone.name, basePrice: zone.basePrice, volumeThreshold: zone.volumeThreshold, extraPrice: zone.extraPrice } },
    });
    return Response.json({ zone: zoneView(zone) }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) return jsonError("Ya hay una zona con ese nombre.", 409);
    throw error;
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("budgets.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = ((await readJson(request)) ?? {}) as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return jsonError("Falta la zona de flete.", 400);
  const existing = await db.deliveryZone.findFirst({ where: { id, organizationId }, select: ZONE_SELECT });
  if (!existing) return jsonError("La zona de flete no existe en esta empresa.", 404);

  if (body.action === "archive" || body.action === "restore") {
    const archive = body.action === "archive";
    if (archive === Boolean(existing.archivedAt)) return Response.json({ zone: zoneView(existing) });
    const zone = await db.deliveryZone.update({ where: { id: existing.id }, data: { archivedAt: archive ? new Date() : null }, select: ZONE_SELECT });
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "DeliveryZone",
      entityId: zone.id,
      summary: `${archive ? "Archivó" : "Restauró"} la zona de flete «${zone.name}»`,
      detail: { fields: { archivada: archive } },
    });
    return Response.json({ zone: zoneView(zone) });
  }

  const parsed = readDeliveryZoneInput({ ...existing, ...body });
  if (!parsed.ok) return jsonError(parsed.error, 400);
  try {
    const zone = await db.deliveryZone.update({ where: { id: existing.id }, data: parsed.value, select: ZONE_SELECT });
    const changes = auditChanges(existing, zone, ["name", "basePrice", "volumeThreshold", "extraPrice", "notes", "sortOrder"]);
    if (changes) {
      await recordAudit({ context: auth.context, action: "update", entity: "DeliveryZone", entityId: zone.id, summary: `Editó la zona de flete «${zone.name}»`, detail: { changes } });
    }
    return Response.json({ zone: zoneView(zone) });
  } catch (error) {
    if (isUniqueConstraintError(error)) return jsonError("Ya hay una zona con ese nombre.", 409);
    throw error;
  }
}
