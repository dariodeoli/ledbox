import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import * as rules from "../lib/quantity-control";

const native = createRequire(import.meta.url);
const NumberField = () => null;
function harness(extra: Record<string, unknown> = {}) {
  let cursor = 0; const states: unknown[] = []; const changes: number[] = [];
  const exports: any = {};
  const hooks = { ...React, useEffect() {}, useState(initial: unknown) {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [states[index], (next: unknown) => { states[index] = next; }];
  } };
  const mocks: Record<string, unknown> = { react: hooks, "@/components/admin/AdminFields": { NumberField }, "@/lib/quantity-control": rules, "./StoreIcons": { XIcon: () => null } };
  runInNewContext(ts.transpileModule(readFileSync("components/catalog-public/Stepper.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: (id: string) => mocks[id] ?? native(id) });
  const props = { label: "Cantidad", value: 3, min: 1, max: 99, editable: true, onChange: (next: number) => { changes.push(next); props.value = next; }, ...extra };
  const render = () => { cursor = 0; return exports.Stepper(props); };
  const field = () => React.Children.toArray(render().props.children).find((node: any) => node.type === NumberField) as React.ReactElement<any>;
  const buttons = () => React.Children.toArray(render().props.children).filter((node: any) => node.type === "button") as React.ReactElement<any>[];
  return { field, buttons, props, changes };
}

test("blank editing leaves persisted quantity intact and blur restores it; invalid/overflow text never commits", () => {
  const h = harness();
  h.field().props.onChange(""); assert.equal(h.field().props.value, ""); assert.deepEqual(h.changes, []);
  h.field().props.onBlur(); assert.equal(h.field().props.value, "3");
  for (const invalid of ["1.5", "-2", "1e3", "9007199254740992"]) h.field().props.onChange(invalid);
  assert.deepEqual(h.changes, []); assert.equal(h.field().props.value, "3");
  h.field().props.onChange("120"); assert.deepEqual(h.changes, [99]); assert.equal(h.field().props.value, "99");
});

test("native-number keyboard arrows still step, clamp and prevent cursor-only arrow behavior", () => {
  const h = harness({ value: 90, max: 99, step: 10 }); let prevented = 0;
  h.field().props.onKeyDown({ key: "ArrowUp", preventDefault() { prevented++; } });
  assert.deepEqual(h.changes, [99]);
  h.field().props.onKeyDown({ key: "ArrowDown", preventDefault() { prevented++; } });
  assert.deepEqual(h.changes, [99, 89]); assert.equal(prevented, 2);
});

test("disabled and readOnly reject typing, clicks and keyboard callbacks", () => {
  for (const flag of ["disabled", "readOnly"]) {
    const h = harness({ [flag]: true });
    h.field().props.onChange("10");
    h.buttons()[1].props.onClick();
    h.field().props.onKeyDown({ key: "ArrowUp", preventDefault() { throw new Error("locked input must not step"); } });
    assert.deepEqual(h.changes, []);
    assert.equal(h.buttons()[0].props.disabled, true); assert.equal(h.buttons()[1].props.disabled, true);
  }
});

test("portal delta callback keeps rapid consecutive clicks on latest parent state", () => {
  let current = 1;
  const h = harness({ value: 1, max: 999, onStep(delta: number) { current = rules.stepQuantity(current, delta, 1, 999); } });
  const plus = h.buttons()[1]; plus.props.onClick(); plus.props.onClick(); plus.props.onClick();
  assert.equal(current, 4); assert.deepEqual(h.changes, []);
});
