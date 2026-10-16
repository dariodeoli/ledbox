import { db } from "./db";
import { csvFilename, type CsvCell } from "@/lib/admin-export";
import { csvResponse } from "@/lib/platform/csv-response";
import { STOCK_ORIGIN_LABELS, serializeImportStockOrigin } from "@/lib/inventory-stock-origin";

const EXPORT_LIMIT = 50_000;

/** Physical units only: defaults on an empty product are never reported as stored units. */
export async function exportInventoryUnits(organizationId: string): Promise<Response> {
  const units = await db.inventoryUnit.findMany({
    where: { organizationId, inventory: { organizationId, deletedAt: null } },
    orderBy: [{ inventoryId: "asc" }, { code: "asc" }],
    take: EXPORT_LIMIT + 1,
    select: {
      id: true, code: true, status: true, location: true,
      stockOrigin: true, ownerSupplierId: true,
      ownerSupplier: { select: { id: true, organizationId: true, name: true } },
      inventory: { select: { id: true, sku: true, name: true, stockCountStatus: true, archivedAt: true } },
      warehouse: { select: { organizationId: true, code: true, name: true } },
    },
  });
  if (units.length > EXPORT_LIMIT) return Response.json({ error: "El reporte supera 50.000 unidades. No se descargó un archivo parcial." }, { status: 422 });
  const rows: CsvCell[][] = units.map(unit => {
    const warehouse = unit.warehouse?.organizationId === organizationId ? unit.warehouse : null;
    const owner = unit.ownerSupplier?.organizationId === organizationId ? unit.ownerSupplier : null;
    const origin = serializeImportStockOrigin({ origin: unit.stockOrigin, supplierId: owner?.id ?? null }, owner?.name);
    return [unit.inventory.id, unit.inventory.sku, unit.inventory.name, unit.id, unit.code, unit.status,
      warehouse?.code, warehouse?.name, unit.location, unit.stockOrigin ? STOCK_ORIGIN_LABELS[unit.stockOrigin] : "Origen sin revisar",
      origin.origen_stock, origin.tercero?.id, origin.tercero?.nombre,
      unit.inventory.stockCountStatus === "PENDING_COUNT" ? "Pendiente conteo" : "Confirmado", unit.inventory.archivedAt ? "Sí" : "No"];
  });
  return csvResponse(csvFilename("unidades-por-deposito"),
    ["Producto ID", "SKU", "Producto", "Unidad ID", "Código unidad", "Estado unidad", "Depósito código", "Depósito", "Ubicación", "Origen", "origen_stock", "Tercero ID", "Tercero", "Conteo producto", "Producto archivado"], rows);
}
