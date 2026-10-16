import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as unknown as { React: typeof React }).React = React;

test("editable shared stepper renders complete stored numbers, even above a new maximum", async () => {
  const { Stepper } = await import("../components/catalog-public/Stepper");
  const html = renderToStaticMarkup(createElement(Stepper, { label: "Cantidad de mesa", value: 12345, max: 999, min: 1, editable: true, variant: "portal", onChange() { throw new Error("render must not change data"); } }));
  assert.match(html, /value="12345"/);
  assert.match(html, /--quantity-input-width:7ch/);
  assert.doesNotMatch(html, /maxLength=/i);
  assert.match(html, /aria-label="Cantidad de mesa \(1 a 999\)"/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 1);
});

test("readOnly locks both buttons and input, disabled remains a separate input state", async () => {
  const { Stepper } = await import("../components/catalog-public/Stepper");
  for (const flag of ["readOnly", "disabled"] as const) {
    const html = renderToStaticMarkup(createElement(Stepper, { label: "Días", value: 2, min: 1, max: 90, editable: true, variant: "cart", [flag]: true, onChange() { throw new Error("locked control must not change data"); } }));
    assert.equal((html.match(/<button[^>]*disabled=""/g) ?? []).length, 2);
    assert.match(html, flag === "readOnly" ? /<input[^>]*readOnly=""/i : /<input[^>]*disabled=""/);
    assert.match(html, /value="2"/);
  }
});

test("store output variant keeps live quantity, batch step and zero removal boundary", async () => {
  const { Stepper } = await import("../components/catalog-public/Stepper");
  const html = renderToStaticMarkup(createElement(Stepper, { label: "Copas", value: 0, step: 10, min: 0, onChange() {} }));
  assert.match(html, /class="cp-stepper quantity-stepper"/);
  assert.match(html, /<output aria-live="polite">0<\/output>/);
  assert.match(html, /aria-label="Sumar 10 a Copas"/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 1);
});
