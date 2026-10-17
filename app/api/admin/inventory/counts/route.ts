import { db } from "@/lib/server/db";
import { jsonError, isJsonObject, readJson } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminContext } from "@/lib/server/tenancy";
import { createInventoryCount, InventoryCountInputError, listInventoryCountHistory } from "@/lib/server/inventory-counts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Historial y registro de conteos físicos. Guardar un conteo nunca modifica el stock. */
export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const requestedTake = Number(params.get("take") ?? 50);
  const take = Number.isInteger(requestedTake) ? Math.min(100, Math.max(1, requestedTake)) : 50;
  const inventoryId = params.get("inventoryId")?.trim() || undefined;
  const warehouseId = params.get("warehouseId")?.trim() || undefined;
  if ((inventoryId && inventoryId.length > 120) || (warehouseId && warehouseId.length > 120)) return jsonError("El filtro de producto o depósito no es válido.", 400);
  const sessions = await listInventoryCountHistory(db, { organizationId: auth.context.organizationId, take, inventoryId, warehouseId });
  return Response.json({ sessions });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const body = await readJson(request);
  if (!isJsonObject(body)) return jsonError("Los datos deben ser un objeto JSON.", 400);
  if (!Array.isArray(body.lines)) return jsonError("La sesión debe incluir la lista de productos contados.", 400);
  const lines = body.lines.map((raw) => {
    if (!isJsonObject(raw)) return null;
    const countedQuantity = Number(raw.countedQuantity);
    return typeof raw.inventoryId === "string" && typeof raw.warehouseId === "string"
      ? { inventoryId: raw.inventoryId, warehouseId: raw.warehouseId, countedQuantity }
      : null;
  });
  if (lines.some((line) => line === null)) return jsonError("Cada fila requiere producto, depósito y cantidad contada.", 400);
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";
  if (notes.length > 1000) return jsonError("Las notas no pueden superar 1000 caracteres.", 400);
  try {
    const session = await db.$transaction((tx) => createInventoryCount(tx, {
      organizationId: auth.context.organizationId,
      actor: { id: auth.context.user.id, name: auth.context.user.name, email: auth.context.user.email },
      lines: lines as NonNullable<(typeof lines)[number]>[], notes,
    }));
    await recordAudit({
      context: auth.context, action: "create", entity: "InventoryCountSession", entityId: session.id,
      summary: `Registró un conteo físico de ${session.lines.length} producto${session.lines.length === 1 ? "" : "s"}`,
      detail: { fields: { lineas: session.lines.length, discrepancias: session.lines.filter((line) => line.discrepancy !== 0).length } },
    });
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof InventoryCountInputError) return jsonError(error.message, error.status);
    throw error;
  }
}
