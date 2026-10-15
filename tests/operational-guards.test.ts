import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ITEM_BULK_UI_FIELDS, readBulkChanges } from "../lib/inventory-bulk";
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
test("la edición masiva conserva compatibilidad API sin ofrecer precios heredados sin efecto", () => {
  for (const key of ["listFromDays", "listFromPrice", "wholesaleFromDays", "wholesaleFromPrice"]) {
    assert.ok(!ITEM_BULK_UI_FIELDS.some(field => field.key === key));
    assert.deepEqual(readBulkChanges("items", { [key]: 3 }), { [key]: 3 });
  }
  assert.match(source("components/admin/modules/InventoryBulkEditor.tsx"), /ITEM_BULK_UI_FIELDS/);
});
test("ambas entradas de renombre usan la guarda pública compartida", () => {
  for (const route of ["app/api/admin/events/route.ts", "app/api/admin/budgets/[id]/event/route.ts"]) assert.match(source(route), /await guardEventNameChange\(/);
});
