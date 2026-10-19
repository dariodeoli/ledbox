import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), "utf8");
const css = read("app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const storeCss = read("app", "tienda.css").replace(/\/\*[\s\S]*?\*\//g, "");

test("TextField sigue en la biblioteca y conserva etiqueta, ayuda, error y disabled", () => {
  const fields = read("components", "admin", "AdminFields.tsx");
  const textField = fields.slice(fields.indexOf("export function TextField("), fields.indexOf("export type TextAreaFieldProps"));
  assert.match(textField, /<SharedInput/);
  assert.match(textField, /aria-invalid=\{error \? true : undefined\}/);
  assert.match(textField, /aria-describedby=\{describedBy\(error, hint \?\? success/);
  assert.match(textField, /disabled=\{disabled\}/);
});

test("los campos del panel conservan caja completa redondeada sin reset a línea inferior", () => {
  assert.doesNotMatch(css, /\.admin-root \.admin-field :is\([^}]+\)\s*\{\s*border-radius:\s*0;\s*border-width:\s*0 0 1px/);
  assert.match(css, /--a-field-radius:\s*8px/);
  assert.match(css, /\.admin-root \.admin-field \[data-oc-control\]:focus-visible\s*\{\s*outline:\s*none;\s*\}/);
  assert.match(css, /\.admin-root \[data-oc-control\]\[aria-invalid="true"\]/);
  assert.match(css, /\.admin-root \[data-oc-control\]\[readonly\]\s*\{\s*border-style:\s*dashed/);
});

test("los formularios de acceso unifican el ancho de controles con tamaños semánticos distintos", () => {
  assert.match(css, /\.admin-form--uniform > \.admin-field[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/);
  for (const file of ["AdminLoginForm.tsx", "AdminRecoveryForm.tsx", "AdminResetForm.tsx", "AdminInvitationForm.tsx"]) {
    assert.match(read("components", "admin", file), /className="admin-form admin-form--uniform"/);
  }
});

test("la tienda comparte forma rectangular con sus colores de tema", () => {
  const fields = storeCss.slice(storeCss.indexOf(".cp-theme .cp-fields {"), storeCss.indexOf(".cp-theme .cp-event {"));
  assert.match(fields, /\.cp-theme \.cp-fields\s*\{[^}]*--a-field-radius:\s*var\(--radius-sm\)/);
  assert.match(fields, /\.cp-theme \.cp-fields[^}]*border:\s*1px solid var\(--color-muted\)[^}]*border-radius:\s*var\(--radius-sm\)/);
  assert.match(fields, /:focus[^}]*border-color:\s*var\(--color-primary\)[^}]*box-shadow:\s*0 0 0 3px/);
  assert.match(fields, /:disabled[^}]*border-color:\s*var\(--color-border\)[^}]*cursor:\s*not-allowed/);
  assert.doesNotMatch(fields, /border:\s*0;\s*border-bottom:\s*1px solid var\(--color-muted\)/);
});

test("el portal conserva tema propio con la misma caja, foco visible, error y disabled", () => {
  const portal = css.slice(css.indexOf(".portal-field {"), css.indexOf(".portal-help {"));
  assert.match(portal, /border:\s*1px solid var\(--line-control\)/);
  assert.match(portal, /border-radius:\s*var\(--p-radius\)/);
  assert.match(portal, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--p-action\)/);
  assert.match(portal, /\[aria-invalid="true"\]\s*\{\s*border-color:\s*var\(--p-danger\)/);
  assert.match(portal, /:disabled\s*\{\s*border-color:\s*var\(--line-control\)/);
  assert.doesNotMatch(portal, /border:\s*0;\s*border-bottom:/);
});
