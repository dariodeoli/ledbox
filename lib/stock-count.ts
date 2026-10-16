/** Explicit count knowledge; legacy callers without the additive field remain confirmed. */
export type StockCountStatus = "CONFIRMED" | "PENDING_COUNT";
export function pendingStockCount(item: { stockCountStatus?: StockCountStatus | null }): boolean {
  return item.stockCountStatus === "PENDING_COUNT";
}
export const PENDING_STOCK_LABEL = "Pendiente conteo";
export const PENDING_STOCK_MESSAGE = "Confirmá el conteo de unidades antes de reservar este producto.";
