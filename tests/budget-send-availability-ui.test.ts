import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { emailValid, normalizeEmail } from "../lib/field-rules";

const text = readFileSync("components/admin/modules/PresupuestosModule.tsx", "utf8");
const source = ts.createSourceFile("module.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean) { let result: ts.Node | undefined; function visit(node: ts.Node) { if (predicate(node)) result = node; ts.forEachChild(node, visit); } visit(source); assert.ok(result); return result; }
function evaluate(text: string, globals: Record<string, unknown>) { return runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, globals); }

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

test("actual review block renders every row before mail with explicit capacity, unknown and shared-group labels", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const copy = await import("../lib/budget-send-availability");
  const element = find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "AdminDialogSection" && node.openingElement.attributes.getText(source).includes('title="Disponibilidad antes de enviar"'));
  const shared = { inventoryId: "stock", sku: "COD-1", requested: 2, covered: 2, groupRequested: 2, groupId: "stock", sharedGroup: true, range: null };
  const availability = { state: "unverified", checkedAt: "2030-01-01T12:00:00Z", range: null, warnings: [], lines: [
    { ...shared, itemId: "a", name: "Mesa completa", state: "available", available: 5, reason: "Comprobado por motor" },
    { ...shared, itemId: "b", name: "Silla por confirmar", state: "unverified", available: null, reason: "Conteo pendiente" },
    { ...shared, itemId: "c", name: "Servicio excluido", state: "excluded", available: null, reason: "No se comprueba" },
  ] };
  const rendered = evaluate(`(${element.getText(source)})`, { React, sendPreview: { availability }, ...copy,
    formatDateTime: (value: string) => value, formatNumber: (value: number) => String(value),
    AdminDialogSection: ({ children }: any) => React.createElement("section", null, children), AdminNote: ({ children }: any) => React.createElement("p", null, children),
    CheckboxField: ({ text }: any) => React.createElement("label", null, text), sendAvailabilityAccepted: false, sendBusy: false, sendAttemptId: null, setSendAvailabilityAccepted() {},
  });
  const html = renderToStaticMarkup(rendered);
  assert.equal((html.match(/<li>/g) ?? []).length, 3);
  assert.match(html, /Mesa completa/); assert.match(html, /Silla por confirmar/); assert.match(html, /Servicio excluido/);
  assert.match(html, /Capacidad para el grupo/); assert.match(html, /Por confirmar/); assert.match(html, /mayor cantidad del grupo \(MAX\)/);
  assert.ok(source.text.indexOf('title="Disponibilidad antes de enviar"') < source.text.indexOf('<AdminMailPreview preview={sendPreview}'));
});
