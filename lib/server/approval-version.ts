import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { EVENT_RANGE_SELECT, MAINTENANCE_UNITS_SELECT, lockInventoryItems, parseComboSubstitutions } from "./inventory-availability";
import { lockLiveEvent } from "./event-lock";
import { QuoteComparisonError } from "./quote-comparison";

/** Estado de las piezas que usa el motor; cambia también al retirar o mantener unidades. */
const stockItemSelect = {
  id: true, updatedAt: true, quantity: true, status: true, incidentHold: true,
  bufferBeforeMin: true, bufferAfterMin: true, deletedAt: true,
  _count: { select: MAINTENANCE_UNITS_SELECT },
} as const;

/** Datos concretos usados por stock/precio. Se leen antes del gate y bajo lock al aceptar. */
const approvalSnapshotSelect = {
  id: true, title: true, status: true, approvedAt: true, eventId: true, updatedAt: true,
  client: { select: { name: true, company: true, tradeName: true, legalName: true } },
  event: { select: { ...EVENT_RANGE_SELECT, updatedAt: true, status: true, deletedAt: true,
    assignments: { orderBy: { inventoryId: "asc" }, select: { inventoryId: true, comboSubstitutions: true } },
  } },
  items: { orderBy: { id: "asc" }, select: {
    id: true, inventoryId: true, quantity: true, days: true, excluded: true, unitPrice: true, freeOnPurpose: true,
    inventory: { select: { ...stockItemSelect, comboIncomplete: true, components: {
      orderBy: { componentId: "asc" }, select: { componentId: true, quantity: true, anyVariant: true, component: { select: stockItemSelect } },
    } } },
  } },
} as const;

export async function readApprovalVersion(client: Pick<typeof db, "budget" | "inventoryItem">, organizationId: string, budgetId: string) {
  const budget = await client.budget.findFirst({ where: { id: budgetId, organizationId }, select: approvalSnapshotSelect });
  if (!budget) return null;
  const linked = new Set(budget.items.flatMap((item) => item.inventoryId ? [item.inventoryId] : []));
  const substitutions = (budget.event?.assignments ?? []).filter((row) => linked.has(row.inventoryId))
    .map((row) => ({ inventoryId: row.inventoryId, entries: Object.entries(parseComboSubstitutions(row.comboSubstitutions)).sort(([a], [b]) => a.localeCompare(b)) }))
    .filter((row) => row.entries.length);
  const substituteIds = [...new Set(substitutions.flatMap((row) => row.entries.map(([, inventoryId]) => inventoryId)))];
  const substituteItems = substituteIds.length ? await client.inventoryItem.findMany({ where: { organizationId, id: { in: substituteIds } }, select: stockItemSelect, orderBy: { id: "asc" } }) : [];
  const stockInventoryIds = [...new Set([
    ...linked, ...budget.items.flatMap((item) => item.inventory?.components.map((part) => part.componentId) ?? []), ...substituteIds,
  ])].sort();
  return { ...budget, organizationId, substitutions, substituteItems, stockInventoryIds };
}

export type ApprovalVersion = NonNullable<Awaited<ReturnType<typeof readApprovalVersion>>>;
function approvalFingerprint(budget: ApprovalVersion): string {
  // Crear las reservas del gate no cambia la versión: sólo importan sustituciones
  // explícitas, no las filas con JSON vacío que el propio gate acaba de crear.
  const event = budget.event ? { ...budget.event, assignments: undefined } : null;
  return JSON.stringify({ updatedAt: budget.updatedAt, eventId: budget.eventId, event, items: budget.items,
    substitutions: budget.substitutions, substitutes: budget.substituteItems, stockInventoryIds: budget.stockInventoryIds });
}

/** El mismo orden del motor: ítems por id → evento → presupuesto (lo toma el llamador). */
export async function lockApprovalVersion(tx: Prisma.TransactionClient, version: ApprovalVersion): Promise<void> {
  // NO KEY UPDATE mantiene stock/estado fijos y permite las comprobaciones FK de
  // un editor que ya tenga Budget: no espera la aprobación que espera ese Budget.
  await lockInventoryItems(tx, version.organizationId, version.stockInventoryIds, { mode: "no-key-update" });
  if (version.eventId && !await lockLiveEvent(tx, version.organizationId, version.eventId)) throw new QuoteComparisonError(409, "El evento cambió o ya no está disponible. Actualizá y reintentá.");
}

/** Comparar después de esperar por los locks y antes de evidencia/selección/plan. */
export function assertApprovalVersion(before: ApprovalVersion, current: ApprovalVersion | null): asserts current is ApprovalVersion {
  if (!current) throw new QuoteComparisonError(404, "Presupuesto no encontrado.");
  if (approvalFingerprint(current) !== approvalFingerprint(before)) throw new QuoteComparisonError(409, "El presupuesto, sus piezas o las fechas cambiaron mientras se verificaba el stock. Actualizá y volvé a aprobar.", "approval_stale");
}
