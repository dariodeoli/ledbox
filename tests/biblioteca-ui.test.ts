import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const ui = read("components", "admin", "AdminUI.tsx");
const fields = read("components", "admin", "AdminFields.tsx");
const css = read("app", "globals.css");
const library = css.slice(css.indexOf("BIBLIOTECA DE PIEZAS"), css.indexOf("FIN BIBLIOTECA"));

function runCheck(files: Record<string, string>, globals?: string) {
  const dir = mkdtempSync(join(tmpdir(), "check-ui-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, content);
    }
    mkdirSync(join(dir, "app"), { recursive: true });
    writeFileSync(join(dir, "app", "globals.css"), globals ?? "/* BIBLIOTECA DE PIEZAS */\n/* FIN BIBLIOTECA */\n");
    const result = spawnSync("node", [join(root, "scripts", "check-ui.mjs")], { env: { ...process.env, CHECK_UI_ROOT: dir }, encoding: "utf8" });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("botón: primary, secondary, ghost, danger y link; tamaños sm y md; busy", () => {
  assert.match(ui, /export type AdminButtonVariant = "primary" \| "secondary" \| "ghost" \| "danger" \| "link"/);
  assert.match(ui, /export type AdminButtonSize = "sm" \| "md"/);
  assert.match(ui, /aria-busy=\{busy \|\| undefined\}/);
  assert.match(ui, /export function AdminButtonLink/);
  assert.match(ui, /export function AdminIconButton/);
  for (const variant of ["secondary", "ghost", "primary", "danger", "link"]) assert.match(library, new RegExp(`\\.admin-btn--${variant}\\b`), `falta .admin-btn--${variant} en la biblioteca`);
  assert.match(library, /\.admin-btn--sm\s*\{[^}]*--btn-h:\s*30px/);
  assert.match(library, /@media \(max-width: 720px\)[^}]*--btn-h:\s*44px/, "44 px de alto en celular");
});

test("chip único: AdminBadge con los tonos del inventario y StateChip lo reutiliza", () => {
  for (const tone of ["ok", "warn", "danger", "info", "accent"]) assert.match(library, new RegExp(`\\.admin-badge\\[data-tone="${tone}"\\]`));
  assert.match(ui, /icon\?: AdminIconName;[\s\S]{0,200}size\?: "sm" \| "md"/);
  const parts = read("components", "admin", "modules", "InventoryParts.tsx");
  assert.match(parts, /<AdminBadge tone=\{state\.tone\} icon=\{state\.icon\}/);
  assert.doesNotMatch(css, /\.admin-inv-chip\b/, "no queda un chip paralelo");
});

test("pestañas: un solo AdminTabs (enlaces, controladas y filtros) y ya no hay AdminSubtabs", () => {
  assert.match(ui, /export function AdminTabs/);
  assert.doesNotMatch(ui, /export function AdminSubtabs/);
  assert.match(ui, /event\.key === "Home"/, "flechas, Inicio y Fin");
  assert.match(ui, /aria-pressed=\{active\}/, "modo filtros");
});

test("campos: cada pieza trae su ancho por tipo y acepta size", () => {
  assert.match(fields, /export type FieldSize = "xs" \| "sm" \| "md" \| "lg" \| "full"/);
  const expected: Array<[string, string]> = [
    ["MoneyField", "sm"], ["NumberField", "xs"], ["PercentField", "xs"], ["SerialField", "xs"], ["PhoneField", "md"], ["RucField", "md"],
    ["SelectField", "md"], ["EmailField", "lg"], ["TextField", "lg"], ["TextAreaField", "full"],
  ];
  for (const [name, size] of expected) {
    const start = fields.indexOf(`export function ${name}(`);
    assert.ok(start > 0, name);
    const next = fields.indexOf("\nexport function", start + 10);
    assert.match(fields.slice(start, next < 0 ? undefined : next), new RegExp(`size=\\{size \\?\\? "${size}"\\}`), `${name} debería medir ${size}`);
  }
  for (const [size, rem] of [["xs", "8rem"], ["sm", "12rem"], ["md", "17rem"], ["lg", "24rem"]]) assert.match(library, new RegExp(`\\.admin-field\\[data-size="${size}"\\]\\s*\\{\\s*max-width:\\s*${rem}`));
  assert.match(library, /@media \(max-width: 720px\)\s*\{\s*\.admin-field\[data-size\]\s*\{\s*max-width:\s*none/, "ancho completo en celular");
});

test("campos: prefijo y sufijo (Gs, %, días) y una sola caja con un solo borde", () => {
  assert.match(fields, /prefix\?: string;[\s\S]{0,200}suffix\?: string;/);
  assert.match(fields, /fin=\{suffix \?/);
  assert.match(library, /\.admin-root \[data-oc-control\]:not\(:focus\):not\(\[aria-invalid="true"\]\)\s*\{\s*box-shadow:\s*none/, "sin anillo en reposo");
  assert.match(library, /:focus\s*\{[^}]*box-shadow:\s*0 0 0 3px var\(--a-focus-halo\)/, "anillo de acento solo en foco");
});

test("campos: el borde de la librería es sólido (sin el inset nativo de dos tonos)", () => {
  assert.match(library, /\.admin-root \[class~="border"\][^{]*\{\s*border-style:\s*solid/, "el panel no carga el preflight: sin esto el borde se dibuja inset");
  assert.match(library, /\[data-oc-control\]\[readonly\]\s*\{\s*border-style:\s*dashed/);
});

test("diálogo: grilla de 12 columnas, tamaño xl, AdminCol, `columns` y secciones con separador", () => {
  assert.match(ui, /"sm" \| "md" \| "lg" \| "xl"/);
  assert.match(ui, /export function AdminCol/);
  assert.match(ui, /columns\?: 1 \| 2 \| 3 \| 4/);
  assert.match(css, /\.admin-dialog-grid\s*\{[^}]*repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.admin-dialog-section-title::after/);
  assert.match(css, /\.admin-dialog-footer \.admin-btn--secondary[^{]*\{[^}]*border-color:\s*transparent/, "la secundaria del pie es ghost");
});

test("menús: una sola caja opaca con sombra", () => {
  assert.match(library, /\.admin-menu-pop, \.admin-combobox-pop, \.admin-company-menu, \.admin-root \[role="listbox"\]\s*\{[^}]*background:\s*var\(--a-pop-bg\)[^}]*box-shadow:\s*var\(--a-pop-shadow\)[^}]*backdrop-filter:\s*none/);
  assert.match(css, /--a-pop-bg:\s*var\(--a-dialog-bg\)/);
});

test("candado check:ui: el repo está limpio", () => {
  const result = spawnSync("node", [join(root, "scripts", "check-ui.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("candado check:ui: frena campos, botones, estilos y clases sueltos", () => {
  const bad = runCheck({
    "components/admin/Foo.tsx": [
      "export function Foo() {",
      "  return (<div>",
      '    <input value="x" />',
      '    <button type="button">Hola</button>',
      '    <span style={{ margin: 4, color: "red" }} />',
      '    <span className="admin-btn admin-btn--primary" />',
      '    <span className="w-[300px] border rounded-lg" />',
      "  </div>);",
      "}",
    ].join("\n"),
  });
  assert.equal(bad.status, 1);
  for (const needle of ["campo suelto <input>", "<button> suelto", "style= no dinámico", "clase de la biblioteca a mano", "utilidad suelta"]) assert.ok(bad.out.includes(needle), `no frenó: ${needle}\n${bad.out}`);
});

test("candado check:ui: deja pasar lo dinámico, los hidden y los widgets de la allowlist", () => {
  const good = runCheck({
    "components/admin/Bar.tsx": ['export const Bar = ({ width }: { width: number }) => (<span><input type="hidden" name="x" /><i style={{ width: `${width}%` }} /></span>);'].join("\n"),
    "components/admin/AdminMobileNav.tsx": '<button type="button">Más</button>',
  });
  assert.equal(good.status, 0, good.out);
});

test("candado check:ui: frena bordes y tamaños de campo definidos fuera del bloque de la biblioteca", () => {
  const css2 = "/* BIBLIOTECA DE PIEZAS */\n.admin-field input { border: 1px solid red; }\n/* FIN BIBLIOTECA */\n.admin-field input { border: 2px solid blue; }\n.admin-foo { border: 0; }\n";
  const result = runCheck({}, css2);
  assert.equal(result.status, 1);
  assert.match(result.out, /app\/globals\.css:4/);
  assert.doesNotMatch(result.out, /globals\.css:2:/);
});

test("diálogos con pestañas: el cuerpo del diálogo no deja que la barra de pestañas se aplaste", () => {
  const body = css.match(/^\.admin-dialog-body \{[^}]*\}/m)?.[0] ?? "";
  assert.match(body, /display:\s*grid/);
  // Un hijo con overflow-x (la barra) tiene mínimo automático 0 y, sin esto, colapsa al desbordar el contenido.
  assert.match(body, /grid-auto-rows:\s*max-content/);
  assert.match(css, /^\.admin-ficha-nav \{[^}]*position:\s*sticky[^}]*overflow-x:\s*auto/m);
});
