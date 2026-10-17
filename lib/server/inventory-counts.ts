import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
export type PhysicalCountInput = { inventoryId: string; warehouseId: string; countedQuantity: number };

export class InventoryCountInputError extends Error {
  constructor(readonly status: 400 | 404, message: string) { super(message); }
}

/** Guarda un relevamiento de stock por producto/depósito como fotografía, sin ajustar unidades. */
export async function createInventoryCount(
  tx: Tx,
  options: { organizationId: string; actor: { id: string; name: string; email: string }; lines: PhysicalCountInput[]; notes?: string | null },
) {
  if (options.lines.length < 1 || options.lines.length > 500) throw new InventoryCountInputError(400, "La sesión debe incluir entre 1 y 500 productos.");
  const keys = options.lines.map(({ inventoryId, warehouseId }) => `${inventoryId}\0${warehouseId}`);
  if (new Set(keys).size !== keys.length) throw new InventoryCountInputError(400, "No repitas un producto en el mismo depósito.");
  if (options.lines.some((line) => !line.inventoryId || !line.warehouseId || !Number.isInteger(line.countedQuantity) || line.countedQuantity < 0 || line.countedQuantity > 2_000_000_000)) {
    throw new InventoryCountInputError(400, "Cada cantidad contada debe ser un entero no negativo.");
  }

  const inventoryIds = [...new Set(options.lines.map((line) => line.inventoryId))];
  const warehouseIds = [...new Set(options.lines.map((line) => line.warehouseId))];
  const [items, warehouses, stock] = await Promise.all([
    tx.inventoryItem.findMany({ where: { organizationId: options.organizationId, id: { in: inventoryIds }, deletedAt: null }, select: { id: true, name: true } }),
    tx.warehouse.findMany({ where: { organizationId: options.organizationId, id: { in: warehouseIds }, archivedAt: null }, select: { id: true, name: true, code: true } }),
    tx.inventoryUnit.groupBy({ by: ["inventoryId", "warehouseId"], where: { organizationId: options.organizationId, inventoryId: { in: inventoryIds }, warehouseId: { in: warehouseIds }, status: { not: "RETIRED" } }, _count: { _all: true } }),
  ]);
  if (items.length !== inventoryIds.length) throw new InventoryCountInputError(404, "Uno o más productos no existen en esta empresa.");
  if (warehouses.length !== warehouseIds.length) throw new InventoryCountInputError(404, "Uno o más depósitos no existen o están archivados.");
  const itemById = new Map(items.map((item) => [item.id, item]));
  const warehouseById = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));
  const stockByKey = new Map(stock.map((row) => [`${row.inventoryId}\0${row.warehouseId}`, row._count._all]));
  const id = `ic_${randomUUID()}`;
  const countedAt = new Date();
  return tx.inventoryCountSession.create({
    data: {
      id, organizationId: options.organizationId, actorId: options.actor.id,
      actorName: options.actor.name, actorEmail: options.actor.email,
      countedAt, notes: options.notes?.trim() || null,
      lines: { create: options.lines.map((line) => {
        const expectedQuantity = stockByKey.get(`${line.inventoryId}\0${line.warehouseId}`) ?? 0;
        const item = itemById.get(line.inventoryId)!;
        const warehouse = warehouseById.get(line.warehouseId)!;
        return {
          id: `icl_${randomUUID()}`, organizationId: options.organizationId,
          inventoryId: line.inventoryId, warehouseId: line.warehouseId,
          expectedQuantity, countedQuantity: line.countedQuantity,
          discrepancy: line.countedQuantity - expectedQuantity,
          productName: item.name, warehouseName: warehouse.name, warehouseCode: warehouse.code,
        };
      }) },
    },
    include: { lines: { orderBy: [{ productName: "asc" }, { warehouseCode: "asc" }] } },
  });
}

/** Reads matching snapshots only inside the active organization; filtered reads return matching lines only. */
export async function listInventoryCountHistory(
  tx: Tx,
  options: { organizationId: string; take: number; inventoryId?: string; warehouseId?: string },
) {
  const lineWhere = {
    organizationId: options.organizationId,
    ...(options.inventoryId ? { inventoryId: options.inventoryId } : {}),
    ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
  };
  const filtered = Boolean(options.inventoryId || options.warehouseId);
  return tx.inventoryCountSession.findMany({
    where: {
      organizationId: options.organizationId,
      ...(filtered ? { lines: { some: lineWhere } } : {}),
    },
    orderBy: [{ countedAt: "desc" }, { id: "desc" }],
    take: options.take,
    include: {
      lines: {
        ...(filtered ? { where: lineWhere } : {}),
        orderBy: [{ productName: "asc" }, { warehouseCode: "asc" }],
      },
    },
  });
}
