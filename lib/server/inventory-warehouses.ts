import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { lockInventoryItems } from "@/lib/server/inventory-availability";
import { committedAssignmentWhere } from "@/lib/server/inventory-availability";
import { INVENTORY_TAXONOMY_NAME_MAX, FIELD_MESSAGES, normalizeWarehouseCode, warehouseCodeValid } from "@/lib/field-rules";

/**
 * Depósitos de inventario (rediseño E1). El depósito y la ubicación viven en la **unidad**: el
 * «stock por depósito» es un `groupBy` de unidades, nunca un segundo número. Las reservas no eligen
 * depósito (la disponibilidad sigue global por producto); el depósito dice dónde buscar.
 *
 * Toda unidad nace con depósito: el principal de la empresa (D1), que se crea solo la primera vez.
 */

type Tx = Prisma.TransactionClient;

export const DEFAULT_WAREHOUSE_NAME = "Depósito principal";
export const DEFAULT_WAREHOUSE_CODE = "D1";

/** Depósito principal de la empresa; lo crea si todavía no existe (idempotente, sin pisarse). */
export async function ensureDefaultWarehouse(tx: Tx, organizationId: string): Promise<{ id: string; code: string }> {
  const existing = await tx.warehouse.findFirst({ where: { organizationId, isDefault: true }, select: { id: true, code: true } });
  if (existing) return existing;
  await tx.warehouse.createMany({
    data: [{ id: `wh_${randomUUID()}`, organizationId, name: DEFAULT_WAREHOUSE_NAME, code: DEFAULT_WAREHOUSE_CODE, isDefault: true }],
    skipDuplicates: true,
  });
  const created = await tx.warehouse.findFirst({ where: { organizationId, isDefault: true }, select: { id: true, code: true } });
  if (created) return created;
  // D1 ya existía como depósito común: pasa a ser el principal.
  const d1 = await tx.warehouse.findFirstOrThrow({ where: { organizationId, code: DEFAULT_WAREHOUSE_CODE }, select: { id: true, code: true } });
  await tx.warehouse.update({ where: { id: d1.id }, data: { isDefault: true } });
  return d1;
}

/** Un depósito activo de la empresa (o `null` si el id es ajeno o está archivado). */
export async function findUsableWarehouse(tx: Tx, organizationId: string, id: string) {
  return tx.warehouse.findFirst({ where: { id, organizationId, archivedAt: null }, select: { id: true, code: true, name: true } });
}

/** Depósito activo por código (para la importación). */
export async function findWarehouseByCode(tx: Tx, organizationId: string, rawCode: string) {
  const code = normalizeWarehouseCode(rawCode);
  if (!code) return null;
  return tx.warehouse.findFirst({ where: { organizationId, code, archivedAt: null }, select: { id: true, code: true, name: true } });
}

export type WarehouseFailure = { ok: false; status: 400 | 404 | 409; error: string };
const fail = (status: WarehouseFailure["status"], error: string): WarehouseFailure => ({ ok: false, status, error });

export type WarehouseInput = { name?: unknown; code?: unknown; address?: unknown; sortOrder?: unknown };

/** Cambia la ubicación de unidades explícitas dentro del mismo depósito. */
export async function relocateUnitsWithinWarehouse(
  tx: Tx,
  options: { organizationId: string; inventoryId: string; warehouseId: string; unitIds: readonly string[]; location: string | null },
): Promise<{ ok: true; moved: number } | WarehouseFailure> {
  const { organizationId, inventoryId, warehouseId } = options;
  const unitIds = [...new Set(options.unitIds)];
  if (unitIds.length === 0 || unitIds.length > 200 || unitIds.length !== options.unitIds.length || unitIds.some((id) => !id || id.length > 200)) {
    return fail(400, "Seleccioná entre 1 y 200 unidades distintas.");
  }
  const [item, warehouse] = await Promise.all([
    tx.inventoryItem.findFirst({ where: { id: inventoryId, organizationId }, select: { id: true } }),
    findUsableWarehouse(tx, organizationId, warehouseId),
  ]);
  if (!item) return fail(404, "El producto no existe en esta empresa.");
  if (!warehouse) return fail(404, "El depósito no existe en esta empresa.");
  await lockInventoryItems(tx, organizationId, [inventoryId]);
  // Las reservas se guardan por producto, no por código físico. Hasta que el modelo
  // permita asignar una unidad a una reserva, cualquier compromiso vivo bloquea
  // reubicar unidades de ese producto para no mover una unidad reservada a ciegas.
  const committed = await tx.eventInventory.count({ where: { organizationId, inventoryId, ...committedAssignmentWhere(organizationId) } });
  if (committed > 0) return fail(409, "El producto tiene unidades reservadas o comprometidas; liberá la reserva antes de cambiar ubicaciones.");
  const units = await tx.inventoryUnit.findMany({
    where: { organizationId, inventoryId, id: { in: unitIds } },
    select: { id: true, status: true, warehouseId: true },
  });
  if (units.length !== unitIds.length) return fail(404, "Una o más unidades no pertenecen a este producto y empresa.");
  if (units.some((unit) => unit.status !== "AVAILABLE" || unit.warehouseId !== warehouseId)) {
    return fail(409, "Solo se pueden reubicar unidades disponibles del mismo depósito.");
  }
  const result = await tx.inventoryUnit.updateMany({
    where: { organizationId, inventoryId, id: { in: unitIds }, status: "AVAILABLE", warehouseId },
    data: { location: options.location },
  });
  if (result.count !== unitIds.length) throw new WarehouseMoveConflict(result.count);
  return { ok: true, moved: result.count };
}

function readName(raw: unknown): string | null {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  return name && name.length <= INVENTORY_TAXONOMY_NAME_MAX ? name : null;
}

export async function createWarehouse(tx: Tx, organizationId: string, input: WarehouseInput): Promise<{ ok: true; warehouse: { id: string; name: string; code: string } } | WarehouseFailure> {
  const name = readName(input.name);
  if (!name) return fail(400, `Ingresá el nombre del depósito (hasta ${INVENTORY_TAXONOMY_NAME_MAX} caracteres).`);
  const code = normalizeWarehouseCode(typeof input.code === "string" ? input.code : "");
  if (!warehouseCodeValid(typeof input.code === "string" ? input.code : "")) return fail(400, FIELD_MESSAGES.warehouseCode);
  const address = typeof input.address === "string" ? input.address.trim().slice(0, 400) : "";
  if (await tx.warehouse.findFirst({ where: { organizationId, code }, select: { id: true } })) return fail(409, `Ya hay un depósito con el código ${code}.`);
  // Si es el primero de la empresa, queda como principal.
  const first = (await tx.warehouse.count({ where: { organizationId } })) === 0;
  const created = await tx.warehouse.create({
    data: { id: `wh_${randomUUID()}`, organizationId, name, code, address: address || null, isDefault: first },
    select: { id: true, name: true, code: true },
  });
  return { ok: true, warehouse: created };
}

export async function updateWarehouse(tx: Tx, organizationId: string, id: string, input: WarehouseInput): Promise<{ ok: true } | WarehouseFailure> {
  const existing = await tx.warehouse.findFirst({ where: { id, organizationId } });
  if (!existing) return fail(404, "El depósito no existe en esta empresa.");
  const data: Prisma.WarehouseUpdateInput = {};
  if (input.name !== undefined) {
    const name = readName(input.name);
    if (!name) return fail(400, `Ingresá el nombre del depósito (hasta ${INVENTORY_TAXONOMY_NAME_MAX} caracteres).`);
    data.name = name;
  }
  if (input.code !== undefined) {
    const code = normalizeWarehouseCode(typeof input.code === "string" ? input.code : "");
    if (!warehouseCodeValid(typeof input.code === "string" ? input.code : "")) return fail(400, FIELD_MESSAGES.warehouseCode);
    if (code !== existing.code && (await tx.warehouse.findFirst({ where: { organizationId, code, id: { not: id } }, select: { id: true } }))) return fail(409, `Ya hay un depósito con el código ${code}.`);
    data.code = code;
  }
  if (input.address !== undefined) {
    const address = typeof input.address === "string" ? input.address.trim().slice(0, 400) : "";
    data.address = address || null;
  }
  if (input.sortOrder !== undefined) {
    if (typeof input.sortOrder !== "number" || !Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 9999) return fail(400, "El orden es un entero de 0 a 9999.");
    data.sortOrder = input.sortOrder;
  }
  await tx.warehouse.update({ where: { id }, data });
  return { ok: true };
}

/** Marca el depósito principal (el de las altas nuevas). */
export async function setDefaultWarehouse(tx: Tx, organizationId: string, id: string): Promise<{ ok: true } | WarehouseFailure> {
  const target = await tx.warehouse.findFirst({ where: { id, organizationId } });
  if (!target) return fail(404, "El depósito no existe en esta empresa.");
  if (target.archivedAt) return fail(409, "Un depósito archivado no puede ser el principal.");
  await tx.warehouse.updateMany({ where: { organizationId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
  await tx.warehouse.update({ where: { id }, data: { isDefault: true } });
  return { ok: true };
}

/** Archiva o restaura. El principal no se archiva; un depósito con unidades solo se archiva (nunca se borra). */
export async function archiveWarehouse(tx: Tx, organizationId: string, id: string, archive: boolean): Promise<{ ok: true } | WarehouseFailure> {
  const target = await tx.warehouse.findFirst({ where: { id, organizationId } });
  if (!target) return fail(404, "El depósito no existe en esta empresa.");
  if (archive && target.isDefault) return fail(409, "Es el depósito principal: marcá otro como principal antes de archivarlo.");
  await tx.warehouse.update({ where: { id }, data: { archivedAt: archive ? target.archivedAt ?? new Date() : null } });
  return { ok: true };
}

/** Borrado: solo un depósito sin unidades, sin productos que lo propongan y que no sea el principal. */
export async function deleteWarehouse(tx: Tx, organizationId: string, id: string): Promise<{ ok: true } | WarehouseFailure> {
  const target = await tx.warehouse.findFirst({ where: { id, organizationId } });
  if (!target) return fail(404, "El depósito no existe en esta empresa.");
  if (target.isDefault) return fail(409, "Es el depósito principal: no se puede borrar.");
  // Lock de la fila del depósito: un alta o movimiento de unidades hacia él toma `FOR KEY SHARE` por la FK
  // y espera acá; con la FK en RESTRICT, si igual ganara la carrera el borrado falla en vez de dejar `warehouseId` en NULL.
  const locked = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "Warehouse" WHERE "id" = ${id} AND "organizationId" = ${organizationId} FOR UPDATE`,
  );
  if (locked.length === 0) return fail(404, "El depósito no existe en esta empresa.");
  const units = await tx.inventoryUnit.count({ where: { organizationId, warehouseId: id } });
  if (units > 0) return fail(409, `Tiene ${units} unidad${units === 1 ? "" : "es"}: archivalo en lugar de borrarlo.`);
  await tx.warehouse.delete({ where: { id } });
  return { ok: true };
}

/** Depósitos con su cantidad de unidades (no retiradas). */
export async function listWarehouses(tx: Tx, organizationId: string) {
  const [rows, counts] = await Promise.all([
    tx.warehouse.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    tx.inventoryUnit.groupBy({ by: ["warehouseId"], where: { organizationId, status: { not: "RETIRED" } }, _count: { _all: true } }),
  ]);
  const byId = new Map(counts.map((row) => [row.warehouseId, row._count._all]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code,
    address: row.address,
    sortOrder: row.sortOrder,
    isDefault: row.isDefault,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    unitCount: byId.get(row.id) ?? 0,
  }));
}

/** Mueve unidades DISPONIBLES de un depósito a otro, por orden de código. La cantidad de unidades no cambia. */
export async function moveUnitsBetweenWarehouses(
  tx: Tx,
  options: { organizationId: string; inventoryId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; location?: string | null },
): Promise<{ ok: true; moved: number } | WarehouseFailure> {
  const { organizationId, inventoryId, fromWarehouseId, toWarehouseId } = options;
  if (fromWarehouseId === toWarehouseId) return fail(400, "Elegí dos depósitos distintos.");
  if (!Number.isInteger(options.quantity) || options.quantity < 1) return fail(400, "La cantidad a mover debe ser un entero mayor a cero.");
  const [from, to] = await Promise.all([
    tx.warehouse.findFirst({ where: { id: fromWarehouseId, organizationId }, select: { id: true } }),
    findUsableWarehouse(tx, organizationId, toWarehouseId),
  ]);
  if (!from || !to) return fail(404, "El depósito no existe en esta empresa.");
  // Mismo lock que las confirmaciones de reserva: el movimiento no se cruza con una asignación en curso.
  await lockInventoryItems(tx, organizationId, [inventoryId]);
  const units = await tx.inventoryUnit.findMany({
    where: { organizationId, inventoryId, warehouseId: fromWarehouseId, status: "AVAILABLE" },
    orderBy: { code: "asc" },
    take: options.quantity,
    select: { id: true },
  });
  if (units.length < options.quantity) return fail(409, `Solo hay ${units.length} unidad${units.length === 1 ? "" : "es"} disponible${units.length === 1 ? "" : "s"} en ese depósito.`);
  // El `where` repite estado y depósito de origen: si una unidad cambió entre la lectura y la escritura no se mueve.
  const result = await tx.inventoryUnit.updateMany({
    where: { organizationId, inventoryId, id: { in: units.map((unit) => unit.id) }, status: "AVAILABLE", warehouseId: fromWarehouseId },
    data: { warehouseId: to.id, ...(options.location !== undefined ? { location: options.location } : {}) },
  });
  if (result.count < options.quantity) throw new WarehouseMoveConflict(result.count);
  return { ok: true, moved: result.count };
}

/** Se movieron menos unidades que las pedidas: la transacción entera se revierte. */
export class WarehouseMoveConflict extends Error {
  constructor(readonly moved: number) {
    super(`Solo se pudieron mover ${moved} unidad${moved === 1 ? "" : "es"}: cambiaron mientras se movían.`);
  }
}
