import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { dateShortcuts } from "../lib/date-shortcuts";
import { dayInputText, maskDayInput, parseDayInput } from "../lib/admin-format";
Object.assign(globalThis, { React });
const now = new Date("2026-10-15T16:00:00Z");

test("Hoy usa día civil Asunción; offsets cruzan mes/año y bisiesto sin sumar horas", () => {
  assert.deepEqual(dateShortcuts({ now: new Date("2026-10-15T01:30:00Z") }).map(x => x.day), ["2026-10-14", "2026-10-15", "2026-10-16"]);
  assert.equal(dateShortcuts({ now: new Date("2026-10-15T03:01:00Z") })[0].day, "2026-10-15");
  assert.deepEqual(dateShortcuts({ now: new Date("2026-12-31T16:00:00Z") }).map(x => x.day), ["2026-12-31", "2027-01-01", "2027-01-02"]);
  assert.deepEqual(dateShortcuts({ now: new Date("2028-02-28T16:00:00Z") }).map(x => x.day), ["2028-02-28", "2028-02-29", "2028-03-01"]);
});
test("cada atajo tiene fecha exacta y respeta min/max inclusivos sin alterar valor ni límites", () => {
  const options = dateShortcuts({ now, min: "2026-10-16", max: "2026-10-16" });
  assert.deepEqual(options.map(x => [x.label, x.dateLabel, x.allowed]), [["Hoy", "15/10/2026", false], ["Mañana", "16/10/2026", true], ["Pasado mañana", "17/10/2026", false]]);
  assert.ok(dateShortcuts({ now, min: "fecha inválida", max: "2026-02-30" }).every(x => x.allowed), "límites nativos inválidos no restringen el calendario");
});
test("datetime conserva hora/segundos; vacío usa 00:00 y compara límites por precisión equivalente", () => {
  assert.equal(dateShortcuts({ now, kind: "datetime-local", value: "2020-01-01T23:40:05.123" })[1].value, "2026-10-16T23:40:05.123");
  assert.equal(dateShortcuts({ now, kind: "datetime-local" })[0].value, "2026-10-15T00:00");
  assert.equal(dateShortcuts({ now, kind: "datetime-local", value: "2026-10-15T09:00:00", min: "2026-10-15T09:00", max: "2026-10-15T09:00" })[0].allowed, true);
  assert.equal(dateShortcuts({ now, kind: "datetime-local", value: "2026-10-15T08:59", min: "2026-10-15T09:00" })[0].allowed, false);
});

type Node = { type: unknown; props: Record<string, any> };
const all = (node: any): Node[] => Array.isArray(node) ? node.flatMap(all) : node?.props ? [node, ...all(node.props.children)] : [];
const file = ts.createSourceFile("AdminFields.tsx", readFileSync("components/admin/AdminFields.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actual(name: string, extras: Record<string, unknown> = {}) {
  const declaration = file.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.ok(declaration);
  return runInNewContext(ts.transpileModule(declaration.getText(file).replace(/^export /, "") + `\n${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, {
    React: { createElement: (type: unknown, props: object, ...children: unknown[]) => ({ type, props: { ...props, children } }) },
    useState: (value: any) => [typeof value === "function" ? value() : value, () => {}],
    dateShortcuts: (props: Parameters<typeof dateShortcuts>[0]) => dateShortcuts({ ...props, now }), ...extras,
  });
}
test("botones reales son no-submit, accesibles, deshabilitados por rango/estado; sólo clic cambia fecha", () => {
  const changes: string[] = [];
  const render = actual("DateShortcuts");
  let tree = render({ kind: "date", value: "", min: "2026-10-16", max: "2026-10-16", label: "Fecha del evento", onChange: (value: string) => changes.push(value) });
  assert.equal(changes.length, 0);
  const buttons = all(tree).filter(n => n.type === "button");
  assert.equal(buttons.length, 3); assert.equal(buttons[1].props.type, "button"); assert.equal(buttons[1].props["aria-label"], "Mañana, 16/10/2026");
  buttons[0].props.onClick(); assert.equal(changes.length, 0);
  buttons[1].props.onClick(); assert.deepEqual(changes, ["2026-10-16"]);
  tree = render({ kind: "date", value: "", disabled: true, label: "Evento", onChange: (value: string) => changes.push(value) });
  for (const button of all(tree).filter(n => n.type === "button")) { assert.equal(button.props.disabled, true); button.props.onClick(); }
  assert.equal(changes.length, 1);
});
test("DayField limpia error/texto inválido al elegir fecha rápida y conserva la edición exacta manual", () => {
  const states: any[] = []; let index = 0;
  const changes: string[] = [];
  const render = actual("DayField", { dayInputText, maskDayInput, parseDayInput, SharedInput: "input", DateShortcuts: "shortcuts", FieldChrome: "field", describedBy: () => undefined, useFieldIds: () => ({ fieldId: "date", hintId: "hint", errorId: "error" }), useEffect() {}, useState(initial: any) { const i = index++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], (value: any) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; } });
  const props = { label: "Fecha", value: "2026-10-16", min: "2026-10-16", shortcuts: true, onChange: (value: string) => changes.push(value) };
  const draw = () => { index = 0; return render(props); };
  let tree = draw(); all(tree).find(n => n.type === "input")!.props.onChange({ target: { value: "15/10/2026" } });
  tree = draw(); assert.match(tree.props.error, /anterior/);
  all(tree).find(n => n.type === "shortcuts")!.props.onChange("2026-10-16");
  tree = draw(); assert.equal(tree.props.error, ""); assert.equal(all(tree).find(n => n.type === "input")!.props.value, "16/10/2026");
  all(tree).find(n => n.type === "input")!.props.onChange({ target: { value: "18/10/2026" } }); assert.deepEqual(changes, ["2026-10-18"]);
});
test("SSR canónico: opt-in no afecta fechas normales, nacimiento/horas; entrada exacta sigue accesible", async () => {
  const { DateField, DateTimeField, TimeField, DayField } = await import("../components/admin/AdminFields");
  const options = { label: "Fecha", value: "", onChange() {} };
  for (const Field of [DateField, DateTimeField, DayField]) {
    assert.doesNotMatch(renderToStaticMarkup(createElement(Field, options)), /Fechas rápidas/);
    const html = renderToStaticMarkup(createElement(Field, { ...options, shortcuts: true, disabled: true }));
    assert.match(html, /Fechas rápidas para fecha/); assert.equal((html.match(/type="button"/g) ?? []).length, 3); assert.match(html, /disabled=""/);
  }
  assert.doesNotMatch(renderToStaticMarkup(createElement(TimeField, options)), /Fechas rápidas/);
});
test("activación revalida día civil y límites si se cruza medianoche con la página abierta", () => {
  let clock = new Date("2026-10-15T02:59:00Z");
  const changes: string[] = [];
  const render = actual("DateShortcuts", { dateShortcuts: (props: Parameters<typeof dateShortcuts>[0]) => dateShortcuts({ ...props, now: clock }) });
  const props = { kind: "date", value: "", label: "Evento", onChange: (value: string) => changes.push(value) };
  const tree = render(props);
  clock = new Date("2026-10-15T03:01:00Z");
  all(tree).find(n => n.type === "button")!.props.onClick(); assert.deepEqual(changes, ["2026-10-15"]);
  clock = new Date("2026-10-15T02:59:00Z");
  const bounded = render({ ...props, max: "2026-10-14" });
  clock = new Date("2026-10-15T03:01:00Z");
  all(bounded).find(n => n.type === "button")!.props.onClick(); assert.equal(changes.length, 1, "un atajo mostrado válido no salta un max que ya no cumple");
});
test("volver a enfocar/usar atajos refresca el reloj sin cambiar la fecha del formulario", () => {
  let refreshes = 0;
  const changes: string[] = [];
  const render = actual("DateShortcuts", { useState: () => [now, () => { refreshes++; }] });
  const tree = render({ kind: "date", value: "", label: "Evento", onChange: (value: string) => changes.push(value) });
  for (const action of ["onFocusCapture", "onPointerEnter", "onPointerDownCapture", "onKeyDownCapture"]) tree.props[action]();
  assert.equal(refreshes, 4); assert.equal(changes.length, 0);
});

test("sólo teclado puede refrescar atajos todos fuera de rango al cruzar medianoche", () => {
  let clock = "2026-10-15T02:59:59.999Z";
  let state: Date | undefined;
  class ClockDate extends Date { constructor() { super(clock); } }
  const changes: string[] = [];
  const render = actual("DateShortcuts", {
    Date: ClockDate,
    dateShortcuts: (props: Parameters<typeof dateShortcuts>[0]) => dateShortcuts({ ...props, now: props?.now ?? new Date(clock) }),
    useState: (initial: () => Date) => { state ??= initial(); return [state, (next: Date) => { state = next; }]; },
  });
  const props = { kind: "date", value: "", min: "2026-10-17", label: "Fecha del evento", onChange: (next: string) => changes.push(next) };
  let tree = render(props);
  assert.equal(tree.props.tabIndex, 0); assert.ok(all(tree).filter(n => n.type === "button").every(n => n.props.disabled));
  clock = "2026-10-15T03:00:00.001Z";
  tree.props.onFocusCapture(); tree = render(props);
  assert.equal(tree.props.tabIndex, undefined);
  const buttons = all(tree).filter(n => n.type === "button");
  assert.equal(buttons[2].props.disabled, false); assert.equal(changes.length, 0);
  buttons[2].props.onClick(); assert.deepEqual(changes, ["2026-10-17"]);
  const disabled = render({ ...props, disabled: true }); assert.equal(disabled.props.tabIndex, undefined);
});
