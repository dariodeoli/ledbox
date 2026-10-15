import assert from "node:assert/strict";
import { test } from "node:test";
import { capacityText, cardSpecs } from "../lib/catalog-card";
import { catalogSpecs } from "../lib/import-catalog";

test("tarjeta: usa los campos propios cuando existen y no toca la descripción", () => {
  const specs = cardSpecs({ dimensions: "Ø 1,40 m", capacity: 8, description: "Medidas: otra cosa. Capacidad: 99. Texto." });
  assert.deepEqual(specs, { dimensions: "Ø 1,40 m", capacity: 8, description: "Medidas: otra cosa. Capacidad: 99. Texto." });
});

test("tarjeta: datos viejos, medidas y capacidad salen de la descripción en una línea", () => {
  const specs = cardSpecs({ dimensions: null, capacity: null, description: "Medidas: 40 x 40 cm. Capacidad: 10 personas. Plato llano de porcelana." });
  assert.equal(specs.dimensions, "40 x 40 cm");
  assert.equal(specs.capacity, 10);
  assert.equal(specs.description, "Plato llano de porcelana.");
});

test("tarjeta: datos viejos en renglones y con decimales", () => {
  const specs = cardSpecs({ dimensions: null, capacity: null, description: "Medidas: Ø 1.40 m\nCapacidad: 6\nIncluye mantel." });
  assert.equal(specs.dimensions, "Ø 1.40 m");
  assert.equal(specs.capacity, 6);
  assert.equal(specs.description, "Incluye mantel.");
});

test("tarjeta: completa solo lo que falta", () => {
  const specs = cardSpecs({ dimensions: "30 cm", capacity: null, description: "Medidas: 99 cm. Capacidad: 4 personas." });
  assert.equal(specs.dimensions, "30 cm");
  assert.equal(specs.capacity, 4);
  assert.equal(specs.description, "Medidas: 99 cm.");
});

test("tarjeta: lo que el importador no puede mapear no se inventa", () => {
  const specs = cardSpecs({ dimensions: null, capacity: null, description: "Capacidad: varias. Sin medidas." });
  assert.equal(specs.capacity, null);
  assert.equal(specs.dimensions, null);
  assert.equal(specs.description, "Capacidad: varias. Sin medidas.");
  assert.deepEqual(cardSpecs({}), { dimensions: null, capacity: null, description: null });
});

test("tarjeta: mismo resultado que el importador para el mismo texto", () => {
  const archivo = { medidas: " Ø 1,40  m ", capacidad: "10 personas" };
  const importado = catalogSpecs(archivo);
  const mostrado = cardSpecs({ description: `Medidas: ${archivo.medidas.trim()}. Capacidad: ${archivo.capacidad}.` });
  assert.equal(mostrado.dimensions, importado.dimensions);
  assert.equal(mostrado.capacity, importado.capacity);
  assert.equal(capacityText(1), "1 persona");
  assert.equal(capacityText(10), "10 personas");
});

// ── Anatomía de la tarjeta y vista rápida ─────────────────────────────────────

import { readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pickSimilar } from "../lib/server/catalog-product";

// tsx compila el JSX con el runtime clásico: el componente espera `React` global (Next usa el automático).
(globalThis as { React?: unknown }).React = React;
const loadTile = async () => (await import("../components/catalog-public/ProductTile")).ProductTile;

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const item = { id: "i1", name: "Sofá de dos cuerpos", category: "Sector Living › Lounge", sku: "527", imageUrl: "/x.png", description: "Medidas: 1,80 m. Descripción larga que NO va en la tarjeta.", capacity: 2, dimensions: "1,80 m", price: null, availability: "LOW" as const, package: null };
const tile = async (overrides: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(await loadTile(), {
    item, specs: cardSpecs(item), isPackage: false, showPrices: true, unit: 150000, unitText: "por día", saving: null, tierHint: null, quantity: 0,
    fichaHref: "/tienda/demo/p/i1", onOpen: () => {}, onQuantity: () => {}, ...overrides,
  } as never));

test("tarjeta: sin bloque «Incluye» ni descripción y con chips, precio y botones", async () => {
  const html = await tile({ item: { ...item, package: [{ name: "Silla", quantity: 4, price: { unit: 1000 } }] }, isPackage: true });
  assert.ok(!/Incluye/i.test(html), "la tarjeta no muestra «Incluye»");
  assert.ok(!html.includes("Descripción larga"), "la tarjeta no muestra la descripción");
  assert.ok(!/cp-x-desc|cp-x-specs|catalog-pieces/.test(html), "sin contenedores reservados para Incluye o descripción");
  assert.match(html, /COD #527/);
  assert.match(html, />Juego</);
  assert.match(html, /Medidas<\/span> 1,80 m/);
  assert.match(html, /Capacidad<\/span> 2 personas/);
  assert.match(html, /Gs\. 150\.000/);
  assert.match(html, /por día/);
  assert.match(html, /Pocas unidades/);
  assert.match(html, /Agregar al pedido/);
  assert.match(html, /Ver más/);
  // El nombre y la foto abren la vista rápida (con enlace a la ficha como respaldo sin JavaScript).
  assert.equal((html.match(/href="\/tienda\/demo\/p\/i1"/g) ?? []).length, 3);
});

test("tarjeta: no reserva espacio para lo que no existe", async () => {
  const bare = { ...item, capacity: null, dimensions: null, description: null, availability: null };
  const html = await tile({ item: bare, specs: cardSpecs(bare) });
  assert.ok(!/cp-tile-specs/.test(html), "sin medidas ni capacidad no hay fila de chips");
  assert.ok(!/cp-tile-status/.test(html), "sin estado no hay chip de estado");
  assert.ok(!/cp-tile-sub/.test(html), "sin ahorro ni escalón no hay renglón extra");
  const sinPrecio = await tile({ item: bare, specs: cardSpecs(bare), showPrices: false, unit: 0 });
  assert.match(sinPrecio, /Consultar precio/);
});

test("tarjeta: combo con ahorro muestra «Ahorrás» y «Por separado» tachado; con pedido muestra la cantidad", async () => {
  const html = await tile({ saving: { savings: 50000, unitSum: 200000 }, quantity: 3 });
  assert.match(html, /Ahorrás Gs\. 50\.000/);
  assert.match(html, /Por separado <s>Gs\. 200\.000<\/s>/);
  assert.match(html, /<output[^>]*>3<\/output>/);
  assert.ok(!/cp-tile-add"/.test(html), "con cantidad el botón de agregar se reemplaza por el selector");
});

test("vista rápida: opciones similares = combos que lo contienen y la misma categoría, nunca el resto", () => {
  const mk = (id: string, category: string) => ({ id, category }) as never;
  const all = [mk("a", "Sillas"), mk("b", "Sillas"), mk("c", "Mesas"), mk("combo", "Combos"), mk("d", "Sillas")];
  const picked = pickSimilar({ id: "a", category: "Sillas" }, all, new Set(["combo"]));
  assert.deepEqual(picked.map((entry) => entry.id), ["combo", "b", "d"]);
  assert.deepEqual(pickSimilar({ id: "z", category: "X" }, [mk("z", "X"), mk("m", "Y")], new Set()), []);
});

test("vista rápida y cajones: URL ?p=, atrás cierra, portal por encima del encabezado y barra con monto sin fechas", () => {
  const browser = read("components/catalog-public/CatalogBrowser.tsx");
  assert.match(browser, /searchParams\.set\("p", id\)/);
  assert.match(browser, /addEventListener\("popstate"/);
  assert.match(browser, /window\.history\.back\(\)/);
  assert.equal((browser.match(/<ThemePortal>/g) ?? []).length, 3, "carrito, guardar carrito y vista rápida salen por el portal");
  assert.match(browser, /Elegí fechas para el total/);
  assert.match(browser, /por día o evento/);
  const quick = read("components/catalog-public/QuickView.tsx");
  for (const text of ["Opciones similares", "Abrir página del producto", "Incluye", 'aria-modal="true"', "Agregar al pedido"]) assert.ok(quick.includes(text), text);
  const css = read("app/globals.css");
  assert.match(css, /\.cp-overlay \{ position: fixed; inset: 0; z-index: 60;/);
  assert.match(css, /\.cp-btn--primary\[disabled\]/);
  const portal = read("components/catalog-public/ThemePortal.tsx");
  assert.match(portal, /closest\("\.cp-theme"\)/);
  assert.match(portal, /key === "Escape"/);
});

test("vista rápida: el endpoint público filtra por empresa, limita intentos y no devuelve costos", () => {
  const http = read("lib/server/store-product-http.ts");
  assert.match(http, /rateLimit\(/);
  assert.match(http, /loadProductDetail\(context/);
  assert.match(http, /catalogAccessMode !== "OPEN"/);
  assert.ok(!/unitCost|costPrice|purchasePrice/i.test(http));
  for (const route of ["product/[code]", "acceso/[token]/product/[code]", "mayorista/[token]/product/[code]"]) {
    const file = read(`app/api/catalog/[orgSlug]/${route}/route.ts`);
    assert.match(file, /export async function GET/);
    assert.match(file, /handleStoreProduct/);
  }
});
