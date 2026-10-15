import type { Prisma } from "@prisma/client";
import { QuoteComparisonError } from "./quote-comparison";

/** La duración facturable sale del producto real, también al conservar un vínculo omitido. */
export async function normalizeBudgetLineBilling<T extends { inventoryId: string | null; days: number }>(
  tx: Prisma.TransactionClient,
  organizationId: string,
  lines: T[],
): Promise<T[]> {
  const ids = [...new Set(lines.flatMap((line) => line.inventoryId ? [line.inventoryId] : []))];
  if (ids.length === 0) return lines;
  const products = await tx.inventoryItem.findMany({ where: { organizationId, id: { in: ids }, deletedAt: null }, select: { id: true, billingUnit: true } });
  if (products.length !== ids.length) throw new QuoteComparisonError(400, "El producto no existe en esta empresa.");
  const perEvent = new Set(products.filter((product) => product.billingUnit === "EVENT").map((product) => product.id));
  return lines.map((line) => line.inventoryId && perEvent.has(line.inventoryId) ? { ...line, days: 1 } : line);
}
