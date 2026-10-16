import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeBudgetCode, publicConfig, whatsappUrl } from "../lib/public-config";
import { normalizePhone } from "../lib/field-rules";

const text = readFileSync("app/(portal)/_components/PortalCodeForm.tsx", "utf8");
const source = ts.createSourceFile("entry.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(root: ts.Node, predicate: (n: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function visit(n: ts.Node) { if (!found && predicate(n)) found = n; if (!found) ts.forEachChild(n, visit); }
  visit(root); assert.ok(found); return found;
}
function evaluate(code: string, globals: Record<string, unknown>) {
  return runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, globals);
}
const declaration = (name: string) => find(source, n => ts.isFunctionDeclaration(n) && n.name?.text === name);

test("#166 real submit requires code; empty/whitespace never dispatch demo, navigate or fetch", () => {
  for (const value of ["", "   ", "\t\n", "INVALIDO"]) {
    const pushes: string[] = [], errors: string[] = []; let demoCalls = 0, fetchCalls = 0, prevented = 0;
    const submit = evaluate(`(${declaration("submit").getText(source)})`, {
      value, normalizeBudgetCode, setError: (v: string) => errors.push(v), setDemoError: () => {},
      openDemo: () => { demoCalls++; }, fetch: () => { fetchCalls++; }, router: { push: (p: string) => pushes.push(p) },
    });
    submit({ preventDefault: () => { prevented++; } });
    assert.equal(prevented, 1); assert.equal(demoCalls, 0); assert.equal(fetchCalls, 0); assert.deepEqual(pushes, []);
    assert.match(errors[0], value.trim() ? /Revisá el código/ : /Ingresá el código/);
  }
});

test("#166 real valid-code submit still navigates to the normalized private portal path", () => {
  const pushes: string[] = []; let demoCalls = 0;
  const value = "ABCD-EFGH-JKMN-PQRS-TUVW";
  const submit = evaluate(`(${declaration("submit").getText(source)})`, {
    value, normalizeBudgetCode, setError: () => {}, setDemoError: () => {},
    openDemo: () => { demoCalls++; }, router: { push: (p: string) => pushes.push(p) },
  });
  submit({ preventDefault() {} });
  assert.deepEqual(pushes, [`/p/${normalizeBudgetCode(value)}`]); assert.equal(demoCalls, 0);
});

test("#166 the explicit example button retains the real demo fetch and error recovery", async () => {
  const click = find(source, n => ts.isJsxAttribute(n) && n.name.getText(source) === "onClick") as ts.JsxAttribute;
  const pushes: string[] = [], calls: string[] = [], errors: string[] = [], busy: boolean[] = [];
  const openDemo = evaluate(`(${declaration("openDemo").getText(source)})`, {
    DEMO_UNAVAILABLE: "Ejemplo no disponible", setDemoBusy: (v: boolean) => busy.push(v), setError: () => {}, setDemoError: (v: string) => errors.push(v),
    fetch: async (path: string) => { calls.push(path); return { ok: true, json: async () => ({ path: "/p/DEMO" }) }; },
    router: { push: (p: string) => pushes.push(p) },
  });
  // The JSX callback really calls openDemo; the async function itself is awaited separately.
  let explicit = 0;
  evaluate(`(${(click.initializer as ts.JsxExpression).expression!.getText(source)})`, { openDemo: () => { explicit++; } })();
  assert.equal(explicit, 1); await openDemo(); assert.deepEqual(calls, ["/api/portal/demo"]); assert.deepEqual(pushes, ["/p/DEMO"]); assert.deepEqual(busy, [true, false]);
  const failed = evaluate(`(${declaration("openDemo").getText(source)})`, {
    DEMO_UNAVAILABLE: "Ejemplo no disponible", setDemoBusy: () => {}, setError: () => {}, setDemoError: (v: string) => errors.push(v),
    fetch: async () => { throw Error("mock offline"); }, router: { push: (p: string) => pushes.push(p) },
  });
  await failed(); assert.match(errors.at(-1)!, /conectar/); assert.equal(pushes.length, 1);
});

test("#166 both invalid-code views render the same canonical clickable, formatted support number", () => {
  const supportText = readFileSync("app/(portal)/_components/PortalSupportLink.tsx", "utf8");
  const supportSource = ts.createSourceFile("support.tsx", supportText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = find(supportSource, n => ts.isFunctionDeclaration(n) && n.name?.text === "PortalSupportLink");
  const Support = evaluate(`(${fn.getText(supportSource).replace(/^export /, "")})`, { React, publicConfig, whatsappUrl, normalizePhone });
  const expectedLabel = normalizePhone(`+${publicConfig.whatsappNumber.replace(/\D/g, "")}`);
  for (const path of ["app/(portal)/not-found.tsx", "app/(portal)/firma/[codigo]/not-found.tsx"]) {
    const raw = readFileSync(path, "utf8"), ast = ts.createSourceFile(path, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = find(ast, n => ts.isFunctionDeclaration(n));
    const View = evaluate(`(${component.getText(ast).replace(/^export default /, "")})`, { React, PortalSupportLink: Support, Link: "a" });
    const html = renderToStaticMarkup(React.createElement(View));
    assert.match(html, /href="https:\/\/wa\.me\/\d+\?text=/);
    assert.ok(html.includes(`>${expectedLabel}</a>`)); assert.match(html, /rel="noopener noreferrer"/);
  }
});
