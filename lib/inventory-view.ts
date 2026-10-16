import { pendingStockCount, type StockCountStatus } from "./stock-count";
import { effectiveAudience, type CatalogAudience } from "./catalog-audience";
import type { AdminInventoryAssignmentRow, AdminInventoryAvailabilityNow, AdminInventoryItemRow, AdminInventoryRow, AdminInventoryUnitRow } from "./admin-types";

/**
 * Lo que necesitan los filtros y los indicadores de una fila: sirve tanto para la fila completa
 * (con unidades y asignaciones) como para la liviana de la pantalla (`?fields=grid`, con los
 * agregados por `groupBy` en `availability`).
 */
export type InventoryRowLike = Pick<AdminInventoryRow, "id" | "catalogAudience" | "visibleOnWeb" | "stockCountStatus"> & {
  combo?: unknown;
  units?: ReadonlyArray<Pick<AdminInventoryUnitRow, "status">>;
  assignments?: AdminInventoryItemRow["assignments"];
  availability: AdminInventoryAvailabilityNow;
};

/**
 * Reglas puras de la vista del módulo Inventario (rediseño de la pantalla): qué
 * filtro cuenta cada pestaña/indicador, el resumen de stock de una fila y la
 * mini línea de tiempo de las próximas semanas. No toca red ni base: todo sale
 * del payload de `/api/admin/inventory` que ya tiene la pantalla.
 */

/** Filtro de foco de la lista: las cinco pestañas y los dos que abren los indicadores. */
export type InventoryFocus = "all" | "combos" | "incidents" | "published" | "hidden" | "free" | "week" | "incomplete";

export const INVENTORY_TABS: ReadonlyArray<{ value: InventoryFocus; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "combos", label: "Combos" },
  { value: "incomplete", label: "Datos por completar" },
  { value: "incidents", label: "Con incidentes" },
  { value: "published", label: "Publicados en tienda" },
  { value: "hidden", label: "Ocultos" },
];

/** Nombre del filtro de un indicador que no tiene pestaña propia. */
export const INVENTORY_FOCUS_LABEL: Partial<Record<InventoryFocus, string>> = {
  free: "Con unidades libres hoy",
  week: "Con reservas esta semana",
};

/** Estados de unidad que la sacan de circulación (mantenimiento, daño o pérdida). */
export const UNIT_PROBLEM_STATUSES = ["MAINTENANCE", "DAMAGED", "LOST"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function isPublished(item: Pick<AdminInventoryItemRow, "catalogAudience" | "visibleOnWeb">): boolean {
  return effectiveAudience(item) !== "HIDDEN";
}

/** Unidades fuera de circulación de un conjunto de productos, por estado (más lo retenido por cantidad). */
export function unitProblemCounts(items: ReadonlyArray<Pick<InventoryRowLike, "units" | "availability">>) {
  const counts = { maintenance: 0, damaged: 0, lost: 0 };
  for (const item of items) {
    if (item.units) {
      for (const unit of item.units) {
        if (unit.status === "MAINTENANCE") counts.maintenance += 1;
        else if (unit.status === "DAMAGED") counts.damaged += 1;
        else if (unit.status === "LOST") counts.lost += 1;
      }
      continue;
    }
    const byStatus = item.availability.unitsByStatus ?? {};
    const hold = item.availability.holdByKind ?? {};
    counts.maintenance += (byStatus.MAINTENANCE ?? 0) + (hold.REPAIR ?? 0) + (hold.CLEANING ?? 0);
    counts.damaged += (byStatus.DAMAGED ?? 0) + (hold.DAMAGE ?? 0);
    counts.lost += (byStatus.LOST ?? 0) + (hold.MISSING ?? 0);
  }
  return { ...counts, total: counts.maintenance + counts.damaged + counts.lost };
}

export type InventoryFocusContext = {
  /** Ids de productos con algún incidente abierto o en reparación. */
  openIncidentIds: ReadonlySet<string>;
  now: Date;
};

/** ¿El producto tiene un incidente abierto o una unidad fuera de circulación? */
export function hasIncident(item: Pick<InventoryRowLike, "id" | "units" | "availability">, openIncidentIds: ReadonlySet<string>): boolean {
  if (openIncidentIds.has(item.id)) return true;
  if (item.units) return item.units.some((unit) => (UNIT_PROBLEM_STATUSES as readonly string[]).includes(unit.status));
  return unitProblemCounts([item]).total > 0;
}

/** Rango efectivo de una asignación: el propio o, si falta, el de su evento. */
export function assignmentSpan(assignment: Pick<AdminInventoryAssignmentRow, "startsAt" | "endsAt" | "event">): { start: Date; end: Date } | null {
  const startsAt = assignment.startsAt ?? assignment.event.startsAt;
  const endsAt = assignment.endsAt ?? assignment.event.endsAt ?? startsAt;
  if (!startsAt || !endsAt) return null;
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end: end.getTime() < start.getTime() ? start : end };
}

/** ¿La asignación compromete stock ahora? (no liberada, retención vigente, evento no cancelado, no devuelta) */
export function assignmentIsLive(assignment: AdminInventoryAssignmentRow, now: Date): boolean {
  if (assignment.releasedAt) return false;
  if (assignment.holdExpiresAt && new Date(assignment.holdExpiresAt).getTime() <= now.getTime()) return false;
  if (assignment.event.status === "CANCELLED") return false;
  if (assignment.checkedIn) return false;
  return true;
}

function overlaps(span: { start: Date; end: Date }, from: Date, to: Date): boolean {
  return span.start.getTime() < to.getTime() && span.end.getTime() >= from.getTime();
}

/** ¿Tiene reservas o retenciones vivas que tocan la ventana `[from, to)`? */
export function hasLiveAssignmentIn(item: Pick<AdminInventoryItemRow, "assignments">, from: Date, to: Date, now: Date): boolean {
  return (item.assignments ?? []).some((assignment) => {
    if (!assignmentIsLive(assignment, now)) return false;
    const span = assignmentSpan(assignment);
    return span ? overlaps(span, from, to) : false;
  });
}

/** ¿El producto entra en el foco elegido? */
export function itemInFocus(item: InventoryRowLike, focus: InventoryFocus, context: InventoryFocusContext): boolean {
  switch (focus) {
    case "all":
      return true;
    case "combos":
      return Boolean(item.combo);
    case "incidents":
      return hasIncident(item, context.openIncidentIds);
    case "published":
      return isPublished(item);
    case "hidden":
      return !isPublished(item);
    case "incomplete":
      return pendingStockCount(item) || Boolean((item.combo as { incomplete?: boolean } | undefined)?.incomplete);
    case "free":
      return item.availability.availableNow > 0;
    case "week": {
      const until = new Date(context.now.getTime() + 7 * DAY_MS);
      // Fila liviana: lo comprometido ahora o la próxima reserva dentro de la semana.
      if (!item.assignments) {
        const next = item.availability.nextCommittedAt ? new Date(item.availability.nextCommittedAt) : null;
        return item.availability.committedNow > 0 || Boolean(next && next.getTime() < until.getTime());
      }
      return hasLiveAssignmentIn({ assignments: item.assignments }, context.now, until, context.now);
    }
  }
}

/** Cuántos productos entran en cada pestaña (sobre los ya filtrados por búsqueda). */
export function tabCounts(items: ReadonlyArray<InventoryRowLike>, context: InventoryFocusContext): Record<(typeof INVENTORY_TABS)[number]["value"], number> {
  const counts = { all: 0, combos: 0, incidents: 0, published: 0, hidden: 0 } as Record<(typeof INVENTORY_TABS)[number]["value"], number>;
  for (const tab of INVENTORY_TABS) counts[tab.value] = items.filter((item) => itemInFocus(item, tab.value, context)).length;
  return counts;
}

export type StockSummary = {
  free: number | null;
  total: number | null;
  /** 0–100 de unidades libres sobre el total; `null` en combos (no tienen total propio). */
  percent: number | null;
  tone: "ok" | "warn" | "danger";
};

/**
 * Stock libre / total de una fila. Un combo no tiene unidades propias: su «libre»
 * es lo que se puede armar y no lleva barra. El tono sale del libre real.
 */
export function stockSummary(item: Pick<InventoryRowLike, "combo" | "availability"> & { quantity: number; stockCountStatus?: StockCountStatus }, rangeActive: boolean): StockSummary {
  if (pendingStockCount(item)) return { free: null, total: null, percent: null, tone: "warn" };
  const range = item.availability.range ?? null;
  const free = rangeActive ? (range?.available ?? null) : item.availability.availableNow;
  if (item.combo) return { free, total: null, percent: null, tone: free === 0 ? "danger" : "ok" };
  const total = item.quantity;
  const percent = free == null || total <= 0 ? null : Math.max(0, Math.min(100, Math.round((free / total) * 100)));
  const tone = free === 0 ? "danger" : percent != null && percent < 25 ? "warn" : "ok";
  return { free, total, percent, tone };
}

// ── Mini línea de tiempo de las próximas semanas ────────────────────────────

export type TimelineKind = "reservation" | "hold" | "out";

export type TimelineBar = {
  id: string;
  eventName: string;
  quantity: number;
  kind: TimelineKind;
  startsAt: Date;
  endsAt: Date;
  holdExpiresAt: Date | null;
  /** Posición en % dentro de la ventana (recortada a sus bordes). */
  left: number;
  width: number;
  /** Fila donde se apilan las barras que se solapan. */
  lane: number;
};

export type Timeline = {
  start: Date;
  end: Date;
  weeks: number;
  bars: TimelineBar[];
  lanes: number;
};

/** Las próximas `weeks` semanas desde el comienzo del día de `now`, con reservas y retenciones vivas. */
export function buildTimeline(assignments: ReadonlyArray<AdminInventoryAssignmentRow>, now: Date, weeks = 4): Timeline {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + weeks * 7 * DAY_MS);
  const total = end.getTime() - start.getTime();
  const raw = assignments
    .filter((assignment) => assignmentIsLive(assignment, now))
    .flatMap((assignment) => {
      const span = assignmentSpan(assignment);
      if (!span || !overlaps(span, start, end)) return [];
      const holdExpiresAt = assignment.holdExpiresAt ? new Date(assignment.holdExpiresAt) : null;
      const kind: TimelineKind = holdExpiresAt ? "hold" : assignment.checkedOut ? "out" : "reservation";
      return [{ assignment, span, holdExpiresAt, kind }];
    })
    .sort((a, b) => a.span.start.getTime() - b.span.start.getTime() || a.assignment.id.localeCompare(b.assignment.id));
  const laneEnds: number[] = [];
  const bars = raw.map(({ assignment, span, holdExpiresAt, kind }): TimelineBar => {
    const from = Math.max(span.start.getTime(), start.getTime());
    const to = Math.min(Math.max(span.end.getTime(), from + 60 * 60 * 1000), end.getTime());
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= from);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = to;
    return {
      id: assignment.id,
      eventName: assignment.event.name,
      quantity: assignment.quantity,
      kind,
      startsAt: span.start,
      endsAt: span.end,
      holdExpiresAt,
      left: ((from - start.getTime()) / total) * 100,
      width: Math.max(((to - from) / total) * 100, 1.5),
      lane,
    };
  });
  return { start, end, weeks, bars, lanes: Math.max(1, laneEnds.length) };
}

export const TIMELINE_KIND_LABEL: Record<TimelineKind, string> = {
  reservation: "Reserva",
  hold: "Retención",
  out: "En uso",
};

/** Productos de la lista que usan al producto dado como componente. */
export function combosUsing<T extends Pick<AdminInventoryRow, "archivedAt" | "combo">>(inventory: ReadonlyArray<T>, itemId: string): T[] {
  return inventory.filter((candidate) => !candidate.archivedAt && candidate.combo?.components.some((component) => component.componentId === itemId));
}

export const AUDIENCE_TONE: Record<CatalogAudience, "neutral" | "ok" | "info" | "accent"> = {
  HIDDEN: "neutral",
  RETAIL: "ok",
  WHOLESALE: "info",
  BOTH: "accent",
};
