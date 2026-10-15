import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canSeeInventoryCosts as clientCanSee } from "../lib/admin-policy";
import { canSeeInventoryCosts, stripInventoryCosts } from "../lib/server/inventory-costs";
import { ADMIN_ROLES, roleCan } from "../lib/server/permissions";

const unit = { id: "u1", code: "KIO-01", status: "AVAILABLE", purchaseCost: 900_000, supplierId: "s1", purchasedAt: "2026-01-01", warrantyUntil: "2027-01-01", location: "E3" };
const base = {
  id: "i1",
  name: "Pantalla",
  quantity: 3,
  listPrice: 500_000,
  replacementCost: 4_000_000,
  dailyCost: 120_000,
  supplierId: "s1",
  purchasedAt: "2026-01-01",
  warrantyUntil: "2027-01-01",
};
const gridRow = { ...base, stock: { unitCount: 3, locations: [], supplierIds: ["s1"] } };
const fichaRow = { ...base, units: [unit], assignments: [] };
const listRow = { ...base, units: [unit], availability: { committedNow: 0 } };

const COST_KEYS = ["replacementCost", "dailyCost", "purchaseCost", "supplierId", "purchasedAt", "warrantyUntil"];
const leaks = (value: unknown) => JSON.stringify(value) !== undefined && COST_KEYS.some((key) => JSON.stringify(value).includes(`"${key}"`));

test("VIEWER no recibe costos en la grilla, la ficha ni la lista", () => {
  for (const row of [gridRow, fichaRow, listRow]) {
    const out = stripInventoryCosts(row, { role: "VIEWER" });
    assert.equal(leaks(out), false);
    assert.equal(out.name, "Pantalla");
    assert.equal(out.listPrice, 500_000);
  }
  const ficha = stripInventoryCosts(fichaRow, { role: "VIEWER" });
  assert.equal(ficha.units[0].code, "KIO-01");
  assert.equal(ficha.units[0].location, "E3");
  assert.deepEqual(stripInventoryCosts(gridRow, { role: "VIEWER" }).stock.supplierIds, []);
});

test("OWNER, ADMIN, FINANCE y OPERATIONS reciben los costos tal cual", () => {
  for (const role of ["OWNER", "ADMIN", "FINANCE", "OPERATIONS"] as const) {
    assert.equal(stripInventoryCosts(gridRow, { role }), gridRow);
    assert.equal(stripInventoryCosts(fichaRow, { role }).units[0].purchaseCost, 900_000);
    assert.equal(stripInventoryCosts(listRow, { role }).dailyCost, 120_000);
  }
});

test("la capacidad inventory.costs coincide entre servidor y cliente y excluye a VIEWER", () => {
  for (const role of ADMIN_ROLES) {
    assert.equal(canSeeInventoryCosts({ role }), roleCan(role, "inventory.costs"));
    assert.equal(clientCanSee(role), roleCan(role, "inventory.costs"));
  }
  assert.equal(roleCan("VIEWER", "inventory.costs"), false);
});

test("la lista vieja y la grilla pasan por stripInventoryCosts", () => {
  const route = readFileSync(new URL("../app/api/admin/inventory/route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/stripInventoryCosts\(/g) ?? []).length >= 2, true);
});
