import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../components/admin/modules/FacturacionModule.tsx", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const css = globals.split("/* #167: responsive invoice form only; shared dialogs stay canonical. */")[1]?.split("/* ── Plantillas de mensajes (issue #35) ──")[0] ?? "";

test("#167 invoice mobile layout scopes single-column controls and totals to the invoice form", () => {
  assert.ok(css, "invoice styles must exist in the canonical stylesheet");
  assert.equal(existsSync(new URL("../components/admin/modules/FacturacionInvoice.module.css", import.meta.url)), false, "must not retain a parallel stylesheet");
  assert.doesNotMatch(source, /FacturacionInvoice\.module\.css|styles\.invoiceForm/);
  assert.match(source, /className="admin-form-grid admin-invoice-form" onSubmit=\{submitInvoice\}/);
  assert.equal((source.match(/admin-invoice-form/g) ?? []).length, 1, "must not change purchase/profile dialogs");
  assert.match(css, /@media \(max-width: 480px\)/, "390px must use the narrow layout");
  assert.match(css, /\.admin-invoice-form \.admin-fiscal-line,\s*\.admin-invoice-form \.admin-fiscal-total-row\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.admin-invoice-form \.admin-fiscal-line-sum \.admin-cell-sub\s*\{\s*overflow-wrap: anywhere/);
  assert.doesNotMatch(css, /overflow(?:-x)?:\s*hidden/, "must reflow, not conceal amounts or controls");
  assert.match(source, /<NumberField label="Cantidad" required/);
  assert.match(source, /<MoneyField label="Precio unitario" required/);
  assert.match(source, /<SelectField label="IVA"/);
  assert.match(source, /disabled=\{invoiceForm\.items\.length <= 1\}/);
});

test("#167 fiscal explanatory punctuation preserves legal names and stored profile values", () => {
  assert.match(source, /hint="El nombre comercial que ven tus clientes; la razón social es la legal"/);
  assert.match(source, /placeholder="LedBox S\.A\."/);
  assert.match(source, /placeholder="Eventos del Sur S\.A\."/);
  assert.match(source, /razonSocial: profile\.razonSocial \?\? ""/);
  assert.match(source, /\{ kind: "profile", \.\.\.profileForm \}/);
  assert.match(source, /reemplaza al comprobante de SIFEN\/DNIT; ver el detalle/);
  assert.doesNotMatch(source, /profileForm\.[a-zA-Z]+\.replace\(/, "must not normalize punctuation out of stored values");
});
