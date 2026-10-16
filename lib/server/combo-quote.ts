import { db } from "./db";
import {
  BLOCKED_INVENTORY_STATUSES,
  MAINTENANCE_UNITS_SELECT,
  loadCommittedAssignments,
  buildAvailability,
  findSubstitutes,
  loadRentalSettings,
  maintenanceUnits,
  resolveRentalBuffers,
} from "./inventory-availability";
import { loadPricedItems, pricedProduct, packageComponents } from "./line-pricing";
import { priceLine, packageSummary, repricedPackageTotal, substitutionPrice } from "@/lib/price-tiers";

/**
 * Paquetes (combos con precio): precio del paquete vs. suma por unidad, y alternativas cuando una
 * pieza no alcanza (alquileres P2). Todo sale del motor real: la disponibilidad es la de
 * `buildAvailability` y los sustitutos los de `findSubstitutes` (misma categoría, con stock libre).
 *
 * Regla de re-precio al cambiar una pieza: precio del paquete + diferencia, con
 *   diferencia = cantidad por paquete × (total del sustituto − total de la pieza)
 * para los mismos días y con la regla de escalones de cada producto. Si falta el precio de alguna
 * de las dos piezas la diferencia es «sin precio» (no se inventa): el equipo fija el precio a mano.
 */

export type ComboAlternative = {
  id: string;
  name: string;
  available: number;
  /** El sustituto alcanza para TODAS las unidades pedidas de la pieza. */
  enough: boolean;
  /** Diferencia de precio por paquete para todo el período; `null` si falta algún precio. */
  priceDelta: number | null;
  /** Precio del paquete con este reemplazo (por unidad); `null` si falta algún precio. */
  newPackageTotal: number | null;
};

export type ComboQuoteComponent = {
  componentId: string;
  name: string;
  category: string;
  /** Piezas por paquete. */
  quantity: number;
  /** Total de UNA pieza para todo el período (regla de días propia); 0 = sin precio. */
  pieceTotal: number;
  /** Piezas que necesita el pedido (por paquete × paquetes). */
  needed: number;
  /** Libres en el rango; `null` si no se pidió rango. */
  available: number | null;
  short: boolean;
  alternatives: ComboAlternative[];
};

export type ComboQuote = {
  combo: { id: string; name: string };
  quantity: number;
  days: number;
  /** Precio del paquete por unidad para todo el período. */
  packageTotal: number;
  /** Suma de sus piezas por separado, por unidad. */
  unitSum: number;
  savings: number;
  incomplete: boolean;
  components: ComboQuoteComponent[];
};

const COMPONENT_AVAILABILITY_SELECT = {
  id: true, name: true, sku: true, category: true, quantity: true, stockCountStatus: true, status: true,
  bufferBeforeMin: true, bufferAfterMin: true, incidentHold: true,
  _count: { select: MAINTENANCE_UNITS_SELECT },
} as const;

/**
 * Cotización de un combo de la empresa. `range` activa la disponibilidad y las alternativas; sin
 * rango solo se calcula el precio. `null` si el ítem no existe en la empresa o no es un combo.
 */
export async function comboQuote(options: {
  organizationId: string;
  comboId: string;
  quantity: number;
  days: number;
  audience: "RETAIL" | "WHOLESALE";
  range?: { startsAt: Date; endsAt: Date } | null;
}): Promise<ComboQuote | null> {
  const { organizationId } = options;
  const days = Math.max(1, Math.trunc(options.days) || 1);
  const quantity = Math.max(1, Math.trunc(options.quantity) || 1);
  const priced = await loadPricedItems(organizationId, [options.comboId]);
  const combo = priced.get(options.comboId);
  if (!combo || combo.components.length === 0) return null;
  const parts = await db.inventoryComponent.findMany({
    where: { organizationId, parentId: options.comboId },
    select: { componentId: true, component: { select: { category: true } } },
  });
  const categoryOf = new Map(parts.map((part) => [part.componentId, part.component.category]));

  const comboProduct = pricedProduct(combo, options.audience, true);
  const summary = packageSummary(comboProduct, packageComponents(combo, options.audience, true), days);

  // Disponibilidad real de cada pieza en el rango pedido.
  const availableById = new Map<string, number>();
  if (options.range) {
    const ids = combo.components.map((part) => part.item.id);
    const [items, settings] = await Promise.all([
      db.inventoryItem.findMany({ where: { organizationId, id: { in: ids } }, select: COMPONENT_AVAILABILITY_SELECT }),
      loadRentalSettings(organizationId),
    ]);
    const rows = await loadCommittedAssignments({
      organizationId, inventoryIds: ids,
      range: { startsAt: options.range.startsAt, endsAt: options.range.endsAt, bufferMinutes: Math.max(0, ...items.map((item) => {
        const buffers = resolveRentalBuffers(settings, item);
        return buffers.beforeMin + buffers.afterMin;
      })) },
    });

    for (const item of items) {
      const availability = buildAvailability(
        { ...item, maintenance: maintenanceUnits(item), buffers: resolveRentalBuffers(settings, item) },
        rows.filter((row) => row.inventoryId === item.id),
        options.range.startsAt,
        options.range.endsAt,
      );
      availableById.set(item.id, availability.blocked ? 0 : availability.available);
    }
  }

  const inCombo = new Set(combo.components.map((part) => part.item.id));
  const components: ComboQuoteComponent[] = [];
  for (const part of combo.components) {
    const piece = priceLine(pricedProduct(part.item, options.audience, true), days);
    const needed = part.quantity * quantity;
    const available = options.range ? availableById.get(part.item.id) ?? 0 : null;
    const short = available !== null && available < needed;
    let alternatives: ComboAlternative[] = [];
    if (short && options.range) {
      const item = await db.inventoryItem.findFirst({ where: { id: part.item.id, organizationId }, select: { id: true, category: true, status: true } });
      const candidates = item
        ? (await findSubstitutes({ organizationId, item, startsAt: options.range.startsAt, endsAt: options.range.endsAt })).filter(
            (candidate) => !inCombo.has(candidate.id) && !BLOCKED_INVENTORY_STATUSES.includes(candidate.status),
          )
        : [];
      const pricedCandidates = await loadPricedItems(organizationId, candidates.map((candidate) => candidate.id));
      alternatives = candidates.flatMap((candidate) => {
        const candidatePriced = pricedCandidates.get(candidate.id);
        // Un combo no es pieza de otro combo.
        if (!candidatePriced || candidatePriced.components.length > 0) return [];
        const price = substitutionPrice(pricedProduct(part.item, options.audience, true), pricedProduct(candidatePriced, options.audience, true), part.quantity, days);
        return [{
          id: candidate.id,
          name: candidate.name,
          available: candidate.available,
          enough: candidate.available >= needed,
          priceDelta: price.known ? price.delta : null,
          newPackageTotal: price.known && summary.packageTotal > 0 ? repricedPackageTotal(summary.packageTotal, price.delta) : null,
        }];
      });
    }
    components.push({
      componentId: part.item.id,
      name: part.item.name,
      category: categoryOf.get(part.item.id) ?? "",
      quantity: part.quantity,
      pieceTotal: piece.total,
      needed,
      available,
      short,
      alternatives,
    });
  }

  return {
    combo: { id: combo.id, name: combo.name },
    quantity,
    days,
    packageTotal: summary.packageTotal,
    unitSum: summary.unitSum,
    savings: summary.savings,
    incomplete: summary.incomplete,
    components,
  };
}
