import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { emailValid, normalizeEmail } from "../lib/field-rules";

const text = readFileSync("components/admin/modules/PresupuestosModule.tsx", "utf8");
const source = ts.createSourceFile("module.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean) { let result: ts.Node | undefined; function visit(node: ts.Node) { if (predicate(node)) result = node; ts.forEachChild(node, visit); } visit(source); assert.ok(result); return result; }
function evaluate(text: string, globals: Record<string, unknown>) { return runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, globals); }

test("actual send button requires independent consent only for a warned preview; receipt recovery remains usable", () => {
  const button = find(node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.attributes.getText(source).includes('onClick={() => void sendBudgetMail()}')) as ts.JsxOpeningElement;
  const attr = button.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(source) === "disabled") as ts.JsxAttribute;
  const expression = (attr.initializer as ts.JsxExpression).expression!.getText(source);
  const base = { sendAttemptId: null, sendBudget: { publicToken: "token" }, emailValid, sendTo: "ana@example.invalid", sendDatesDirty: false, linkBusy: false, sendDatesBusy: false, sendPreview: { availability: { state: "unverified" } }, sendAvailabilityAccepted: false };
  assert.equal(evaluate(expression, base), true);
  assert.equal(evaluate(expression, { ...base, sendAvailabilityAccepted: true }), false);
  assert.equal(evaluate(expression, { ...base, sendPreview: { availability: { state: "available" } } }), false);
  assert.equal(evaluate(expression, { ...base, sendAttemptId: "receipt" }), false);
});

test("actual confirmation preserves the receipt and draft on a preflight conflict, including another-tab races", async () => {
  const fn = find(node => ts.isFunctionDeclaration(node) && node.name?.text === "sendBudgetMail");
  const remembered: unknown[] = [], errors: string[] = [], requests: any[] = [], previews: any[] = [];
  const inFlight = { current: false };
  const submit = evaluate(`(${fn.getText(source)})`, {
    sendBudget: { id: "budget" }, linkBusy: false, sendDatesInFlight: { current: false }, mailInFlight: inFlight,
    sendAttemptId: null, sendDatesDirty: false, sendTo: "ana@example.invalid", sendMessage: "Keep my draft", normalizeEmail, emailValid,
    sendPreview: { confirmationToken: "signed", attemptId: "receipt", availability: { state: "shortage" } }, sendAvailabilityAccepted: true,
    rememberSendAttempt: (value: unknown) => remembered.push(value), setSendBusy: () => {}, setSendError: (value: string) => errors.push(value), setSendPreview: (value: unknown) => previews.push(value),
    adminSend: async (path: string, body: unknown) => { requests.push({ path, body }); return { ok: false, code: "availability_preview_required", error: "Stock changed" }; },
  });
  await submit();
  assert.deepEqual(remembered, ["receipt"], "never delete recovery metadata just because this request did not reach the claim");
  assert.equal(previews.length, 0); assert.equal(inFlight.current, false); assert.equal(errors.at(-1), "Stock changed");
  assert.equal(requests.length, 1); assert.equal(requests[0].body.acceptAvailabilityWarnings, true); assert.equal(requests[0].body.message, "Keep my draft");
});
