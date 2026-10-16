import { InventoryOriginError, newPhysicalUnitOrigin } from "./inventory-stock-origin";
import type { StockOriginValue } from "../inventory-stock-origin";
import { randomUUID } from "node:crypto";
import type { Prisma, InventoryUnitStatus } from "@prisma/client";
import { INVENTORY_UNIT_STATUSES } from "@/lib/admin-types";
import { inventoryUnitPrefix, normalizeInventoryUnitCode } from "@/lib/field-rules";
import { lockInventoryItems } from "./inventory-availability";
import { ensureDefaultWarehouse } from "@/lib/server/inventory-warehouses";

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

export class InventoryUnitIncidentConflict extends Error {
  constructor() {
    super("Hay unidades con incidentes abiertos. Resolvé sus incidentes antes de marcarlas como disponibles. No se aplicó ningún cambio.");
  }
}

/** El llamador bloquea los productos primero, igual que el escritor de incidentes. */
export async function assertUnitsAvailableWithoutIncidents(
  tx: Prisma.TransactionClient,
  organizationId: string,
  unitIds: readonly string[],
  status: unknown,
): Promise<void> {
  if (status !== "AVAILABLE") return;
  const open = await tx.inventoryIncident.findFirst({
    where: { organizationId, unitId: { in: [...unitIds] }, status: { in: ["OPEN", "IN_REPAIR"] } },
    select: { id: true },
  });
  if (open) throw new InventoryUnitIncidentConflict();
}

/** Snapshot causal, independiente de relojes y de la precisión de las fechas. Producto ya bloqueado. */
export async function beginInventoryUnitIncidentCycle(tx: Prisma.TransactionClient, organizationId: string, unitId: string): Promise<number> {
  const unit = await tx.inventoryUnit.findFirstOrThrow({ where: { id: unitId, organizationId }, select: { incidentCycle: true } });
  const open = await tx.inventoryIncident.count({ where: { organizationId, unitId, status: { in: ["OPEN", "IN_REPAIR"] } } });
  if (open > 0) return unit.incidentCycle;
  const next = await tx.inventoryUnit.update({ where: { id: unitId }, data: { incidentCycle: { increment: 1 } }, select: { incidentCycle: true } });
  return next.incidentCycle;
}

/**
 * Cantidad del ítem = unidades activas (issue #112): las retiradas no cuentan y
 * la columna `quantity` se sincroniza para no romper los contratos existentes.
 * El llamador debe tomar lockInventoryItems ANTES de mutar unidades; bloquear
 * recién acá no protege una escritura previa ni evita deadlocks de unidades.
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

/** Datos opcionales de una unidad nueva (depósito, ubicación, condición, proveedor, compra, garantía y costo). */
export type NewUnitDetails = {
  stockOrigin?: StockOriginValue;
  ownerSupplierId?: string | null;
  /** Depósito activo ya validado contra la empresa; sin él, el del producto o el principal. */
  warehouseId?: string | null;
  location?: string | null;
  conditionScore?: number | null;
  supplierId?: string | null;
  purchasedAt?: Date | null;
  warrantyUntil?: Date | null;
  purchaseCost?: number;
};

/**
 * Dónde cae una unidad nueva: el depósito pedido, o el que propone el producto, o el principal
 * de la empresa (que se crea solo la primera vez). Toda unidad nace con depósito.
 */
export async function resolveUnitPlacement(
  tx: Prisma.TransactionClient,
  organizationId: string,
  inventoryId: string,
  details: Pick<NewUnitDetails, "warehouseId" | "location">,
): Promise<{ warehouseId: string; location: string | null }> {
  if (details.warehouseId) return { warehouseId: details.warehouseId, location: details.location ?? null };
  const item = await tx.inventoryItem.findFirst({
    where: { id: inventoryId, organizationId },
    select: { defaultLocation: true, defaultWarehouse: { select: { id: true, archivedAt: true } } },
  });
  if (item?.defaultWarehouse && !item.defaultWarehouse.archivedAt) {
    return { warehouseId: item.defaultWarehouse.id, location: details.location !== undefined ? details.location : item.defaultLocation };
  }
  const principal = await ensureDefaultWarehouse(tx, organizationId);
  return { warehouseId: principal.id, location: details.location ?? null };
}

/**
 * Crea las unidades iniciales de un ítem nuevo: una por unidad pedida, todas
 * disponibles. El ítem ya viene creado con `quantity`; sincronizar al final deja
 * el número igual a las unidades reales. También es la «compra» de unidades
 * nuevas: acepta depósito, ubicación, condición, proveedor, fecha, garantía y costo.
 */
export async function createInventoryUnits(
  tx: Prisma.TransactionClient,
  options: { organizationId: string; inventoryId: string; name: string; quantity: number } & NewUnitDetails,
): Promise<number> {
  if (!Number.isSafeInteger(options.quantity) || options.quantity < 0) throw new InventoryOriginError("La cantidad física debe ser un entero mayor o igual a cero.");
  const quantity = options.quantity;
  if (quantity === 0) return 0;
  await lockInventoryItems(tx, options.organizationId, [options.inventoryId]);
  const origin = await newPhysicalUnitOrigin(tx, options.organizationId, options.inventoryId, options);
  const placement = await resolveUnitPlacement(tx, options.organizationId, options.inventoryId, options);
  for (let index = 0; index < quantity; index += 1) {
    const code = await nextInventoryUnitCode(tx, options.organizationId, options.name);
    await tx.inventoryUnit.create({
      data: {
        id: randomUUID(),
        organizationId: options.organizationId,
        inventoryId: options.inventoryId,
        code,
        status: "AVAILABLE",
        ...origin,
        purchaseCost: options.purchaseCost ?? 0,
        notes: null,
        warehouseId: placement.warehouseId,
        location: placement.location,
        conditionScore: options.conditionScore ?? null,
        supplierId: options.supplierId ?? null,
        purchasedAt: options.purchasedAt ?? null,
        warrantyUntil: options.warrantyUntil ?? null,
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
