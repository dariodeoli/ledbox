"use client";
import { adminApiGet, adminSend } from "./admin-api";
import { bulkTrashEligibility, type BulkTrashAction, type BulkTrashOutcome, type BulkTrashRow, type BulkTrashSelectionPage } from "./bulk-trash";
import { trashActionPath, type TrashEntityType } from "./trash-shared";

/** Carga completa: cualquier página ausente/incoherente impide afirmar «todos». */
export async function loadBulkTrashRows<T extends { id: string }>(path: string, key: string): Promise<T[]> {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query); params.set("fields", "bulk-selection");
  const rows: T[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null, snapshot: string | null = null, total: number | null = null;
  for (let page = 0; page < 1000; page++) {
    if (cursor) params.set("cursor", cursor);
    const response = await adminApiGet<Record<string, unknown>>(`${pathname}?${params}`, { fresh: true });
    if (!response.ok) throw new Error(response.error);
    const meta = response.data.bulkSelection as BulkTrashSelectionPage | undefined;
    const batch = response.data[key] as T[] | undefined;
    if (!meta || !Array.isArray(batch) || !Number.isSafeInteger(meta.total) || meta.total < 0 || !meta.snapshotAt) throw new Error("La lista no acredita una selección completa. Actualizá e intentá nuevamente.");
    if (snapshot && meta.snapshotAt !== snapshot) throw new Error("Cambió la selección durante la carga. Volvé a seleccionar todos.");
    if (total !== null && meta.total !== total) throw new Error("Cambió el total durante la carga. Volvé a seleccionar todos.");
    snapshot = meta.snapshotAt; total = meta.total;
    for (const row of batch) { if (!row.id || ids.has(row.id)) throw new Error("La selección contiene filas repetidas. Reintentá."); ids.add(row.id); rows.push(row); }
    if (meta.complete && !meta.nextCursor) {
      if (rows.length !== total) throw new Error("La selección quedó incompleta. No se aplicó ninguna acción.");
      return rows;
    }
    if (!meta.nextCursor || !batch.length || cursors.has(meta.nextCursor)) throw new Error("El cursor de selección no avanzó. No se aplicó ninguna acción.");
    cursor = meta.nextCursor; cursors.add(cursor);
  }
  throw new Error("La selección supera el límite de seguridad de páginas; dividila con filtros. No se aplicó ninguna acción.");
}

export async function performBulkTrash(type: TrashEntityType, row: BulkTrashRow, action: BulkTrashAction, reason: string): Promise<BulkTrashOutcome> {
  const blocked = bulkTrashEligibility(row, action);
  if (blocked) return { row, status: "blocked", message: blocked };
  const result = type === "InventoryItem" && action === "archive"
    ? await adminSend("/api/admin/inventory", { kind: "item-archive", id: row.id })
    : await adminSend(trashActionPath(type, row.id, action), { reason: reason.trim() || undefined });
  return result.ok ? { row, status: "success", message: action === "archive" ? "Archivado" : "En la papelera" }
    : { row, status: result.uncertain ? "unknown" : result.blockers?.length ? "blocked" : "failed", message: result.uncertain ? "Resultado por confirmar. Revisá el estado antes de reintentar; no se repitió automáticamente." : result.error };
}
