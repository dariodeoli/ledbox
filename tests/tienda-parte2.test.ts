import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeCatalog, planCatalog } from "../lib/import-catalog";
import { collectionSlug, parseCollectionInput, sortCollections, uniqueSlug } from "../lib/collections";
import { DEFAULT_HOME, HOME_SECTION_IDS, moveSection, moveSectionTo, normalizeOrder, parseHome, readHome, visibleSections } from "../lib/store-home";
import { EMPTY_FILTERS, activeFilterCount, capacityOptions, matchesFilters, parsePriceBound } from "../lib/store-filters";
import { collectTags, parseTags } from "../lib/store-tags";
import { DEFAULT_APPEARANCE, parseAppearance, readAppearance } from "../lib/appearance";

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const doc = (productos: unknown[], extra: Record<string, unknown> = {}) => {
  const parsed = normalizeCatalog({ moneda: "PYG", productos, ...extra });
  assert.ok(parsed.ok);
  return parsed.value;
};
const preview = (value: ReturnType<typeof doc>, photos: string[] | null) =>
  planCatalog({ products: value.doc.productos, parseProblems: value.problems, existing: new Map(), photoNames: photos ? new Set(photos) : null, collections: value.doc.colecciones });

// ── Importación: fotos, colecciones y estilo ─────────────────────────────────

test("importación: «fotos» además de «foto»; la principal es foto (o la primera de fotos) y no se repite", () => {
  const value = doc([
    { codigo: "527", nombre: "Lounge Oslo", categoria: "Living", foto: "527.jpg", fotos: ["527.jpg", "527-2.jpg", "527-3.jpg"] },
    { codigo: "528", nombre: "Lounge Roma", categoria: "Living", fotos: ["528.jpg", "528-2.jpg"] },
    { codigo: "529", nombre: "Puff", categoria: "Living", foto: "529.jpg" },
  ]);
  const [a, b, c] = value.doc.productos;
  assert.equal(a.foto, "527.jpg");
  assert.deepEqual(a.fotos, ["527-2.jpg", "527-3.jpg"], "la principal no se repite entre las extra");
  assert.equal(b.foto, "528.jpg", "sin «foto», la primera de «fotos» es la principal");
  assert.deepEqual(b.fotos, ["528-2.jpg"]);
  assert.equal(c.fotos, null, "sin «fotos» no se tocan las que ya tiene");
});

test("importación: fotos con carpeta o ../ se ignoran con aviso, y más de 8 extras se recortan con aviso", () => {
  const value = doc([{ codigo: "A1", nombre: "Uno", categoria: "X", foto: "a.jpg", fotos: ["../x.jpg", "sub/b.jpg", ...Array.from({ length: 10 }, (_, i) => `a-${i}.jpg`)] }]);
  const [product] = value.doc.productos;
  assert.equal(product.fotos?.length, 8);
  assert.ok(value.problems.filter((p) => p.tipo === "foto-invalida").length >= 2);
  assert.ok(value.problems.some((p) => p.tipo === "fotos-exceso"));
});

test("importación: el plan cruza las fotos extra con el ZIP, avisa las que faltan y no las marca como sobrantes", () => {
  const value = doc([{ codigo: "527", nombre: "Lounge", categoria: "Living", foto: "527.jpg", fotos: ["527-2.jpg", "527-3.jpg"] }]);
  const plan = preview(value, ["527.jpg", "527-2.jpg", "otra.jpg"]);
  assert.deepEqual(plan.items[0].fotosExtra, ["527-2.jpg"]);
  assert.equal(plan.summary.fotosExtra, 1);
  assert.ok(plan.problems.some((p) => p.tipo === "foto-faltante" && p.mensaje.includes("527-3.jpg")));
  assert.ok(plan.problems.some((p) => p.tipo === "foto-sobrante" && p.mensaje.includes("otra.jpg")));
  assert.ok(!plan.problems.some((p) => p.tipo === "foto-sobrante" && p.mensaje.includes("527-2.jpg")));
  assert.equal(preview(value, null).items[0].fotosExtra, null, "sin ZIP no hay fotos extra");
});

test("importación: «colecciones» por producto y sección declarada (descripcion, foto, orden); repetidas e inválidas avisan", () => {
  const value = doc(
    [
      { codigo: "1", nombre: "Plato verde", categoria: "Vajilla", colecciones: ["Verde Bosque", "verde bosque", "Colección Rayas"] },
      { codigo: "2", nombre: "Vaso", categoria: "Vajilla", colecciones: "Verde Bosque; Otra" },
      { codigo: "3", nombre: "Mantel", categoria: "Mesa" },
    ],
    { colecciones: [{ nombre: "Verde Bosque", descripcion: "Tonos de selva", foto: "vb.jpg", orden: 2 }, { nombre: "verde bosque" }, { descripcion: "sin nombre" }, { nombre: "Rayas", orden: "x" }] },
  );
  assert.deepEqual(value.doc.productos[0].colecciones, ["Verde Bosque", "Colección Rayas"], "la misma colección no se repite (sin tildes ni mayúsculas)");
  assert.deepEqual(value.doc.productos[1].colecciones, ["Verde Bosque", "Otra"], "un texto con separadores también sirve (planilla)");
  assert.equal(value.doc.productos[2].colecciones, null);
  assert.deepEqual(value.doc.colecciones.map((c) => [c.nombre, c.orden, c.foto]), [["Verde Bosque", 2, "vb.jpg"], ["Rayas", null, null]]);
  assert.ok(value.problems.some((p) => p.tipo === "coleccion-repetida"));
  assert.ok(value.problems.some((p) => p.tipo === "coleccion-invalida"));
  const plan = preview(value, ["vb.jpg"]);
  assert.deepEqual(plan.collections.map((c) => c.nombre).sort(), ["Colección Rayas", "Otra", "Rayas", "Verde Bosque"].sort());
  assert.equal(plan.summary.colecciones, 4);
  assert.equal(plan.summary.fotosColeccion, 1);
  assert.equal(plan.collections.find((c) => c.nombre === "Verde Bosque")?.declarada, true);
  assert.equal(plan.collections.find((c) => c.nombre === "Otra")?.declarada, false, "la que solo nombra un producto se crea sola");
  const missing = preview(value, []);
  assert.ok(missing.problems.some((p) => p.tipo === "coleccion-foto-faltante"));
});

test("importación: «estilo» se limpia (sin repetidos, hasta 8 de 24 caracteres) y ausente no toca nada", () => {
  const value = doc([
    { codigo: "1", nombre: "Silla", categoria: "Sillas", estilo: ["Natural", "natural", " Rattan ", "x".repeat(30)] },
    { codigo: "2", nombre: "Mesa", categoria: "Mesas", estilo: "Verde, Boho" },
    { codigo: "3", nombre: "Vaso", categoria: "Vasos", estilo: [] },
    { codigo: "4", nombre: "Plato", categoria: "Platos" },
  ]);
  const estilos = value.doc.productos.map((p) => p.estilo);
  assert.deepEqual(estilos, [["Natural", "Rattan"], ["Verde", "Boho"], [], null]);
  assert.ok(value.problems.some((p) => p.tipo === "estilo-invalido" && p.codigo === "1"));
  assert.equal(preview(value, null).summary.conEstilo, 2);
});

test("importación: una colección nueva no necesita ZIP ni sección; sin los campos el resumen queda en cero", () => {
  const plan = preview(doc([{ codigo: "1", nombre: "Silla", categoria: "Sillas" }]), null);
  assert.deepEqual([plan.summary.fotosExtra, plan.summary.colecciones, plan.summary.fotosColeccion, plan.summary.conEstilo], [0, 0, 0, 0]);
});

// ── Colecciones, estilos y secciones del inicio ──────────────────────────────

test("colecciones: slug sin tildes, único dentro de la empresa y validación del panel", () => {
  assert.equal(collectionSlug("Verde Bosque"), "verde-bosque");
  assert.equal(collectionSlug("Colección Rayas & Lunares"), "coleccion-rayas-y-lunares");
  assert.equal(collectionSlug("¡¡¡"), "");
  assert.equal(uniqueSlug("verde", new Set(["verde"])), "verde-2");
  assert.equal(uniqueSlug("", new Set()), "coleccion");
  assert.equal(parseCollectionInput({ name: "  " }).ok, false);
  assert.equal(parseCollectionInput({ name: "x".repeat(61) }).ok, false);
  assert.equal(parseCollectionInput({ name: "Rayas", sortOrder: -1 }).ok, false);
  assert.equal(parseCollectionInput({ name: "Rayas", itemIds: "no" }).ok, false);
  const ok = parseCollectionInput({ name: " Verde   Bosque ", itemIds: ["a", "b", "a"], description: "  Tonos  de selva " });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { name: "Verde Bosque", description: "Tonos de selva", visible: true, sortOrder: 0, itemIds: ["a", "b"] });
  assert.deepEqual(sortCollections([{ name: "B", sortOrder: 1 }, { name: "A", sortOrder: 1 }, { name: "Z", sortOrder: 0 }]).map((c) => c.name), ["Z", "A", "B"]);
});

test("estilos: parseo, repetidos sin tildes y colección de todos los del catálogo", () => {
  assert.deepEqual(parseTags(" Natural, rattán ,RATTAN; ").tags, ["Natural", "rattán"]);
  const many = parseTags(Array.from({ length: 10 }, (_, i) => `e${i}`));
  assert.equal(many.tags.length, 8);
  assert.equal(many.ignored.length, 2);
  assert.deepEqual(collectTags([["Natural", "Rattan"], ["natural", "Boho"]]), ["Boho", "Natural", "Rattan"]);
});

test("inicio: orden por defecto, normalización, mover (Subir/Bajar y arrastrar) y secciones ocultas", () => {
  assert.deepEqual([...HOME_SECTION_IDS], ["hero", "categorias", "destacados", "colecciones", "catalogo", "como-funciona", "inspiracion", "contacto"]);
  assert.deepEqual(normalizeOrder(["contacto", "hero", "hero", "basura"]), ["contacto", "hero", "categorias", "destacados", "colecciones", "catalogo", "como-funciona", "inspiracion"], "lo desconocido sale y lo que falta se agrega");
  assert.deepEqual(moveSection(DEFAULT_HOME.order, "categorias", 1).slice(0, 3), ["hero", "destacados", "categorias"]);
  assert.deepEqual(moveSection(DEFAULT_HOME.order, "hero", -1), [...DEFAULT_HOME.order], "en el borde no hace nada");
  assert.deepEqual(moveSectionTo(DEFAULT_HOME.order, "contacto", "hero").slice(0, 2), ["contacto", "hero"]);
  const home = parseHome({ order: ["contacto", "hero"], hidden: ["inspiracion", "catalogo", "destacados"] });
  assert.ok(home.ok);
  assert.deepEqual(home.home.hidden, ["inspiracion", "destacados"], "el catálogo no se puede ocultar");
  assert.deepEqual(visibleSections(home.home).slice(0, 2), ["contacto", "hero"]);
  assert.ok(!visibleSections(home.home).includes("inspiracion"));
  assert.ok(visibleSections(home.home).includes("catalogo"));
  assert.equal(parseHome({ order: ["hero", "inventado"] }).ok, false);
  assert.equal(parseHome({ hidden: "hero" }).ok, false);
});

test("inicio: textos del bloque editorial e inspiración con tope; lo roto en la base nunca tira la tienda", () => {
  assert.equal(parseHome({ editorial: { title: "x".repeat(81) } }).ok, false);
  assert.equal(parseHome({ inspiration: { captions: ["a", "b", "c", "d"] } }).ok, false);
  const ok = parseHome({ editorial: { eyebrow: " Colección ", title: "Mesas que se sienten", text: "Texto", cta: "Ver" }, inspiration: { title: "Ideas", captions: ["Uno", "", "Tres"] } });
  assert.ok(ok.ok);
  assert.equal(ok.home.editorial.eyebrow, "Colección");
  assert.deepEqual(ok.home.inspiration.captions, ["Uno", "", "Tres"]);
  assert.deepEqual(readHome("basura"), DEFAULT_HOME);
  assert.deepEqual(readHome({ order: 5, hidden: ["hero", "x"] }).hidden, ["hero"]);
  assert.deepEqual(readAppearance({ template: "noir", home: { order: ["contacto"] } }).home.order[0], "contacto");
  assert.deepEqual(readAppearance({ template: "noir" }).home, DEFAULT_APPEARANCE.home, "una empresa sin configurar ve el inicio de siempre");
  const parsed = parseAppearance({ home: { hidden: ["colecciones"] } });
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.appearance.home.hidden, ["colecciones"]);
  assert.equal(parseAppearance({ home: { order: ["x"] } }).ok, false);
});

// ── Filtros del catálogo ─────────────────────────────────────────────────────

test("filtros: capacidad, rango de precio, estilo, colección y «Disponible en mis fechas»", () => {
  const items = [
    { id: "a", capacity: 6, tags: ["Natural"], collections: ["verde"], availability: "AVAILABLE" as const },
    { id: "b", capacity: 8, tags: ["Rattan", "Natural"], collections: [], availability: "LOW" as const },
    { id: "c", capacity: 12, tags: [], collections: ["verde"], availability: "CONSULT" as const },
    { id: "d", capacity: null, tags: ["rattán"], collections: [], availability: null },
  ];
  const capacities = capacityOptions(items);
  assert.deepEqual(capacities.map((o) => o.label), ["6 personas", "8 personas", "12 personas"]);
  const unit: Record<string, number> = { a: 100_000, b: 250_000, c: 400_000, d: 0 };
  const run = (filters: Partial<typeof EMPTY_FILTERS>) => items.filter((item) => matchesFilters(item, { ...EMPTY_FILTERS, ...filters }, { unit: unit[item.id], capacities })).map((item) => item.id);
  assert.deepEqual(run({}), ["a", "b", "c", "d"]);
  assert.deepEqual(run({ capacity: "8" }), ["b"]);
  assert.deepEqual(run({ priceMax: 250_000 }), ["a", "b"], "sin precio queda afuera cuando hay tope");
  assert.deepEqual(run({ priceMin: 200_000, priceMax: 300_000 }), ["b"]);
  assert.deepEqual(run({ tags: ["Rattan"] }), ["b", "d"], "rattán y Rattan son el mismo estilo");
  assert.deepEqual(run({ tags: ["Natural", "Rattan"] }), ["a", "b", "d"], "cualquiera de los estilos elegidos");
  assert.deepEqual(run({ collection: "verde" }), ["a", "c"]);
  assert.deepEqual(run({ onlyAvailable: true }), ["a", "b"], "«Consultar» y sin fechas no cuentan como disponibles");
  assert.deepEqual(run({ collection: "verde", onlyAvailable: true, capacity: "6" }), ["a"]);
  assert.equal(activeFilterCount({ ...EMPTY_FILTERS, priceMin: 1, priceMax: 2, tags: ["x"], onlyAvailable: true }), 3);
  assert.equal(parsePriceBound("1.250.000"), 1_250_000);
  assert.equal(parsePriceBound(""), null);
  const many = capacityOptions([2, 4, 6, 8, 10, 14].map((capacity) => ({ capacity })));
  assert.deepEqual(many.map((o) => o.key), ["2", "4", "6", "8+"], "con muchas capacidades, la última es «N o más»");
});

// ── Migración y archivos ─────────────────────────────────────────────────────

test("migración 202610310001: aditiva e idempotente (sin DROP, DELETE ni TRUNCATE; todo con IF NOT EXISTS)", () => {
  const sql = read("prisma/migrations/202610310001_tienda_parte2/migration.sql");
  const code = sql.replace(/--.*$/gm, "");
  assert.ok(!/\bDROP |(?<!ON )DELETE |TRUNCATE |RENAME /i.test(code));
  assert.equal((code.match(/CREATE TABLE/g) ?? []).length, (code.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length);
  assert.equal((code.match(/ADD COLUMN/g) ?? []).length, (code.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length);
  assert.equal((code.match(/CREATE (UNIQUE )?INDEX/g) ?? []).length, (code.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS/g) ?? []).length);
  assert.equal((code.match(/ADD CONSTRAINT/g) ?? []).length, (code.match(/EXCEPTION WHEN duplicate_object/g) ?? []).length);
  for (const table of ["InventoryImage", "Collection", "CollectionItem"]) assert.ok(code.includes(`"${table}"`), table);
  assert.ok(code.includes('"featured"') && code.includes('"tags"'));
});

test("tienda: rutas públicas sin trabajo pesado (galería sin bytes, una consulta por tema) y la galería es un carrusel accesible", () => {
  const catalog = read("lib/server/catalog-public.ts");
  const photos = read("lib/server/product-photos.ts");
  assert.ok(/loadGalleryUrls[\s\S]*?select: \{ id: true, itemId: true, updatedAt: true \}/.test(photos), "la galería pública nunca lee los bytes");
  assert.ok(!/sharp/.test(catalog) && !/sharp/.test(photos), "ningún procesamiento de imágenes en la ruta pública");
  const gallery = read("components/catalog-public/ProductGallery.tsx");
  for (const needle of ["scroll", "aria-roledescription", "Ampliar la foto", "Foto anterior", "Foto siguiente", "ArrowRight"]) assert.ok(gallery.includes(needle), needle);
  assert.ok(read("components/catalog-public/QuickView.tsx").includes("<ProductGallery"), "la vista rápida usa la misma galería");
  assert.ok(read("components/catalog-public/ProductPage.tsx").includes("...item.gallery"), "la ficha suma las fotos extra después de la principal");
});

test("panel: la sección «Fotos» es un componente propio y InventoryItemDialogs no se tocó", () => {
  assert.ok(read("components/admin/modules/ProductStorefrontPanel.tsx").includes("Sumar una foto"));
  assert.ok(read("components/admin/modules/InventoryFicha.tsx").includes("<ProductStorefrontPanel"));
  assert.ok(!read("components/admin/modules/InventoryItemDialogs.tsx").includes("ProductStorefrontPanel"));
  assert.ok(read("components/admin/modules/TiendaWebSettings.tsx").includes("<CollectionsSettings"));
  assert.ok(read("components/admin/modules/AparienciaSettings.tsx").includes("<HomeLayoutPanels"));
});
