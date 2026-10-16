import { createHash } from "node:crypto";
import type { BudgetSendAvailability, SendAvailabilityWarning } from "../budget-send-availability";
import type { AuditContext } from "./audit";
import { db } from "./db";
import { incompleteGameLines } from "./approval-stock";
import { eventReservationRange, reserveBudgetInventory } from "./inventory-availability";

const STOCK_SELECT = { id: true, organizationId: true, name: true, deletedAt: true, updatedAt: true, quantity: true, stockCountStatus: true, status: true, comboIncomplete: true, defaultStockOrigin: true } as const;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export class SendAvailabilityChangedError extends Error {}

/** Lecturas acotadas a la empresa: nunca transportar conflictos de otros eventos/clientes del motor. */
async function snapshot(organizationId: string, budgetId: string) {
  const budget = await db.budget.findFirst({
    where: { id: budgetId, organizationId },
    select: { id: true, updatedAt: true, eventId: true,
      event: { select: { id: true, organizationId: true, deletedAt: true, updatedAt: true, startsAt: true, endsAt: true, setupAt: true, strikeAt: true } },
      items: { where: { excluded: false }, orderBy: { id: "asc" }, select: { id: true, name: true, quantity: true, inventoryId: true, days: true, unitPrice: true, subtotal: true, pricingSnapshot: true } },
    },
  });
  if (!budget) throw new SendAvailabilityChangedError("El presupuesto ya no está disponible. Actualizá la lista.");
  if (budget.event && budget.event.organizationId !== organizationId) throw new Error("Evento ajeno a la empresa.");
  const ids = budget.items.flatMap(row => row.inventoryId ? [row.inventoryId] : []);
  const inventory = ids.length ? await db.inventoryItem.findMany({
    where: { organizationId, id: { in: ids } }, orderBy: { id: "asc" },
    select: { ...STOCK_SELECT,
      components: { where: { organizationId }, orderBy: { componentId: "asc" }, select: { quantity: true, componentId: true, component: { select: STOCK_SELECT } } },
    },
  }) : [];
  // Las relaciones de un combo también deben pertenecer a esta empresa; no filtrar silenciosamente una pieza corrupta.
  if (inventory.some(row => row.components.some(part => part.component.organizationId !== organizationId))) throw new Error("Composición ajena a la empresa.");
  return { budget, inventory };
}

/** Sin lock de Budget: dryRun toma sus locks canónicos y siempre hace rollback.
 * Releer la revisión antes/después detecta cambios durante el cálculo; no mantener
 * un lock de presupuesto mientras se abre la transacción de inventario. */
export async function checkBudgetSendAvailability(options: { organizationId: string; budgetId: string; expectedUpdatedAt: Date; context: AuditContext }) {
  const before = await snapshot(options.organizationId, options.budgetId);
  if (before.budget.updatedAt.getTime() !== options.expectedUpdatedAt.getTime()) throw new SendAvailabilityChangedError("El presupuesto cambió. Previsualizá nuevamente.");
  const revision = digest(before);
  const range = before.budget.event && !before.budget.event.deletedAt ? eventReservationRange(before.budget.event) : null;
  const effectiveRange = range?.endsAt ? { startsAt: range.startsAt.toISOString(), endsAt: range.endsAt.toISOString() } : null;
  const byInventory = new Map(before.inventory.map(row => [row.id, row]));
  const warnings: SendAvailabilityWarning[] = [];
  const unknown = new Set<string>();
  const lines = before.budget.items;
  const unlinked = lines.filter(row => !row.inventoryId || !byInventory.has(row.inventoryId));
  if (!effectiveRange) warnings.push({ code: "dates", itemId: null, name: "Fechas del evento", message: "Falta un rango completo y válido de montaje/inicio a desmontaje/fin. No se comprobó stock por fechas." });
  for (const row of unlinked) warnings.push({ code: "manual", itemId: row.id, name: row.name, message: "Línea sin inventario vinculado de esta empresa: su disponibilidad se confirma por separado." });
  if (!lines.length) warnings.push({ code: "no_items", itemId: null, name: "Ítems", message: "No hay líneas incluidas para comprobar." });
  const incomplete = await incompleteGameLines(options.organizationId, options.budgetId);
  for (const row of lines) {
    const item = row.inventoryId ? byInventory.get(row.inventoryId) : null;
    if (!item) continue;
    if (item.comboIncomplete || item.components.some(part => part.component.deletedAt)) {
      unknown.add(item.id);
      warnings.push({ code: "incomplete_game", itemId: row.id, inventoryId: item.id, name: row.name, available: null, message: "Juego sin composición completa: cargá sus piezas antes de reservarlo." });
    }
    const pending = item.stockCountStatus === "PENDING_COUNT" || item.components.some(part => part.component.stockCountStatus === "PENDING_COUNT");
    if (pending) {
      unknown.add(item.id);
      warnings.push({ code: "pending_count", itemId: row.id, inventoryId: item.id, name: row.name, available: null, message: "El conteo del producto o de una pieza está pendiente; la cantidad disponible es desconocida." });
    }
    const external = [item, ...item.components.map(part => part.component)].some(part => part.defaultStockOrigin === "EXTERNAL_RENTAL" && part.quantity === 0);
    if (external) {
      unknown.add(item.id);
      warnings.push({ code: "external", itemId: row.id, inventoryId: item.id, name: row.name, available: null, message: "El suministro externo no tiene cobertura física registrada; requiere confirmación del proveedor." });
    }
  }
  // El guard canónico puede detectar un juego editado entre nuestras lecturas.
  if (incomplete.length && !warnings.some(row => row.code === "incomplete_game")) throw new SendAvailabilityChangedError("La composición del presupuesto cambió. Previsualizá nuevamente.");
  const linked = lines.length - unlinked.length;
  let failed = false;
  if (effectiveRange && linked) {
    const result = await reserveBudgetInventory({ organizationId: options.organizationId, budgetId: options.budgetId, context: options.context, dryRun: true });
    failed = result.failed || result.eventId !== before.budget.eventId || !result.range;
    if (result.blocked && !result.outcomes.length) failed = true;
    if (result.blocked) for (const outcome of result.outcomes) {
      if (unknown.has(outcome.inventoryId)) continue;
      const line = lines.find(row => row.id === outcome.itemId);
      // No exponer motivos/conflictos/alternativas crudos: contienen nombres de otros eventos y clientes.
      if (!line || !byInventory.has(outcome.inventoryId)) { failed = true; continue; }
      warnings.push({ code: "shortage", itemId: line.id, inventoryId: outcome.inventoryId, name: line.name, requested: outcome.quantity, available: outcome.available,
        message: `Se piden ${outcome.quantity}; hay ${outcome.available} disponibles para estas fechas.` });
    }
  }
  const after = await snapshot(options.organizationId, options.budgetId);
  if (digest(after) !== revision) throw new SendAvailabilityChangedError("Cambiaron las fechas, líneas o datos de inventario durante la comprobación. Previsualizá nuevamente.");
  const state: BudgetSendAvailability["state"] = failed ? "error" : warnings.some(row => row.code === "incomplete_game") ? "incomplete" : warnings.some(row => ["dates", "manual", "pending_count", "external", "no_items"].includes(row.code)) ? "unverified" : warnings.length ? "shortage" : "available";
  const review: BudgetSendAvailability = { state, checkedAt: new Date().toISOString(), revision, range: effectiveRange, checkedLines: effectiveRange ? linked : 0, unlinkedLines: unlinked.length, warnings };
  // checkedAt no invalida por sí solo el preview: sí lo hacen revisión, rango o avisos/capacidad nuevos.
  return { review, fingerprint: digest({ ...review, checkedAt: undefined }) };
}
