import type { Prisma } from "@prisma/client";
import { lockInventoryItems } from "./inventory-availability";
import { createInventoryUnits } from "./inventory-units";
import { recordAudit, type AuditContext } from "./audit";

/** An explicit total, never a side effect of saving metadata or registering a purchase. */
export async function confirmInventoryCount(tx: Prisma.TransactionClient, context: AuditContext, id: string, total: number, placement: { warehouseId?: string; location?: string } = {}) {
  if (!Number.isSafeInteger(total) || total < 0 || total > 100_000) throw new Error("El conteo debe ser un entero de 0 a 100.000.");
  const locked = await lockInventoryItems(tx, context.organizationId, [id]);
  const item = locked.has(id) ? await tx.inventoryItem.findFirst({
    where: { id, organizationId: context.organizationId, archivedAt: null },
    select: { id: true, name: true, quantity: true, stockCountStatus: true, comboIncomplete: true, _count: { select: { components: true } } },
  }) : null;
  if (!item) throw new Error("El producto no existe en esta empresa o está archivado.");
  if (item.comboIncomplete || item._count.components > 0) throw new Error("El stock de un combo se cuenta en sus componentes.");
  if (total < item.quantity) throw new Error("El conteo es menor que las unidades registradas: revisá sus estados o retiros antes de confirmar. No se eliminó ninguna unidad.");
  const added = total - item.quantity;
  if (added > 0) await createInventoryUnits(tx, { organizationId: context.organizationId, inventoryId: id, name: item.name, quantity: added, ...placement });
  await tx.inventoryItem.update({ where: { id }, data: { stockCountStatus: "CONFIRMED" } });
  if (item.stockCountStatus !== "CONFIRMED" || added > 0) await recordAudit({
    context, action: "update", entity: "InventoryItem", entityId: id,
    summary: `Confirmó el conteo de «${item.name}»: ${total} unidades`,
    detail: { changes: { stockCountStatus: { from: item.stockCountStatus, to: "CONFIRMED" }, quantity: { from: item.quantity, to: total } }, fields: { unitsCreated: added } },
  }, tx);
  return { id, quantity: total, stockCountStatus: "CONFIRMED" as const, added };
}
