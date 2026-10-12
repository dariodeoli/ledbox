import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BUDGET_APPROVAL_NOTE_MAX, budgetApprovalNoteError } from "../lib/budget-approval-validation";

test("#163 revision requires a non-whitespace note while approval keeps its optional note", () => {
  for (const note of ["", " ", "\n\t"]) {
    assert.equal(budgetApprovalNoteError("request_revision", note), "Indicá qué cambios se piden.");
    assert.equal(budgetApprovalNoteError("approve", note), null);
  }
  assert.equal(budgetApprovalNoteError("request_revision", "  Cambiar la fecha del evento  "), null);
});

test("#163 UI length boundary matches API trimming without truncating notes", () => {
  const api = readFileSync(new URL("../app/api/admin/budgets/approval/route.ts", import.meta.url), "utf8");
  assert.match(api, new RegExp(`const MAX_NOTE = ${BUDGET_APPROVAL_NOTE_MAX};`));
  for (const decision of ["approve", "request_revision"] as const) {
    assert.equal(budgetApprovalNoteError(decision, "x".repeat(1000)), null);
    assert.equal(budgetApprovalNoteError(decision, `  ${"x".repeat(1000)}\n`), null);
    assert.equal(budgetApprovalNoteError(decision, "x".repeat(1001)), "La nota no puede superar los 1000 caracteres.");
  }
});

test("#163 approval submit and action button consume the same note guard before mutation", () => {
  const source = readFileSync(new URL("../components/admin/modules/PresupuestosModule.tsx", import.meta.url), "utf8");
  const submit = source.slice(source.indexOf("  async function submitApproval()"), source.indexOf("  async function submitResolution()"));
  assert.match(submit, /const noteError = budgetApprovalNoteError\(approval\.decision, note\);\s*if \(noteError\) \{\s*setDialogError\(noteError\);\s*return;/);
  assert.ok(submit.indexOf("if (noteError)") < submit.indexOf("setDialogBusy(true)"));
  assert.match(source, /disabled=\{Boolean\(budgetApprovalNoteError\(approval\.decision, note\)\)\} onClick=\{\(\) => void submitApproval\(\)\}/);
  assert.match(submit, /note: note\.trim\(\) \|\| undefined/);
});
