import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PREORDER_COPY, preorderEstimate } from "../lib/storefront-ui";
import { estimatedSubtotal, QUOTE_REQUEST_PUBLIC_COPY } from "../lib/catalog-public";

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("la suma sin logística es explícitamente de productos y no de un alquiler confirmado", () => {
  assert.deepEqual(preorderEstimate(240000), { products: 240000, fee: null, amount: 240000, label: "Productos estimados", logisticsPending: true });
  assert.match(PREORDER_COPY.notice, /no confirma el alquiler ni reserva productos o fechas/);
  assert.match(PREORDER_COPY.logistics, /se cotizan/);
});

test("sólo suma flete ZONE revalidado; coordinar o monto ausente no inventa costo", () => {
  assert.deepEqual(preorderEstimate(240000, { choice: "ZONE", fee: 30000 }), { products: 240000, fee: 30000, amount: 270000, label: "Estimado con flete", logisticsPending: false });
  for (const delivery of [{ choice: "COORDINATE", fee: 30000 }, { choice: "NONE", fee: 30000 }, { choice: "ZONE", fee: null }, { choice: "ZONE", fee: Number.NaN }, { choice: "ZONE", fee: -1 }]) {
    const result = preorderEstimate(240000, delivery);
    assert.equal(result.fee, null); assert.equal(result.amount, 240000); assert.equal(result.logisticsPending, true);
  }
  assert.equal(preorderEstimate(240000, { choice: "ZONE", fee: 0 }).amount, 240000, "flete cero real del API se conserva");
  assert.equal(preorderEstimate(240000, { choice: "ZONE", fee: 0 }).logisticsPending, false);
});

test("productos sin precio nunca se convierten en total cero, aun con flete conocido", () => {
  assert.equal(estimatedSubtotal([{ name: "Mesa", unitPrice: 1000, quantity: 2 }, { name: "Sin precio", unitPrice: null, quantity: 1 }], 3), null);
  for (const products of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const result = preorderEstimate(products, { choice: "ZONE", fee: 10000 });
    assert.equal(result.products, null); assert.equal(result.amount, null);
  }
  assert.equal(PREORDER_COPY.consult, "Consultar precio y disponibilidad");
});

test("eventos y escalones conservan su aritmética; el resumen sólo presenta importes", () => {
  const products = estimatedSubtotal([{ name: "Por evento", quantity: 2, unitPrice: 100000, perEvent: true }, { name: "Por día", quantity: 3, unitPrice: 10000 }], 4);
  assert.equal(products, 320000);
  assert.equal(preorderEstimate(products, { choice: "ZONE", fee: 50000 }).amount, 370000);
});

test("barra y confirmación reales muestran preorden sin prometer reserva", async () => {
  const { default: React, createElement } = await import("react");
  Object.assign(globalThis, { React });
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { OrderBar } = await import("../components/catalog-public/OrderBar");
  const { CartDrawer } = await import("../components/catalog-public/CartDrawer");
  const bar = renderToStaticMarkup(createElement(OrderBar, { count: 4, productCount: 2, names: ["Mesa", "Silla"], text: "Productos estimados Gs. 320.000 · flete a cotizar", confirmation: null, onOpen() {} }));
  assert.match(bar, /Ver preorden/); assert.match(bar, /4 unidades/); assert.match(bar, /flete a cotizar/);
  const html = renderToStaticMarkup(createElement(CartDrawer, {
    slug: "qa", preorderPath: "/api/catalog/qa/preorder", wholesale: false, clientName: null,
    range: null, lines: [], localSubtotal: null, perDay: null, view: null, showPrices: true, priceMode: "day", zones: [], zoneChoice: "",
    done: { kind: "saved", respondBy: "2027-01-20T15:00:00Z", trackingPath: "/pedido/solo-prueba", whatsappUrl: null, priceRequested: false },
    onRange() {}, onQuantity() {}, onZone() {}, onDone() {}, onSent() {}, onClose() {}, onFinish() {},
  }));
  assert.match(html, /Recibimos tu preorden/); assert.match(html, /no confirma el alquiler ni reserva productos o fechas/);
  assert.match(html, /se cotizan/); assert.ok(!html.includes("Gs. 0"));
});

test("checkout y barra comparten presentación; el envío mantiene endpoint preorden e idempotencia", () => {
  const drawer = read("components/catalog-public/CartDrawer.tsx");
  const browser = read("components/catalog-public/CatalogBrowser.tsx");
  for (const source of [drawer, browser]) assert.match(source, /preorderEstimate\(subtotal, view\?\.delivery\)/);
  assert.ok(!drawer.includes("deliveryFee(zone"), "no se estima logística local mientras falta respuesta API");
  assert.match(drawer, /fetch\(props\.preorderPath/);
  assert.match(drawer, /"Idempotency-Key": attempt\.current\.key/);
  assert.match(drawer, /Resumen antes de enviar/);
  assert.ok(!drawer.includes("/approve"));
  assert.ok(!drawer.includes("/reserve"));
  assert.match(QUOTE_REQUEST_PUBLIC_COPY.NEW.detail, /Todavía no es una reserva confirmada/);
  assert.match(QUOTE_REQUEST_PUBLIC_COPY.PROPOSED.detail, /Todavía no es una reserva confirmada/);
  assert.match(QUOTE_REQUEST_PUBLIC_COPY.APPROVED.detail, /Todavía no es una reserva confirmada/);
});
