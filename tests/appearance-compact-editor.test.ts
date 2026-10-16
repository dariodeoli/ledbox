import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as homeRules from "../lib/store-home";
import { adjustBrandColor } from "../lib/appearance";

Object.assign(globalThis, { React });
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
type Tree = { type: unknown; props: Record<string, any> };
function all(node: any): Tree[] { if (Array.isArray(node)) return node.flatMap(all); return node?.props ? [node, ...all(node.props.children)] : []; }
function editor() {
  const source = ts.createSourceFile("HomeLayoutPanels.tsx", read("components/admin/modules/HomeLayoutPanels.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "HomeLayoutPanels"); assert.ok(component);
  const states: any[] = [], refs: any[] = []; let si = 0, ri = 0;
  const fakeReact = { createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props: { ...props, children } }), Fragment: "fragment" };
  const render = runInNewContext(ts.transpileModule(`${component.getText(source).replace(/^export /, "")}\nHomeLayoutPanels;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, {
    React: fakeReact, ...homeRules,
    useState(initial: unknown) { const index = si++; if (!(index in states)) states[index] = initial; return [states[index], (value: unknown) => { states[index] = value; }]; },
    useRef(initial: unknown) { const index = ri++; return refs[index] ?? (refs[index] = { current: initial }); },
    AdminPanel: "panel", AdminButton: "button", SelectField: "select", SwitchField: "switch", TextField: "field", TextAreaField: "textarea", PhotoBox: "photo",
  }) as (props: unknown) => Tree;
  return (props: unknown) => { si = 0; ri = 0; return render(props); };
}
const event = (clientY: number) => ({ clientY, preventDefault() {}, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 100 }) }, dataTransfer: { effectAllowed: "", dropEffect: "", setData() {} } });

test("arrastre muestra destino antes de soltar y sólo confirma el orden en drop; cancelar no muta", () => {
  const render = editor(); const changes: any[] = [];
  const props = { home: homeRules.DEFAULT_HOME, onHome: (next: unknown) => changes.push(next), photos: {}, onPhotos() {}, versions: {}, disabled: false };
  let tree = render(props), rows = all(tree).filter(node => node.type === "li");
  rows[0].props.onDragStart(event(10)); rows[3].props.onDragOver(event(80));
  assert.equal(changes.length, 0);
  tree = render(props); rows = all(tree).filter(node => node.type === "li");
  assert.equal(rows[3].props["data-drop"], "after", "el indicador ya está visible antes de drop");
  assert.equal(rows[0].props["data-dragging"], "true");
  rows[3].props.onDrop(event(80));
  assert.deepEqual(Array.from(changes[0].order), homeRules.moveSectionAtEdge(homeRules.DEFAULT_HOME.order, "hero", "colecciones", "after"));
  assert.equal(homeRules.DEFAULT_HOME.order[0], "hero");
  tree = render(props); rows = all(tree).filter(node => node.type === "li");
  rows[1].props.onDragStart(event(10)); rows[0].props.onDragOver(event(10)); rows[1].props.onDragEnd();
  assert.equal(changes.length, 1, "cancelar otro arrastre no guarda el orden provisional");
});

test("alternativa de teclado sigue subiendo/bajando y el modo deshabilitado no ordena", () => {
  const render = editor(), changes: any[] = [];
  const props = { home: homeRules.DEFAULT_HOME, onHome: (next: unknown) => changes.push(next), photos: {}, onPhotos() {}, versions: {}, disabled: false };
  const tree = render(props);
  all(tree).find(node => node.type === "button" && node.props["aria-label"] === "Subir la sección Categorías")!.props.onClick();
  assert.equal(changes[0].order[0], "categorias");
  const disabled = render({ ...props, disabled: true }); const rows = all(disabled).filter(node => node.type === "li");
  rows[0].props.onDragStart(event(10)); rows[1].props.onDrop(event(90)); assert.equal(changes.length, 1);
});

test("posición indicada antes/después es exacta para todos los pares de módulos", () => {
  const order = homeRules.DEFAULT_HOME.order;
  for (const moving of order) for (const target of order) for (const edge of ["before", "after"] as const) {
    const next = homeRules.moveSectionAtEdge(order, moving, target, edge);
    assert.equal(new Set(next).size, order.length);
    if (moving !== target) assert.equal(next.indexOf(moving) - next.indexOf(target), edge === "before" ? -1 : 1);
  }
  assert.deepEqual(homeRules.DEFAULT_HOME.order, order);
});

test("ColorField canónico incluye picker y texto editable, sin borrar inválidos ni omitir AA", async () => {
  const { ColorField } = await import("../components/admin/AdminFields");
  const html = renderToStaticMarkup(createElement(ColorField, { label: "Color de marca", value: "#ff0000", onChange() {} }));
  assert.match(html, /type="color"/); assert.match(html, /type="text"/); assert.match(html, /value="#ff0000"/);
  const invalid = renderToStaticMarkup(createElement(ColorField, { label: "Color de marca", value: "mal", error: "Color inválido", fallbackColor: "#0f766e", onChange() {} }));
  assert.match(invalid, /value="mal"/); assert.match(invalid, /value="#0f766e"/); assert.match(invalid, /aria-invalid="true"/);
  const settings = read("components/admin/modules/AparienciaSettings.tsx");
  assert.match(settings, /<ColorField/); assert.doesNotMatch(settings, /type="color"/);
  assert.match(settings, /adjustBrandColor\(color\)/);
  const presets = /const PRESET_COLORS = \[([^\]]+)\]/.exec(settings)![1].match(/#[0-9a-f]{6}/g)!;
  assert.ok(presets.length >= 20); assert.equal(new Set(presets).size, presets.length);
  for (const color of presets) assert.ok(adjustBrandColor(color).ok);
});

test("layout conserva preview sticky única, fotos en fila y marcador animado con movimiento reducido", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.admin-appearance-preview\s*\{[^}]*position: sticky/);
  assert.match(css, /\.admin-appearance-preview-stage\s*\{[^}]*overflow: auto/);
  assert.match(css, /\.admin-home-inspiration-grid\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.admin-home-photo\[data-slot="editorial"\]\s*\{[^}]*grid-template-columns: 100px/);
  assert.match(css, /\.admin-home-modules \.admin-order-section\[data-drop="before"\]::before/);
  assert.match(css, /\.admin-home-modules \.admin-order-section\[data-drop="after"\]::after/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^\n]*transition: none/);
  assert.match(css, /@media \(max-width: 1099px\)[^\n]*\.admin-appearance-preview \{ position: static/);
});
