import type { Prisma } from "@prisma/client";
import { readStockOrigin, type OriginPair } from "@/lib/inventory-stock-origin";

export class InventoryOriginError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}
export const ITEM_ORIGIN_FIELDS = { origin: "defaultStockOrigin", supplier: "defaultSourceSupplierId" };
export const UNIT_ORIGIN_FIELDS = { origin: "stockOrigin", supplier: "ownerSupplierId" };

export async function validatedStockOrigin(tx: Prisma.TransactionClient, organizationId: string, body: Record<string, unknown>, target: "item" | "unit", current: OriginPair = { origin: null, supplierId: null }) {
  const fields = target === "item" ? ITEM_ORIGIN_FIELDS : UNIT_ORIGIN_FIELDS;
  const parsed = readStockOrigin(body, fields, current, target === "unit");
  if (!parsed.ok) throw new InventoryOriginError(parsed.error);
  if (parsed.changed && parsed.value.supplierId && (parsed.value.origin !== current.origin || parsed.value.supplierId !== current.supplierId)) {
    const supplier = await tx.supplier.findFirst({ where: { id: parsed.value.supplierId, organizationId, active: true }, select: { id: true } });
    if (!supplier) throw new InventoryOriginError("El tercero no existe o no está activo en esta empresa.", 404);
  }
  return parsed;
}

/** API metadata edits must not silently replace an ownership edit made elsewhere.
 * Call only under the canonical inventory lock, with a freshly read pair. */
export function assertOriginExpected(body: Record<string, unknown>, current: OriginPair, next: OriginPair, target: "item" | "unit") {
  if (current.origin === next.origin && current.supplierId === next.supplierId) return;
  const fields = target === "item" ? ["expectedDefaultStockOrigin", "expectedDefaultSourceSupplierId"] : ["expectedStockOrigin", "expectedOwnerSupplierId"];
  if (!(fields[0] in body) || !(fields[1] in body)) throw new InventoryOriginError("Volvé a cargar la ficha antes de cambiar el origen o el dueño.", 409);
  if (body[fields[0]] !== current.origin || body[fields[1]] !== current.supplierId) throw new InventoryOriginError("El origen o el dueño cambió en otra ventana. Recargá la ficha antes de guardar.", 409);
}

/** Defaults are copied once into a NEW unit, never applied retrospectively. */
export async function newPhysicalUnitOrigin(tx: Prisma.TransactionClient, organizationId: string, inventoryId: string, body: Record<string, unknown> = {}) {
  const item = await tx.inventoryItem.findFirst({ where: { id: inventoryId, organizationId }, select: { defaultStockOrigin: true, defaultSourceSupplierId: true } });
  if (!item) throw new InventoryOriginError("El producto no existe en esta empresa.", 404);
  if (item.defaultStockOrigin === "EXTERNAL_RENTAL" && (body.stockOrigin === undefined || body.stockOrigin === null || body.stockOrigin === "")) {
    throw new InventoryOriginError("El alquiler externo por evento no crea stock físico. Sólo agregá una unidad si registrás explícitamente que es propia o consignada.");
  }
  const input = {
    stockOrigin: body.stockOrigin === undefined ? item.defaultStockOrigin : body.stockOrigin,
    ownerSupplierId: body.ownerSupplierId === undefined ? (body.stockOrigin !== undefined && body.stockOrigin !== item.defaultStockOrigin ? null : item.defaultSourceSupplierId) : body.ownerSupplierId,
  };
  const parsed = await validatedStockOrigin(tx, organizationId, input, "unit");
  return { stockOrigin: parsed.value.origin, ownerSupplierId: parsed.value.supplierId };
}
