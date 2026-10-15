#!/usr/bin/env node
/**
 * Candado de la biblioteca de piezas del panel (docs/DISENO-PANEL.md §16).
 *
 * Una pieza = un componente. Corregir la ventana, el campo de precio, un
 * desplegable o el tablero tiene que corregirlos en todas las pantallas, así que
 * fuera de la biblioteca no puede haber estilos ni controles sueltos. En
 * `components/admin` y `app/(admin)` falla si aparece:
 *
 * 1. `<input>`, `<select>` o `<textarea>` sueltos (campos: `AdminFields.tsx`).
 * 2. `<button>` suelto: los botones son `AdminButton`, `AdminIconButton`,
 *    `AdminButtonLink` o `AdminTabs`. Los controles que son un widget propio
 *    (navegación lateral, celdas del calendario, tarjetas seleccionables…) viven
 *    en la allowlist de abajo, con el motivo y un tope por archivo (si crece, falla).
 * 3. `style=` no dinámico: solo se admiten valores calculados (posición, ancho
 *    en %, color elegido por el usuario). Un objeto con puros literales va a una
 *    clase de `app/globals.css`.
 * 4. Clases de botón, chip o pestaña a mano (`admin-btn*`, `admin-iconbtn`,
 *    `admin-badge`, `admin-subtab`, `btn-led`…): se piden por componente.
 * 5. Utilidades de Tailwind de borde, sombra o ancho en un className: la caja y
 *    el ancho de cada pieza los fija la biblioteca (`size` en los campos).
 * 6. En `app/globals.css`, reglas de borde, sombra o tamaño sobre los campos
 *    (`.admin-field input`, `[data-oc-control]`, `.admin-field[data-size]`) fuera
 *    del bloque «BIBLIOTECA DE PIEZAS».
 *
 * Archivos de la biblioteca (única excepción de 1 a 5): AdminUI, AdminFields,
 * AdminBoard.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// CHECK_UI_ROOT permite probar el candado sobre un árbol de prueba (tests/biblioteca-ui.test.ts).
const ROOT = process.env.CHECK_UI_ROOT ? resolve(process.env.CHECK_UI_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = [join(ROOT, "components", "admin"), join(ROOT, "app", "(admin)")];
const LIBRARY = new Set(["components/admin/AdminUI.tsx", "components/admin/AdminFields.tsx", "components/admin/AdminBoard.tsx"]);

/** `<button>` que es un widget propio, no un botón de acción: archivo → tope y motivo. */
const BUTTON_ALLOWLIST = {
  "components/admin/AdminShell.tsx": { max: 7, reason: "chrome del shell: grupos del menú, cerrar sesión, telón del drawer, buscador y franja demo (no son acciones de formulario)" },
  "components/admin/AdminMobileNav.tsx": { max: 1, reason: "pestaña «Más» de la barra inferior (navegación)" },
  "components/admin/AdminCommandPalette.tsx": { max: 1, reason: "opción de la paleta de comandos (listbox)" },
  "components/admin/AdminSandboxStrip.tsx": { max: 3, reason: "enlaces de la franja de la demo sobre fondo propio" },
  "components/admin/modules/AparienciaSettings.tsx": { max: 2, reason: "tarjeta de plantilla y muestra de color (selección visual)" },
  "components/admin/modules/CalendarioModule.tsx": { max: 3, reason: "celdas, ítems y «+N más» de la grilla del calendario" },
  "components/admin/modules/EventoFicha.tsx": { max: 1, reason: "hueco clicable del checklist del evento" },
  "components/admin/modules/EventoLista.tsx": { max: 1, reason: "cuerpo clicable de la tarjeta de evento" },
  "components/admin/modules/InventoryList.tsx": { max: 1, reason: "nombre del producto como fila clicable" },
  "components/admin/modules/InventoryParts.tsx": { max: 1, reason: "casilla de selección de fila (rowcheck)" },
  "components/admin/modules/InventoryTiles.tsx": { max: 2, reason: "mosaico del inventario (tarjeta clicable y selección)" },
  "components/admin/modules/PerfilModule.tsx": { max: 2, reason: "filas de la lista de cuentas del perfil" },
  "app/(admin)/(print)/_components/PrintToolbar.tsx": { max: 1, reason: "hoja imprimible: piel de papel propia (lbprint), no usa los tokens del panel" },
  "app/(admin)/(print)/_components/ReporteView.tsx": { max: 1, reason: "hoja imprimible: piel de papel propia (lbprint)" },
};
/** Campos sueltos permitidos: archivo → tope y motivo. */
const FIELD_ALLOWLIST = {
  "app/(admin)/(print)/_components/ReporteView.tsx": { max: 1, reason: "selector de mes de la hoja imprimible (piel de papel propia)" },
};

const FIELD_TAG = /<(input|select|textarea)\b[\s\S]*?>/g;
const BUTTON_TAG = /<button\b/g;
const STYLE_TAG = /\bstyle=(\{\{[\s\S]*?\}\}|"[^"]*")/g;
const CLASS_ATTR = /className=(\{[^}]*\}|"[^"]*"|`[^`]*`)/g;
const HAND_CLASS = /(?<![\w-])(admin-btn(?:--[a-z-]+)?|admin-iconbtn|admin-badge|admin-subtab|admin-inv-chip|admin-chip|btn-led)(?![\w-])/;
const TAILWIND_LOOSE = /(?<![\w-])(?:(?:max-|min-)?w-(?:\[|\d|full|screen|xs|sm|md|lg|xl)|border(?:-[a-z0-9[]+)?|rounded(?:-[a-z0-9[]+)?|shadow(?:-[a-z0-9[]+)?|ring(?:-[a-z0-9[]+)?)(?![\w-])/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}
function maskComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (all, lead) => lead + " ".repeat(all.length - lead.length));
}
const lineOf = (source, index) => source.slice(0, index).split("\n").length;
const posix = (path) => path.split("\\").join("/");

/** Un `style` es dinámico si algún valor no es un literal (variable, template, cálculo, spread). */
function isStaticStyle(raw) {
  if (raw.startsWith('"')) return true;
  const inner = raw.slice(2, -2).trim();
  if (inner === "") return true;
  if (inner.includes("...")) return false;
  return inner.split(",").map((part) => part.trim()).filter(Boolean).every((part) => {
    const value = part.split(":").slice(1).join(":").trim();
    return /^("[^"]*"|'[^']*'|-?\d+(\.\d+)?)$/.test(value);
  });
}

const violations = [];
const add = (path, line, message) => violations.push({ path, line, message });

for (const dir of SCAN_DIRS) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const path = posix(relative(ROOT, file));
    const source = maskComments(readFileSync(file, "utf8"));
    const inLibrary = LIBRARY.has(path);

    if (!inLibrary) {
      const fields = [...source.matchAll(FIELD_TAG)].filter((match) => {
        const name = match[0].match(/^<(\w+)/)[1];
        return !(name === "input" && /type=["'](checkbox|hidden)["']/.test(match[0]));
      });
      const allowedFields = FIELD_ALLOWLIST[path]?.max ?? 0;
      fields.slice(allowedFields).forEach((match) => add(path, lineOf(source, match.index), `campo suelto <${match[0].match(/^<(\w+)/)[1]}>: usá el kit de campos (components/admin/AdminFields.tsx)`));

      const buttons = [...source.matchAll(BUTTON_TAG)];
      const allowedButtons = BUTTON_ALLOWLIST[path]?.max ?? 0;
      buttons.slice(allowedButtons).forEach((match) => add(path, lineOf(source, match.index), "<button> suelto: usá AdminButton, AdminIconButton, AdminButtonLink o AdminTabs (o sumalo a la allowlist de scripts/check-ui.mjs con motivo)"));

      for (const match of source.matchAll(CLASS_ATTR)) {
        const found = match[1].match(HAND_CLASS);
        if (found) add(path, lineOf(source, match.index), `clase de la biblioteca a mano («${found[1]}»): pedila por componente (AdminButton, AdminBadge, AdminTabs…)`);
        const loose = match[1].match(TAILWIND_LOOSE);
        if (loose) add(path, lineOf(source, match.index), `utilidad suelta de borde, sombra o ancho («${loose[1]}»): la caja y el ancho los fija la biblioteca (size del campo)`);
      }
    }

    for (const match of source.matchAll(STYLE_TAG)) {
      if (inLibrary && !isStaticStyle(match[1])) continue;
      if (isStaticStyle(match[1])) add(path, lineOf(source, match.index), "style= no dinámico: pasalo a una clase de app/globals.css (solo valores calculados van inline)");
    }
  }
}

// Regla 6: CSS de los campos fuera del bloque de la biblioteca.
{
  const cssPath = join(ROOT, "app", "globals.css");
  const raw = readFileSync(cssPath, "utf8");
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const start = raw.indexOf("BIBLIOTECA DE PIEZAS");
  const end = raw.indexOf("FIN BIBLIOTECA");
  if (start < 0 || end < start) add("app/globals.css", 1, "faltan los marcadores «BIBLIOTECA DE PIEZAS» / «FIN BIBLIOTECA»");
  // Permitidas: ocultar visualmente (sr-only), el ancho base y el teléfono, que une dos cajas en una (+595 | número).
  const CSS_ALLOW = [/^\.sr-only\b/, /^\.admin-field input, \.admin-field select, \.admin-field textarea$/, /\.admin-shared-phone/];
  const rule = /([^{}@]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rule.exec(css))) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    if (!/(\.admin-field\b[^,]*\b(?:input|select|textarea)\b|data-oc-control|\.admin-field\[data-size)/.test(selector)) continue;
    if (!/(?:^|[;\s])(?:border[a-z-]*|box-shadow|max-width|width|min-height|height)\s*:/.test(match[2])) continue;
    const offset = match.index + match[1].length - match[1].trimStart().length;
    if (offset >= start && offset <= end) continue;
    if (CSS_ALLOW.some((pattern) => pattern.test(selector))) continue;
    add("app/globals.css", lineOf(css, match.index + (match[1].length - match[1].trimStart().length)), `borde, sombra o tamaño de campo fuera de la biblioteca («${selector.slice(0, 70)}»): se define una vez en el bloque BIBLIOTECA DE PIEZAS`);
  }
}

if (violations.length > 0) {
  console.error(`Candado de la biblioteca (check:ui): ${violations.length} problema(s).`);
  for (const violation of violations) console.error(`  ${violation.path}:${violation.line}: ${violation.message}`);
  process.exitCode = 1;
} else {
  console.log("Candado de la biblioteca (check:ui): sin campos, botones, estilos ni clases sueltos en components/admin y app/(admin).");
}
