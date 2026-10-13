import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { comboCapacity, comboCapacityLabel, readComboComponents } from "../lib/inventory-combos";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("capacidad de un combo: mínimo de floor(libres / cantidad) y componente limitante", () => {
  const components = [
    { componentId: "silla", name: "Silla", quantity: 10 },
    { componentId: "mesa", name: "Mesa", quantity: 1 },
  ];
  const result = comboCapacity(components, new Map([["silla", 25], ["mesa", 3]]));
  assert.equal(result.capacity, 2);
  assert.equal(result.limiting?.name, "Silla");
  assert.equal(comboCapacity(components, { silla: 25, mesa: 0 }).limiting?.name, "Mesa");
  assert.equal(comboCapacity(components, {}).capacity, 0);
  assert.equal(comboCapacity([], {}).limiting, null);
  assert.equal(comboCapacityLabel(1), "Se puede armar 1");
  assert.equal(comboCapacityLabel(2), "Se pueden armar 2");
});

test("lectura de componentes: obligatorios, sin repetidos y con cantidad entera positiva", () => {
  assert.equal(readComboComponents([]).ok, false);
  assert.equal(readComboComponents([{ componentId: "a", quantity: 1 }, { componentId: "a", quantity: 2 }]).ok, false);
  assert.equal(readComboComponents([{ componentId: "a", quantity: 0 }]).ok, false);
  assert.equal(readComboComponents([{ componentId: "a", quantity: 1.5 }]).ok, false);
  assert.equal(readComboComponents([{ componentId: "", quantity: 1 }]).ok, false);
  assert.deepEqual(readComboComponents([{ componentId: "a", quantity: "3" }]), { ok: true, components: [{ componentId: "a", quantity: 3 }] });
});

test("la API de combos exige inventory.write para escribir, audita y mapea lo ajeno a 404", () => {
  const route = read("app/api/admin/inventory/combos/route.ts");
  assert.match(route, /export async function POST[\s\S]*requireAdminContext\("inventory\.write"\)/);
  assert.match(route, /export async function GET[\s\S]*requireAdminContext\(\)/);
  assert.match(route, /recordAudit[\s\S]*Sustituyó/);
  assert.match(route, /component-missing"[\s\S]{0,40}404/);
  assert.match(route, /reason === "not-found" \? 404/);
});

test("el motor de combos bloquea con FOR UPDATE ordenado y los sueltos no pisan la parte de combos", () => {
  const engine = read("lib/server/inventory-combos.ts");
  assert.match(engine, /lockInventoryItems\(tx, organizationId, \[\.\.\.lockedIds\]\)/);
  const availability = read("lib/server/inventory-availability.ts");
  assert.match(availability, /isComboItem\(db, options\.organizationId, options\.inventoryId\)/);
  assert.match(availability, /comboQuantity/);
});

test("la pantalla usa los campos compartidos y el diálogo del panel", () => {
  const dialog = read("components/admin/modules/ComboDialog.tsx");
  assert.match(dialog, /AdminDialog/);
  assert.match(dialog, /from "\.\.\/AdminFields"/);
  assert.doesNotMatch(dialog, /<input\b/);
  assert.match(dialog, /comboCapacityLabel\(preview\.capacity\)/);
  assert.match(read("components/admin/modules/InventarioModule.tsx"), /Nuevo combo/);
});
