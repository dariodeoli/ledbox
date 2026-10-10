import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Landing de EventOS con la piel v2 (issue #133): misma familia que el sitio
 * (tokens claro/oscuro, tipografía real, vidrio, matriz LED y esquina cortada),
 * tema fijado antes del primer pintado reusando el mecanismo del sitio, textos
 * y SEO intactos.
 */
const root = process.cwd();
const page = readFileSync(join(root, "app", "(product)", "producto", "page.tsx"), "utf8");
const css = readFileSync(join(root, "app", "globals.css"), "utf8");
const theme = readFileSync(join(root, "lib", "site-theme.ts"), "utf8");
const footer = readFileSync(join(root, "components", "app-footer.tsx"), "utf8");

test("la landing se envuelve en la raíz de piel con arranque de tema", () => {
  assert.match(page, /className="producto" id=\{PRODUCT_ROOT_ID\} data-theme="dark" suppressHydrationWarning/, "falta la raíz de piel");
  assert.match(page, /__html: PRODUCT_BOOT_SCRIPT/, "falta el arranque de tema");
  assert.match(page, /className="led-grid-bg" aria-hidden="true"/, "falta la matriz LED");
});

test("el tema del producto reusa el mecanismo del sitio", () => {
  assert.match(theme, /export const PRODUCT_ROOT_ID = "producto-root";/, "falta la raíz del producto");
  assert.match(theme, /export const PRODUCT_BOOT_SCRIPT = themeBootScript\(PRODUCT_ROOT_ID\);/, "el producto no usa el mecanismo común");
  assert.match(theme, /export const SITE_BOOT_SCRIPT = themeBootScript\(SITE_ROOT_ID\);/, "el sitio dejó de usar el mecanismo común");
});

test("la piel declara los dos temas con los tokens de la familia", () => {
  const base = css.match(/\.producto \{([^}]*)\}/)?.[1] ?? "";
  const light = css.match(/\.producto\[data-theme="light"\] \{([^}]*)\}/)?.[1] ?? "";
  assert.ok(base, "falta el bloque oscuro de la landing");
  assert.ok(light, "falta el bloque claro de la landing");
  // Los colores, superficies y formas cambian con el tema.
  for (const token of ["--bg", "--surface", "--border", "--text", "--muted", "--led", "--grad-action", "--radius", "--radius-lg", "--shadow-card"]) {
    assert.match(base, new RegExp(`${token}:`), `falta ${token} en oscuro`);
    assert.match(light, new RegExp(`${token}:`), `falta ${token} en claro`);
  }
  // La tipografía real no depende del tema: alcanza con declararla una vez.
  for (const token of ["--font-display", "--font-body"]) {
    assert.match(base, new RegExp(`${token}:`), `falta ${token}`);
  }
  assert.match(base, /--a-line: var\(--border\)/, "el pie compartido no está mapeado a la piel");
});

test("no quedan los colores fijos de la piel vieja", () => {
  const start = css.indexOf(".producto {");
  const block = css.slice(start, css.indexOf("/* ─── UX DEL PANEL", start));
  for (const color of ["#05080a", "#081115", "#12222a", "#14262e", "#1b3a46", "#9fb6c0", "#e8f4f8", "#a9c0ca", "#7b93a0"]) {
    assert.ok(!block.includes(color), `quedó el color viejo ${color}`);
  }
});

test("textos y SEO intactos", () => {
  assert.match(page, /Todo tu evento, <span>de la cotización al cobro\.<\/span>/, "cambió el título");
  for (const copy of [
    "Presupuestos y portal",
    "Trazabilidad y auditoría",
    "Aprobación online",
    "Cobro y cierre",
    "¿EventOS sirve para varias empresas?",
    "¿Se puede probar?",
  ]) {
    assert.ok(page.includes(copy), `desapareció el texto: ${copy}`);
  }
  assert.match(page, /alternates: \{ canonical: publicConfig\.productUrl \}/, "cambió el canonical");
  assert.match(page, /"@type": "FAQPage"/, "cambió el JSON-LD");
  assert.equal((page.match(/\] as const;/g) ?? []).length, 5, "cambiaron los bloques de contenido (módulos, pasos, FAQ, resultados o perfiles)");
});

test("el header usa la marca de EventOS, no el logo de otra marca", () => {
  assert.match(page, /<BrandMark className="producto-brand-mark" size=\{26\} \/>/, "el header no usa la marca de EventOS");
  assert.doesNotMatch(page, /producto-brand-mark[^>]{0,200}icon-192/, "el header volvió al logo de LedBox");
  assert.doesNotMatch(css, /producto-brand-mark \{ border-radius/, "quedó el ajuste de la imagen vieja");
});

test("flujo visual y secciones de la 2ª pasada", () => {
  assert.match(page, /className="producto-flow"/, "falta el flujo visual");
  for (const verb of ["Cotizá", "Aprobá", "Operá", "Cobrá"]) {
    assert.ok(page.includes(`<li>${verb}</li>`), `falta el paso ${verb}`);
  }
  assert.match(page, /id="resultados"/, "faltan los resultados cuantificables");
  for (const eyebrow of ["Tiempo", "Faltantes", "Margen"]) {
    assert.ok(page.includes(`["${eyebrow}",`), `falta el beneficio ${eyebrow}`);
  }
  assert.match(page, /id="para-quien"/, "falta la sección para quién es");
  for (const audience of ["Productoras de eventos", "Alquiladores de equipos", "Agencias"]) {
    assert.ok(page.includes(audience), `falta el perfil ${audience}`);
  }
});

test("responsive y pie con versión real", () => {
  assert.match(css, /\.producto-section \{ padding: clamp\(30px, 4\.5vw, 48px\) 0; scroll-margin-top: 76px; \}/, "cambió el ritmo de las secciones o el ancla");
  assert.match(css, /@media \(max-width: 860px\) \{/, "falta el corte de la barra");
  assert.match(css, /@media \(max-width: 480px\) \{/, "falta el ajuste de mobile chico");
  assert.match(readFileSync(join(root, "app", "layout.tsx"), "utf8"), /<AppFooter variant="product" \/>/, "el layout raíz publica el pie compartido");
  assert.doesNotMatch(page, /<AppFooter/, "la landing no duplica el pie del layout raíz");
  assert.match(footer, /APP_VERSION_LABEL/, "el pie dejó de mostrar la versión real");
});
