import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Select } from "owncoding-ui";
import ts from "typescript";

test("filtro compartido conserva selección, tono, etiqueta y bloqueo del selector de formulario", () => {
  const source = ts.createSourceFile("AdminUI.tsx", readFileSync("components/admin/AdminUI.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "AdminSelect")!;
  const Filter = runInNewContext(ts.transpileModule(declaration.getText(source).replace(/^export /, "") + "\nAdminSelect;", { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, { React, SharedSelect: Select });
  let next = "";
  const node = Filter({ label: "Estado", value: "active", tone: "ok", disabled: true, required: true,
    onChange: (value: string) => { next = value; }, options: [{ value: "active", label: "Activo" }, { value: "closed", label: "Cerrado" }] });
  assert.equal(node.type, Select);
  const html = renderToStaticMarkup(node);
  assert.match(html, /data-oc-select/); assert.match(html, /data-oc-control/); assert.match(html, /aria-label="Estado"/);
  assert.match(html, /data-tone="ok"/); assert.match(html, /disabled=""/); assert.match(html, /required=""/);
  assert.match(html, /value="active" selected=""/);
  node.props.onChange({ target: { value: "closed" } }); assert.equal(next, "closed");
});
