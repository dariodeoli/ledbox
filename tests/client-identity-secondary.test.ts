import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { clientPresentation } from "../lib/client-identity";
import { clientIdentityDTO } from "../lib/server/client-identity";
import { formatTime, calendarKindLabel } from "../lib/admin-format";
Object.assign(globalThis, { React });
const sample = { id: "client-qa", name: "Historical", company: "Old company", tradeName: "Shared business", contactName: "Explicit manager", type: "RESELLER", logoUpdatedAt: null };
function actual(path: string, names: string[], globals: Record<string, unknown>) {
 const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
 const declarations = sf.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? "")).map(node => node.getText(sf).replace(/^export /, "")).join("\n");
 return runInNewContext(ts.transpileModule(declarations + ";" + names.at(-1) + ";", { fileName: "fixture.tsx", compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, { React, ...globals });
}
test("calendar event mapper uses canonical identity without repeating the business in location subtitle", () => {
 const eventItem = actual("app/api/admin/calendar/route.ts", ["eventItem"], { clientIdentityDTO, dayKeyOf: () => "2031-03-10", placeLabel: () => "Venue · Asunción" });
 const row = eventItem("event", { id: "event", name: "Event", status: "CONFIRMED", startsAt: null, endsAt: null, location: "Venue", city: "Asunción", client: { ...sample, logo: { updatedAt: new Date("2030-01-01") } } }, new Date());
 assert.equal(row.subtitle, "Venue · Asunción"); assert.equal(row.client.tradeName, sample.tradeName); assert.equal(row.client.logoUpdatedAt, "2030-01-01T00:00:00.000Z"); assert(!Object.hasOwn(row.client, "logo"));
});
test("actual calendar event and collection tiles expose logo/initials, explicit manager and real segment once", async () => {
 const { ClientIdentityView } = await import("../components/admin/ClientIdentity");
 const link = actual("components/admin/modules/CalendarioModule.tsx", ["itemTitleText", "CalendarItemLink"], { clientPresentation, ClientIdentityView, formatTime, calendarKindLabel, itemTagLabel: () => "" });
 for (const kind of ["event", "collection"]) {
  const item = { id: "item", kind, at: "2031-03-10T12:00:00Z", endAt: null, title: kind === "collection" ? sample.tradeName : "Event", subtitle: "Venue", client: sample, amount: null, tone: "info" };
  const html = renderToStaticMarkup(React.createElement(link, { item, variant: "list", onSelect() {} }));
  assert.match(html, /admin-client-identity/); assert.match(html, /Explicit manager/); assert.match(html, /Mayorista/);
  const visible = html.replace(/<[^>]*>/g, " "); assert.equal(visible.split(sample.tradeName).length - 1, 1);
 }
});
test("the live pricing selector reuses rich searchable options without inferring a responsible or segment", async () => {
 const { ClientIdentityView, clientComboboxOption } = await import("../components/admin/ClientIdentity");
 const option = clientComboboxOption(sample); assert.equal(option.value, sample.id); assert.match(option.keywords!, /Historical/); assert.match(option.description!, /Explicit manager.*Mayorista/);
 const html = renderToStaticMarkup(option.content as React.ReactElement); assert.match(html, /Shared business/); assert.match(html, /admin-avatar/);
 const noResponsible = clientPresentation({ id: "unused", name: "Some person", company: "Business", type: null } as any); assert.equal(noResponsible.responsible, null); assert.equal(noResponsible.category, null);
 const deleted = renderToStaticMarkup(React.createElement(ClientIdentityView, { client: { ...sample, deletedAt: "2030-01-01" } })); assert.match(deleted, /eliminado/i);
});
test("CityField rejects an unpersisted IA proposal before applying while retaining historical editor values", async () => {
 const { CityField } = await import("../components/admin/AdminFields");
 const props = { label: "Ciudad", value: "AsunciónX", onChange() {}, onSelect() {} };
 const old = renderToStaticMarkup(React.createElement(CityField, props)); assert.doesNotMatch(old, /no pertenece al catálogo/);
 const draft = renderToStaticMarkup(React.createElement(CityField, { ...props, allowHistoricalValue: false })); assert.match(draft, /no pertenece al catálogo/); assert.match(draft, /aria-invalid="true"/);
 const valid = renderToStaticMarkup(React.createElement(CityField, { ...props, value: "Asunción", allowHistoricalValue: false })); assert.doesNotMatch(valid, /no pertenece al catálogo/);
});

test("comparison candidates and fiscal live budget references actually render the canonical identity", async () => {
 const { ClientIdentityView } = await import("../components/admin/ClientIdentity");
 for (const path of ["components/admin/modules/BudgetComparisons.tsx", "components/admin/modules/FacturacionModule.tsx"]) {
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let identity: ts.JsxSelfClosingElement | undefined;
  const visit = (node: ts.Node) => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sf) === "ClientIdentityView") identity = node; ts.forEachChild(node, visit); }; visit(sf); assert(identity, path);
  const value = runInNewContext(ts.transpileModule("const result=" + identity.getText(sf) + ";result;", { fileName: "fixture.tsx", compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, { React, ClientIdentityView, quote: { client: sample }, budget: { client: sample } });
  const html = renderToStaticMarkup(value); assert.match(html, /Shared business/); assert.match(html, /Explicit manager/); assert.match(html, /Mayorista/);
 }
});
test("the pricing dialog's actual client option expression retains rich content and accessible search text", async () => {
 const { clientComboboxOption } = await import("../components/admin/ClientIdentity");
 const path = "components/admin/modules/BudgetPricingDialog.tsx", sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let expression: ts.Expression | undefined;
 const visit = (node: ts.Node) => { if (ts.isJsxAttribute(node) && node.name.getText(sf) === "options" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(sf).includes("clients.data")) expression = node.initializer.expression; ts.forEachChild(node, visit); }; visit(sf); assert(expression);
 const options = runInNewContext(ts.transpileModule("const result=" + expression.getText(sf) + ";result;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { clients: { data: [sample] }, clientComboboxOption });
 assert.equal(options[0].value, sample.id); assert.match(options[0].keywords, /Historical/); assert.match(renderToStaticMarkup(options[0].content), /Mayorista/);
});
