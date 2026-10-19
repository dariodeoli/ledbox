import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { leadBudgetPrefillItems } from "../lib/lead-budget-prefill";
import type { AdminInventoryLink } from "../lib/admin-types";

const repoFile = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const inventory: AdminInventoryLink = {
  id: "inventory-a", name: "Pantalla LED", sku: "LED-01", category: "Pantallas",
  quantity: 3, status: "AVAILABLE", imageUrl: "/api/inventory-images/inventory-a", listPrice: 450000,
  billingUnit: "DAILY", _count: { components: 0 },
};

test("precarga líneas activas conservando nombre, cantidad, días, notas, vínculo y precio editable", () => {
  const items = leadBudgetPrefillItems([
    { state: "CHANGED", productName: "Nombre snapshot", quantity: 2, days: 3, unitPrice: 450000, notes: "Ajustar montaje", inventory, priceSource: "catalog", snapshotDays: 3 },
  ]);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    id: null, name: "Pantalla LED", quantity: "2", days: "3", unitPrice: "450000",
    costPrice: "0", notes: "Ajustar montaje", inventory, rentalDays: "3",
  });
});

test("precio nulo o cero queda vacío y sin rentalDays para revisión; conserva líneas huérfanas", () => {
  const items = leadBudgetPrefillItems([
    { state: "KEEP", productName: "Producto antiguo", quantity: 1, days: 2, unitPrice: null, notes: null, inventory: null, priceSource: "pending" },
    { state: "KEEP", productName: "Precio cero sin confirmar", quantity: 1, days: 1, unitPrice: 0, notes: "Pendiente", inventory, priceSource: "pending" },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].name, "Producto antiguo");
  assert.equal(items[0].unitPrice, "");
  assert.equal(items[0].inventory, null);
  assert.equal(items[1].unitPrice, "");
  assert.equal(items[1].rentalDays, undefined);
});

test("líneas quitadas/no disponibles no se precargan; el vínculo no crea stock", () => {
  const items = leadBudgetPrefillItems([
    { state: "REMOVED", productName: "Quitado", quantity: 1, days: 1, unitPrice: 100, notes: null, inventory, priceSource: "request" },
    { state: "UNAVAILABLE", productName: "No disponible", quantity: 1, days: 1, unitPrice: 100, notes: null, inventory, priceSource: "request" },
  ]);
  assert.deepEqual(items, []);
  assert.equal(inventory.quantity, 3);
});

test("endpoint lee solo lead y productos del tenant, usa precios como la conversión y no muta stock", () => {
  const route = repoFile("app/api/admin/budgets/lead-draft/route.ts");
  assert.match(route, /requireAdminContext\("budgets\.write"\)/);
  assert.match(route, /where: \{ id: leadId, organizationId \}/);
  assert.match(route, /where: \{ organizationId, id: \{ in: requestedInventoryIds \} \}/);
  assert.match(route, /quoteItemActive\(item\.state\)/);
  assert.match(route, /catalogLineAmounts\(priced, item\.unitPrice, item\.quantity, itemDays, priceList\)/);
  assert.match(route, /leadBudgetPrefillItems\(prefillLines\)/);
  assert.doesNotMatch(route, /inventoryItem\.(create|update|updateMany|delete)|holdQuoteRequestStock|commitInventoryAssignment/);
});

test("el editor recibe las líneas precargadas y comprueba disponibilidad en el rango del pedido", () => {
  const module = repoFile("components/admin/modules/PresupuestosModule.tsx");
  assert.match(module, /setCreateItems\(draft\.items\)/);
  assert.match(module, /eventAvailabilityRange\(formEvent\) \?\? leadDraft\?\.quoteRange/);
  assert.match(module, /Abrir el editor no reserva stock/);
  assert.match(module, /Revisá cantidad, duración, precio y disponibilidad/);
});
