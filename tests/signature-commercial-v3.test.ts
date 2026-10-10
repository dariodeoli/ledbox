import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { SignatureDocumentSheet } from "../app/(portal)/_components/SignatureDocumentSheet";
import { budgetDocumentHash, budgetDocumentPayload, signatureDocument } from "../lib/server/signature/document";
Object.assign(globalThis, { React });

function source() {
  return { id: "commercial-v3", title: "Terms", createdAt: new Date("2030-01-10T12:00:00Z"), validUntil: null, deliveryAt: null, ivaType: null, warranty: null, notes: null, paymentTerms: null, advanceAmount: 0, installmentsJson: null, subtotal: 300003, discount: 0, total: 300003,
    discountMode: "PERCENT" as const, discountValue: 0, advancePercentBps: 0,
    client: { name: "Contact", company: "Company", tradeName: "Trade", legalName: "Legal" }, event: null,
    items: [{ name: "Effective front", quantity: 1, days: 3, unitPrice: 100001, subtotal: 300003, excluded: false, notes: null, sortOrder: 0, priceMode: "TARIFF" as "TARIFF" | "MANUAL", tariffSnapshot: { version: 1, front: "FINAL", normalPrice: 100001, fromDays: 3, fromPrice: 80001, minimumPrice: 60001 }, discountMode: "PERCENT" as const, discountValue: 0, discountAmount: 0 }],
  };
}
const live = (budget = source(), version: 1 | 2 | 3 = 3) => signatureDocument({ source: "live", version, budget, title: "Terms", organizationName: "Issuer" });
const hash = (budget = source(), version: 1 | 2 | 3 = 3) => budgetDocumentHash(budgetDocumentPayload(live(budget, version)));
test("V3 binds effective tariff, modes, discounts and advance without changing V1/V2 recipe", () => {
  const original = source(), baseHash = hash(original);
  const mutations = [
    (b: ReturnType<typeof source>) => { b.items[0].tariffSnapshot.fromPrice += 1; },
    (b: ReturnType<typeof source>) => { b.items[0].tariffSnapshot.minimumPrice += 1; },
    (b: ReturnType<typeof source>) => { b.items[0].priceMode = "MANUAL"; },
    (b: ReturnType<typeof source>) => { b.items[0].discountValue = 1; },
    (b: ReturnType<typeof source>) => { b.discountValue = 1; },
    (b: ReturnType<typeof source>) => { b.advancePercentBps = 1; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    assert.notEqual(hash(changed), baseHash);
    for (const version of [1, 2] as const) assert.equal(hash(changed, version), hash(original, version));
  }
  const document = live(original), payload = JSON.parse(JSON.stringify(budgetDocumentPayload(document)));
  assert.equal(payload.version, 3);
  const restored = signatureDocument({ source: "snapshot", payload });
  assert.equal(budgetDocumentHash(budgetDocumentPayload(restored)), baseHash);
  const html = renderToStaticMarkup(createElement(SignatureDocumentSheet, { document: restored }));
  for (const text of ["Trade", "Legal", "Tarifa final", "Desde 3 días", "80.001", "60.001", "Descuento de línea", "Descuento global"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(JSON.stringify(payload), /costPrice|dailyCost|wholesalePrice/);
  const manual = source(); manual.items[0].priceMode = "MANUAL";
  const publicManual = live(manual).items[0].commercialTerms!;
  assert.equal(publicManual.tariffSnapshot, null); assert.equal(publicManual.minimumPrice, 60001);
  assert.equal(signatureDocument({ source: "snapshot", payload: budgetDocumentPayload(live(manual)) }).items[0].commercialTerms?.minimumPrice, 60001);
});
test("V3 snapshot rejects private/unknown fields and malformed commercial terms", () => {
  const payload = JSON.parse(JSON.stringify(budgetDocumentPayload(live())));
  for (const mutate of [
    (p: typeof payload) => { p.items[0].commercialTerms.tariffSnapshot.costPrice = 1; },
    (p: typeof payload) => { p.commercialTerms.advancePercentBps = 10001; },
    (p: typeof payload) => { p.items[0].commercialTerms.discountValue = 10001; },
    (p: typeof payload) => { delete p.items[0].commercialTerms; },
    (p: typeof payload) => { p.items[0].commercialTerms.minimumPrice = 0; },
  ]) { const invalid = structuredClone(payload); mutate(invalid); assert.throws(() => signatureDocument({ source: "snapshot", payload: invalid }), /snapshot/); }
});
