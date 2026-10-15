import type { AdminRole } from "@prisma/client";
import { roleCan } from "@/lib/server/permissions";

/** Campos de costo y de compra de un producto o de una unidad (internos de la empresa). */
const COST_FIELDS = ["replacementCost", "dailyCost", "purchaseCost", "supplierId", "purchasedAt", "warrantyUntil"] as const;

export function canSeeInventoryCosts(context: { role: AdminRole }): boolean {
  return roleCan(context.role, "inventory.costs");
}

function without<T extends Record<string, unknown>>(value: T): T {
  const copy: Record<string, unknown> = { ...value };
  for (const field of COST_FIELDS) delete copy[field];
  return copy as T;
}

/**
 * Única puerta de los costos internos del inventario (reposición, costo diario, costo de compra,
 * proveedor, fecha de compra y garantía). Si el rol no tiene `inventory.costs` (VIEWER) los
 * saca del producto, de sus unidades y de `stock.supplierIds`; si lo tiene, devuelve la fila tal cual.
 * Todo payload de inventario pasa por acá antes de salir.
 */
export function stripInventoryCosts<T extends object>(row: T, context: { role: AdminRole }): T {
  if (canSeeInventoryCosts(context)) return row;
  const copy = without(row as Record<string, unknown>) as Record<string, unknown>;
  if (Array.isArray(copy.units)) copy.units = copy.units.map((unit) => (unit && typeof unit === "object" ? without(unit as Record<string, unknown>) : unit));
  if (copy.stock && typeof copy.stock === "object") copy.stock = { ...(copy.stock as Record<string, unknown>), supplierIds: [] };
  return copy as T;
}
