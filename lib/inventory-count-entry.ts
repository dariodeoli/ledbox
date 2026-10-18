export type InventoryCountDraftLine = {
  inventoryId: string;
  warehouseId: string;
  countedQuantity: string;
};

export type InventoryCountLineInput = {
  inventoryId: string;
  warehouseId: string;
  countedQuantity: number;
};

/** Convert the count form into the API contract without treating an empty value as zero. */
export function buildInventoryCountLines(
  draft: readonly InventoryCountDraftLine[],
): { ok: true; lines: InventoryCountLineInput[] } | { ok: false; error: string } {
  if (draft.length < 1 || draft.length > 500) {
    return { ok: false, error: "La sesión debe incluir entre 1 y 500 productos." };
  }

  const seen = new Set<string>();
  const lines: InventoryCountLineInput[] = [];
  for (const row of draft) {
    if (!row.inventoryId || !row.warehouseId || !/^\d+$/.test(row.countedQuantity)) {
      return { ok: false, error: "Completá producto, depósito y cantidad contada en cada fila." };
    }
    const countedQuantity = Number(row.countedQuantity);
    if (!Number.isSafeInteger(countedQuantity) || countedQuantity < 0 || countedQuantity > 2_000_000_000) {
      return { ok: false, error: "La cantidad debe ser un entero entre 0 y 2.000.000.000." };
    }
    const key = `${row.inventoryId}\0${row.warehouseId}`;
    if (seen.has(key)) return { ok: false, error: "No repitas un producto en el mismo depósito." };
    seen.add(key);
    lines.push({ inventoryId: row.inventoryId, warehouseId: row.warehouseId, countedQuantity });
  }
  return { ok: true, lines };
}
