import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

/**
 * Adopción de owncoding-ui v0.68.3 en el panel: formularios pro, campos con la
 * fuente única de la librería, logos financieros, pie `panel` y avatares sobrios.
 * Todo se verifica sobre la fuente y sobre los tokens reales de `app/globals.css`.
 */
const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const css = read("app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const fields = read("components", "admin", "AdminFields.tsx");

test("la dependencia queda fijada en el commit de v0.68.3", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.dependencies["owncoding-ui"], /#22f68c037440e71ccce68348adea4460bcc0a82a$/);
  const lib = JSON.parse(read("node_modules", "owncoding-ui", "package.json"));
  assert.equal(lib.version, "0.68.3");
});

test("el espejo de CSS de campos es idéntico al bloque de base.css de la librería", () => {
  const base = read("node_modules", "owncoding-ui", "dist", "base.css");
  const start = base.indexOf("/* ── Campos de formulario: color y selección");
  const end = base.indexOf("/* Animaciones de la pantalla de carga");
  assert.ok(start > 0 && end > start, "cambió la estructura de base.css: revisar el espejo");
  const mirror = read("app", "oc-formularios.css");
  assert.ok(mirror.includes(base.slice(start, end).trimEnd()), "app/oc-formularios.css quedó desactualizado: volver a copiar el bloque");
  assert.match(css + read("app", "globals.css"), /@import "\.\/oc-formularios\.css"/);
});

test("el panel activa «Formularios pro»: atributo para el CSS y contexto para el JS", () => {
  const layout = read("app", "(admin)", "layout.tsx");
  assert.match(layout, /data-oc-formularios="pro"/);
  assert.match(layout, /<FormulariosPro contenedor=\{false\}>/);
  assert.match(layout, /from "owncoding-ui"/);
});

test("los campos del kit usan los componentes de la librería y no dibujan controles a mano", () => {
  for (const name of ["SharedInput", "SharedSelect", "SharedTextarea", "SharedCheckbox", "SharedSwitch", "SharedSegmented"]) {
    assert.match(fields, new RegExp(`<${name}\\b`), `AdminFields no usa ${name}`);
  }
  const code = fields.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /<select\b/, "el select es el de la librería");
  assert.doesNotMatch(code, /<textarea\b/, "el textarea es el de la librería");
  assert.doesNotMatch(css, /\.admin-switch-track|\.admin-segmented-item|\.admin-check-box/, "CSS duplicado de Switch/Segmented/Checkbox");
});

test("el segmentado conserva grupo accesible, descripción, invalidez y deshabilitado sin foco", () => {
  const seg = fields.slice(fields.indexOf("export function SegmentedField"), fields.indexOf("export function AttachmentInput"));
  assert.match(seg, /role="group"/);
  assert.match(seg, /aria-labelledby=\{label \? labelId : undefined\}/);
  assert.match(seg, /aria-describedby=\{describedBy\(error, hint, hintId, errorId\)\}/);
  assert.match(seg, /aria-invalid=\{error \? true : undefined\}/);
  assert.match(seg, /inert=\{disabled \? true : undefined\}/);
  assert.match(seg, /ariaLabel=\{name\}/);
});

test("la caja de texto no crece sola salvo que el llamador lo pida", () => {
  assert.match(fields, /autoGrow = false,/);
});

test("la caja de texto acepta autoGrow y contador sin cambiar la API existente", () => {
  assert.match(fields, /autoGrow\?: boolean/);
  assert.match(fields, /counter\?: boolean/);
  assert.match(fields, /autoCrecer=\{autoGrow\}/);
  assert.match(fields, /contador=\{counter\}/);
});

test("logos de banco: un solo componente del panel que usa BancoLogo y respeta el catálogo", () => {
  const logo = read("components", "admin", "BankLogo.tsx");
  assert.match(logo, /from "owncoding-ui\/financial"/);
  assert.match(logo, /soloCatalogo/, "un banco fuera del catálogo no inventa un logo");
  for (const file of ["components/admin/modules/FinanzasModule.tsx", "components/admin/modules/PresupuestosModule.tsx", "app/(portal)/_components/PortalBudgetView.tsx"]) {
    const source = read(...file.split("/"));
    assert.match(source, /<BankLogo\b/, `${file}: falta el logo financiero`);
    assert.doesNotMatch(source, /bank-asset|admin-bank-mark|portal-bank-mark/, `${file}: quedó el logo propio`);
  }
  const tailwind = read("tailwind.config.mjs");
  assert.match(tailwind, /darkMode: \["selector", '\[data-theme="dark"\]'\]/, "las variantes dark: de la librería siguen el tema del panel");
});

test("el pie del panel usa ProductFooter modelo=panel y el resto conserva distribuido", () => {
  const footer = read("components", "app-footer.tsx");
  assert.match(footer, /modelo=\{variant === "app" \? "panel" : "distribuido"\}/);
  assert.match(css, /body > \.app-footer--app \{ padding-block: 8px;/);
});

test("las iniciales de persona usan la paleta sobria de la librería", () => {
  const avatar = read("components", "admin", "AdminAvatar.tsx");
  assert.match(avatar, /colorDeNombre\(name \?\? "", "sobria"\)/);
});

// ── Contraste de los tokens --c-* que leen los controles de la librería ──
function triples(startMarker: string): Record<string, [number, number, number]> {
  const from = css.indexOf(startMarker);
  const block = css.slice(from, css.indexOf("}", from));
  const out: Record<string, [number, number, number]> = {};
  for (const match of block.matchAll(/(--c-[\w-]+):\s*(\d+) (\d+) (\d+);/g)) out[match[1]] = [Number(match[2]), Number(match[3]), Number(match[4])];
  return out;
}

function luminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const [name, marker] of [["oscuro", ".admin-root {\n  --c-fore"], ["claro", '.admin-root[data-theme="light"] {\n  --c-fore']] as const) {
  test(`contraste de los tokens de la librería en el panel (${name}): texto ≥ 4,5 y controles ≥ 3`, () => {
    const t = triples(marker);
    const surfaces = [t["--c-ink-800"], t["--c-ink"], t["--c-paper"]];
    for (const token of ["--c-fore", "--c-mute", "--c-placeholder", "--c-bad-text", "--c-ok-text", "--c-info-text", "--c-warn-text", "--c-fono-text"]) {
      assert.ok(t[token], `${name}: falta ${token}`);
      for (const surface of surfaces) assert.ok(contrast(t[token], surface) >= 4.5, `${name}: ${token} sobre una superficie < 4,5 (${contrast(t[token], surface).toFixed(2)})`);
    }
    for (const token of ["--c-interactivo", "--c-fono-dark", "--c-bad", "--c-ok"]) {
      assert.ok(t[token], `${name}: falta ${token}`);
      for (const surface of surfaces) assert.ok(contrast(t[token], surface) >= 3, `${name}: ${token} (borde/indicador) < 3 (${contrast(t[token], surface).toFixed(2)})`);
    }
  });
}

test("reduced-motion: el espejo de la librería apaga animaciones y transiciones de los campos", () => {
  const mirror = read("app", "oc-formularios.css");
  assert.match(mirror, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(mirror, /\[data-oc-switch\] \*/);
  assert.match(mirror, /\[data-motion="off"\]/);
});
