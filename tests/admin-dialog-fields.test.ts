import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { inventoryModuleSource } from "./fixtures/inventory-module-source";

/**
 * Rediseño de campos y ventanas (13-10-2026): contrato visual y de
 * accesibilidad de `AdminFields` y `AdminDialog`, verificado sobre la fuente
 * y sobre los tokens reales de `app/globals.css` (no sobre copias).
 */
const root = process.cwd();
const css = readFileSync(join(root, "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const fields = readFileSync(join(root, "components", "admin", "AdminFields.tsx"), "utf8");
const ui = readFileSync(join(root, "components", "admin", "AdminUI.tsx"), "utf8");
const dialog = ui.slice(ui.indexOf("export function AdminDialog("), ui.indexOf("// ── Cronología"));

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `falta la regla ${selector}`);
  return css.slice(start, css.indexOf("}", start));
}

const darkStart = css.indexOf(".admin-root {\n  color-scheme: dark;");
const lightStart = css.indexOf('.admin-root[data-theme="light"] {\n  color-scheme: light;');
const darkBlock = css.slice(darkStart, lightStart);

function tokens(startMarker: string, endMarker: string): Record<string, string> {
  const from = css.indexOf(startMarker);
  const block = css.slice(from, css.indexOf(endMarker, from + startMarker.length));
  const out: Record<string, string> = {};
  for (const match of block.matchAll(/(--a-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[match[1]] = match[2];
  return out;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Fuente única de los campos de la librería (v0.68): estilo y alturas de `CLASES_CAMPO`.
// El paquete no la exporta por el entry: se lee el archivo publicado.
const campoLib = readFileSync(join(root, "node_modules", "owncoding-ui", "src", "utils", "campo.js"), "utf8");

test("campos: una sola altura (44 px en celular, 36 px desde md) para los de la librería y los propios", () => {
  assert.match(campoLib, /CAMPO_ALTURA = 'h-11 md:h-9'/, "la librería cambió la altura de los campos: revisar el panel");
  assert.match(darkBlock, /--a-field-h:\s*36px/, "los controles propios (combobox, contraseña, PIN) miden lo mismo que los de la librería");
  assert.match(darkBlock, /--a-field-radius:\s*8px/, "mismo radio que los de la librería (rounded-lg)");
  assert.match(darkBlock, /--a-field-border:\s*rgb\(var\(--c-interactivo\)\)/, "un solo borde fino, el token interactivo de la librería");
  assert.match(darkBlock, /--a-field-bg:\s*rgb\(var\(--c-ink-800\)\)/, "mismo fondo que los de la librería");
  assert.match(css, /@media \(max-width: 720px\) \{ \.admin-root \{ --a-field-h: 44px; \} \}/);
  assert.match(css, /\.admin-field input:not\(\[data-oc-control\]\)[^{]*\{[^}]*min-height:\s*var\(--a-field-h\)/);
  assert.doesNotMatch(rule(".admin-field input, .admin-field select, .admin-field textarea"), /min-height|padding|border/, "el aspecto de los campos de la librería no se pisa desde el panel");
});

test("campos: foco, error, válido y deshabilitado salen de la librería; los controles propios conservan los suyos", () => {
  // Librería (CAMPO_ESTADOS): anillo de 3 px, inválido por aria-invalid, ok y deshabilitado.
  assert.match(campoLib, /focus:ring-\[3px\]/, "foco: borde de acento + anillo de 3 px");
  assert.match(campoLib, /aria-\[invalid=true\]:border-bad/, "error: borde rojo por aria-invalid");
  assert.match(campoLib, /\[&\[data-oc-estado=ok\]\]:border-ok/, "válido: borde verde por estado=ok");
  assert.match(campoLib, /disabled:cursor-not-allowed/, "deshabilitado");
  assert.match(fields, /estado=\{success && !error \? "ok" : undefined\}/, "el éxito del kit pasa a estado=ok de la librería");
  // Controles propios que todavía no son de la librería.
  assert.match(css, /\.admin-field input:not\(\[data-oc-control\]\):focus[^{]*\{[^}]*box-shadow:\s*0 0 0 3px var\(--a-focus-halo\)/, "foco: borde del acento + halo de 3 px");
  assert.match(css, /\.admin-field input:not\(\[data-oc-control\]\)\[aria-invalid="true"\][^{]*\{[^}]*border-color:\s*var\(--a-danger\)[^}]*box-shadow:\s*none/, "error: borde rojo y nada más (sin halo)");
  assert.match(css, /\.admin-field input:not\(\[data-oc-control\]\):disabled[^{]*\{[^}]*background:\s*var\(--a-field-disabled-bg\)/, "deshabilitado: fondo apagado, igual que el de la librería");
  assert.match(css, /\.admin-root \[data-oc-control\]:not\(:focus\):not\(\[aria-invalid="true"\]\)\s*\{\s*box-shadow:\s*none/, "en reposo ningún control lleva sombra ni anillo: el halo es solo del foco");
  assert.match(rule(".admin-field-error"), /var\(--a-danger-text\)/);
  assert.match(rule(".admin-field-success"), /var\(--a-ok-text\)/);
  assert.match(rule(".admin-field-hint"), /font-size:\s*11\.5px/);
});

test("campos: etiqueta de 12 px con «*» en el acento y «opcional» a la derecha", () => {
  assert.match(css, /\.admin-field-label[^{]*\{[^}]*font-size:\s*12px[^}]*font-weight:\s*600/);
  assert.match(rule(".admin-field-req"), /var\(--a-accent\)/);
  assert.match(rule(".admin-field-optional"), /margin-left:\s*auto/);
  assert.match(fields, /admin-field-req/);
  assert.match(fields, /data-state=\{state\}/);
  assert.match(fields, /aria-hidden="true"> \*/, "el asterisco no se lee dos veces: el input ya es required");
});

test("campos: Gs y % son adornos dentro del campo (librería) y +595 comparte el borde con el número", () => {
  const ui = readFileSync(join(root, "node_modules", "owncoding-ui", "src", "components", "ui.jsx"), "utf8");
  assert.match(ui, /inicio=\{<span className="text-xs font-semibold">\{prefix\}<\/span>\}/, "MoneyInput dibuja la moneda como adorno inicio");
  assert.match(fields, /<SharedPercentField[\s\S]*?simbolo/, "el % es el adorno fin de la librería");
  assert.doesNotMatch(css, /\.admin-money span\b|\.admin-money--suffix/, "el panel ya no reposiciona los adornos de la librería");
  assert.match(css, /\.admin-shared-phone button\[role="combobox"\]\s*\{[^}]*border-radius:\s*var\(--a-field-radius\) 0 0/);
});

test("kit: existe CheckboxField y los dos campos sueltos pasaron al kit", () => {
  assert.match(fields, /export function CheckboxField/);
  assert.doesNotMatch(readFileSync(join(root, "components", "admin", "modules", "Checklist.tsx"), "utf8"), /<input\b/);
  assert.doesNotMatch(readFileSync(join(root, "components", "admin", "modules", "PresupuestosModule.tsx"), "utf8"), /<input type="checkbox"/);
});

test("ventana: encabezado, cuerpo con scroll propio y pie fijo", () => {
  assert.match(dialog, /description\?: string/);
  assert.match(dialog, /footer\?: React\.ReactNode/);
  assert.match(dialog, /dirty\?: boolean/);
  assert.match(dialog, /admin-dialog-icon/);
  assert.match(dialog, /admin-dialog-description/);
  assert.match(dialog, /<footer className="admin-dialog-footer">/);
  assert.match(css, /\.admin-dialog-icon\s*\{[^}]*width:\s*36px[^}]*height:\s*36px/);
  assert.match(css, /\.admin-dialog-close\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  assert.match(css, /\.admin-dialog-body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.admin-dialog-body \.admin-dialog-foot\s*\{[^}]*position:\s*sticky/, "los pies .admin-dialog-foot existentes quedan fijos igual");
});

test("ventana: tamaños 560 / 720 / ficha lateral y hoja completa en celular", () => {
  assert.match(css, /\.admin-dialog\s*\{[^}]*width:\s*min\(560px, 100%\)/);
  assert.match(css, /\.admin-dialog--wide\s*\{\s*width:\s*min\(720px, 100%\)/);
  assert.match(css, /\.admin-dialog--ficha\s*\{\s*width:\s*min\(1040px, 100%\)/);
  assert.match(css, /\.admin-dialog-overlay--ficha\s*\{[^}]*place-items:\s*stretch end/);
  assert.match(css, /\.admin-dialog-overlay--ficha \.admin-dialog--sheet\s*\{[^}]*height:\s*100dvh/);
  assert.match(css, /@media \(max-width: 767px\) \{\s*[^{]*\.admin-dialog-overlay, \.admin-dialog-overlay--ficha \{[^}]*padding:\s*0/);
  assert.match(css, /\.admin-dialog--xl\s*\{\s*width:\s*min\(960px, 100%\)/);
  assert.match(css, /\.admin-dialog-grid\s*\{[^}]*repeat\(12, minmax\(0, 1fr\)\)/, "grilla de 12 columnas");
});

test("ventana: foco, Esc, aria-modal, trampa de Tab y confirmación sin window.confirm", () => {
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /requestClose/);
  assert.match(dialog, /¿Descartar los cambios\?/);
  assert.doesNotMatch(dialog, /window\.confirm|confirm\(/);
  assert.match(dialog, /createPortal\(content, host\)/, "el diálogo anidado no queda recortado por el padre");
});

test("alto tráfico: los tres diálogos usan description y footer", () => {
  for (const file of ["ClientQuickForm.tsx", "BudgetQuickCreate.tsx", "BudgetPricingDialog.tsx"]) {
    const source = readFileSync(join(root, "components", "admin", "modules", file), "utf8");
    assert.match(source, /description=/, `${file}: falta description`);
    assert.match(source, /footer=/, `${file}: falta footer`);
    assert.match(source, /dirty=/, `${file}: falta dirty`);
  }
});

test("las altas de evento e inventario y los diálogos de Finanzas y Usuarios usan AdminDialog con pie y dirty", () => {
  const mod = (file: string) => readFileSync(join(root, "components", "admin", "modules", file), "utf8");
  for (const file of ["EventosModule.tsx", "InventarioModule.tsx", "LeadsModule.tsx"]) {
    // Inventario reparte sus ventanas en varios archivos: se lee el conjunto.
    const source = file === "InventarioModule.tsx" ? inventoryModuleSource() : mod(file);
    assert.match(source, /<AdminDialog\b/, `${file}: el alta/edición va en AdminDialog`);
    assert.match(source, /dirty=\{/, `${file}: falta dirty`);
    assert.match(source, /requestClose/, `${file}: Cancelar debe pasar por requestClose`);
  }
  for (const file of ["FinanzasModule.tsx", "UsuariosModule.tsx"]) {
    const source = mod(file);
    assert.doesNotMatch(source, /className="admin-dialog-overlay"/, `${file}: no deben quedar diálogos armados a mano`);
    assert.match(source, /<AdminDialog\b[\s\S]*footer=/, `${file}: los diálogos llevan footer`);
  }
});

test("tercera tanda: Clientes, Proveedores, Promotoras, Finanzas y Usuarios son AdminDialog con secciones, pie y dirty", () => {
  const mod = (file: string) => readFileSync(join(root, "components", "admin", "modules", file), "utf8");
  for (const file of ["ClientesModule.tsx", "ProveedoresModule.tsx", "PromotorasModule.tsx", "FinanzasModule.tsx", "UsuariosModule.tsx"]) {
    const source = mod(file);
    assert.doesNotMatch(source, /AdminFormPanel/, `${file}: no debe quedar AdminFormPanel`);
    assert.match(source, /<AdminDialog\b[\s\S]*description=/, `${file}: falta description`);
    assert.match(source, /<AdminDialogSection\b/, `${file}: faltan secciones`);
    assert.match(source, /dirty=\{/, `${file}: falta dirty`);
    assert.match(source, /footer=\{\(\{ requestClose \}\)/, `${file}: Cancelar debe pasar por requestClose`);
    assert.match(source, /form=\{\w*[Ff]ormId\}/, `${file}: el submit del pie apunta al formulario (Enter envía)`);
  }
  // Con despacho y devolución en ventana (Fase 4), ya no queda ningún formulario inline.
  assert.doesNotMatch(mod("EventosModule.tsx"), /AdminFormPanel/);
});

test("invitar usuario enfoca el correo; revocar no enfoca el botón destructivo; EmailField y MoneyField aceptan autoFocus", () => {
  const users = readFileSync(join(root, "components", "admin", "modules", "UsuariosModule.tsx"), "utf8");
  assert.match(users, /<EmailField\s+label="Correo"\s+required\s+autoFocus\s+value=\{invite\.email\}/);
  const revoke = users.slice(users.indexOf("function RevokeInviteDialog"), users.indexOf("function InvitationsPanel"));
  assert.doesNotMatch(revoke, /autoFocus/, "el foco inicial de Revocar es el respaldo del diálogo (la X), nunca el destructivo");
  const fields = readFileSync(join(root, "components", "admin", "AdminFields.tsx"), "utf8");
  for (const name of ["EmailField", "MoneyField"]) {
    const part = fields.slice(fields.indexOf(`export function ${name}(`));
    assert.match(part.slice(0, 1800), /autoFocus\?: boolean;/, `${name}: falta el prop autoFocus`);
    assert.match(part.slice(0, 3500), /autoFocus=\{autoFocus\}/, `${name}: no pasa autoFocus al input`);
  }
});

test("móvil (#159): el perfil del menú conserva nombre y rol y la barra inferior queda bajo las ventanas", () => {
  const css = readFileSync(join(root, "app", "globals.css"), "utf8");
  assert.match(css, /\.admin-user:not\(\.admin-user--sidebar\) \.admin-user-info \{ display: none; \}/);
  assert.doesNotMatch(css, /^  \.admin-user-info \{ display: none; \}/m, "la regla móvil no puede ocultar el perfil del drawer");
  const z = (selector: RegExp) => Number(css.match(selector)?.[1]);
  assert.ok(z(/\.admin-dialog-overlay \{[^}]*z-index: (\d+)/) > z(/\.admin-bottomnav \{ position: fixed;[^}]*z-index: (\d+)/), "las ventanas van sobre la barra inferior");
});

test("contraste AA de los tokens de campos y ventanas, en oscuro y claro", () => {
  const dark = tokens(".admin-root {\n  color-scheme: dark;", '.admin-root[data-theme="light"]');
  const light = tokens('.admin-root[data-theme="light"] {\n  color-scheme: light;', ".admin-root :focus-visible");
  for (const [name, set] of [["oscuro", dark], ["claro", light]] as const) {
    const surface = set["--a-dialog-bg"];
    assert.ok(surface, `${name}: falta --a-dialog-bg`);
    for (const token of ["--a-text", "--a-muted", "--a-muted-2", "--a-accent", "--a-danger-text", "--a-ok-text"]) {
      assert.ok(contrast(set[token], surface) >= 4.5, `${name}: ${token} sobre la ventana < 4.5`);
    }
    for (const token of ["--a-danger", "--a-accent"]) {
      assert.ok(contrast(set[token], surface) >= 3, `${name}: ${token} (borde) sobre la ventana < 3`);
    }
  }
});
