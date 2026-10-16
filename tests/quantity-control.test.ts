import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { integerDraft, quantityFromDraft, stepQuantity } from "../lib/quantity-control";

test("quantity draft rejects signs, decimals and exponents instead of changing the order", () => {
  for (const invalid of ["-2", "+2", "1.5", "1,5", "1e3", " 12 ", "Gs. 12", "abc", "１２"]) {
    assert.equal(integerDraft(invalid), null, invalid);
    assert.equal(quantityFromDraft(invalid, 1, 999), null, invalid);
  }
  assert.equal(integerDraft("00012"), "12");
  assert.equal(integerDraft("0"), "0");
});

test("blank and unsafe numbers never commit an invented quantity", () => {
  assert.equal(integerDraft(""), "");
  assert.equal(quantityFromDraft("", 1, 999), null);
  assert.equal(quantityFromDraft("9007199254740992", 1, 999), null);
  assert.equal(quantityFromDraft("9".repeat(400), 1, 999), null);
});

test("typed values respect each flow's bounds without fixed digit truncation", () => {
  assert.equal(quantityFromDraft("0", 1, 99), 1);
  assert.equal(quantityFromDraft("0", 0, 99), 0);
  assert.equal(quantityFromDraft("123", 1, 999), 123);
  assert.equal(quantityFromDraft("12345", 1, 99999), 12345);
  assert.equal(quantityFromDraft("1000", 1, 999), 999);
  assert.equal(quantityFromDraft("91", 1, 90), 90);
  assert.equal(quantityFromDraft(String(Number.MAX_SAFE_INTEGER), 1, 999), 999);
});

test("stepping preserves store batches, portal days, final remainder and removal zero", () => {
  assert.equal(stepQuantity(90, 10, 0, 99), 99);
  assert.equal(stepQuantity(99, 10, 0, 99), 99);
  assert.equal(stepQuantity(10, -10, 0, 99), 0);
  assert.equal(stepQuantity(10, -10, 10, 99), 10);
  assert.equal(stepQuantity(1, -1, 1, 999), 1);
  assert.equal(stepQuantity(998, 1, 1, 999), 999);
  assert.equal(stepQuantity(90, 1, 1, 90), 90);
});

test("all three quantity surfaces use one control; portal retains functional updates", () => {
  const portal = readFileSync("app/(portal)/_components/PortalBudgetView.tsx", "utf8");
  const landing = readFileSync("components/cart/CartDrawer.tsx", "utf8");
  const control = readFileSync("components/catalog-public/Stepper.tsx", "utf8");
  assert.match(portal, /import \{ Stepper \} from "@\/components\/catalog-public\/Stepper"/);
  assert.match(portal, /stepQuantity\(base\[field\], delta, 1, max\)/);
  assert.doesNotMatch(portal, /function Stepper\(|function clampInt\(/);
  assert.equal((landing.match(/<Stepper editable variant="cart"/g) ?? []).length, 2);
  assert.doesNotMatch(landing, /type="number"/);
  assert.match(control, /<NumberField[\s\S]*?strictInteger[\s\S]*?readOnly=\{readOnly\}/);
  assert.match(control, /if \(locked\) return/);
  assert.match(control, /onBlur=\{\(\) => setDraft\(String\(value\)\)\}/);
});
