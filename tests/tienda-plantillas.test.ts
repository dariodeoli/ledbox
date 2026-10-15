import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, FONTS, TEMPLATES, TEMPLATE_META, appearanceView, parseAppearance } from "../lib/appearance";
import {
  DESIGN_TEMPLATES,
  TEMPLATE_TOKENS,
  designTemplateTheme,
  isDesignTemplate,
  templateAccent,
  templateContrastPairs,
  templateFontHref,
  templateVars,
} from "../lib/storefront-templates";
import { contrastRatio, storefrontTheme } from "../lib/storefront-theme";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const FONT_ALLOW = new Set(["Inter", "Space Grotesk", "Cormorant Garamond", "Jost", "Sora", "Fredoka", "Nunito"]);

test("registro: las 5 plantillas de diseño están en la lista cerrada, con nombre y descripción", () => {
  assert.deepEqual([...DESIGN_TEMPLATES], ["tecnologica", "boutique", "noche", "fresca", "minimal"]);
  for (const id of DESIGN_TEMPLATES) {
    assert.ok(TEMPLATES.includes(id), id);
    assert.ok(isDesignTemplate(id));
    assert.ok(TEMPLATE_META[id].label && TEMPLATE_META[id].description, id);
    assert.equal(parseAppearance({ template: id }).ok, true, id);
  }
  assert.equal(isDesignTemplate("clasica"), false);
  assert.equal(parseAppearance({ template: "tecnologica; }" }).ok, false, "nada de CSS libre");
  assert.deepEqual([...TEMPLATES].slice(0, 5), ["clasica", "minimalista", "elegante", "oscura", "editorial"], "las anteriores siguen primero");
});

test("contraste AA: texto, secundarios, acento, botón primario y estados de cada plantilla", () => {
  for (const id of DESIGN_TEMPLATES) {
    for (const pair of templateContrastPairs(id)) {
      const ratio = contrastRatio(pair.fg, pair.bg);
      assert.ok(ratio >= pair.min, `${id} · ${pair.name}: ${ratio.toFixed(2)} < ${pair.min}`);
    }
  }
});

test("contraste AA también en los pasteles y chips fijos de Fresca", () => {
  for (const [fg, bg] of [["#8f1245", "#ffe3ec"], ["#8f1245", "#fff1f5"], ["#0b4f78", "#e9f7ff"]]) assert.ok(contrastRatio(fg, bg) >= 4.5, `${fg}/${bg}`);
});

test("acento: el color de marca rige si da contraste AA; si no, cae al acento de la plantilla", () => {
  for (const id of DESIGN_TEMPLATES) {
    const own = TEMPLATE_TOKENS[id].accent;
    assert.deepEqual(templateAccent(id, null), { accent: own, on: templateAccent(id, null).on, fromBrand: false });
    assert.equal(templateAccent(id, "no-es-hex").accent, own);
    assert.equal(templateAccent(id, "").fromBrand, false);
  }
  // Azul de marca oscuro: sirve en las claras, no en Noche (se cae al champagne).
  assert.deepEqual([templateAccent("minimal", "#0b5cd5").fromBrand, templateAccent("minimal", "#0b5cd5").accent], [true, "#0b5cd5"]);
  assert.equal(templateAccent("boutique", "#0b5cd5").fromBrand, true);
  assert.deepEqual([templateAccent("noche", "#0b5cd5").fromBrand, templateAccent("noche", "#0b5cd5").accent], [false, TEMPLATE_TOKENS.noche.accent]);
  // Un amarillo claro no da AA sobre fondo claro: cae al acento propio.
  assert.equal(templateAccent("fresca", "#ffe14a").fromBrand, false);
  // Y un color claro sí sirve en Noche.
  assert.equal(templateAccent("noche", "#7dd3fc").fromBrand, true);
  // Con marca o sin ella, el acento elegido siempre cumple AA contra fondo y superficie, y su texto de botón también.
  for (const id of DESIGN_TEMPLATES) {
    for (const brand of [null, "#0b5cd5", "#ffe14a", "#7dd3fc", "#1f2937", "#ff00aa"]) {
      const { accent, on } = templateAccent(id, brand);
      const t = TEMPLATE_TOKENS[id];
      assert.ok(contrastRatio(accent, t.bg) >= 4.5 && contrastRatio(accent, t.surface) >= 4.5, `${id} ${brand}`);
      assert.ok(contrastRatio(on, accent) >= 4.5, `${id} ${brand} botón`);
    }
  }
});

test("tema de la tienda: la marca de la empresa pasa solo si cumple y el esquema oscuro no la altera", () => {
  const branded = designTemplateTheme("minimal", storefrontTheme("#0b5cd5"));
  assert.equal(branded.branded, true);
  assert.equal(branded.light.accent, "#0b5cd5");
  assert.equal(branded.dark.accent, "#0b5cd5", "la plantilla fija el esquema: el acento no se aclara");
  const fallback = designTemplateTheme("noche", storefrontTheme("#0b5cd5"));
  assert.equal(fallback.branded, false);
  assert.equal(fallback.light.accent, TEMPLATE_TOKENS.noche.accent);
  assert.equal(designTemplateTheme("boutique", storefrontTheme(null)).light.accent, TEMPLATE_TOKENS.boutique.accent);
});

test("tipografía: como máximo 2 familias, de una lista cerrada, con display=swap", () => {
  for (const id of DESIGN_TEMPLATES) {
    const { head, body } = TEMPLATE_TOKENS[id];
    assert.ok(FONT_ALLOW.has(head.family) && FONT_ALLOW.has(body.family), id);
    const href = templateFontHref(id);
    assert.match(href, /^https:\/\/fonts\.googleapis\.com\/css2\?family=[A-Za-z0-9+:;@=.&-]+&display=swap$/);
    assert.ok((href.match(/family=/g) ?? []).length <= 2, `${id} más de 2 familias`);
  }
  assert.equal((templateFontHref("minimal").match(/family=/g) ?? []).length, 1, "Minimal usa una sola familia");
  // Una tipografía elegida reemplaza solo el cuerpo: sigue habiendo 2 familias como máximo.
  const view = appearanceView({ ...DEFAULT_APPEARANCE, template: "tecnologica", font: "poppins" });
  assert.equal((view.fontHref?.match(/family=/g) ?? []).length, 2);
  assert.equal(view.vars["--cp-font-body"], FONTS.find((font) => font.id === "poppins")!.family);
  assert.equal(view.vars["--cp-font-head"], TEMPLATE_TOKENS.tecnologica.head.css);
});

test("vista: solo variables --cp-*, atributos de plantilla y esquema, y fondo propio ignorado", () => {
  for (const id of DESIGN_TEMPLATES) {
    const view = appearanceView({ template: id, font: "sistema", background: "#f6f1e8", script: false });
    assert.ok(Object.keys(view.vars).every((key) => key.startsWith("--cp-")), id);
    assert.equal(view.attrs["data-store-template"], id);
    assert.equal(view.attrs["data-cp-template"], id);
    assert.equal(view.attrs["data-store-scheme"], TEMPLATE_TOKENS[id].scheme);
    assert.equal(view.attrs["data-cp-bg"], "default", "la plantilla trae su propio fondo");
    assert.equal(view.vars["--cp-bg"], templateVars(id)["--cp-bg"]);
    assert.equal(Object.values(view.vars).some((value) => /url\(|<|;\s*}/.test(value)), false, "sin imágenes ni CSS suelto");
  }
  assert.equal(TEMPLATE_TOKENS.noche.scheme, "dark");
  const classic = appearanceView(DEFAULT_APPEARANCE);
  assert.equal(classic.attrs["data-store-template"], "clasica");
  assert.equal("data-store-scheme" in classic.attrs, false);
});

test("hoja de estilos: cada plantilla tiene su bloque acotado, sin imágenes de fondo", () => {
  for (const id of DESIGN_TEMPLATES) assert.ok(css.includes(`.cp-theme[data-store-template="${id}"]`), id);
  const start = css.indexOf("Plantillas de diseño: Tecnológica");
  assert.ok(start > 0);
  const block = css.slice(start);
  assert.equal(/url\(/.test(block), false, "patrones y fondos en CSS puro");
  for (const id of DESIGN_TEMPLATES) assert.equal(/url\(|data:image/.test(TEMPLATE_TOKENS[id].backdrop), false, id);
});
