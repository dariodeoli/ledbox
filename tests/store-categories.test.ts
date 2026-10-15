import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolveStoreCategory, storeCategories, storeCategoryHref, withStoreDates } from "../lib/store-categories";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
test("categorías públicas: acentos, subcategorías, espacios y caracteres sin equivalencia ASCII", () => {
  const result = storeCategories(["Tótems", "Pantallas LED › Exterior", "Vajilla y copas", "日本語"].map((category) => ({ category })));
  assert.deepEqual(result.map((row) => row.slug), ["totems", "pantallas-led-exterior", "vajilla-y-copas", "categoria"]);
  assert.deepEqual(storeCategories([{ category: "Vajilla" }, { category: "Vajilla" }]), [{ name: "Vajilla", slug: "vajilla" }]);
  assert.equal(resolveStoreCategory(result, "oculta"), null);
});

test("colisiones no mezclan categorías; orden de productos no cambia URLs y enlaces con huella sobreviven al ocultar homónimas", () => {
  const names = ["Sonido Pro", "Sonido › Pro", "Sonído Pro", "Sonido-Pro"];
  const result = storeCategories(names.map((category) => ({ category })));
  assert.equal(new Set(result.map((row) => row.slug)).size, names.length);
  for (const category of result) {
    assert.match(category.slug, /^sonido-pro--[a-f0-9]{8}$/);
    assert.equal(resolveStoreCategory(result, category.slug)?.name, category.name);
    assert.equal(resolveStoreCategory(storeCategories([{ category: category.name }]), category.slug)?.name, category.name);
  }
  assert.deepEqual(storeCategories([...names].reverse().map((category) => ({ category }))).sort((a, b) => a.name.localeCompare(b.name)), [...result].sort((a, b) => a.name.localeCompare(b.name)));
  assert.equal(resolveStoreCategory(result, "sonido-pro"), null, "una URL ambigua no elige otra categoría al azar");
});

test("navegación de categoría conserva solo el período y escapa el nombre de empresa", () => {
  const dates = { fromKey: "2026-10-30", toKey: "2026-11-02" };
  const category = storeCategories([{ category: "Tótems" }])[0];
  assert.equal(storeCategoryHref("/tienda/empresa", category, dates), "/tienda/empresa/categoria/totems?desde=2026-10-30&hasta=2026-11-02");
  assert.equal(withStoreDates("/tienda/empresa#catalogo", dates), "/tienda/empresa?desde=2026-10-30&hasta=2026-11-02#catalogo");
  assert.equal(withStoreDates("/tienda/empresa/acceso/token?categoria=Sonido", dates), "/tienda/empresa/acceso/token?categoria=Sonido&desde=2026-10-30&hasta=2026-11-02");
  assert.equal(storeCategoryHref("/tienda/empresa", category, null), "/tienda/empresa/categoria/totems");
});

test("página propia reutiliza el catálogo y carrito de toda la tienda; limpiar filtros conserva la categoría", () => {
  const page = read("components/catalog-public/CategoryPage.tsx");
  assert.match(page, /<h1 className="cp-h3">\{category.name\}/);
  assert.ok(!/<StoreFront|cp-hero/.test(page));
  assert.match(page, /items=\{items\} range=\{range\} initialCategory=\{category.name\} categoryName=\{category.name\}/);
  assert.match(page, /cartScope="public" fichaBase=\{basePath\}/);
  const browser = read("components/catalog-public/CatalogBrowser.tsx");
  assert.match(browser, /currentCategory = categoryName \?\? category/);
  assert.match(browser, /setCategory\(categoryName \?\? null\)/);
  assert.match(browser, /storeCartKey\(slug, cartScope === "visitor" \? "public" : cartScope\)/);
  const route = read("app/(catalogo)/tienda/[orgSlug]/page.tsx");
  assert.ok(route.indexOf('catalogAccessMode !== "OPEN"') < route.indexOf("query.categoria !== undefined"));
});

test("el resumen persistente diferencia productos y unidades, con importe y confirmación repetible", async () => {
  const { default: React, createElement } = await import("react");
  Object.assign(globalThis, { React });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { OrderBar } = await import("../components/catalog-public/OrderBar");
  const props = { count: 3, productCount: 2, names: ["Pantalla", "Copa"], text: "Subtotal estimado Gs. 300.000", confirmation: { key: 2, text: "Agregaste 1 × Copa" }, onOpen: () => {} };
  const html = renderToStaticMarkup(createElement(OrderBar, props));
  for (const text of ["2 productos", "3 unidades", "Subtotal estimado Gs. 300.000", "Agregaste 1 × Copa", 'role="status"']) assert.ok(html.includes(text), text);
  const normal = renderToStaticMarkup(createElement(OrderBar, { ...props, confirmation: null }));
  assert.ok(normal.includes("Pantalla · Copa"));
  const browser = read("components/catalog-public/CatalogBrowser.tsx");
  assert.match(browser, /key: \+\+addedSequence.current/);
  assert.ok(!browser.includes("contactAsked"), "agregar no abre un formulario automático");
  assert.match(browser, /onSaveCart=\{!saved && cartScope === "public"/);
});


test("cerrar la vista rápida conserva fechas elegidas dentro del popup", () => {
  const browser = read("components/catalog-public/CatalogBrowser.tsx");
  assert.match(browser, /quickDatesBefore.current = JSON.stringify\(\[params.get\("desde"\), params.get\("hasta"\)\]\)/);
  assert.match(browser, /pushedQuick.current && currentDates === quickDatesBefore.current/);
  assert.match(browser, /replaceState\(window.history.state, "", quickUrl\(null\)\)/);
});
