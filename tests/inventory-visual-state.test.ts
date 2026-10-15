import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  INVENTORY_STATES,
  INVENTORY_STATE_FILTER_OPTIONS,
  INVENTORY_STATE_KEYS,
  inventoryStateKey,
  inventoryStateMatches,
  inventoryVisualState,
  unitVisualState,
  type InventoryStateInput,
} from "../lib/inventory-visual-state";

const base = (overrides: Omit<Partial<InventoryStateInput>, "availability"> & { availability?: Partial<InventoryStateInput["availability"]> } = {}): InventoryStateInput => ({
  archivedAt: null,
  status: "AVAILABLE",
  quantity: 40,
  ...overrides,
  availability: { committedNow: 0, availableNow: 40, unitsByStatus: { AVAILABLE: 40 }, holdByKind: {}, nextCommittedAt: null, overduePending: 0, ...overrides.availability },
});

test("cada fila del mapa tiene un caso real: estado, tono e ícono", () => {
  const cases: Array<[string, InventoryStateInput, string, string, string]> = [
    ["archived", base({ archivedAt: "2026-10-01T00:00:00Z" }), "neutral", "archive", "Archivado"],
    ["out-of-service", base({ status: "MAINTENANCE" }), "info", "wrench", "Fuera de servicio"],
    ["overdue", base({ availability: { overduePending: 3, availableNow: 0 } }), "danger", "alert", "Vencida"],
    ["rented", base({ availability: { availableNow: 0, committedNow: 40 } }), "danger", "truck", "Alquilado"],
    ["damaged", base({ availability: { availableNow: 0, unitsByStatus: { DAMAGED: 5, AVAILABLE: 35 } } }), "warn", "alert", "Dañado"],
    ["maintenance", base({ availability: { availableNow: 0, unitsByStatus: { MAINTENANCE: 40 } } }), "info", "wrench", "Mantenimiento"],
    ["available", base(), "ok", "check", "Disponible"],
    ["empty", base({ quantity: 0, availability: { availableNow: 0, unitsByStatus: {} } }), "neutral", "inventory", "Sin stock libre"],
  ];
  assert.deepEqual(cases.map(([key]) => key), [...INVENTORY_STATE_KEYS]);
  for (const [key, input, tone, icon, label] of cases) {
    const result = inventoryVisualState(input);
    assert.equal(result.state.key, key);
    assert.equal(result.state.tone, tone, key);
    assert.equal(result.state.icon, icon, key);
    assert.equal(result.state.label, label, key);
    assert.ok(result.state.label.length > 0 && result.state.icon, "siempre ícono + texto");
  }
});

test("precedencia: archivado > fuera de servicio > vencida > alquilado > dañado > mantenimiento > disponible", () => {
  const everything = base({
    archivedAt: "2026-10-01T00:00:00Z",
    status: "RETIRED",
    availability: { overduePending: 2, committedNow: 5, availableNow: 0, unitsByStatus: { DAMAGED: 1, MAINTENANCE: 1 } },
  });
  assert.equal(inventoryStateKey(everything), "archived");
  assert.equal(inventoryStateKey({ ...everything, archivedAt: null }), "out-of-service");
  assert.equal(inventoryStateKey({ ...everything, archivedAt: null, status: "AVAILABLE" }), "overdue");
  assert.equal(inventoryStateKey(base({ availability: { committedNow: 5, availableNow: 0, unitsByStatus: { DAMAGED: 1, MAINTENANCE: 1 } } })), "rented");
  assert.equal(inventoryStateKey(base({ availability: { availableNow: 0, unitsByStatus: { DAMAGED: 1, MAINTENANCE: 1 } } })), "damaged");
  assert.equal(inventoryStateKey(base({ availability: { availableNow: 0, unitsByStatus: { MAINTENANCE: 1 } } })), "maintenance");
});

test("la devolución vencida destaca: alerta roja, etiqueta en negrita y gana sobre alquilado", () => {
  const overdue = inventoryVisualState(base({ availability: { overduePending: 1, committedNow: 10, availableNow: 0 } })).state;
  assert.equal(overdue.tone, "danger");
  assert.equal(overdue.icon, "alert");
  assert.equal(overdue.emphasis, true);
  assert.equal(overdue.longLabel, "Devolución vencida");
  assert.equal(INVENTORY_STATES.rented.tone, "danger");
  assert.equal(INVENTORY_STATES.rented.icon, "truck");
  assert.equal(INVENTORY_STATES.rented.emphasis, undefined);
});

test("las retenciones por cantidad cuentan como dañado o mantenimiento aunque no haya unidades con código", () => {
  assert.equal(inventoryStateKey(base({ availability: { availableNow: 0, holdByKind: { MISSING: 4 } } })), "damaged");
  assert.equal(inventoryStateKey(base({ availability: { availableNow: 0, holdByKind: { CLEANING: 4 } } })), "maintenance");
  assert.equal(inventoryStateKey(base({ availability: { availableNow: 0, holdByKind: { REPAIR: 1 } } })), "maintenance");
});

test("parcial: chip principal Disponible, barra segmentada y «12/40»", () => {
  const result = inventoryVisualState(
    base({ availability: { availableNow: 12, committedNow: 20, unitsByStatus: { DAMAGED: 3, MAINTENANCE: 5, AVAILABLE: 12 } } }),
  );
  assert.equal(result.state.key, "available");
  assert.equal(result.fraction, "12/40");
  assert.equal(result.partial, true);
  assert.deepEqual(result.segments.map((segment) => [segment.key, segment.count]), [["free", 12], ["rented", 20], ["damaged", 3], ["maintenance", 5]]);
  assert.deepEqual(result.segments.map((segment) => segment.tone), ["ok", "danger", "warn", "info"]);
});

test("los tramos nunca suman más que el total y un combo no tiene total propio", () => {
  const over = inventoryVisualState(base({ quantity: 10, availability: { availableNow: 8, committedNow: 9 } }));
  assert.ok(over.segments.reduce((sum, segment) => sum + segment.count, 0) <= 10);
  const combo = inventoryVisualState(base({ availability: { availableNow: 3 } }), { combo: true });
  assert.equal(combo.fraction, null);
  assert.deepEqual(combo.segments, []);
  assert.equal(combo.partial, false);
});

test("«Reservado desde dd/mm» sale de la próxima reserva real y nunca se inventa", () => {
  const reserved = inventoryVisualState(base({ availability: { nextCommittedAt: "2026-10-18T13:00:00Z" } })).reserved;
  assert.ok(reserved);
  assert.equal(reserved.tone, "accent");
  assert.equal(reserved.icon, "calendar");
  assert.equal(reserved.label, "Reservado desde 18/10");
  assert.equal(inventoryVisualState(base()).reserved, null);
});

test("el filtro de estado usa las claves del mapa y «reservado»", () => {
  const rented = base({ availability: { availableNow: 0, committedNow: 40, nextCommittedAt: "2026-10-20T10:00:00Z" } });
  assert.equal(inventoryStateMatches(rented, "rented"), true);
  assert.equal(inventoryStateMatches(rented, "available"), false);
  assert.equal(inventoryStateMatches(rented, "reserved"), true);
  assert.equal(inventoryStateMatches(rented, "ALL"), true);
  assert.deepEqual(
    INVENTORY_STATE_FILTER_OPTIONS.map((option) => option.value),
    ["archived", "out-of-service", "overdue", "rented", "damaged", "maintenance", "available", "reserved"],
  );
});

test("estados de unidad: disponible verde, dañada naranja, mantenimiento azul, perdida roja, retirada neutra", () => {
  assert.deepEqual(
    ["AVAILABLE", "DAMAGED", "MAINTENANCE", "LOST", "RETIRED"].map((status) => unitVisualState(status).tone),
    ["ok", "warn", "info", "danger", "neutral"],
  );
  assert.equal(unitVisualState("RARO").tone, "neutral");
});

// ── Test de fuente: ningún estado se calcula fuera del mapa ────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

test("fuente: las pantallas de inventario no calculan el estado fuera de lib/inventory-visual-state", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = [...walk(join(root, "components/admin/modules")).filter((file) => /\/(Inventor|Combo)[^/]*\.tsx$/.test(file))];
  assert.ok(files.length >= 5, "debe revisar los componentes de inventario");
  const forbidden = [
    /availableNow\s*(?:===|!==|==|!=|>=|<=|>|<)\s*\d/,
    /committedNow\s*(?:===|!==|==|!=|>=|<=|>|<)\s*\d/,
    /overduePending\s*(?:===|!==|==|!=|>=|<=|>|<)/,
    /unitsByStatus\??\.\w+\s*(?:===|!==|>=|<=|>|<)/,
    /holdByKind\??\.\w+\s*(?:===|!==|>=|<=|>|<)/,
    /["'`](?:Alquilado|Dañado|Vencida|Devolución vencida|Fuera de servicio)["'`]/,
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.equal(pattern.test(source), false, `${file.replace(root, "")} calcula un estado a mano (${pattern})`);
    }
  }
  const screen = readFileSync(join(root, "components/admin/modules/InventoryParts.tsx"), "utf8");
  assert.match(screen, /inventory-visual-state/, "el chip de estado sale del mapa");
});
