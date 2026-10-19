import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_FILTERS } from "../lib/store-filters";

Object.assign(globalThis, { React });

test("buscador y orden viven justo antes de Capacidad, dentro del panel reutilizado", async () => {
  const { FiltersPanel } = await import("../components/catalog-public/StoreFilters");
  const html = renderToStaticMarkup(createElement(FiltersPanel, {
    filters: EMPTY_FILTERS, onChange: () => {}, capacities: [{ key: "4", label: "4 personas", min: 4, max: 4 }],
    tags: [], collections: [], showPrices: true, hasRange: false, resultCount: 1,
    query: "mesa", onQuery: () => {}, sort: "nombre", onSort: () => {},
  }));
  assert.ok(html.indexOf("store-search-order") < html.indexOf("Capacidad"));
  assert.ok(html.includes('aria-label="Buscar productos por nombre o código"'));
  assert.ok(html.includes('aria-label="Ordenar productos"'));
  assert.ok(html.includes("cp-x-icon"), "mantiene los iconos de búsqueda/orden/capacidad disponibles");
});

test("panel desktop y cajón móvil pueden coexistir sin duplicar ids accesibles", async () => {
  const { FiltersPanel } = await import("../components/catalog-public/StoreFilters");
  const props = {
    filters: EMPTY_FILTERS, onChange: () => {}, capacities: [{ key: "4", label: "4 personas", min: 4, max: 4 }],
    tags: [], collections: [], showPrices: true, hasRange: false, resultCount: 1,
    query: "", onQuery: () => {}, sort: "destacados" as const, onSort: () => {},
  };
  const html = renderToStaticMarkup(createElement(React.Fragment, null,
    createElement(FiltersPanel, props), createElement(FiltersPanel, props),
  ));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 4, "ambos paneles generan sus propios controles etiquetables");
});

test("fecha manual y calendario compartido mantienen el borrador en una fila compacta", async () => {
  const picker = readFileSync("components/catalog-public/EventPicker.tsx", "utf8");
  assert.match(picker, /DayField label="Fecha del evento"/);
  assert.doesNotMatch(picker, /dateShortcuts|cp-event-shortcut|Elegir una fecha rápida/);
  assert.match(picker, /updateDraft\(\{ from: value \}\)/, "la fecha manual persiste en el borrador de sesión");
  for (const label of ["Días de alquiler", "Invitados", "Ver disponibilidad"]) assert.ok(picker.includes(label), label);
  const css = readFileSync("app/tienda.css", "utf8");
  assert.match(css, /\.cp-filter-chips\[data-hidden="true"\] \{ max-height: 0; padding-block: 0;/);
  assert.match(css, /\.cp-theme \.cp-event\[data-variant="bar"\] \.cp-event-fields \{ display: grid; grid-template-columns: minmax\(190px/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.cp-event\[data-variant="bar"\] \.cp-event-go \{ grid-column: 3;/);
});

test("la preorden anuncia el agregado, muestra carrito y respeta movimiento reducido", async () => {
  const { OrderBar } = await import("../components/catalog-public/OrderBar");
  const html = renderToStaticMarkup(createElement(OrderBar, {
    count: 2, productCount: 1, text: "Gs. 200.000", names: ["Mesa"],
    confirmation: { key: 1, text: "Agregado · 2 × Mesa" }, onOpen: () => {},
  }));
  assert.ok(html.includes("Ver preorden"));
  assert.ok(html.includes('role="status"'));
  assert.ok(html.includes("cp-x-icon"));
  const css = readFileSync("app/tienda.css", "utf8");
  assert.match(css, /backdrop-filter: blur\(12px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^{]*\{[^}]*cp-bar/);
  assert.match(css, /cp-theme:has\(\.cp-bar\) \.cp-footer \{ padding-bottom:/);
});

test("los chips de categoría usan historia de cliente y no enlaces de navegación de documento", () => {
  const source = readFileSync("components/catalog-public/CategoryPage.tsx", "utf8");
  assert.match(source, /clientSide: true/);
  assert.doesNotMatch(source, /<Link\b/);
  const browser = readFileSync("components/catalog-public/CatalogBrowser.tsx", "utf8");
  assert.match(browser, /window\.history\.pushState\(window\.history\.state, "", target\)/);
  assert.match(browser, /categoryPath = categoryNavigation\?\.links\.find/);
});
