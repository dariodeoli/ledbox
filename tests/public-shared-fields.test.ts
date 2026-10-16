import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as ui from "owncoding-ui";
import * as priceRules from "../lib/price-request";
import * as alta from "../lib/platform/alta-empresa";
import { PREORDER_COPY } from "../lib/storefront-ui";
const native = createRequire(import.meta.url);
function source(path: string, mocks: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, require: (id: string) => mocks[id] ?? native(id), ...globals });
  return exports;
}
function find(node: any, predicate: (node: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) { const result = find(child, predicate); if (result) return result; }
  return null;
}
function hooks() {
  let at = 0; const values: any[] = [];
  return { reset: () => { at = 0; }, react: { ...React, useState: (initial: any) => { const i = at++; if (!(i in values)) values[i] = typeof initial === "function" ? initial() : initial; return [values[i], (next: any) => { values[i] = typeof next === "function" ? next(values[i]) : next; }]; } } };
}

test("server GET filter renders actual shared native controls; preserves query and omits pagination/detail", () => {
  const { FilterForm } = source("components/platform/FilterForm.tsx", { "@/components/admin/AdminIcons": { AdminIcon: () => null } });
  const html = renderToStaticMarkup(React.createElement(FilterForm, { basePath: "/superadmin/empresas", current: { q: "old", pag: "8", detalle: "org", periodo: "7d", orden: "-alta", plan: "a" }, q: "Luz & sonido", searchLabel: "Buscar empresas", filters: [{ name: "plan", label: "Plan", value: "b", options: [{ value: "a", label: "Inicial" }, { value: "b", label: "Profesional" }] }] }));
  assert.match(html, /method="get"/); assert.match(html, /action="\/superadmin\/empresas"/);
  assert.match(html, /name="q"[^>]*value="Luz &amp; sonido"/);
  assert.match(html, /name="periodo" value="7d"/); assert.match(html, /name="orden" value="-alta"/);
  assert.doesNotMatch(html, /name="(?:pag|detalle)"/); assert.equal((html.match(/name="plan"/g) ?? []).length, 1);
  assert.match(html, /value="b" selected=""/); assert.equal((html.match(/data-oc-control=""/g) ?? []).length, 2);
});

test("shared phone adapter keeps landlines, country changes and native national name/autofill", () => {
  const { PhonePartsField } = source("components/fields/PhonePartsField.tsx");
  let phone = ""; let country = "";
  const element = PhonePartsField({ countryCode: "+595", phone: "021123456", name: "phone", required: true, onChange: (value: string) => { phone = value; }, onCountryCodeChange: (value: string) => { country = value; } });
  find(element, n => n.type === ui.Input).props.onChange({ target: { value: "021 123-456" } });
  find(element, n => n.type === ui.Select).props.onChange({ target: { value: "+54" } });
  assert.equal(phone, "021123456"); assert.equal(country, "+54");
  const html = renderToStaticMarkup(element);
  assert.match(html, /name="phone"/); assert.match(html, /autoComplete="tel-national"/); assert.match(html, /value="021123456"/);
  assert.doesNotMatch(html, /aria-invalid="true"/); assert.match(html, /required=""/);
});

test("price request uses money domain control; raw normalized amount and note reach unchanged endpoint", async () => {
  const state = hooks(); let sent: any; let reloaded = 0;
  const { PriceRequestForm } = source("components/catalog-public/PriceRequestForm.tsx", { react: state.react, "@/lib/price-request": priceRules, "@/lib/storefront-ui": { PREORDER_COPY } }, { fetch: async (url: string, options: any) => { sent = { url, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({}) }; }, window: { location: { reload: () => { reloaded++; } } } });
  const render = () => { state.reset(); return PriceRequestForm({ token: "token/fixture", total: 2_000_000 }); };
  render().props.onClick(); let form = render();
  const money = find(form, n => n.type === ui.MoneyInput); assert.ok(money); assert.equal(money.props.currency, "PYG"); assert.equal(money.props.integerOnly, true);
  money.props.onValueChange("1200000"); find(form, n => n.type === ui.Textarea).props.onChange({ target: { value: "Cliente frecuente" } });
  form = render(); await form.props.onSubmit({ preventDefault() {} });
  assert.equal(sent.url, "/api/pedido/token%2Ffixture/price-request"); assert.deepEqual(sent.body, { comment: "Cliente frecuente", desiredAmount: "1200000" }); assert.equal(reloaded, 1);
});

test("price request still blocks invalid or excessive proposals before any request", async () => {
  const state = hooks(); let calls = 0;
  const { PriceRequestForm } = source("components/catalog-public/PriceRequestForm.tsx", { react: state.react, "@/lib/price-request": priceRules, "@/lib/storefront-ui": { PREORDER_COPY } }, { fetch: async () => { calls++; throw new Error("must not request"); } });
  const render = () => { state.reset(); return PriceRequestForm({ token: "fixture", total: 1000 }); };
  render().props.onClick(); let form = render();
  find(form, n => n.type === ui.Textarea).props.onChange({ target: { value: "Descuento habitual" } }); find(form, n => n.type === ui.MoneyInput).props.onValueChange("1200");
  form = render(); await form.props.onSubmit({ preventDefault() {} }); assert.equal(calls, 0); assert.match(renderToStaticMarkup(render()), /menor al total/);
});

test("access gate email domain callback and text controls retain autofill and anti-bot contract", () => {
  const state = hooks();
  const { AccessGate } = source("components/catalog-public/AccessGate.tsx", { react: state.react, "@/lib/catalog-access-mode": { ACCESS_REQUEST_KINDS: ["RETAIL"], ACCESS_REQUEST_KIND_LABEL: { RETAIL: "Cliente final" } } });
  const props = { mode: "REQUEST", organizationName: "Fixture", endpoint: "/api/fixture", demo: false, whatsappUrl: null };
  const render = () => { state.reset(); return AccessGate(props); };
  find(render(), n => n.type === ui.EmailField).props.onChange("persona@example.com");
  const html = renderToStaticMarkup(render()); assert.match(html, /name="email"/); assert.match(html, /value="persona@example.com"/); assert.match(html, /autoComplete="email"/);
  assert.match(html, /name="website"/); assert.match(html, /tabindex="-1"/); assert.match(html, /name="phone"/);
});


test("new company server-action form retains names, required fields and repeated invitee transport", () => {
  const { NuevaEmpresaForm } = source("components/platform/NuevaEmpresaForm.tsx", { "@/lib/platform/alta-empresa": alta });
  const html = renderToStaticMarkup(React.createElement(NuevaEmpresaForm, { plans: [{ code: "pro", name: "Profesional" }], createAction: async (state: any) => state }));
  for (const name of ["name", "slug", "planCode", "inviteeEmail", "inviteeRole"]) assert.equal((html.match(new RegExp(`name="${name}"`, "g")) ?? []).length, 1);
  assert.match(html, /id="alta-slug"/); assert.match(html, /autoCapitalize="none"/);
  assert.match(html, /name="inviteeEmail"/); assert.match(html, /type="email"/); assert.match(html, /value="OWNER" selected=""/);
  assert.match(html, /value="pro"/); assert.match(html, /noValidate=""/); assert.match(html, /data-oc-select=""/);
});
