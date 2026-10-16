import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import * as ui from "owncoding-ui";
import * as rules from "../lib/field-rules";

const portal = ts.createSourceFile("portal.tsx", readFileSync("app/(portal)/_components/PortalBudgetView.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fields = ts.createSourceFile("fields.tsx", readFileSync("components/admin/AdminFields.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] { const found: ts.Node[] = []; function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); } visit(root); return found; }
function evaluate(text: string, globals: Record<string, any>) { return runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, globals); }
function declaration(file: ts.SourceFile, name: string) { return nodes(file, n => ts.isFunctionDeclaration(n) && n.name?.text === name)[0].getText(file).replace(/^export /, ""); }
const math = ["discountRaw", "discountNumber", "discountError", "discountAmount", "discountTotal"].map(name => nodes(portal, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(portal) === name))[0].getText(portal)).join("\n");
const choice = nodes(portal, n => ts.isConditionalExpression(n) && n.whenTrue.getText(portal).includes("<PercentField ") && n.whenFalse.getText(portal).includes("<MoneyField "))[0];
const Money = Symbol("canonical money"), Percent = Symbol("canonical percent");
const budget = { subtotal: 2_000_000, total: 2_200_000 };
const treeNodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(treeNodes) : node?.props ? [node, ...treeNodes(node.props.children)] : [];
function control(kind: string, onChange: (value: string) => void) { return evaluate(`(${choice.getText(portal)});`, { React, discountType: kind, discountValue: "", discountError: null, budget, setDiscountValue: onChange, MoneyField: Money, PercentField: Percent }); }
function amounts(kind: string, value: string) { return evaluate(`${math}\n({discountRaw,discountNumber,discountError,discountAmount,discountTotal});`, { discountType: kind, discountValue: value, budget, formatMoney: String }); }
async function submit(kind: string, value: string, note = "Cliente habitual") {
  const posted: any[] = [], errors: string[] = [], sending: boolean[] = [];
  const run = evaluate(`${declaration(portal, "runAction")}\nrunAction;`, { ...amounts(kind, value), discountType: kind, discountValue: value, actionMode: "discount", budget, name: "Ana Pérez", note, demo: false, setSending: (value: boolean) => sending.push(value), setActionError: (value: string) => errors.push(value), postPortal: async (...args: any[]) => { posted.push(args); return {}; }, setJustRequested() {}, setNote() {}, router: { refresh() {} } });
  await run({ preventDefault() {} }); return { posted, errors, sending };
}
function canonical(name: string, ref: object) {
  let refAt = 0;
  return evaluate(`${declaration(fields, name)}\n${name};`, { React, ...rules, useFieldIds: () => ({ fieldId: "discount", hintId: "hint", errorId: "error" }), useRef: (initial: any) => ({ current: refAt++ === 0 ? { querySelector: () => ref } : initial }), useEffect() {}, FieldChrome: "field", describedBy: () => undefined, MoneyInput: ui.MoneyInput, SharedPercentField: ui.PercentField });
}

test("portal amount uses canonical capture and sends same proposed amount, name and reason", async () => {
  let raw = "";
  const selected = control("amount", value => { raw = value; });
  assert.equal(selected.type, Money); assert.equal(selected.props.limit, budget.subtotal);
  assert.equal(selected.props.id, "portal-discount-value"); assert.equal(selected.props.name, "discount-value"); assert.equal(selected.props.required, true);
  const input = { value: "Gs. 1.200.000" };
  const rendered = canonical("MoneyField", input)(selected.props);
  const wrapper = treeNodes(rendered).find(n => n.props.onInputCapture);
  wrapper.props.onInputCapture({ target: input });
  // The library clears this DOM value for this paste before invoking the canonical callback.
  input.value = "";
  treeNodes(rendered).find(n => n.type === ui.MoneyInput).props.onValueChange("");
  assert.equal(raw, "1200000");
  const result = amounts("amount", raw); assert.equal(result.discountAmount, 1_200_000); assert.equal(result.discountTotal, 1_000_000);
  const sent = await submit("amount", raw);
  assert.equal(sent.posted.length, 1); assert.equal(sent.posted[0][0], "propose");
  assert.equal(JSON.stringify(sent.posted[0][1]), JSON.stringify({ kind: "discount", name: "Ana Pérez", note: "Cliente habitual", discount: { type: "amount", value: 1_200_000 } }));
  assert.deepEqual(sent.sending, [true, false]);
});

test("portal percent uses actual shared percent input and preserves decimal percentage in payload", async () => {
  let raw = "";
  const selected = control("percent", value => { raw = value; });
  assert.equal(selected.type, Percent); assert.equal(selected.props.name, "discount-value");
  const rendered = canonical("PercentField", {})(selected.props);
  const percentProps = treeNodes(rendered).find(n => n.type === ui.PercentField).props;
  const code = String(ui.PercentField);
  const ns = { ...ui, jsx: (type: any, props: any) => ({ type, props }), cn: () => "" };
  const aliases = Object.fromEntries([...new Set(code.match(/\bimport_\w+/g) ?? [])].map(name => [name, ns]));
  const actual = runInNewContext(`(${code})`, { ...ui, ...aliases, jsx3: ns.jsx, Input: "input", __name: (fn: any) => fn, TAMANOS_CAMPO: { porcentaje: "" } });
  actual(percentProps).props.onChange({ target: { value: "10,25" } });
  assert.equal(raw, "10,25"); assert.equal(amounts("percent", raw).discountAmount, 205_000);
  const sent = await submit("percent", raw);
  assert.equal(JSON.stringify(sent.posted[0][1].discount), JSON.stringify({ type: "percent", value: 10.25 }));
});

test("portal still blocks blank/zero, excessive percentages/subtotal and missing reason before posting", async () => {
  for (const [kind, value, note] of [["amount", "", "Motivo"], ["amount", "0", "Motivo"], ["amount", "2000001", "Motivo"], ["percent", "100,01", "Motivo"], ["percent", "0", "Motivo"], ["percent", "10", ""]]) {
    const result = await submit(kind, value, note);
    assert.equal(result.posted.length, 0, `${kind}/${value}`); assert.ok(result.errors.some(Boolean)); assert.equal(result.sending.at(-1), false);
  }
});
