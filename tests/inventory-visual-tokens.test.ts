import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * AA de los seis tonos del estado visual del inventario (rediseño E2), medido sobre `globals.css`
 * en el tema claro y en el oscuro: texto del chip sobre su superficie ≥ 4.5 y el color base (ícono
 * y tramo de la barra) sobre el panel ≥ 3. Las superficies translúcidas del tema oscuro se
 * componen sobre tres fondos: el negro de la app, el pico de la aurora y el fondo del diálogo.
 */

type Rgba = { r: number; g: number; b: number; a: number };
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function block(selector: string): string {
  // El bloque que define los tokens de estado (el selector puede repetirse en otras reglas).
  let start = css.indexOf(`${selector} {`);
  while (start >= 0) {
    const text = css.slice(start, css.indexOf("\n}", start));
    if (text.includes("--a-ok:")) return text;
    start = css.indexOf(`${selector} {`, start + 1);
  }
  assert.fail(`falta ${selector} con los tokens de estado`);
}

function variables(selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of block(selector).matchAll(/(--a-[a-z0-9-]+):\s*([^;]+);/g)) out[match[1]] = match[2].trim();
  return out;
}

function parse(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return { r: parseInt(hex[1].slice(0, 2), 16), g: parseInt(hex[1].slice(2, 4), 16), b: parseInt(hex[1].slice(4, 6), 16), a: 1 };
  const rgba = value.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/);
  assert.ok(rgba, `color no reconocido: ${value}`);
  return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] === undefined ? 1 : Number(rgba[4]) };
}

const over = (top: Rgba, bottom: Rgba): Rgba => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});
const channel = (value: number) => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = (c: Rgba) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TONES = ["ok", "warn", "danger", "info", "accent"] as const;

function themes() {
  const dark = variables(".admin-root");
  const light = { ...dark, ...variables('.admin-root[data-theme="light"]') };
  const darkBackdrops = [parse(dark["--a-bg"]), over({ r: 56, g: 189, b: 248, a: 0.22 }, parse(dark["--a-bg"])), parse(dark["--a-dialog-bg"])].map((base) => over(parse(dark["--a-panel"]), base));
  return [
    { name: "oscuro", vars: dark, backdrops: darkBackdrops, panel: darkBackdrops },
    { name: "claro", vars: light, backdrops: [parse(light["--a-panel-2"])], panel: [parse(light["--a-panel-2"])] },
  ];
}

test("los tokens de estado existen en los dos temas", () => {
  for (const theme of themes()) {
    for (const tone of TONES) {
      for (const part of ["", "-surface", "-text"]) assert.ok(theme.vars[`--a-${tone}${part}`], `${theme.name}: falta --a-${tone}${part}`);
    }
  }
});

test("AA ≥ 4.5: el texto de cada tono sobre su superficie, en claro y en oscuro", () => {
  for (const theme of themes()) {
    for (const tone of TONES) {
      const text = parse(theme.vars[`--a-${tone}-text`]);
      const surface = parse(theme.vars[`--a-${tone}-surface`]);
      for (const backdrop of theme.backdrops) {
        const ratio = contrast(text, over(surface, backdrop));
        assert.ok(ratio >= 4.5, `${theme.name} · ${tone}: ${ratio.toFixed(2)}:1 < 4.5`);
      }
    }
    // Neutral: texto fuerte del panel sobre la superficie del chip.
    for (const backdrop of theme.backdrops) {
      const ratio = contrast(parse(theme.vars["--a-muted-2"]), over(parse(theme.vars["--a-panel-2"]), backdrop));
      assert.ok(ratio >= 4.5, `${theme.name} · neutral: ${ratio.toFixed(2)}:1 < 4.5`);
    }
  }
});

test("AA ≥ 3: el color base de cada tono (ícono y barra) sobre el panel, en claro y en oscuro", () => {
  for (const theme of themes()) {
    for (const tone of TONES) {
      for (const backdrop of theme.panel) {
        const ratio = contrast(parse(theme.vars[`--a-${tone}`]), backdrop);
        assert.ok(ratio >= 3, `${theme.name} · ${tone}: ${ratio.toFixed(2)}:1 < 3`);
      }
    }
  }
});
