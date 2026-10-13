import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AUDIENCES_FOR,
  CATALOG_AUDIENCE_OPTIONS,
  audienceShownIn,
  effectiveAudience,
  readAudienceInput,
  visibleOnWebFor,
} from "../lib/catalog-audience";
import { catalogDailyPrice, catalogPriceFor, listDailyPrice } from "../lib/catalog-public";
import { parseRentalSettingsPatch } from "../lib/server/rental-settings";
import { catalogTokenHash, catalogTokenValue, isCatalogTokenShape } from "../lib/server/catalog-access";
import { contrastRatio, normalizeHex, parseStorefrontAccent, storefrontTheme, STORE_MIN_CONTRAST, STORE_SURFACE_DARK } from "../lib/storefront-theme";
import { featuredCategories } from "../components/catalog-public/StoreFront";

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("alcance del producto: cuatro valores en el orden del campo y visibleOnWeb sincronizado", () => {
  assert.deepEqual(CATALOG_AUDIENCE_OPTIONS.map((option) => option.label), ["Oculto", "Cliente final", "Mayorista", "Ambos"]);
  assert.equal(visibleOnWebFor("HIDDEN"), false);
  for (const audience of ["RETAIL", "WHOLESALE", "BOTH"] as const) assert.equal(visibleOnWebFor(audience), true);
  assert.deepEqual(AUDIENCES_FOR.RETAIL, ["RETAIL", "BOTH"]);
  assert.deepEqual(AUDIENCES_FOR.WHOLESALE, ["WHOLESALE", "BOTH"]);
  assert.equal(audienceShownIn("WHOLESALE", "RETAIL"), false, "un producto mayorista nunca está en el catálogo público");
  assert.equal(audienceShownIn("RETAIL", "WHOLESALE"), false);
  assert.equal(audienceShownIn("BOTH", "RETAIL") && audienceShownIn("BOTH", "WHOLESALE"), true);
  // Fila vieja sin alcance: manda el booleano.
  assert.equal(effectiveAudience({ catalogAudience: null, visibleOnWeb: true }), "BOTH");
  assert.equal(effectiveAudience({ catalogAudience: null, visibleOnWeb: false }), "HIDDEN");
  assert.equal(effectiveAudience({ catalogAudience: "WHOLESALE", visibleOnWeb: true }), "WHOLESALE");
});

test("el API acepta el alcance nuevo y el booleano viejo, y rechaza lo demás", () => {
  assert.deepEqual(readAudienceInput({ catalogAudience: "RETAIL" }), { ok: true, audience: "RETAIL" });
  assert.deepEqual(readAudienceInput({ visibleOnWeb: true }), { ok: true, audience: "BOTH" });
  assert.deepEqual(readAudienceInput({ visibleOnWeb: false }), { ok: true, audience: "HIDDEN" });
  assert.deepEqual(readAudienceInput({}), { ok: true, audience: undefined });
  assert.equal(readAudienceInput({ catalogAudience: "ALL" }).ok, false);
  assert.equal(readAudienceInput({ visibleOnWeb: "si" }).ok, false);
  // El alcance manda sobre el booleano si llegan los dos.
  assert.deepEqual(readAudienceInput({ catalogAudience: "HIDDEN", visibleOnWeb: true }), { ok: true, audience: "HIDDEN" });
});

test("la lista de precios sale del campo correcto y nunca mezcla las dos", () => {
  const row = { listPrice: 100_000, listFromDays: 3, listFromPrice: 90_000, wholesalePrice: 60_000, wholesaleFromDays: 5, wholesaleFromPrice: 50_000 };
  assert.deepEqual(catalogPriceFor(row, "RETAIL"), { unit: 100_000, fromDays: 3, fromPrice: 90_000 });
  assert.deepEqual(catalogPriceFor(row, "WHOLESALE"), { unit: 60_000, fromDays: 5, fromPrice: 50_000 });
  assert.equal(listDailyPrice(row, "RETAIL", 3), 90_000);
  assert.equal(listDailyPrice(row, "WHOLESALE", 3), 60_000, "el umbral mayorista es el suyo");
  assert.equal(listDailyPrice(row, "WHOLESALE", 5), 50_000);
  assert.equal(listDailyPrice({ listPrice: 100_000 }, "WHOLESALE", 1), 0, "sin precio mayorista cargado: Consultar, no se usa el de lista");
  assert.equal(catalogDailyPrice({ unit: 0, fromDays: 0, fromPrice: 0 }, 2), 0);
});

test("color de marca: hex válido y legible; el tema oscuro se aclara hasta 4,5:1", () => {
  assert.equal(normalizeHex("#ABC"), "#aabbcc");
  assert.equal(normalizeHex("0E7490"), "#0e7490");
  for (const bad of ["rojo", "#12", "#12345", "#gggggg", "", null, 5]) assert.equal(normalizeHex(bad as never), null);
  assert.deepEqual(parseStorefrontAccent("#0E7490"), { ok: true, accent: "#0e7490" });
  assert.deepEqual(parseStorefrontAccent(""), { ok: true, accent: null });
  assert.deepEqual(parseStorefrontAccent(null), { ok: true, accent: null });
  assert.equal(parseStorefrontAccent("azul").ok, false);
  const pale = parseStorefrontAccent("#ffee00");
  assert.equal(pale.ok, false, "un amarillo claro no se lee sobre blanco");
  assert.ok(contrastRatio("#000000", "#ffffff") > 20.9);
  for (const accent of ["#0e7490", "#b3261e", "#1d4ed8", "#7c3aed", "#6b21a8", "#111111"]) {
    const theme = storefrontTheme(accent);
    assert.equal(theme.branded, true);
    assert.ok(contrastRatio(theme.light.accent, "#ffffff") >= STORE_MIN_CONTRAST, `${accent} sobre blanco`);
    assert.ok(contrastRatio(theme.light.accent, theme.light.on) >= STORE_MIN_CONTRAST, `${accent} texto sobre el botón claro`);
    assert.ok(contrastRatio(theme.dark.accent, STORE_SURFACE_DARK) >= STORE_MIN_CONTRAST, `${accent} sobre la superficie oscura`);
    assert.ok(contrastRatio(theme.dark.accent, theme.dark.on) >= STORE_MIN_CONTRAST, `${accent} texto sobre el botón oscuro`);
  }
  // Sin color (o con un valor inválido guardado) rige un tema neutro prolijo.
  for (const none of [null, undefined, "", "no-es-hex", "#ffee00"]) {
    const theme = storefrontTheme(none);
    assert.equal(theme.branded, false);
    assert.ok(contrastRatio(theme.light.accent, "#ffffff") >= 7);
  }
});

test("ajustes de la tienda: frase, color y correo se validan en el servidor", () => {
  const ok = parseRentalSettingsPatch({ storefrontTagline: "  Pantallas   para tu evento ", storefrontAccent: "#0E7490", storefrontEmail: " Ventas@Empresa.com " });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.data, { storefrontTagline: "Pantallas para tu evento", storefrontAccent: "#0e7490", storefrontEmail: "ventas@empresa.com" });
  const cleared = parseRentalSettingsPatch({ storefrontTagline: "", storefrontAccent: null, storefrontEmail: "" });
  assert.ok(cleared.ok && cleared.data.storefrontTagline === null && cleared.data.storefrontAccent === null && cleared.data.storefrontEmail === null);
  assert.equal(parseRentalSettingsPatch({ storefrontTagline: "x".repeat(141) }).ok, false);
  assert.equal(parseRentalSettingsPatch({ storefrontAccent: "#ffee00" }).ok, false);
  assert.equal(parseRentalSettingsPatch({ storefrontAccent: "rojo" }).ok, false);
  assert.equal(parseRentalSettingsPatch({ storefrontEmail: "no-es-correo" }).ok, false);
  assert.equal(parseRentalSettingsPatch({ storefrontTagline: 7 }).ok, false);
});

test("token del catálogo mayorista: aleatorio, con prefijo, validado por forma y guardado solo como hash", () => {
  const a = catalogTokenValue();
  const b = catalogTokenValue();
  assert.notEqual(a, b);
  assert.ok(isCatalogTokenShape(a));
  assert.match(a, /^lbxw_[A-Za-z0-9_-]{32}$/);
  for (const bad of ["", "lbxw_", "lbxw_corto", `lbx_${"a".repeat(32)}`, `lbxw_${"a b".repeat(12)}`, `lbxw_${"a".repeat(81)}`, 5, null]) assert.equal(isCatalogTokenShape(bad), false);
  assert.match(catalogTokenHash(a), /^[0-9a-f]{64}$/);
  assert.notEqual(catalogTokenHash(a), a);
  assert.equal(catalogTokenHash(a), catalogTokenHash(a));
});

test("categorías destacadas: las de más equipos, hasta 6, con la foto de su primer equipo que la tenga", () => {
  const items = [
    ...Array.from({ length: 3 }, (_, i) => ({ category: "Pantallas", imageUrl: i === 1 ? "/p.png" : null })),
    { category: "Tótems", imageUrl: "/t.png" },
    { category: "Tótems", imageUrl: null },
    { category: "Sonido", imageUrl: null },
    ...["A", "B", "C", "D", "E"].map((category) => ({ category, imageUrl: null })),
  ];
  const featured = featuredCategories(items);
  assert.equal(featured.length, 6);
  assert.deepEqual(featured.slice(0, 3).map((entry) => [entry.category, entry.count, entry.imageUrl]), [["Pantallas", 3, "/p.png"], ["Tótems", 2, "/t.png"], ["A", 1, null]]);
  assert.deepEqual(featuredCategories([]), []);
});

test("migraciones de la tienda: aditivas, idempotentes y posteriores a 202610150004", () => {
  const audience = read("prisma/migrations/202610160001_inventory_catalog_audience/migration.sql");
  const storefront = read("prisma/migrations/202610160002_company_storefront/migration.sql");
  assert.match(audience, /ADD COLUMN IF NOT EXISTS "catalogAudience" TEXT;/);
  assert.match(audience, /WHERE "catalogAudience" IS NULL/, "el backfill solo toca filas sin alcance");
  assert.match(audience, /CASE WHEN "visibleOnWeb" THEN 'BOTH' ELSE 'HIDDEN' END/);
  assert.match(storefront, /CREATE TABLE IF NOT EXISTS "CatalogAccessToken"/);
  for (const column of ["id", "organizationId", "clientId", "tokenHash", "createdAt", "revokedAt", "lastUsedAt"]) assert.match(storefront, new RegExp(`"${column}"`));
  assert.match(storefront, /CREATE UNIQUE INDEX IF NOT EXISTS "CatalogAccessToken_tokenHash_key"/);
  assert.match(storefront, /ADD COLUMN IF NOT EXISTS "priceList" TEXT NOT NULL DEFAULT 'RETAIL'/);
  for (const sql of [audience, storefront]) {
    assert.equal(/\bDROP\b|\bTRUNCATE\b|^\s*DELETE\b/im.test(sql), false, "nada destructivo");
  }
  assert.ok("202610160001" > "202610150004");
  const schema = read("prisma/schema.prisma");
  assert.match(schema, /model CatalogAccessToken \{[\s\S]*?tokenHash\s+String\s+@unique/);
  assert.match(schema, /catalogAudience\s+String\?/);
  assert.match(schema, /visibleOnWeb\s+Boolean\s+@default\(false\)/, "visibleOnWeb se conserva");
});

test("el inventario cambia el switch por el campo segmentado en el alta, la edición y la edición en lote", () => {
  const module = read("components/admin/modules/InventarioModule.tsx");
  assert.equal((module.match(/<SegmentedField\s+label="Visibilidad en la tienda"/g) ?? []).length, 2, "alta y edición");
  assert.equal(/label="Visible en la web"/.test(module), false, "ya no queda el switch viejo");
  assert.match(module, /options=\{\[\.\.\.CATALOG_AUDIENCE_OPTIONS\]\}/);
  const bulk = read("components/admin/modules/InventoryBulkEditor.tsx");
  assert.match(bulk, /field\.type === "audience" \? <SegmentedField/);
  const api = read("app/api/admin/inventory/route.ts");
  assert.match(api, /data\.catalogAudience = audience\.audience;\n\s+data\.visibleOnWeb = visibleOnWebFor\(audience\.audience\)/, "visibleOnWeb queda sincronizado");
  assert.match(read("app/api/admin/resources/route.ts"), /\.\.\.newItemAudience\(body\)/);
});

test("la tienda: /catalogo redirige, el mayorista y el pedido van noindex y la tienda apagada es 404", () => {
  const legacy = read("app/(catalogo)/catalogo/[orgSlug]/page.tsx");
  assert.match(legacy, /redirect\(`\/tienda\//);
  const store = read("app/(catalogo)/tienda/[orgSlug]/page.tsx");
  assert.match(store, /if \(!context\) notFound\(\)/);
  assert.match(store, /robots: context\.demo \? \{ index: false, follow: false \} : \{ index: true, follow: true \}/);
  assert.match(store, /title: \{ absolute: `\$\{name\} · Tienda de alquiler` \}/);
  assert.match(store, /description,/);
  const wholesale = read("app/(catalogo)/tienda/[orgSlug]/mayorista/[token]/page.tsx");
  assert.match(wholesale, /PRIVATE_ROBOTS = \{ index: false, follow: false/);
  assert.equal((wholesale.match(/robots: PRIVATE_ROBOTS/g) ?? []).length, 2, "noindex también cuando el link no existe");
  assert.match(wholesale, /if \(!context \|\| !context\.access\) notFound\(\)/);
  assert.match(read("app/(catalogo)/pedido/[token]/page.tsx"), /robots: \{ index: false, follow: false \}/);
  assert.match(read("app/layout.tsx"), /\(catalogo\|tienda\|pedido\)/, "la tienda no lleva el pie de LedBox");
});

test("el link mayorista se administra desde la ficha con clients.write y nunca devuelve el token guardado", () => {
  const route = read("app/api/admin/clients/[id]/catalog-access/route.ts");
  assert.equal((route.match(/requireAdminContext\("clients\.write"\)/g) ?? []).length, 2, "generar y revocar exigen clients.write");
  assert.match(route, /export async function GET[\s\S]*?requireAdminContext\(\)/);
  assert.match(route, /"Cache-Control": "no-store"/);
  const ficha = read("components/admin/modules/ClienteFichaModule.tsx");
  assert.match(ficha, /<ClientCatalogAccess clientId=\{client\.id\}[^>]*canEdit=\{canEdit\}/);
  assert.match(read("components/admin/modules/ClientCatalogAccess.tsx"), /Compartir catálogo mayorista/);
  assert.match(read("lib/server/catalog-access.ts"), /where: \{ id: clientId, organizationId(, active: true)? \}/);
});

test("Ajustes tiene la sección «Tienda web» con Crear tienda, copiar link, frase y color", () => {
  const tabs = read("components/admin/modules/AjustesTabs.tsx");
  assert.match(tabs, /key: "tienda", href: "\/ajustes\/tienda", label: "Tienda web"/);
  const settings = read("components/admin/modules/TiendaWebSettings.tsx");
  for (const text of ["Crear tienda", "Copiar link", "Frase de la portada", "Color de marca", "Tienda encendida", "Mostrar precios", "WhatsApp de la empresa"]) assert.ok(settings.includes(text), text);
  assert.match(read("lib/admin-policy.ts"), /"\/ajustes\/tienda": \["OWNER", "ADMIN"\]/);
  assert.match(read("lib/admin-routes.ts"), /"\/ajustes\/tienda"/);
  assert.equal(/publicCatalogEnabled/.test(read("components/admin/modules/AlquileresSettings.tsx")), false, "Alquileres ya no lleva el catálogo");
});

test("la portada de la tienda tiene sus secciones y no copia la marca de LedBox", () => {
  const front = read("components/catalog-public/StoreFront.tsx");
  for (const text of ["Cómo funciona", "Categorías", "Contacto", "Ver catálogo", "Elegí tus equipos"]) assert.ok(front.includes(text) || read("components/catalog-public/CatalogBrowser.tsx").includes(text), text);
  assert.equal((front.match(/<li key=\{step\.title\}/g) ?? []).length, 1);
  assert.match(front, /const STEPS = \[/);
  assert.equal(/ledbox/i.test(front.replace(/\/\*[\s\S]*?\*\//g, "")), false, "ninguna marca de LedBox en la tienda de la empresa");
  const browser = read("components/catalog-public/CatalogBrowser.tsx");
  assert.match(browser, /className="cp-bar"/);
  assert.match(browser, /className="cp-cats"/);
  assert.match(browser, /type="search"/);
});
