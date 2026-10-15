import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, FONTS, TEMPLATES, TEMPLATE_META, appearanceView, parseAppearance, readAppearance } from "../lib/appearance";
import {
  DISPLAY_FONTS,
  LEGACY_TEMPLATE_MAP,
  STORE_THEMES,
  THEMES,
  isDisplayFont,
  isStoreTheme,
  resolveStoredTheme,
  themeAttrs,
  themeContrastPairs,
  themeFontHref,
  themePrimary,
  themeVars,
} from "../lib/storefront-templates";
import { THEME_REGISTRY, themesByRubro } from "../lib/storefront-themes";
import { contrastRatio, hexToRgb } from "../lib/storefront-theme";
import {
  addDaysKey,
  categoryDatum,
  priceUnitLabel,
  productWhatsappMessage,
  quantityStep,
  rangeFromEvent,
  rentalDays,
  sortCatalog,
} from "../lib/storefront-ui";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const css = read("app/tienda.css");

/** Tokens mínimos de la especificación (docs/TIENDA-PLANTILLAS.md §Arquitectura 3 y TIENDA-BOUTIQUE.md §2). */
const SPEC_TOKENS = [
  "--color-bg", "--color-surface", "--color-sand", "--color-text", "--color-muted", "--color-border", "--color-border-soft",
  "--color-primary", "--color-primary-700", "--color-on-primary", "--color-accent", "--color-ink", "--color-success", "--color-info-bg",
  "--font-display", "--font-body", "--radius-sm", "--radius-md", "--radius-lg", "--radius-pill", "--shadow-card", "--shadow-float",
  "--container-max", "--image-ratio-card", "--image-ratio-category",
];

// ── Registro ─────────────────────────────────────────────────────────────────

test("registro: las 4 plantillas del dueño más las 6 premium, cada una con id, nombre, descripción, rubro ideal y miniatura", () => {
  assert.deepEqual([...STORE_THEMES], ["lienzo", "boutique", "noir", "studio", "jardin", "marmol", "terracota", "nordico", "gala", "brisa", "escenario", "corporativo", "fiesta", "gourmet", "kids", "industrial"]);
  assert.deepEqual([...TEMPLATES], [...STORE_THEMES]);
  assert.equal(new Set(THEME_REGISTRY.map((theme) => theme.id)).size, THEME_REGISTRY.length, "ids únicos");
  for (const theme of THEME_REGISTRY) {
    assert.ok(isStoreTheme(theme.id));
    assert.ok(theme.label && theme.description && theme.forWho && theme.rubro, theme.id);
    assert.equal(theme.swatch.length, 3, `${theme.id}: miniatura`);
    assert.ok(TEMPLATE_META[theme.id as keyof typeof TEMPLATE_META].label, theme.id);
    assert.ok(existsSync(new URL(`../lib/storefront-themes/${theme.id}.ts`, import.meta.url)), `${theme.id}: un archivo de tokens por plantilla`);
    assert.equal(parseAppearance({ template: theme.id }).ok, true, theme.id);
  }
  assert.equal(parseAppearance({ template: "tecnologica; }" }).ok, false, "nada de CSS libre");
  // El selector las agrupa por rubro (alfabético) sin perder ninguna.
  const groups = themesByRubro();
  assert.deepEqual(groups.map((group) => group.rubro), [...groups.map((group) => group.rubro)].sort((a, b) => a.localeCompare(b, "es")));
  assert.deepEqual(groups.flatMap((group) => group.themes.map((theme) => theme.id)).sort(), [...STORE_THEMES].sort());
});

test("registro: sumar una plantilla no toca componentes (los archivos de tema son solo datos)", () => {
  for (const file of readdirSync(new URL("../lib/storefront-themes/", import.meta.url)).filter((name) => /^(lienzo|boutique|noir|studio|jardin|marmol|terracota|nordico|gala|escenario|corporativo|fiesta|gourmet|kids|industrial|brisa)\.ts$/.test(name))) {
    const source = read(`lib/storefront-themes/${file}`);
    assert.ok(!/\bimport\b[^;]*react/i.test(source), `${file}: sin React`);
    assert.ok(!/function\s/.test(source), `${file}: solo un objeto de tokens`);
  }
});

// ── Contraste AA de TODO el registro ─────────────────────────────────────────

test("contraste AA: texto, secundarios, eyebrow, botón primario, estados, pie y anuncio de cada plantilla", () => {
  for (const id of STORE_THEMES) {
    for (const pair of themeContrastPairs(id)) {
      const ratio = contrastRatio(pair.fg, pair.bg);
      assert.ok(ratio >= pair.min, `${id} · ${pair.name}: ${ratio.toFixed(2)} < ${pair.min}`);
    }
  }
});

test("color primario de la empresa: rige si da AA con el tema; si no, cae al propio; el botón siempre es legible", () => {
  for (const id of STORE_THEMES) {
    const own = THEMES[id].colors;
    assert.deepEqual([themePrimary(id, null).primary, themePrimary(id, "no-es-hex").primary, themePrimary(id, "").fromBrand], [own.primary, own.primary, false]);
    for (const brand of [null, "#0b5cd5", "#ffe14a", "#7dd3fc", "#1f2937", "#ff00aa", "#ffffff", "#000000"]) {
      const { primary, onPrimary, primary700 } = themePrimary(id, brand);
      assert.ok(contrastRatio(primary, own.bg) >= 4.5 && contrastRatio(primary, own.surface) >= 4.5, `${id} ${brand}`);
      assert.ok(contrastRatio(onPrimary, primary) >= 4.5, `${id} ${brand} botón`);
      assert.ok(contrastRatio(onPrimary, primary700) >= 4.5, `${id} ${brand} hover`);
    }
  }
  assert.equal(themePrimary("lienzo", "#0b5cd5").primary, "#0b5cd5");
  assert.equal(themePrimary("noir", "#0b5cd5").fromBrand, false, "un azul oscuro no se lee sobre el fondo negro de Noir");
  assert.equal(themePrimary("noir", "#7dd3fc").fromBrand, true);
  assert.equal(themePrimary("studio", "#ffe14a").fromBrand, false);
});

// ── Tokens, tipografías y atributos ──────────────────────────────────────────

test("tokens: cada plantilla define los nombres de la especificación y nada que no sea una variable", () => {
  for (const id of STORE_THEMES) {
    const vars = themeVars(id);
    for (const token of SPEC_TOKENS) assert.ok(vars[token], `${id}: falta ${token}`);
    assert.ok(Object.keys(vars).every((key) => key.startsWith("--") && !key.startsWith("--cp-")), `${id}: sin el sistema viejo`);
    assert.equal(vars["--container-max"], "1280px");
    assert.equal(Object.values(vars).some((value) => /url\(|<|;\s*}/.test(value)), false, `${id}: sin imágenes ni CSS suelto`);
    const attrs = themeAttrs(id);
    assert.equal(attrs["data-store-theme"], id);
    assert.equal(attrs["data-store-scheme"], THEMES[id].scheme);
    assert.match(attrs["data-category"], /^(card|overlay)$/);
  }
  assert.equal(THEMES.noir.scheme, "dark");
  assert.deepEqual([THEMES.boutique.layout.category, THEMES.noir.layout.category, THEMES.lienzo.layout.category], ["overlay", "overlay", "card"], "overlay en Boutique y Noir");
  // Boutique: los valores exactos de la especificación del dueño.
  const boutique = themeVars("boutique");
  assert.equal(boutique["--color-bg"], "#F6F2EA");
  assert.equal(boutique["--color-primary"], "#4B5637");
  assert.equal(boutique["--radius-lg"], "28px");
  assert.equal(boutique["--space-section-d"], "112px");
  assert.equal(boutique["--space-section-m"], "64px");
});

test("tipografía: como máximo 2 familias de texto (+ la manuscrita decorativa de Boutique), lista cerrada y display=swap", () => {
  for (const id of STORE_THEMES) {
    const t = THEMES[id];
    const families = new Set([t.fonts.display.id, t.fonts.body.id]);
    assert.ok(families.size <= 2, id);
    const href = themeFontHref(id);
    assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z0-9+:;@=.,&-]+&display=swap$/);
    assert.ok((href.match(/family=/g) ?? []).length <= (t.fonts.script ? 3 : 2), `${id} más familias de las permitidas`);
  }
  assert.ok(THEMES.boutique.fonts.script && !THEMES.noir.fonts.script);
  // Fuente de títulos de la empresa: de una lista curada, reemplaza solo los títulos.
  assert.ok(["cormorant", "playfair", "fraunces"].every((id) => isDisplayFont(id)));
  assert.equal(isDisplayFont("comic-sans"), false);
  const vars = themeVars("lienzo", { displayFont: "playfair" });
  assert.match(vars["--font-display"], /Playfair/);
  assert.equal(vars["--font-body"], THEMES.lienzo.fonts.body.css);
  assert.ok(themeFontHref("lienzo", "playfair").includes("Playfair"));
  assert.ok(DISPLAY_FONTS.length >= 3);
  const view = appearanceView({ ...DEFAULT_APPEARANCE, template: "noir", font: "poppins" });
  assert.equal(view.vars["--font-body"], THEMES.noir.fonts.body.css, "la tipografía del portal no cambia la tienda");
});

test("prohibido el rosa en las paletas por defecto", () => {
  for (const id of STORE_THEMES) {
    for (const [name, hex] of Object.entries({ ...THEMES[id].colors, swatch: THEMES[id].swatch[2] })) {
      if (!/^#[0-9a-f]{6}$/i.test(hex)) continue;
      const [r, g, b] = hexToRgb(hex).map((channel) => channel / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d < 0.18 || max < 0.35) continue;
      const hue = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
      assert.ok(!(hue >= 310 && hue <= 350), `${id}.${name} ${hex} es rosa (matiz ${Math.round(hue)})`);
    }
  }
});

// ── Migración de plantillas ──────────────────────────────────────────────────

test("migración: el mapa de la especificación y el alias de lectura coinciden con el SQL", () => {
  assert.deepEqual(
    { minimal: "lienzo", boutique: "boutique", noche: "noir", tecnologica: "noir", fresca: "studio", editorial: "boutique", clasica: "lienzo" },
    Object.fromEntries(["minimal", "boutique", "noche", "tecnologica", "fresca", "editorial", "clasica"].map((key) => [key, LEGACY_TEMPLATE_MAP[key]])),
  );
  for (const legacy of Object.keys(LEGACY_TEMPLATE_MAP)) {
    assert.ok(isStoreTheme(LEGACY_TEMPLATE_MAP[legacy]));
    assert.equal(resolveStoredTheme(legacy), LEGACY_TEMPLATE_MAP[legacy]);
    assert.equal(readAppearance({ template: legacy }).template, LEGACY_TEMPLATE_MAP[legacy], `alias de lectura: ${legacy}`);
  }
  assert.equal(resolveStoredTheme("neon"), null);
  const sql = read("prisma/migrations/202610300001_tienda_temas/migration.sql");
  for (const [legacy, next] of Object.entries(LEGACY_TEMPLATE_MAP)) {
    if (legacy === next) continue;
    assert.ok(sql.includes(`WHEN '${legacy}' THEN '${next}'`), `SQL: ${legacy} → ${next}`);
  }
  // Idempotente y aditiva: solo toca filas con un valor viejo y no borra ni crea nada.
  assert.match(sql, /IN \('minimal', 'clasica'/);
  assert.ok(!/DROP |DELETE |TRUNCATE |ALTER TABLE/i.test(sql.replace(/--.*$/gm, "")));
  assert.ok(!sql.includes("'boutique', 'boutique'") && !/WHEN 'boutique'/.test(sql), "boutique ya se llama igual");
});

// ── Sin hardcodes ────────────────────────────────────────────────────────────

/** El CSS sin los bloques de constantes de escala (`@scale`) y del puente con la librería de campos (`@bridge`). */
function cssWithoutExemptBlocks(source: string): string {
  return source
    .replace(/\/\* @scale \*\/[\s\S]*?\/\* @endscale \*\//g, "")
    .replace(/\/\* @bridge[\s\S]*?\/\* @endbridge \*\//g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

test("sin hardcodes: ni colores ni tamaños de letra escritos a mano en el CSS de la tienda (todo es var(--…))", () => {
  const checked = cssWithoutExemptBlocks(css);
  const colors = checked.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/g) ?? [];
  assert.deepEqual(colors, [], `colores sueltos: ${colors.join(", ")}`);
  const sizes = [...checked.matchAll(/font-size:\s*([^;}]+)/g)].map((match) => match[1].trim()).filter((value) => !value.startsWith("var(--fs-"));
  assert.deepEqual(sizes, [], `tamaños de letra sueltos: ${sizes.join(" | ")}`);
  assert.ok(!/--cp-/.test(css), "sin el sistema viejo --cp-*");
  assert.ok(!/url\(/.test(checked), "fondos y patrones en CSS puro");
  // Y el CSS viejo de la tienda ya no vive en globals.css (una sola fuente de verdad).
  assert.ok(!/\.cp-[a-z]/.test(read("app/globals.css")), "globals.css sin clases de la tienda");
});

test("sin hardcodes: los componentes de la tienda no llevan colores ni tamaños propios", () => {
  const dir = "components/catalog-public";
  for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((name) => /\.(tsx|ts)$/.test(name))) {
    const source = read(`${dir}/${file}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b(?![\w-])/.test(source.replace(/&#\d+;/g, "")), `${file}: color hexadecimal escrito a mano`);
    assert.ok(!/\brgba?\(|\bhsla?\(/.test(source), `${file}: color rgb/hsl escrito a mano`);
    assert.ok(!/style=\{\{/.test(source), `${file}: sin estilos en línea (todo por clases y tokens)`);
    assert.ok(!/--cp-/.test(source), `${file}: sin el sistema viejo --cp-*`);
  }
});

// ── Ayudas de presentación ───────────────────────────────────────────────────

test("modo de precio: «c/u» con selector de a 10 solo en piezas sueltas; juegos de a 1", () => {
  assert.equal(priceUnitLabel("day", "PER_DAY", null), "por día");
  assert.equal(priceUnitLabel("unit", "PER_DAY", null), "c/u");
  assert.equal(priceUnitLabel("unit", "EVENT", null), "por evento");
  assert.equal(priceUnitLabel("day", "TOTAL", 3), "total por 3 días");
  assert.equal(quantityStep("unit", false), 10);
  assert.equal(quantityStep("unit", true), 1);
  assert.equal(quantityStep("day", false), 1);
});

test("categoría: «N productos · Desde Gs. X» sin inventar precios", () => {
  assert.equal(categoryDatum({ count: 38, minUnit: 2500 }, true, "day"), "38 productos · Desde Gs. 2.500");
  assert.equal(categoryDatum({ count: 1, minUnit: null }, true, "day"), "1 producto");
  assert.equal(categoryDatum({ count: 5, minUnit: 100 }, false, "day"), "5 productos");
  assert.equal(categoryDatum({ count: 5, minUnit: 100 }, true, "quote"), "5 productos");
  assert.equal(categoryDatum({ count: 5, minUnit: 2500 }, true, "unit"), "5 productos · Desde Gs. 2.500 c/u");
});

test("orden del catálogo: destacados respeta el orden de la empresa; precio, nombre y capacidad; sin precio al final", () => {
  const rows = [
    { name: "Mesa", unit: 300, capacity: 6 },
    { name: "Ánfora", unit: 0, capacity: null },
    { name: "Copa", unit: 100, capacity: 1 },
    { name: "Banco", unit: 200, capacity: 10 },
  ];
  assert.deepEqual(sortCatalog(rows, "destacados").map((row) => row.name), ["Mesa", "Ánfora", "Copa", "Banco"]);
  assert.deepEqual(sortCatalog(rows, "precio-asc").map((row) => row.name), ["Copa", "Banco", "Mesa", "Ánfora"]);
  assert.deepEqual(sortCatalog(rows, "precio-desc").map((row) => row.name), ["Mesa", "Banco", "Copa", "Ánfora"]);
  assert.deepEqual(sortCatalog(rows, "nombre").map((row) => row.name), ["Ánfora", "Banco", "Copa", "Mesa"]);
  assert.deepEqual(sortCatalog(rows, "capacidad").map((row) => row.name), ["Banco", "Mesa", "Copa", "Ánfora"]);
  assert.equal(rows[0].name, "Mesa", "no muta");
});

test("fecha del evento + días: período, tope de 30 días y mensaje de WhatsApp prearmado", () => {
  assert.deepEqual(rangeFromEvent("2026-10-30", 3), { fromKey: "2026-10-30", toKey: "2026-11-01" });
  assert.equal(rangeFromEvent("", 3), null);
  assert.equal(rangeFromEvent("2026-10-30", 0), null);
  assert.equal(rangeFromEvent("2026-10-30", 31), null);
  assert.equal(addDaysKey("2026-12-31", 1), "2027-01-01");
  assert.equal(rentalDays("2026-10-30", "2026-11-01"), 3);
  assert.equal(rentalDays("2026-11-01", "2026-10-30"), null);
  assert.equal(productWhatsappMessage("La Vajilla", { name: "Juego Petra", sku: "COD #527" }), "Hola La Vajilla! Quiero consultar por Juego Petra (COD #527).");
  assert.match(productWhatsappMessage("La Vajilla", { name: "Copa", sku: null }, { fromKey: "2026-10-30", toKey: "2026-11-01" }), /30\/10\/2026 al 01\/11\/2026/);
});

test("fuentes del portal: lista cerrada sin cambios", () => {
  assert.ok(FONTS.length >= 10);
});

// ── Plantillas premium (v2.1.128) ────────────────────────────────────────────

test("premium: Jardín, Mármol, Terracota, Nórdico, Gala y Brisa traen rubro, tipografías cerradas y botón primario sólido de color", () => {
  const premium = ["jardin", "marmol", "terracota", "nordico", "gala", "brisa"] as const;
  const allowed = new Set(Object.values(DISPLAY_FONTS).map((f) => f.id));
  assert.ok(allowed.size > 0);
  for (const id of premium) {
    const t = THEMES[id];
    assert.ok(t.rubro && t.forWho, id);
    assert.ok(t.fonts.display.google && t.fonts.body.google, id);
    const href = themeFontHref(id);
    assert.ok((href.match(/family=/g) ?? []).length <= 2, `${id}: máximo 2 familias`);
    assert.ok(href.endsWith("&display=swap"), id);
    const [r, g, b] = hexToRgb(t.colors.primary);
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) >= 24, `${id}: el primario no es gris`);
  }
  assert.equal(THEMES.gala.scheme, "dark");
  assert.equal(THEMES.gala.layout.category, "overlay", "Gala lleva overlay en categorías");
  assert.ok(contrastRatio(THEMES.gala.colors.onPrimary, THEMES.gala.colors.primary) >= 4.5, "dorado con contraste AA");
  assert.ok(contrastRatio(THEMES.gala.colors.accentText, THEMES.gala.colors.bg) >= 4.5, "dorado como texto con contraste AA");
});

// ── Versión 2.1.129 ──────────────────────────────────────────────────────────

test("ninguna plantilla tiene un primario gris, y un color de marca gris no pisa al del tema", () => {
  assert.equal(THEME_REGISTRY.length, 16);
  for (const theme of THEME_REGISTRY) {
    const [r, g, b] = hexToRgb(theme.colors.primary);
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) >= 24, `${theme.id}: el primario no es gris`);
    for (const grey of ["#1f2328", "#555555", "#808080", "#ffffff", "#000000", "#3a3d40"]) {
      const result = themePrimary(theme.id as keyof typeof THEMES, grey);
      assert.equal(result.fromBrand, false, `${theme.id}: ${grey} es gris y no debe ser el primario`);
      assert.equal(result.primary, theme.colors.primary);
    }
  }
});

test("rubros: cubren decoración, eventos, corporativo, tecnología, catering, bodas, infantil, mobiliario y exteriores; las nuevas no son de decoración", () => {
  const rubros = themesByRubro().map((group) => group.rubro);
  for (const needle of ["Decoración", "Eventos y fiestas", "Corporativo", "Tecnología", "Catering", "Bodas", "Infantil", "Mobiliario", "Exteriores"]) {
    assert.ok(rubros.some((rubro) => rubro.includes(needle)), `falta el rubro ${needle}`);
  }
  for (const id of ["escenario", "corporativo", "fiesta", "gourmet", "kids", "industrial"] as const) {
    assert.notEqual(THEMES[id].rubro, "Decoración", id);
  }
  assert.equal(THEMES.escenario.scheme, "dark");
  assert.equal(THEMES.industrial.scheme, "dark");
  assert.ok(THEMES.kids.radius.lg >= THEMES.boutique.radius.lg || parseInt(THEMES.kids.radius.lg) >= 32, "Kids con radios grandes");
});

test("fotos de categoría cuadradas y sin recorte en todas las plantillas", () => {
  for (const theme of THEME_REGISTRY) assert.equal(theme.imageRatio.category, "1 / 1", theme.id);
  const cat = css.split("\n").filter((line) => /\.cp-catcard-media img|\.cp-catcard-media \{/.test(line)).join("\n");
  assert.ok(/object-fit: contain/.test(cat) && !/object-fit: cover/.test(cat), "la imagen de categoría es contain en todas las variantes");
  assert.ok(/\.cp-catcard-media \{[^}]*background: var\(--color-photo\)/.test(css), "sobre fondo claro de fotografía");
});

test("portada: escritorio ≥768 px y celular en móvil, con la otra como respaldo", () => {
  const front = read("components/catalog-public/StoreFront.tsx");
  assert.ok(/media="\(min-width: 768px\)"/.test(front));
  assert.ok(/covers\.mobile \?\? store\.covers\.desktop/.test(front));
  assert.ok(/--hero-ratio: 16 \/ 5/.test(css) && /--hero-ratio: 4 \/ 5/.test(css));
});


test("Apariencia muestra computadora y celular juntas con las portadas guardadas o nuevas", () => {
  const settings = read("components/admin/modules/AparienciaSettings.tsx");
  assert.match(settings, /\["desktop", "mobile"\] as const/);
  assert.match(settings, /coverDesktop=\{coverSrc\("desktop"\)\}/);
  assert.match(settings, /coverMobile=\{coverSrc\("mobile"\)\}/);
  assert.ok(!settings.includes('ariaLabel="Dispositivo de la vista previa"'));
});

test("Destacados comparte la vista rápida y el carrito con el catálogo", () => {
  assert.match(read("components/catalog-public/HomeSections.tsx"), /data-store-product=\{item.id\}/);
  const browser = read("components/catalog-public/CatalogBrowser.tsx");
  assert.match(browser, /event.preventDefault\(\);\s+openQuick\(id\)/);
  assert.match(browser, /event.metaKey \|\| event.ctrlKey \|\| event.shiftKey \|\| event.altKey/);
});


test("colecciones tienen su entidad auditable y se pueden filtrar en el panel", () => {
  assert.match(read("lib/admin-types.ts"), /"Collection"/);
  assert.match(read("lib/admin-format.ts"), /Collection: "Colección de la tienda"/);
  const source = read("lib/server/collections.ts");
  assert.equal((source.match(/entity: "Collection"/g) ?? []).length, 5);
  assert.ok(!source.includes('entity: "Organization"'));
});

test("las fotos de producto conservan margen y fondo claro incluso al pasar el mouse", () => {
  for (const theme of THEME_REGISTRY) {
    const [r, g, b] = hexToRgb(theme.colors.photo);
    assert.ok(Math.min(r, g, b) >= 220, `${theme.id}: fondo de producto claro`);
    assert.equal(theme.layout.photoFit, "contain");
  }
  assert.match(css, /\.cp-catcard-media img \{[^}]*object-fit: contain; padding: 5%/);
  assert.match(css, /\.cp-colcard\[data-media="product"\] \.cp-colcard-media img \{[^}]*object-fit: contain; padding: 5%/);
  assert.match(css, /\.cp-btn--on-image \{[^}]*background: var\(--color-primary\)/);
});


test("controles compactos: fecha canónica y montos/cantidades en columnas sin perder área táctil", () => {
  assert.match(read("components/catalog-public/EventPicker.tsx"), /<DayField label="Fecha del evento"/);
  assert.match(css, /--a-field-h: var\(--tap\)/);
  assert.match(css, /\.cp-cart-row \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.cp-cart-actions \{[^}]*grid-template-columns: 1fr/);
  assert.match(read("components/catalog-public/CartDrawer.tsx"), /data-testid="cart-count"/);
});

test("guardar carrito es un popup acotado y espera que se cierre la vista rápida", () => {
  const contact = read("components/catalog-public/ContactPanel.tsx");
  assert.match(contact, /cp-overlay--contact/);
  assert.match(css, /\.cp-contact \{[^}]*height: auto; max-height:/);
  const browser = read("components/catalog-public/CatalogBrowser.tsx");
  assert.match(browser, /cartScope !== "public" \|\| quickId \|\| open/);
  assert.match(browser, /!contactOpen && !open && !quickItem && !filtersOpen \? toast : null/);
});
