import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SegmentedField as SharedSegmented } from "owncoding-ui";
import ts from "typescript";

const file = ts.createSourceFile("AdminFields.tsx", readFileSync("components/admin/AdminFields.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "SegmentedField");
assert.ok(declaration);
// Execute the current field, not a copy of its sizing expression; the inner library field renders for real.
const SegmentedField = runInNewContext(ts.transpileModule(declaration.getText(file).replace(/^export /, "") + "\nSegmentedField;", { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, {
  React, SharedSegmented, useFieldIds: () => ({ fieldId: "segment", hintId: "hint", errorId: "error" }), describedBy: () => undefined,
});
const sizes = ["xs", "sm", "md", "lg", "full"] as const;
function html(count: number, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(React.createElement(SegmentedField, { label: "Tipo de cuenta", value: "option-0", onChange() {}, options: Array.from({ length: count }, (_, i) => ({ value: `option-${i}`, label: `Alternativa ${i + 1}` })), ...props }));
}
function size(markup: string) {
  const outer = /<div\b[^>]*class="admin-field(?: admin-field--wide)?"[^>]*data-size="([^"]+)"/.exec(markup);
  assert.ok(outer, "the canonical field wrapper must expose its resolved width");
  return outer[1];
}
for (const explicit of sizes) test(`SegmentedField SSR preserves explicit ${explicit} with three and four options`, () => {
  for (const count of [3, 4]) {
    const markup = html(count, { size: explicit });
    assert.equal(size(markup), explicit);
    for (let i = 1; i <= count; i++) assert.ok(markup.includes(`Alternativa ${i}`), "sizing must preserve every option");
    assert.match(markup, /aria-labelledby="segment-label"/);
  }
});
test("SegmentedField SSR defaults three choices to lg and four choices to full", () => {
  assert.equal(size(html(3)), "lg");
  assert.equal(size(html(4)), "full");
});
test("SegmentedField SSR wide overrides each explicit size and option-count default", () => {
  for (const count of [3, 4]) for (const explicit of [undefined, ...sizes]) {
    const markup = html(count, { size: explicit, wide: true });
    assert.equal(size(markup), "full");
    assert.match(markup, /class="admin-field admin-field--wide"/);
  }
});
