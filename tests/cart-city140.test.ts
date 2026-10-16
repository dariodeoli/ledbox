import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import { CITY_OPTIONS } from "../lib/field-rules";

function tree(file: string) { return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function find(root: ts.Node, predicate: (n: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined; function visit(node: ts.Node) { if (!result && predicate(node)) result = node; if (!result) ts.forEachChild(node, visit); } visit(root); assert.ok(result); return result;
}
function evaluate(text: string, globals: Record<string, unknown>) { return runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, globals); }
const cart = tree("components/catalog-public/CartDrawer.tsx");
const fields = tree("components/admin/AdminFields.tsx");
const field = find(cart, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(cart) === "CityField") as ts.JsxSelfClosingElement;
const fieldFunction = find(fields, n => ts.isFunctionDeclaration(n) && n.name?.text === "CityField");
const locationExpression = (find(cart, n => ts.isVariableDeclaration(n) && n.name.getText(cart) === "location") as ts.VariableDeclaration).initializer!;
const submitFunction = find(cart, n => ts.isFunctionDeclaration(n) && n.name?.text === "submit");

test("real CityField selection/clear plus CartDrawer submit never retains a previous department", async () => {
  let city = "", department = ""; const place = "Salón nuevo";
  const writes: any[] = []; const errors: string[] = []; const attempt = { current: null as null | { key: string; payload: string } };
  function handlers() {
    const globals = { setCity: (v: string) => { city = v; }, setDepartment: (v: string) => { department = v; } };
    const prop = (name: string) => {
      const attr = field.attributes.properties.find(n => ts.isJsxAttribute(n) && n.name.getText(cart) === name) as ts.JsxAttribute;
      return evaluate(`(${(attr.initializer as ts.JsxExpression).expression!.getText(cart)})`, globals);
    };
    const CityField = evaluate(`(${fieldFunction.getText(fields).replace(/^export /, "")})`, {
      React, CITY_OPTIONS, Combobox: "combobox", useFieldIds: () => ({}), useSharedInputAttributes: () => null, describedBy: () => undefined,
    });
    return CityField({ value: city, onChange: prop("onChange"), onSelect: prop("onSelect") }).props;
  }
  const send = () => evaluate(`(${submitFunction.getText(cart)})`, {
    range: { fromKey: "2026-11-01", toKey: "2026-11-02" },
    location: evaluate(locationExpression.getText(cart), { place, city, department }),
    askPrice: false, name: "Ana", phone: "+595 981123456", email: "ana@example.test", notes: "", lines: [{ id: "product", quantity: 2 }],
    zone: null, zoneChoice: "", trap: "", attempt, crypto: { randomUUID: () => "fixture-key" },
    setError: (message: string) => errors.push(message), setBusy: () => {},
    props: { preorderPath: "/fixture-only", onDone: () => {} },
    fetch: async (_url: string, request: { body: string }) => { writes.push(JSON.parse(request.body)); return { status: 200, ok: true, json: async () => ({ simulated: true }) }; },
  })({ preventDefault() {} });
  handlers().onChange("Asunción"); assert.equal(city, "Asunción"); assert.equal(department, "Asunción");
  await send(); assert.equal(writes.at(-1).location, "Salón nuevo, Asunción, Asunción", "unmodified selection is preserved");
  handlers().onChange(""); assert.equal(city, ""); assert.equal(department, "");
  await send(); assert.equal(writes.at(-1).location, "Salón nuevo", "clear removes both derived components from submitted location");
  handlers().onChange("Encarnación"); assert.equal(city, "Encarnación"); assert.equal(department, "Itapúa");
  await send(); assert.equal(writes.at(-1).location, "Salón nuevo, Encarnación, Itapúa");
  assert.deepEqual(errors, ["", "", ""]);
});
