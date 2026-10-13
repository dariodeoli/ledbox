import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditPick, recordAudit } from "@/lib/server/audit";
import { readInventoryImageUrl } from "@/lib/server/inventory-images";
import { comboCapacitiesForRange, loadComboDefinitions, saveCombo, substituteComboComponent } from "@/lib/server/inventory-combos";
import { parseDate } from "@/lib/server/inventory-availability";
import { FIELD_MESSAGES, inventorySkuValid, normalizeInventorySku, normalizePersonName, personNameValid, readInventoryPriceValues } from "@/lib/field-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Combos (kits) de inventario, alquileres fase 2c.
 *
 * - `GET`: combos de la empresa con sus componentes y cuántos se pueden armar
 *   (hoy o en `?startsAt&endsAt`), con el componente limitante.
 * - `POST kind=combo-save`: alta (sin `id`) o edición (con `id`) de la composición.
 *   Requiere `inventory.write`. Sin combos dentro de combos.
 * - `POST kind=combo-substitute`: sustitución autorizada de un componente de un
 *   combo ya asignado a un evento, por otro ítem de la misma categoría, con el stock
 *   del sustituto validado. Requiere `inventory.write` y queda auditada.
 */

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const url = new URL(request.url);
  const startsAt = parseDate(url.searchParams.get("startsAt")) ?? new Date();
  const endsAt = parseDate(url.searchParams.get("endsAt")) ?? startsAt;
  if (endsAt.getTime() < startsAt.getTime()) return jsonError("El fin del rango no puede ser anterior al inicio.", 400);

  const definitions = await loadComboDefinitions(organizationId);
  const ids = [...definitions.keys()];
  const [items, capacities] = await Promise.all([
    ids.length
      ? db.inventoryItem.findMany({ where: { id: { in: ids }, organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true, category: true, status: true, notes: true, listPrice: true } })
      : [],
    ids.length ? comboCapacitiesForRange({ organizationId, comboIds: ids, startsAt, endsAt }) : new Map(),
  ]);
  const combos = items.map((item) => {
    const capacity = capacities.get(item.id);
    return {
      ...item,
      capacity: capacity?.capacity ?? 0,
      limiting: capacity?.limiting ?? null,
      components: (capacity?.components ?? []).map((component: { componentId: string }) => ({
        ...component,
        category: definitions.get(item.id)?.components.find((entry) => entry.componentId === component.componentId)?.category ?? "",
      })),
    };
  });
  return Response.json({ combos, range: { startsAt, endsAt } });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";

  if (kind === "combo-save") {
    const id = typeof body.id === "string" && body.id ? body.id : null;
    const name = normalizePersonName(typeof body.name === "string" ? body.name : "");
    if (!personNameValid(name)) return jsonError(FIELD_MESSAGES.name, 400);
    const sku = typeof body.sku === "string" ? normalizeInventorySku(body.sku) : "";
    if (sku && !inventorySkuValid(sku)) return jsonError(FIELD_MESSAGES.sku, 400);
    const imageUrl = body.imageUrl === undefined ? undefined : readInventoryImageUrl(body.imageUrl);
    if (imageUrl === false) return jsonError(FIELD_MESSAGES.image, 400);
    const prices = readInventoryPriceValues(body);
    if (!prices.ok) return jsonError(prices.error, 400);
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : undefined;
    const result = await saveCombo({
      organizationId,
      id,
      data: {
        name,
        category: (typeof body.category === "string" && body.category.trim().slice(0, 80)) || "Combos",
        sku: sku || null,
        ...(notes !== undefined ? { notes: notes || null } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        prices: Object.fromEntries(Object.entries(prices.values).filter(([, value]) => typeof value === "number")),
      },
      components: body.components,
    });
    if (!result.ok) {
      const status = result.reason === "not-found" || result.reason === "component-missing" ? 404 : result.reason === "invalid" ? 400 : 409;
      return jsonError(result.message, status);
    }
    await recordAudit({
      context: auth.context,
      action: result.created ? "create" : "update",
      entity: "InventoryItem",
      entityId: result.combo.id,
      summary: result.created
        ? `Armó el combo «${result.combo.name}» (${result.components.length} componente${result.components.length === 1 ? "" : "s"})`
        : `Editó los componentes del combo «${result.combo.name}»`,
      detail: {
        fields: { ...auditPick(result.combo, ["name", "category"]), componentes: result.components.map((c) => `${c.componentId} × ${c.quantity}`) },
        ...(result.created ? {} : { before: { componentes: result.before.map((c) => `${c.componentId} × ${c.quantity}`) } }),
      },
    });
    return Response.json({ combo: result.combo, components: result.components }, { status: result.created ? 201 : 200 });
  }

  if (kind === "combo-substitute") {
    const assignmentId = typeof body.assignmentId === "string" ? body.assignmentId : "";
    const componentId = typeof body.componentId === "string" ? body.componentId : "";
    const substituteId = typeof body.substituteId === "string" ? body.substituteId : "";
    if (!assignmentId || !componentId || !substituteId) return jsonError("Elegí el combo asignado, el componente y su sustituto.", 400);
    const result = await substituteComboComponent({ organizationId, assignmentId, componentId, substituteId });
    if (!result.ok) {
      const status = result.reason === "not-found" ? 404 : result.reason === "invalid" ? 400 : 409;
      return jsonError(result.message, status);
    }
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "EventInventory",
      entityId: assignmentId,
      summary: `Sustituyó «${result.from.name}» por «${result.to.name}» (${result.units} u.) en el combo «${result.combo.name}» de «${result.event.name}»`,
      detail: { fields: { comboId: result.combo.id, eventId: result.event.id, desde: result.from.id, hacia: result.to.id, unidades: result.units } },
    });
    return Response.json({ ok: true, from: result.from, to: result.to, units: result.units });
  }

  return jsonError("Operación de combos desconocida.", 400);
}
