import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminContext } from "@/lib/server/tenancy";
import {
  archiveWarehouse,
  createWarehouse,
  deleteWarehouse,
  listWarehouses,
  moveUnitsBetweenWarehouses,
  relocateUnitsWithinWarehouse,
  WarehouseMoveConflict,
  setDefaultWarehouse,
  updateWarehouse,
} from "@/lib/server/inventory-warehouses";
import { FIELD_MESSAGES, readInventoryLocation } from "@/lib/field-rules";
import { syncInventoryQuantity } from "@/lib/server/inventory-units";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Depósitos de inventario de la empresa activa (rediseño E1).
 *
 * - `GET`: depósitos con su cantidad de unidades; lo lee cualquier rol.
 * - `POST { kind: "create" | "update" | "default" | "archive" | "restore" | "delete" }`: Ajustes →
 *   Inventario (`org.manage`: solo OWNER y ADMIN). Un depósito con unidades se archiva, no se borra (409).
 * - `POST { kind: "move-units", inventoryId, fromWarehouseId, toWarehouseId, quantity, location? }`:
 *   «Mover N de D1 a D2» (`inventory.write`). Toma unidades DISPONIBLES por orden de código; el total
 *   de unidades del producto no cambia.
 */

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  return Response.json({ warehouses: await listWarehouses(db, auth.context.organizationId) });
}

export async function POST(request: Request) {
  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";
  const auth = await requireAdminContext(kind === "move-units" || kind === "relocate-units" ? "inventory.write" : "org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const id = typeof body.id === "string" ? body.id : "";

  if (kind === "create") {
    const result = await db.$transaction((tx) => createWarehouse(tx, organizationId, body));
    if (!result.ok) return jsonError(result.error, result.status);
    await recordAudit({ context: auth.context, action: "create", entity: "Warehouse", entityId: result.warehouse.id, summary: `Depósito «${result.warehouse.name}» (${result.warehouse.code})`, detail: { fields: { nombre: result.warehouse.name, codigo: result.warehouse.code } } });
    return Response.json({ warehouse: result.warehouse }, { status: 201 });
  }

  if (kind === "move-units") {
    const inventoryId = typeof body.inventoryId === "string" ? body.inventoryId : "";
    const item = inventoryId ? await db.inventoryItem.findFirst({ where: { id: inventoryId, organizationId }, select: { id: true, name: true } }) : null;
    if (!item) return jsonError("El producto no existe en esta empresa.", 404);
    const toWarehouse = typeof body.toWarehouseId === "string" ? await db.warehouse.findFirst({ where: { id: body.toWarehouseId, organizationId }, select: { code: true } }) : null;
    const location = body.location === undefined ? undefined : readInventoryLocation(body.location, toWarehouse?.code);
    if (location === false) return jsonError(FIELD_MESSAGES.location, 400);
    const result = await db.$transaction(async (tx) => {
      const moved = await moveUnitsBetweenWarehouses(tx, {
        organizationId,
        inventoryId: item.id,
        fromWarehouseId: typeof body.fromWarehouseId === "string" ? body.fromWarehouseId : "",
        toWarehouseId: typeof body.toWarehouseId === "string" ? body.toWarehouseId : "",
        quantity: typeof body.quantity === "number" ? body.quantity : Number(body.quantity),
        ...(location !== undefined ? { location } : {}),
      });
      // Mover no cambia cuántas unidades hay; se sincroniza igual como red de seguridad.
      if (moved.ok) await syncInventoryQuantity(tx, item.id);
      return moved;
    }).catch((error: unknown) => {
      if (error instanceof WarehouseMoveConflict) return { ok: false as const, status: 409 as const, error: error.message };
      throw error;
    });
    if (!result.ok) return jsonError(result.error, result.status);
    await recordAudit({ context: auth.context, action: "update", entity: "InventoryItem", entityId: item.id, summary: `Movió ${result.moved} unidad${result.moved === 1 ? "" : "es"} de «${item.name}» entre depósitos`, detail: { fields: { unidades: result.moved, desde: body.fromWarehouseId as string, hasta: body.toWarehouseId as string } } });
    return Response.json({ ok: true, moved: result.moved });
  }

  if (kind === "relocate-units") {
    const inventoryId = typeof body.inventoryId === "string" ? body.inventoryId : "";
    const warehouseId = typeof body.warehouseId === "string" ? body.warehouseId : "";
    const item = inventoryId ? await db.inventoryItem.findFirst({ where: { id: inventoryId, organizationId }, select: { id: true, name: true } }) : null;
    if (!item) return jsonError("El producto no existe en esta empresa.", 404);
    const warehouse = warehouseId ? await db.warehouse.findFirst({ where: { id: warehouseId, organizationId }, select: { code: true } }) : null;
    const location = readInventoryLocation(body.location, warehouse?.code);
    if (location === false) return jsonError(FIELD_MESSAGES.location, 400);
    if (!Array.isArray(body.unitIds) || body.unitIds.some((unitId) => typeof unitId !== "string")) return jsonError("Seleccioná las unidades que querés reubicar.", 400);
    const unitIds = body.unitIds as string[];
    const result = await db.$transaction(async (tx) => {
      const moved = await relocateUnitsWithinWarehouse(tx, { organizationId, inventoryId: item.id, warehouseId, unitIds, location });
      if (!moved.ok) return moved;
      await recordAudit({ context: auth.context, action: "update", entity: "InventoryItem", entityId: item.id, summary: `Reubicó ${moved.moved} unidad${moved.moved === 1 ? "" : "es"} de «${item.name}» dentro de ${warehouse?.code ?? "un depósito"}`, detail: { fields: { unidades: moved.moved, codigos: unitIds, deposito: warehouseId, ubicacion: location } } }, tx);
      return moved;
    }).catch((error: unknown) => {
      if (error instanceof WarehouseMoveConflict) return { ok: false as const, status: 409 as const, error: error.message };
      throw error;
    });
    if (!result.ok) return jsonError(result.error, result.status);
    return Response.json({ ok: true, moved: result.moved });
  }

  if (!["update", "default", "archive", "restore", "delete"].includes(kind)) return jsonError("Operación de depósitos desconocida.", 400);
  if (!id) return jsonError("Falta el depósito.", 400);
  const result = await db.$transaction(async (tx) => {
    if (kind === "update") return updateWarehouse(tx, organizationId, id, body);
    if (kind === "default") return setDefaultWarehouse(tx, organizationId, id);
    if (kind === "delete") return deleteWarehouse(tx, organizationId, id);
    return archiveWarehouse(tx, organizationId, id, kind === "archive");
  }).catch((error: unknown) => {
    // FK RESTRICT: llegaron unidades al depósito justo antes de borrarlo.
    if (kind === "delete" && (error as { code?: string } | null)?.code === "P2003") return { ok: false as const, status: 409 as const, error: "El depósito recibió unidades: archivalo en lugar de borrarlo." };
    throw error;
  });
  if (!result.ok) return jsonError(result.error, result.status);
  const labels: Record<string, string> = { update: "Editó un depósito", default: "Marcó el depósito principal", archive: "Archivó un depósito", restore: "Restauró un depósito", delete: "Eliminó un depósito" };
  await recordAudit({ context: auth.context, action: kind === "delete" ? "delete" : "update", entity: "Warehouse", entityId: id, summary: labels[kind] });
  return Response.json({ ok: true });
}
