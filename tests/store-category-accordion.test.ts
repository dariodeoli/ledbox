import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import React, { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { categoryPreviewItems } from "../lib/store-category-preview";
import { storeCategories } from "../lib/store-categories";
import { DEFAULT_APPEARANCE, appearanceView, TEMPLATES } from "../lib/appearance";
import type { PublicCatalogItem, PublicStorefront } from "../lib/server/catalog-public";

Object.assign(globalThis, { React });
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const nodes = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...nodes(node.props.children as ReactNode)];
};

test("preview acotada a cuatro productos de la categoría exacta, sin mezclar jerarquías ni mutar", () => {
  const items = [{ id: "padre", category: "Platos" }, { id: "hermana", category: "Platos › Vidrio" }, ...Array.from({ length: 9 }, (_, i) => ({ id: `hijo${i}`, category: "Platos › Cerámica" }))];
  assert.deepEqual(categoryPreviewItems(items, "Platos › Cerámica").map((row) => row.id), ["hijo0", "hijo1", "hijo2", "hijo3"]);
  assert.deepEqual(categoryPreviewItems(items, "Platos").map((row) => row.id), ["padre"]);
  assert.deepEqual(categoryPreviewItems(items, "No publicada"), []);
  assert.equal(items.length, 11);
});

test("SSR conserva enlace directo, nombre, foto sin producto oculto y controles válidos en los siete temas", async () => {
  const { CategoryAccordion } = await import("../components/catalog-public/CategoryAccordion");
  const props = { catalogKey: "/tienda/qa", showPrices: false, priceMode: "day" as const, categories: [{ name: "Platos › Cerámica", count: 7, minUnit: 9000, imageUrl: "/foto.webp", href: "/tienda/qa/categoria/platos-ceramica?desde=2026-10-30&hasta=2026-11-02" }, { name: "Sin foto", count: 1, minUnit: null, imageUrl: null, href: "/tienda/qa/categoria/sin-foto" }] };
  for (const template of TEMPLATES) {
    const html = renderToStaticMarkup(createElement("div", { className: "cp-theme", "data-theme": template }, createElement(CategoryAccordion, props)));
    assert.match(html, /Platos › Cerámica/); assert.match(html, /7 productos/);
    assert.match(html, /aria-expanded="false"/); assert.match(html, /hidden=""/);
    assert.match(html, /href="\/tienda\/qa\/categoria\/platos-ceramica\?desde=2026-10-30&amp;hasta=2026-11-02"/);
    assert.match(html, /class="cp-ph"/); assert.doesNotMatch(html, /cp-tile|Gs\.|data-store-category-preview=/);
    for (const control of html.matchAll(/aria-controls="([^"]+)"/g)) assert.ok(html.includes(`id="${control[1]}"`), "el panel referenciado existe aun cerrado");
  }
  const css = read("app/tienda.css");
  assert.match(css, /\.cp-cataccordion-media img\s*\{[^}]*object-fit: contain/);
  assert.match(css, /\.cp-cataccordion-toggle\s*\{[^}]*min-height: 80px/);
  assert.match(css, /\.cp-cataccordion-toggle:focus-visible/);
});

test("StoreFront opcional usa todas las categorías autorizadas, enlaces con fechas y un solo catálogo", async () => {
  const { StoreFront } = await import("../components/catalog-public/StoreFront");
  const { CategoryAccordion } = await import("../components/catalog-public/CategoryAccordion");
  const { CategoryCard } = await import("../components/catalog-public/CategoryCard");
  const { CatalogBrowser } = await import("../components/catalog-public/CatalogBrowser");
  const items = ["Platos", "Platos › Cerámica", "Platos › Vidrio", "Copas", "Sillas", "Mesas", "Carpas", "Sonido"].map((category, i) => ({ id: `qa${i}`, name: category, category, imageUrl: null, price: null, sku: null, availability: null })) as PublicCatalogItem[];
  const baseStore = { name: "Prueba", slug: "qa", tagline: null, email: null, whatsappPhone: null, profile: null, logos: { light: false, dark: false }, covers: { desktop: null, mobile: null }, homePhotos: {}, accessMode: "OPEN", appearance: appearanceView(DEFAULT_APPEARANCE) } as PublicStorefront;
  const range = { fromKey: "2026-10-30", toKey: "2026-11-02", days: 3 };
  for (const template of TEMPLATES) {
    const appearance = { ...baseStore.appearance, template, home: { ...baseStore.appearance.home, categoryLayout: "accordion" as const } };
    const tree = nodes(StoreFront({ store: { ...baseStore, appearance }, items, showPrices: true, demo: true, range, initialCategory: null, basePath: "/tienda/qa", preorderPath: "/api/catalog/qa/preorder" }));
    const accordions = tree.filter((node) => node.type === CategoryAccordion);
    const browsers = tree.filter((node) => node.type === CatalogBrowser);
    assert.equal(accordions.length, 1); assert.equal(browsers.length, 1);
    assert.equal(browsers[0].props.items, items, "se reutiliza la misma carga del catálogo");
    assert.equal(accordions[0].props.items, undefined, "no serializa una segunda copia de productos");
    const entries = accordions[0].props.categories as Array<{ name: string; href: string }>;
    assert.deepEqual(entries.map((entry) => entry.name), storeCategories(items).map((entry) => entry.name));
    assert.equal(entries.length, 8, "no aplica el límite de seis destacadas al acordeón");
    assert.ok(entries.every((entry) => entry.href.includes("/categoria/") && entry.href.includes("desde=2026-10-30&hasta=2026-11-02")));
    assert.equal(browsers[0].props.categoryPreviewKey, "/tienda/qa");
  }
  for (const [accessMode, cartScope] of [["PRIVATE", "acceso"], ["REQUEST", "public"], ["OPEN", "mayorista"]] as const) {
    const tree = nodes(StoreFront({ store: { ...baseStore, accessMode, appearance: { ...baseStore.appearance, home: { ...baseStore.appearance.home, categoryLayout: "accordion" } } }, items, showPrices: false, demo: true, range, initialCategory: null, basePath: "/tienda/qa/acceso/token", preorderPath: "/api/catalog/qa/preorder", cartScope }));
    const accordion = tree.find((node) => node.type === CategoryAccordion)!;
    const entries = accordion.props.categories as Array<{ href: string }>;
    assert.ok(entries.every((entry) => entry.href.startsWith("/tienda/qa/acceso/token?categoria=") && !entry.href.includes("/categoria/")), "no convierte acceso privado en una ruta pública");
  }
  const layoutStore = { ...baseStore, appearance: { ...baseStore.appearance, home: { ...baseStore.appearance.home, categoryLayout: "accordion" as const, order: ["categorias", "hero", ...baseStore.appearance.home.order.filter((section) => section !== "categorias" && section !== "hero")] as typeof baseStore.appearance.home.order } } };
  const reordered = nodes(StoreFront({ store: layoutStore, items, showPrices: true, demo: true, range, initialCategory: null, basePath: "/tienda/qa", preorderPath: "/api/catalog/qa/preorder" }));
  assert.ok(reordered.findIndex((node) => node.type === CategoryAccordion) < reordered.findIndex((node) => node.props["data-testid"] === "store-hero"), "respeta categorías antes de la portada");
  layoutStore.appearance.home.hidden = ["categorias"];
  const hidden = nodes(StoreFront({ store: layoutStore, items, showPrices: true, demo: true, range, initialCategory: null, basePath: "/tienda/qa", preorderPath: "/api/catalog/qa/preorder" }));
  assert.equal(hidden.filter((node) => node.type === CategoryAccordion).length, 0);
  assert.equal(hidden.filter((node) => node.type === CatalogBrowser).length, 1);
  const cards = nodes(StoreFront({ store: baseStore, items, showPrices: true, demo: true, range, initialCategory: null, basePath: "/tienda/qa", preorderPath: "/api/catalog/qa/preorder" }));
  assert.equal(cards.filter((node) => node.type === CategoryCard).length, 6);
  assert.equal(cards.filter((node) => node.type === CategoryAccordion).length, 0, "legacy permanece en tarjetas");
});

test("puente real rechaza otros scopes/hosts y monta sólo la categoría autorizada en su host", () => {
  const source = ts.createSourceFile("CatalogBrowser.tsx", read("components/catalog-public/CatalogBrowser.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let accept: ts.ArrowFunction | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === "accept" && node.initializer && ts.isArrowFunction(node.initializer)) accept = node.initializer; ts.forEachChild(node, visit); };
  visit(source); assert.ok(accept);
  const host = { dataset: { storeCategoryScope: "/tienda/qa", storeCategoryPreview: "Platos" } };
  const changes: unknown[] = [];
  const handler = runInNewContext(ts.transpileModule(`(${accept.getText(source)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { categoryPreviewKey: "/tienda/qa", items: [{ category: "Platos" }], document: { getElementById: (id: string) => id === "host" ? host : null }, setCategoryPreview: (value: unknown) => changes.push(value) }) as (detail: unknown) => void;
  handler({ catalogKey: "/otra", category: "Platos", targetId: "host" });
  handler({ catalogKey: "/tienda/qa", category: "Privada", targetId: "host" });
  handler({ catalogKey: "/tienda/qa", category: "Platos", targetId: "otro-host" });
  assert.equal(changes.length, 0);
  handler({ catalogKey: "/tienda/qa", category: "Platos", targetId: "host" });
  assert.equal((changes[0] as { host: unknown }).host, host);
  handler({ catalogKey: "/tienda/qa", category: null, targetId: null }); assert.equal(changes[1], null);
  const browser = read("components/catalog-public/CatalogBrowser.tsx");
  assert.match(browser, /categoryPreviewItems\(items, categoryPreview\.category\)\.map\(renderItem\)/);
  assert.match(browser, /onQuantity=\{setQuantity\}/); assert.match(browser, /onAdd=\{addFromTile\}/);
  assert.match(browser, /window\.removeEventListener\(CATEGORY_PREVIEW_EVENT, onPreview\)/);
  assert.match(browser, /if \(!categoryPreview\.host\.isConnected\) setCategoryPreview\(null\)/);
});
