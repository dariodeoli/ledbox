import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import { integerDraft } from "../lib/quantity-control";
import { snapshotFromProduct } from "../lib/price-tiers";
import { counterofferDraft, originalCounterofferDraft, counterofferDraftExclusion, counterofferDraftSubtotal, resolveCounterofferDraft, type CounterofferDraft } from "../lib/counteroffer-draft";

const admin = readFileSync("components/admin/modules/PresupuestosModule.tsx", "utf8");
const source = ts.createSourceFile("module.tsx", admin, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(root: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node[] {
  const found: ts.Node[] = []; function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); } visit(root); return found;
}
function evaluate(text: string, globals: Record<string, unknown>) {
  return runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, globals);
}
function numberField(props: Record<string, unknown>) {
  const text = readFileSync("components/admin/AdminFields.tsx", "utf8");
  const ast = ts.createSourceFile("fields.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = nodes(ast, node => ts.isFunctionDeclaration(node) && node.name?.text === "NumberField")[0]!;
  const render = evaluate(`(${declaration.getText(ast).replace(/^export /, "")})`, {
    React, FieldChrome: "chrome", SharedInput: "shared-input", integerDraft,
    digitsOnly: (value: string) => value.replace(/\D/g, ""), useFieldIds: () => ({}), describedBy: () => undefined,
  });
  return render(props).props.children;
}
const items = [{ id: "a", name: "Mesa", quantity: 2, days: 3, unitPrice: 1000 }, { id: "b", name: "Silla", quantity: 1, days: 1, unitPrice: 500 }];

test("actual NumberField plus counteroffer onChange preserves blank and rejects malformed quantities", () => {
  const opening = nodes(source, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "NumberField" && node.attributes.getText(source).includes("Cantidad propuesta"))[0] as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  assert.ok(opening.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "strictInteger"));
  const change = opening.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "onChange") as ts.JsxAttribute;
  let drafts: Record<string, CounterofferDraft> = { a: counterofferDraft(items[0]) };
  const callback = evaluate(`(${(change.initializer as ts.JsxExpression).expression!.getText(source)})`, {
    item: items[0], proposed: drafts.a, setCounterItems: (update: (current: typeof drafts) => typeof drafts) => { drafts = update(drafts); },
  });
  const input = numberField({ value: "2", strictInteger: true, onChange: callback });
  for (const value of ["-2", "+2", "1.5", "1,5", "1e3", "1.000", " 2 "]) {
    input.props.onChange({ target: { value } }); assert.equal(drafts.a.quantity, "2", value);
  }
  input.props.onChange({ target: { value: "" } }); assert.equal(drafts.a.quantity, "");
  assert.equal(resolveCounterofferDraft(items, drafts).ok, false);
  assert.equal(counterofferDraftSubtotal(items, drafts), null);
  input.props.onChange({ target: { value: "00012" } }); assert.equal(drafts.a.quantity, "12");
  assert.equal(resolveCounterofferDraft(items, drafts).ok, true);
  input.props.onChange({ target: { value: "0" } }); assert.equal(drafts.a.quantity, "0"); assert.equal(resolveCounterofferDraft(items, drafts).ok, false);
  const legacy: string[] = []; numberField({ value: "", onChange: (v: string) => legacy.push(v) }).props.onChange({ target: { value: "1,5" } });
  assert.deepEqual(legacy, ["15"], "default contract is unchanged for consumers with other semantics");
});

test("actual submitResolution blocks blank drafts before adminSend and sends canonical numeric reentry", async () => {
  const fn = nodes(source, node => ts.isFunctionDeclaration(node) && node.name?.text === "submitResolution")[0]!;
  const requests: unknown[] = []; const errors: string[] = [];
  let drafts = { a: { quantity: "", days: "3" } };
  const submit = () => evaluate(`(${fn.getText(source)})`, {
    resolution: { decision: "accept", request: { id: "request", kind: "items", budget: { items } } }, note: "", counterItems: drafts,
    resolveCounterofferDraft, setDialogBusy: () => {}, setDialogError: (message: string) => errors.push(message),
    adminSend: async (url: string, body: unknown) => { requests.push({ url, body }); return { ok: false, error: "stub stop" }; },
  })();
  await submit(); assert.equal(requests.length, 0); assert.match(errors.at(-1)!, /Completá/);
  drafts = { a: { quantity: "12", days: "3" } }; await submit();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ url: "/api/admin/budgets/requests", body: { requestId: "request", decision: "accept", counter: { items: [{ id: "a", quantity: 12, days: 3, excluded: false }] } } }]);
});

test("TOTAL snapshots, manual prices and EVENT keep canonical rental days, exclusion and subtotals", () => {
  const snapshot = snapshotFromProduct({ basePrice: 100_000, tiers: [{ fromDays: 3, mode: "TOTAL", price: 250_000 }] }, "RETAIL", 3);
  const total = { ...items[0], days: 1, unitPrice: 250_000, pricingSnapshot: snapshot };
  const originals = [total, items[1]];
  assert.equal(originalCounterofferDraft(total).days, "3");
  assert.equal(counterofferDraftSubtotal(originals, {}), 500_500);
  const removed = counterofferDraftExclusion(total, { quantity: "", days: "" }, true);
  assert.deepEqual(removed, { quantity: "2", days: "3", excluded: true });
  assert.equal(resolveCounterofferDraft(originals, { a: removed }).ok, true);
  const restored = counterofferDraftExclusion(total, removed, false);
  assert.equal(resolveCounterofferDraft(originals, { a: restored }).ok, true);
  assert.equal(counterofferDraftSubtotal([total], { a: { quantity: "1", days: "2" } }), 200_000);
  const manual = { ...total, unitPrice: 240_000 }; assert.equal(originalCounterofferDraft(manual).days, "1");
  assert.equal(counterofferDraftSubtotal([manual], { a: { quantity: "2", days: "3" } }), 1_440_000);
  const event = { ...items[0], days: 1, billingUnit: "EVENT" }; assert.equal(counterofferDraftSubtotal([event], { a: { quantity: "2", days: "5" } }), 2000);
  const resolved = resolveCounterofferDraft([event], { a: { quantity: "2", days: "5" } });
  assert.ok(resolved.ok); if (resolved.ok) assert.equal(resolved.value[0].days, 1);
  for (const bad of ["-2", "1.5", "1e3", "", "9007199254740993", "1000"]) assert.equal(resolveCounterofferDraft(items, { a: { quantity: bad, days: "3" } }).ok, false, bad);
});

test("actual GET request projection supplies snapshot/billing to validate a legitimate TOTAL exclusion", () => {
  const text = readFileSync("app/api/admin/budgets/route.ts", "utf8");
  const route = ts.createSourceFile("route.ts", text, ts.ScriptTarget.Latest, true);
  const query = nodes(route, node => ts.isCallExpression(node) && node.expression.getText(route) === "db.budgetChangeRequest.findMany")[0] as ts.CallExpression;
  const options = evaluate(`(${query.arguments[0].getText(route)})`, { organizationId: "tenant", CLIENT_IDENTITY_SELECT: {} });
  assert.equal(options.where.organizationId, "tenant");
  const select = options.include.budget.select.items.select;
  const snapshot = snapshotFromProduct({ basePrice: 100_000, tiers: [{ fromDays: 3, mode: "TOTAL", price: 250_000 }] }, "RETAIL", 3);
  const stored = { ...items[0], days: 1, unitPrice: 250_000, pricingSnapshot: snapshot, inventory: { billingUnit: "DAILY", costPrice: 999 }, costPrice: 999 };
  function project(row: Record<string, any>, fields: Record<string, any>): Record<string, any> {
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value === true ? row[key] : row[key] == null ? row[key] : project(row[key], value.select)]));
  }
  const dto = project(stored, select) as typeof stored;
  assert.ok(dto.pricingSnapshot); assert.deepEqual(dto.inventory, { billingUnit: "DAILY" }); assert.equal(dto.costPrice, undefined);
  const removed = counterofferDraftExclusion(dto, { quantity: "5", days: "4" }, true);
  assert.equal(resolveCounterofferDraft([dto, items[1]], { a: removed }).ok, true);
  const incomplete = { ...dto, pricingSnapshot: undefined };
  assert.equal(resolveCounterofferDraft([incomplete, items[1]], { a: removed }).ok, false, "old DTO loses the rental days and blocks this legitimate exclusion");
  const event = project({ ...stored, days: 1, pricingSnapshot: null, inventory: { billingUnit: "EVENT" } }, select) as typeof stored;
  assert.equal(counterofferDraftSubtotal([event], { a: { quantity: "2", days: "9" } }), 500_000);
});

// El API entrega las líneas vivas, incluso después de resolver una solicitud.
test("request summary labels current values without inventing an original after acceptance", () => {
  const fn = nodes(source, node => ts.isFunctionDeclaration(node) && node.name?.text === "requestDelta")[0]!;
  const summarize = evaluate(`(${fn.getText(source)})`, { formatNumber: String, formatMoney: String });
  const request = { kind: "items", status: "accepted", payload: { items: [{ id: "a", quantity: 3, days: 1 }] }, budget: { items: [{ id: "a", name: "Mesa", quantity: 4, days: 1 }] } };
  assert.equal(summarize(request), "Mesa: actual 4 × 1 d · cliente pidió 3 × 1 d");
  request.status = "pending";
  assert.equal(summarize(request), "Mesa: actual 4 × 1 d · cliente pidió 3 × 1 d");
});
