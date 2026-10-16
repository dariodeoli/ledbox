import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { axesFromJson, optionsFromJson } from "../lib/inventory-variants";
import { pendingStockCount } from "../lib/stock-count";
import { formatNumber } from "../lib/admin-format";

const service = ts.createSourceFile("families.ts", readFileSync("lib/server/inventory-families.ts", "utf8"), ts.ScriptTarget.Latest, true);
const declarations = service.statements.filter(node =>
  ts.isFunctionDeclaration(node) && ["loadFamily", "familyVariants", "toView", "getFamilyView"].includes(node.name?.text ?? "") ||
  ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(service) === "VARIANT_SELECT")
).map(node => node.getText(service).replace(/^export /, "")).join("\n");
const getView = runInNewContext(ts.transpileModule(declarations + ";getFamilyView;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { axesFromJson, optionsFromJson });
const source = ts.createSourceFile("InventoryFamilies.tsx", readFileSync("components/admin/modules/InventoryFamilies.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let cell: ts.JsxElement | undefined, summary: ts.JsxElement | undefined;
const summaryVariables: string[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.getText(source).startsWith("<AdminCell end title={") && node.getText(source).includes("variant.quantity")) cell = node;
  if (ts.isJsxElement(node) && node.getText(source).startsWith('<p className="admin-fam-preview"') && node.getText(source).includes("totalUnits")) summary = node;
  if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ["pendingCounts", "totalUnits", "totalFree", "knownFree"].includes(declaration.name.getText(source)))) summaryVariables.push(node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source); assert(cell && summary);
function render(node: ts.Node, globals: Record<string, unknown>, before = "") {
  const code = ts.transpileModule(before + "\nconst element=" + node.getText(source) + ";element;", { fileName: "view.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const element = runInNewContext(code, { React, pendingStockCount, formatNumber, AdminCell: ({ title, children }: any) => React.createElement("td", { title }, children), ...globals });
  return renderToStaticMarkup(element).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
async function family(rows: Array<{ id: string; quantity: number; stockCountStatus: "CONFIRMED" | "PENDING_COUNT" }>) {
  const tx = {
    inventoryFamily: { findFirst: async ({ where }: any) => { assert.equal(where.organizationId, "org"); return { id: "family", name: "Sillas", code: "F1", axes: [] }; } },
    inventoryItem: { findMany: async ({ select, where }: any) => {
      assert.equal(where.organizationId, "org"); assert.equal(select.stockCountStatus, true, "the real reader must request count knowledge");
      return rows.map(row => Object.fromEntries(Object.keys(select).map(key => [key, ({ name: row.id, sku: row.id, ...row } as any)[key]])));
    } },
  };
  return await getView(tx, "org", "family");
}
test("real family reader and DTO retain pending versus confirmed zero", async () => {
  const view = await family([{ id: "unknown", quantity: 0, stockCountStatus: "PENDING_COUNT" }, { id: "empty", quantity: 0, stockCountStatus: "CONFIRMED" }]);
  assert.equal(view.variants[0].stockCountStatus, "PENDING_COUNT"); assert.equal(view.variants[1].stockCountStatus, "CONFIRMED");
  assert.equal(view.variants[0].quantity, 0); assert.equal(view.variants[1].quantity, 0);
});
test("actual variant stock cell labels unknown zero and registered units without a false free/total promise", async () => {
  for (const quantity of [0, 1, 3]) {
    const view = await family([{ id: "unknown", quantity, stockCountStatus: "PENDING_COUNT" }]);
    const text = render(cell!, { variant: view.variants[0], libres: 0 });
    assert.match(text, /Pendiente de conteo/); assert.match(text, new RegExp(`${quantity} ${quantity === 1 ? "registrada" : "registradas"}`)); assert.doesNotMatch(text, /0\s*\/\s*[03]|libres/);
  }
  const view = await family([{ id: "empty", quantity: 0, stockCountStatus: "CONFIRMED" }]);
  const text = render(cell!, { variant: view.variants[0], libres: 0 }); assert.match(text, /0\s*\/\s*0/); assert.doesNotMatch(text, /Pendiente/);
});
test("actual family summary calls mixed totals registered and counts pending variants instead of claiming total free stock", async () => {
  const view = await family([{ id: "unknown", quantity: 3, stockCountStatus: "PENDING_COUNT" }, { id: "known", quantity: 4, stockCountStatus: "CONFIRMED" }]);
  const text = render(summary!, { family: view, free: new Map([["unknown", 0], ["known", 4]]) }, summaryVariables.join("\n"));
  assert.match(text, /7 unidades registradas/); assert.match(text, /1 variante pendiente de conteo/); assert.doesNotMatch(text, /libres hoy/);
  const pending = await family([{ id: "a", quantity: 0, stockCountStatus: "PENDING_COUNT" }, { id: "b", quantity: 0, stockCountStatus: "PENDING_COUNT" }]);
  assert.match(render(summary!, { family: pending, free: new Map([["a", 0], ["b", 0]]) }, summaryVariables.join("\n")), /2 variantes pendientes de conteo/);
});
test("actual family summary preserves confirmed-zero and known free-stock presentation", async () => {
  const view = await family([{ id: "zero", quantity: 0, stockCountStatus: "CONFIRMED" }, { id: "known", quantity: 4, stockCountStatus: "CONFIRMED" }]);
  const text = render(summary!, { family: view, free: new Map([["zero", 0], ["known", 2]]) }, summaryVariables.join("\n"));
  assert.match(text, /4 unidades/); assert.match(text, /2 libres hoy/); assert.doesNotMatch(text, /pendiente|registradas/);
});
