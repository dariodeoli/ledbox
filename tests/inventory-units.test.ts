import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildAvailability, type AssignmentRecord } from "../lib/server/inventory-availability";
import { inventoryModuleSource } from "./fixtures/inventory-module-source";
import {
  FIELD_MESSAGES,
  inventoryUnitCodeError,
  inventoryUnitCodeValid,
  inventoryUnitPrefix,
  normalizeInventoryUnitCode,
} from "../lib/field-rules";

/**
 * Unidades físicas del inventario (issue #112): código legible y único por
 * empresa (autogenerado, editable), estado y costo por unidad; `quantity` del
 * ítem refleja las unidades activas y la disponibilidad descuenta las que están
 * en mantenimiento. La migración es aditiva y el backfill idempotente.
 */

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const at = (iso: string) => new Date(iso);

test("el prefijo del código sale del nombre, sin acentos", () => {
  assert.equal(inventoryUnitPrefix("Kiosko Touch"), "KIO");
  assert.equal(inventoryUnitPrefix("Tótem LED"), "TOT");
  assert.equal(inventoryUnitPrefix("Cilindro LED"), "CIL");
  assert.equal(inventoryUnitPrefix("  pantalla multimedia "), "PAN");
  assert.equal(inventoryUnitPrefix(""), "UNI");
  assert.equal(inventoryUnitPrefix(null), "UNI");
});

test("el código de la unidad se normaliza y valida (2 a 20, letras/números/guiones)", () => {
  assert.equal(normalizeInventoryUnitCode("  kio-01 "), "KIO-01");
  assert.equal(normalizeInventoryUnitCode("a b/c"), "ABC");
  assert.equal(inventoryUnitCodeValid("KIO-01"), true);
  assert.equal(inventoryUnitCodeValid("kio_02"), true);
  assert.equal(inventoryUnitCodeValid("A"), false);
  assert.equal(inventoryUnitCodeValid("-KIO"), false);
  assert.equal(inventoryUnitCodeValid("KIO 01"), false);
  assert.equal(inventoryUnitCodeValid("K".repeat(21)), false);
  assert.equal(inventoryUnitCodeError("KIO-01"), null);
  assert.equal(inventoryUnitCodeError(""), FIELD_MESSAGES.unitCode);
});

test("la disponibilidad descuenta las unidades en mantenimiento", () => {
  const range = { start: at("2026-10-01T10:00:00.000Z"), end: at("2026-10-02T10:00:00.000Z") };
  const item = { id: "i1", name: "Kiosko Touch", quantity: 5, status: "AVAILABLE" as const, maintenance: 2 };
  const free = buildAvailability(item, [], range.start, range.end);
  assert.equal(free.total, 5);
  assert.equal(free.maintenance, 2);
  assert.equal(free.available, 3, "las 2 en mantenimiento no están libres");

  const committed: AssignmentRecord = {
    id: "a1",
    inventoryId: "i1",
    quantity: 1,
    startsAt: null,
    endsAt: null,
    event: { id: "e1", name: "Expo", startsAt: range.start, endsAt: range.end, setupAt: null, strikeAt: null },
  };
  const withCommitment = buildAvailability(item, [committed], range.start, range.end);
  assert.equal(withCommitment.available, 2);
  assert.equal(withCommitment.committed, 1);

  // El ítem bloqueado sigue en 0 aunque tenga mantenimiento (no se inventa).
  const blocked = buildAvailability({ ...item, status: "MAINTENANCE" }, [], range.start, range.end);
  assert.equal(blocked.available, 0);
  assert.equal(blocked.blocked, true);

  // Sin unidades en mantenimiento, el cálculo es el de siempre.
  const plain = buildAvailability({ ...item, maintenance: 0 }, [], range.start, range.end);
  assert.equal(plain.available, 5);
});

test("la migración de unidades es aditiva y el backfill idempotente", () => {
  const sql = repoFile("prisma/migrations/202610010004_inventory_units/migration.sql");
  assert.match(sql, /CREATE TYPE "InventoryUnitStatus" AS ENUM \('AVAILABLE', 'MAINTENANCE', 'RETIRED'\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "InventoryUnit"/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "InventoryUnit_organizationId_code_key"/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS "InventoryUnit_inventoryId_status_idx"/);
  assert.match(sql, /FOREIGN KEY \("inventoryId"\) REFERENCES "InventoryItem"\("id"\) ON DELETE CASCADE/);
  // Backfill: solo ítems sin unidades, con `ON CONFLICT DO NOTHING`.
  assert.match(sql, /WHERE NOT EXISTS \(SELECT 1 FROM "InventoryUnit" u WHERE u\."inventoryId" = i\."id"\)/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY/);
  assert.equal(/\bDROP\b/i.test(sql), false, "la migración no puede borrar nada");

  const schema = repoFile("prisma/schema.prisma");
  assert.match(schema, /model InventoryUnit \{/);
  assert.match(schema, /enum InventoryUnitStatus \{/);
  assert.match(schema, /quantity\s+Int\s+@default\(1\)/, "la cantidad sigue existiendo");
});

test("el contrato del panel tipa unidades y mantenimiento", () => {
  const types = repoFile("lib/admin-types.ts");
  assert.match(types, /export type AdminInventoryUnitRow = \{/);
  assert.match(types, /units: AdminInventoryUnitRow\[\]/);
  assert.match(types, /maintenanceNow: number/);
  assert.match(types, /maintenance: number/);
  assert.match(types, /INVENTORY_UNIT_STATUSES/);
});

test("el API crea y edita unidades y mantiene la cantidad sincronizada", () => {
  const route = repoFile("app/api/admin/inventory/route.ts");
  assert.match(route, /kind === "unit"/);
  assert.match(route, /kind === "unit-update"/);
  assert.match(route, /syncInventoryQuantity/);
  assert.match(route, /nextInventoryUnitCode/);
  assert.match(route, /MAINTENANCE_UNITS_SELECT/);
  assert.match(route, /maintenance: maintenanceUnits\(item\)/);
  const create = repoFile("app/api/admin/resources/route.ts");
  assert.match(create, /createInventoryUnits\(tx/);
  const availability = repoFile("lib/server/inventory-availability.ts");
  assert.match(availability, /Math\.max\(0, item\.quantity - item\.maintenance\)/);
  const units = repoFile("lib/server/inventory-units.ts");
  assert.match(units, /status: \{ not: "RETIRED" \}/, "las retiradas no cuentan como activas");
});

test("el detalle gestiona las unidades y la edición las resume", () => {
  const module = inventoryModuleSource();
  assert.match(module, /view="inventario-unidades"/, "la ficha lista las unidades");
  assert.match(module, /Agregar unidad/);
  assert.match(module, /changeUnitStatus/);
  assert.match(module, /openUnitDialog/);
  assert.match(module, /Costo que tuvo/);
  assert.match(module, /Ver unidades/);
  assert.match(module, /gestionan en la ficha del producto/, "la edición manda a la ficha, donde viven las unidades");
  assert.match(module, /Se crean las unidades con código automático\./);
  // La demo también trae unidades coherentes con la historia (una en mantenimiento).
  const demo = repoFile("lib/server/demo-data.ts");
  assert.match(demo, /inventoryUnitsData/);
  assert.match(demo, /inMaintenance \? "MAINTENANCE" : "AVAILABLE"/);
});
