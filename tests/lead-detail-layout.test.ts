import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("detalle de Leads: resumen prioriza contacto, evento, estado y ubicación", () => {
  const source = read("components/admin/modules/LeadsModule.tsx");
  assert.match(source, /admin-detail-grid admin-lead-summary/);
  assert.match(source, /selected\.message\?\.trim\(\) \?/);
  assert.doesNotMatch(source, /El lead no dejó un mensaje/);
  assert.match(source, /admin-lead-message/);
});

test("productos del pedido muestran foto o fallback, SKU, detalle y columnas", () => {
  const source = read("components/admin/modules/LeadsModule.tsx");
  const styles = read("app/globals.css");
  assert.match(source, /function LeadProductImage/);
  assert.match(source, /Foto de \$\{name\}/);
  assert.match(source, /admin-lead-product-image--empty/);
  assert.match(source, /SKU \{item\.productSku \|\| item\.productSlug\}/);
  assert.match(source, /admin-lead-product-note/);
  assert.match(styles, /admin-table--leads-productos > \.admin-table-head > \.admin-cell:nth-child\(2\)[\s\S]*admin-lead-product-centered \{ text-align: center/);
  assert.match(styles, /admin-table--leads-productos \{ --leads-productos-cols:/);
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*admin-lead-detail/);
});

test("foto y SKU solo vienen del inventario de la empresa activa", () => {
  const route = read("app/api/leads/route.ts");
  assert.match(route, /where: \{ organizationId: auth\.context\.organizationId, id: \{ in: inventoryIds \} \}/);
  assert.match(route, /productSku: inventory\?\.sku \?\? null/);
  assert.match(route, /productImageUrl: inventory \? inventoryImageUrl\(inventory\) : null/);
});

test("las dos acciones de presupuesto describen alcances distintos y no cambian endpoint", () => {
  const source = read("components/admin/modules/LeadsModule.tsx");
  assert.match(source, /Revisar y armar presupuesto/);
  assert.match(source, /Convertir en borrador/);
  assert.match(source, /todos los productos que pidió el cliente[\s\S]*Revisá stock y precios antes de enviarlo; esta acción no manda el presupuesto/);
  assert.match(source, /quote-requests\/\$\{encodeURIComponent\(quoteId\)\}\/convert/);
  assert.doesNotMatch(source, /Aceptar y convertir en presupuesto/);
});
