import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { categoryWriteData, resolveInventoryCategory } from "@/lib/server/inventory-categories";
import { ensureDefaultWarehouse } from "@/lib/server/inventory-warehouses";

/**
 * Taxonomía y trazabilidad del inventario de la demo (rediseño E1): categorías con subcategorías,
 * dos depósitos con ubicación, condición por unidad y proveedor/compra/garantía de algunos equipos.
 *
 * Las categorías pasan por el helper único `resolveInventoryCategory` (nadie escribe `category` a
 * mano). Se aplica después de crear productos y unidades, dentro de la misma transacción; con una
 * sandbox el `tx` ya viene envuelto y reescribe los ids `demo_*`.
 */

type Tx = Prisma.TransactionClient;

/** Categoría con subcategoría de algunos productos de la demo (ruta «Categoría / Subcategoría»). */
const DEMO_CATEGORY_PATHS: Record<string, string> = {
  demo_inv_led_p3: "Pantallas LED / Interior",
  demo_inv_led_p5: "Pantallas LED / Exterior",
  demo_inv_parlante: "Sonido / Parlantes",
  demo_inv_mezcladora: "Sonido / Consolas",
  demo_inv_tripode: "Sonido / Soportes",
  demo_inv_microfono: "Sonido / Micrófonos",
  demo_inv_truss: "Estructuras / Truss",
  demo_inv_panels: "Estructuras / Bastidores",
};

/** Productos que viven en el depósito secundario (D2). */
const DEMO_SECONDARY_WAREHOUSE = ["demo_inv_cable", "demo_inv_tripode", "demo_inv_microfono", "demo_inv_dispenser"];

/** Proveedor, días de compra (hacia atrás) y días hasta que vence la garantía (desde hoy). */
const DEMO_PURCHASES: Record<string, { supplierId: string; boughtDaysAgo: number; warrantyInDays: number }> = {
  demo_inv_parlante: { supplierId: "demo_supplier_audio", boughtDaysAgo: 340, warrantyInDays: 20 },
  demo_inv_mezcladora: { supplierId: "demo_supplier_audio", boughtDaysAgo: 200, warrantyInDays: 165 },
  demo_inv_microfono: { supplierId: "demo_supplier_audio", boughtDaysAgo: 120, warrantyInDays: 245 },
  demo_inv_generador: { supplierId: "demo_supplier_electricidad", boughtDaysAgo: 400, warrantyInDays: 330 },
  demo_inv_truss: { supplierId: "demo_supplier_carpinteria", boughtDaysAgo: 520, warrantyInDays: 0 },
  demo_inv_led_p3: { supplierId: "demo_supplier_electricidad", boughtDaysAgo: 260, warrantyInDays: 105 },
};

const addDays = (base: Date, days: number) => new Date(base.getTime() + days * 86_400_000);

export async function seedDemoInventoryTaxonomy(
  tx: Tx,
  options: { organizationId: string; base: Date; items: ReadonlyArray<{ id: string; category: string }>; units: ReadonlyArray<{ inventoryId: string }> },
): Promise<void> {
  const { organizationId, base } = options;

  // 1) Categorías: una resolución por texto distinto y un solo UPDATE por categoría.
  const idsByText = new Map<string, string[]>();
  for (const item of options.items) {
    const text = DEMO_CATEGORY_PATHS[item.id] ?? item.category;
    idsByText.set(text, [...(idsByText.get(text) ?? []), item.id]);
  }
  for (const [text, ids] of idsByText) {
    const resolved = await resolveInventoryCategory(tx, organizationId, { category: text });
    if (!resolved) throw new Error(`No se pudo resolver la categoría de la demo «${text}».`);
    await tx.inventoryItem.updateMany({ where: { organizationId, id: { in: ids } }, data: categoryWriteData(resolved) });
  }

  // 2) Depósitos: el principal (D1) y un secundario (D2). Toda unidad queda con depósito.
  const principal = await ensureDefaultWarehouse(tx, organizationId);
  const secondaryId = `wh_${randomUUID()}`;
  await tx.warehouse.create({ data: { id: secondaryId, organizationId, name: "Depósito Planta Alta", code: "D2", address: "Planta alta del taller" } });
  await tx.inventoryUnit.updateMany({ where: { organizationId }, data: { warehouseId: principal.id } });
  await tx.inventoryUnit.updateMany({ where: { organizationId, inventoryId: { in: DEMO_SECONDARY_WAREHOUSE } }, data: { warehouseId: secondaryId } });
  await tx.inventoryItem.updateMany({ where: { organizationId, id: { in: DEMO_SECONDARY_WAREHOUSE } }, data: { defaultWarehouseId: secondaryId } });
  await tx.inventoryItem.updateMany({ where: { organizationId, id: { notIn: DEMO_SECONDARY_WAREHOUSE } }, data: { defaultWarehouseId: principal.id } });

  // 3) Ubicación (estante-nivel) por producto, en el depósito donde vive.
  const inventoryIds = [...new Set(options.units.map((unit) => unit.inventoryId))].sort();
  for (const [index, inventoryId] of inventoryIds.entries()) {
    await tx.inventoryUnit.updateMany({ where: { organizationId, inventoryId }, data: { location: `E${(index % 6) + 1}-B${(index % 3) + 1}` } });
  }

  // 4) Condición 1 a 10 según el estado de cada unidad (determinística: no cambia entre cargas).
  await tx.$executeRaw`
    UPDATE "InventoryUnit"
    SET "conditionScore" = CASE "status"
      WHEN 'AVAILABLE' THEN 10 - (abs(hashtext("code")) % 3)
      WHEN 'MAINTENANCE' THEN 6
      WHEN 'DAMAGED' THEN 3
      ELSE NULL
    END
    WHERE "organizationId" = ${organizationId}`;

  // 5) Proveedor, compra y garantía de algunos equipos (lote del producto; las unidades heredan).
  for (const [id, purchase] of Object.entries(DEMO_PURCHASES)) {
    await tx.inventoryItem.updateMany({
      where: { organizationId, id },
      data: { supplierId: purchase.supplierId, purchasedAt: addDays(base, -purchase.boughtDaysAgo), warrantyUntil: addDays(base, purchase.warrantyInDays) },
    });
  }
}
