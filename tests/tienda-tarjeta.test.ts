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

import { readFileSync, readdirSync } from "node:fs";
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
    item, specs: cardSpecs(item), isPackage: false, showPrices: true, perUnit: false, step: 1, unit: 150000, unitText: "por día", saving: null, tierHint: null, pieces: null, quantity: 0,
    fichaHref: "/tienda/demo/p/i1", onOpen: () => {}, onQuantity: () => {}, onAdd: () => {}, ...overrides,
  } as never));

test("tarjeta: sin bloque «Incluye» ni descripción; foto con capacidad, código, nombre, dato, precio sin caja y UN botón", async () => {
  const html = await tile({ item: { ...item, package: [{ name: "Silla", quantity: 4, price: { unit: 1000 } }] }, isPackage: true, pieces: "4 × Silla" });
  assert.ok(!/Incluye/i.test(html), "la tarjeta no muestra «Incluye»");
  assert.ok(!html.includes("Descripción larga"), "la tarjeta no muestra la descripción");
  assert.match(html, /COD #527 · Juego/);
  assert.match(html, /cp-tile-badge[^>]*>.*2 personas/, "capacidad como badge sobre la foto");
  assert.match(html, /4 × Silla/, "dato clave de una línea: las piezas del juego");
  assert.match(html, /Gs\. 150\.000/);
  assert.match(html, /por día/);
  assert.match(html, /Pocas unidades/);
  assert.match(html, /Agregar<\/button>/);
  assert.ok(!/Ver más/.test(html), "se quitó «Ver más»");
  assert.equal((html.match(/<button/g) ?? []).length, 1, "un solo botón en la tarjeta");
  // La tarjeta ENTERA abre la vista rápida (enlace estirado, con la ficha como respaldo sin JavaScript).
  assert.equal((html.match(/href="\/tienda\/demo\/p\/i1"/g) ?? []).length, 1);
  assert.match(html, /cp-tile-open/);
});

test("tarjeta: sin foto, ícono del tema y nunca letras sueltas", async () => {
  const html = await tile({ item: { ...item, imageUrl: null, name: "Kiosko Touch" } });
  assert.match(html, /cp-ph/);
  assert.ok(!/>KI<|>GE<|>KT</.test(html), "nada de iniciales");
  for (const file of readdirSync(new URL("../components/catalog-public/", import.meta.url)).filter((name) => name.endsWith(".tsx"))) {
    assert.ok(!/slice\(0, 2\)\.toUpperCase\(\)/.test(read(`components/catalog-public/${file}`)), `${file}: sin iniciales como foto`);
  }
});

test("tarjeta: no reserva espacio para lo que no existe", async () => {
  const bare = { ...item, capacity: null, dimensions: null, description: null, availability: null };
  const html = await tile({ item: bare, specs: cardSpecs(bare) });
  assert.ok(!/cp-tile-badge/.test(html), "sin capacidad no hay badge");
  assert.ok(!/cp-tile-datum/.test(html), "sin piezas ni medidas no hay renglón de dato");
  assert.ok(!/cp-tile-avail|cp-tile-flag/.test(html), "sin estado no hay línea de disponibilidad");
  assert.ok(!/cp-tile-sub/.test(html), "sin ahorro ni escalón no hay renglón extra");
  const sinPrecio = await tile({ item: bare, specs: cardSpecs(bare), showPrices: false, unit: 0 });
  assert.match(sinPrecio, /Consultar precio y disponibilidad/);
  assert.match(sinPrecio, /Agregar<\/button>/);
  const sinMonto = await tile({ item: bare, specs: cardSpecs(bare), unit: 0 });
  assert.match(sinMonto, /Consultar precio y disponibilidad/);
  assert.match(sinMonto, /Agregar<\/button>/);
});

test("tarjeta: «c/u» con selector de a 10; combo con ahorro muestra «Ahorrás» y «Por separado»; con pedido, la cantidad", async () => {
  const porUnidad = await tile({ perUnit: true, step: 10, unit: 2500, unitText: "c/u" });
  assert.match(porUnidad, /Gs\. 2\.500/);
  assert.match(porUnidad, /c\/u/);
  assert.match(porUnidad, /Agregar 10<\/button>/);
  assert.match(porUnidad, /cp-tile-add/, "el producto sin cantidad siempre ofrece Agregar");
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
  assert.equal((browser.match(/<ThemePortal>/g) ?? []).length, 4, "resumen, carrito, guardar carrito y vista rápida salen por el portal");
  assert.match(browser, /Elegí fechas para el total/);
  assert.match(browser, /por día o evento/);
  assert.match(browser, /<OrderBar/, "barra del pedido compacta");
  const quick = read("components/catalog-public/QuickView.tsx");
  for (const text of ["Opciones similares", "Incluye", 'aria-modal="true"', "Agregar al pedido"]) assert.ok(quick.includes(text), text);
  assert.ok(!quick.includes("Ver la ficha completa"), "todos los detalles se consultan dentro de la vista rápida");
  const css = read("app/tienda.css");
  assert.match(css, /\.cp-overlay \{ position: fixed; inset: 0; z-index: var\(--z-overlay\);/);
  assert.match(css, /\.cp-btn--primary\[disabled\]/);
  const portal = read("components/catalog-public/ThemePortal.tsx");
  assert.match(portal, /closest\("\.cp-theme"\)/);
  assert.match(portal, /export \{ useModalBehavior \} from "@\/components\/overlays\/useModalBehavior"/);
  assert.match(read("components/overlays/useModalBehavior.ts"), /return mountOverlay\(panel.current/);
  assert.match(read("lib/overlay-lifecycle.ts"), /event\.key === 'Escape'/);
  assert.match(quick, /useModalBehavior\(panel/);
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
