import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminInventoryAssignmentRow, AdminInventoryItemRow } from "../lib/admin-types";
import {
  INVENTORY_TABS,
  assignmentIsLive,
  buildTimeline,
  combosUsing,
  hasIncident,
  itemInFocus,
  stockSummary,
  tabCounts,
  unitProblemCounts,
} from "../lib/inventory-view";

/** Hoy fijo: martes 13-10-2026 10:00 (hora local del runner). */
const NOW = new Date(2026, 9, 13, 10, 0, 0);
const at = (days: number, hour = 9) => new Date(2026, 9, 13 + days, hour, 0, 0).toISOString();

function assignment(overrides: Partial<AdminInventoryAssignmentRow> & { id: string }): AdminInventoryAssignmentRow {
  return {
    quantity: 2,
    startsAt: at(2),
    endsAt: at(4),
    checkedOut: false,
    checkedIn: false,
    checkedOutAt: null,
    checkedInAt: null,
    conditionOut: null,
    conditionIn: null,
    damagedQuantity: 0,
    missingQuantity: 0,
    damageNotes: null,
    eventId: "e1",
    event: { id: "e1", name: "Feria", startsAt: at(2), endsAt: at(4), status: "CONFIRMED" },
    ...overrides,
  };
}

function item(overrides: Partial<AdminInventoryItemRow> & { id: string }): AdminInventoryItemRow {
  return {
    name: overrides.id,
    category: "Pantallas",
    sku: null,
    kind: "REUSABLE",
    status: "AVAILABLE",
    visibleOnWeb: false,
    catalogAudience: "HIDDEN",
    quantity: 10,
    archivedAt: null,
    assignments: [],
    units: [],
    availability: { committedNow: 0, availableNow: 10, overcommittedNow: false, maintenanceNow: 0, range: null },
    ...overrides,
  } as AdminInventoryItemRow;
}

const unit = (id: string, status: string) => ({ id, code: id, status, purchaseCost: 0, notes: null, updatedAt: at(0) });

test("las pestañas del inventario son las cinco pedidas y cada una filtra lo que dice", () => {
  assert.deepEqual(
    INVENTORY_TABS.map((tab) => tab.label),
    ["Todos", "Combos", "Con incidentes", "Publicados en tienda", "Ocultos"],
  );
  const combo = item({ id: "combo", combo: { capacity: 3, limiting: null, components: [] } });
  const published = item({ id: "pub", catalogAudience: "WHOLESALE", visibleOnWeb: true });
  const hidden = item({ id: "hid" });
  const broken = item({ id: "bro", units: [unit("U1", "DAMAGED"), unit("U2", "AVAILABLE")] });
  const flagged = item({ id: "inc" });
  const items = [combo, published, hidden, broken, flagged];
  const ctx = { openIncidentIds: new Set(["inc"]), now: NOW };
  assert.deepEqual(tabCounts(items, ctx), { all: 5, combos: 1, incidents: 2, published: 1, hidden: 4 });
  assert.equal(itemInFocus(combo, "combos", ctx), true);
  assert.equal(itemInFocus(published, "hidden", ctx), false);
  assert.equal(hasIncident(broken, ctx.openIncidentIds), true, "una unidad dañada cuenta como incidente aunque no haya un registro abierto");
  assert.equal(hasIncident(hidden, ctx.openIncidentIds), false);
});

test("un producto sin alcance guardado se publica según visibleOnWeb (filas viejas)", () => {
  const legacy = item({ id: "old", catalogAudience: null as never, visibleOnWeb: true });
  assert.equal(itemInFocus(legacy, "published", { openIncidentIds: new Set(), now: NOW }), true);
});

test("las unidades fuera de circulación se cuentan por estado", () => {
  const counts = unitProblemCounts([
    item({ id: "a", units: [unit("1", "MAINTENANCE"), unit("2", "LOST"), unit("3", "AVAILABLE")] }),
    item({ id: "b", units: [unit("4", "DAMAGED"), unit("5", "DAMAGED"), unit("6", "RETIRED")] }),
  ]);
  assert.deepEqual(counts, { maintenance: 1, damaged: 2, lost: 1, total: 4 });
});

test("el stock libre/total lleva barra y tono; un combo muestra lo que se puede armar sin barra", () => {
  assert.deepEqual(stockSummary(item({ id: "a" }), false), { free: 10, total: 10, percent: 100, tone: "ok" });
  const low = item({ id: "b", quantity: 8, availability: { committedNow: 7, availableNow: 1, overcommittedNow: false, maintenanceNow: 0, range: null } });
  assert.deepEqual(stockSummary(low, false), { free: 1, total: 8, percent: 13, tone: "warn" });
  const none = item({ id: "c", quantity: 4, availability: { committedNow: 4, availableNow: 0, overcommittedNow: false, maintenanceNow: 0, range: null } });
  assert.equal(stockSummary(none, false).tone, "danger");
  const ranged = item({
    id: "d",
    quantity: 10,
    availability: { committedNow: 0, availableNow: 10, overcommittedNow: false, maintenanceNow: 0, range: { startsAt: at(1), endsAt: at(2), committed: 6, maintenance: 0, available: 4, overcommitted: false, conflicts: [] } },
  });
  assert.equal(stockSummary(ranged, true).free, 4, "con rango pedido, lo libre es el del rango");
  assert.equal(stockSummary(ranged, false).free, 10);
  const combo = stockSummary(item({ id: "e", combo: { capacity: 3, limiting: null, components: [] }, quantity: 0 }), false);
  assert.equal(combo.total, null);
  assert.equal(combo.percent, null);
});

test("la línea de tiempo muestra solo reservas y retenciones vivas de las próximas 4 semanas", () => {
  const rows = [
    assignment({ id: "firme", startsAt: at(1), endsAt: at(3) }),
    assignment({ id: "retencion", startsAt: at(2), endsAt: at(5), holdExpiresAt: at(1) }),
    assignment({ id: "vencida", holdExpiresAt: at(-1) }),
    assignment({ id: "liberada", releasedAt: at(-1) }),
    assignment({ id: "devuelta", checkedIn: true }),
    assignment({ id: "cancelada", event: { id: "e2", name: "Cancelado", startsAt: at(2), endsAt: at(4), status: "CANCELLED" } }),
    assignment({ id: "lejana", startsAt: at(40), endsAt: at(42) }),
    assignment({ id: "pasada", startsAt: at(-9), endsAt: at(-7) }),
    assignment({ id: "enuso", startsAt: at(-1), endsAt: at(2), checkedOut: true }),
  ];
  const timeline = buildTimeline(rows, NOW, 4);
  assert.deepEqual(
    timeline.bars.map((bar) => bar.id).sort(),
    ["enuso", "firme", "retencion"],
  );
  const kinds = Object.fromEntries(timeline.bars.map((bar) => [bar.id, bar.kind]));
  assert.deepEqual(kinds, { enuso: "out", firme: "reservation", retencion: "hold" });
  for (const bar of timeline.bars) {
    assert.ok(bar.left >= 0 && bar.left + bar.width <= 100.0001, `${bar.id} queda dentro de la ventana`);
  }
  // Las que se solapan se apilan en filas distintas.
  assert.ok(timeline.lanes >= 2);
  assert.notEqual(timeline.bars.find((bar) => bar.id === "firme")?.lane, timeline.bars.find((bar) => bar.id === "retencion")?.lane);
});

test("sin fechas propias, la asignación usa las del evento; sin ninguna, no se dibuja", () => {
  const viaEvent = assignment({ id: "evt", startsAt: null, endsAt: null });
  assert.equal(buildTimeline([viaEvent], NOW).bars.length, 1);
  const noDates = assignment({ id: "nada", startsAt: null, endsAt: null, event: { id: "e3", name: "X", startsAt: null, endsAt: null, status: "CONFIRMED" } });
  assert.equal(buildTimeline([noDates], NOW).bars.length, 0);
  assert.equal(assignmentIsLive(noDates, NOW), true);
});

test("«con reservas esta semana» mira los 7 días desde hoy", () => {
  const ctx = { openIncidentIds: new Set<string>(), now: NOW };
  const soon = item({ id: "soon", assignments: [assignment({ id: "a", startsAt: at(3), endsAt: at(4) })] });
  const later = item({ id: "later", assignments: [assignment({ id: "b", startsAt: at(12), endsAt: at(13) })] });
  assert.equal(itemInFocus(soon, "week", ctx), true);
  assert.equal(itemInFocus(later, "week", ctx), false);
});

test("los combos donde se usa un producto salen de los componentes de los combos activos", () => {
  const tripod = item({ id: "tripode" });
  const kit = item({ id: "kit", combo: { capacity: 2, limiting: null, components: [{ componentId: "tripode", name: "Trípode", category: "Soportes", quantity: 2, available: 4, canMake: 2, status: "AVAILABLE" }] } });
  const archivedKit = item({ id: "viejo", archivedAt: at(-3), combo: kit.combo });
  assert.deepEqual(combosUsing([tripod, kit, archivedKit], "tripode").map((row) => row.id), ["kit"]);
});
