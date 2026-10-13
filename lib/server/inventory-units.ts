import { randomUUID } from "node:crypto";
import type { Prisma, InventoryUnitStatus } from "@prisma/client";
import { INVENTORY_UNIT_STATUSES } from "@/lib/admin-types";
import { inventoryUnitPrefix, normalizeInventoryUnitCode } from "@/lib/field-rules";

/**
 * Unidades físicas del ítem de inventario (issue #112). Acá viven las reglas que
 * comparten el alta del ítem (crea las unidades iniciales) y la edición (agrega,
 * cambia de estado o retira):
 *
 * - `quantity` del ítem = unidades activas (no retiradas), sincronizada siempre.
 * - El código es legible y único por empresa; si no lo elige la persona, se
 *   autogenera `PREFIJO-NN` con consecutivo global por prefijo.
 *
 * El mismo criterio de prefijo está en el backfill de la migración
 * `202610010004_inventory_units` (si cambia, actualizá los dos).
 */

/** Tope de las notas de una unidad (nota corta de equipo). */
export const MAX_UNIT_NOTES = 400;

/**
 * Cantidad del ítem = unidades activas (issue #112): las retiradas no cuentan y
 * la columna `quantity` se sincroniza para no romper los contratos existentes.
 */
export async function syncInventoryQuantity(tx: Prisma.TransactionClient, inventoryId: string): Promise<number> {
  const quantity = await tx.inventoryUnit.count({ where: { inventoryId, status: { not: "RETIRED" } } });
  await tx.inventoryItem.update({ where: { id: inventoryId }, data: { quantity } });
  return quantity;
}

/**
 * Código autogenerado de una unidad nueva: `KIO-01`, `KIO-02`… El consecutivo es
 * global por prefijo dentro de la empresa (dos ítems con el mismo prefijo no
 * chocan) y contempla los códigos ya usados, editados a mano incluidos.
 */
export async function nextInventoryUnitCode(
  tx: Prisma.TransactionClient,
  organizationId: string,
  itemName: string,
): Promise<string> {
  const prefix = inventoryUnitPrefix(itemName);
  const used = await tx.inventoryUnit.findMany({
    where: { organizationId, code: { startsWith: `${prefix}-` } },
    select: { code: true },
  });
  let max = 0;
  for (const unit of used) {
    const match = unit.code.slice(prefix.length + 1).match(/^\d+/);
    if (match) max = Math.max(max, Number(match[0]));
  }
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

/**
 * Crea las unidades iniciales de un ítem nuevo: una por unidad pedida, todas
 * disponibles. El ítem ya viene creado con `quantity`; sincronizar al final deja
 * el número igual a las unidades reales.
 */
export async function createInventoryUnits(
  tx: Prisma.TransactionClient,
  options: { organizationId: string; inventoryId: string; name: string; quantity: number },
): Promise<number> {
  const quantity = Number.isInteger(options.quantity) && options.quantity > 0 ? options.quantity : 1;
  for (let index = 0; index < quantity; index += 1) {
    const code = await nextInventoryUnitCode(tx, options.organizationId, options.name);
    await tx.inventoryUnit.create({
      data: {
        id: randomUUID(),
        organizationId: options.organizationId,
        inventoryId: options.inventoryId,
        code,
        status: "AVAILABLE",
        purchaseCost: 0,
        notes: null,
      },
    });
  }
  await syncInventoryQuantity(tx, options.inventoryId);
  return quantity;
}

/** Choque de unicidad de Prisma (P2002): el código de la unidad ya existe. */
export function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/** Estado de unidad válido o `null` (issue #112). */
export function readInventoryUnitStatus(raw: unknown): InventoryUnitStatus | null {
  const status = String(raw ?? "");
  return (INVENTORY_UNIT_STATUSES as readonly string[]).includes(status) ? (status as InventoryUnitStatus) : null;
}

/** Código de unidad normalizado tal como llega (recortado y en mayúsculas). */
export function readInventoryUnitCode(raw: unknown): string {
  return normalizeInventoryUnitCode(typeof raw === "string" ? raw : "");
}
