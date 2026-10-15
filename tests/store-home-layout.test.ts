import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { DEFAULT_HOME, moveSectionTo, parseHome, readHome, visibleSections } from "../lib/store-home";
import { DEFAULT_APPEARANCE, parseAppearance, readAppearance } from "../lib/appearance";
import { STORE_THEMES } from "../lib/storefront-templates";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("categorías: default retrocompatible y escrituras estrictas, sin mutar el inicio actual", () => {
  assert.equal(readHome({}).categoryLayout, "cards");
  assert.equal(readAppearance({ template: "boutique", home: { order: ["categorias", "hero"] } }).home.categoryLayout, "cards");
  for (const value of [null, [], true, "accordion"]) assert.equal(parseHome(value).ok, false);
  for (const value of [null, "otro", true, [], {}]) assert.equal(parseHome({ categoryLayout: value }).ok, false);
  const original = JSON.stringify(DEFAULT_HOME);
  const changed = parseHome({ categoryLayout: "accordion" });
  assert.ok(changed.ok);
  assert.equal(changed.home.categoryLayout, "accordion");
  assert.equal(JSON.stringify(DEFAULT_HOME), original);
});

test("PATCH de apariencia conserva módulos al cambiar plantilla y layout, en los siete nichos", () => {
  const initial = parseHome({ order: ["categorias", "catalogo", "hero"], hidden: ["inspiracion"], editorial: { title: "Nuestro trabajo", text: "Colección propia" }, inspiration: { title: "Ideas propias", captions: ["Uno"] } });
  assert.ok(initial.ok);
  let current = { ...DEFAULT_APPEARANCE, home: initial.home };
  const changed = parseAppearance({ home: { categoryLayout: "accordion" } }, current);
  assert.ok(changed.ok);
  assert.deepEqual(changed.appearance.home, { ...initial.home, categoryLayout: "accordion" });
  for (const template of STORE_THEMES) {
    const next = parseAppearance({ template }, changed.appearance);
    assert.ok(next.ok);
    assert.deepEqual(next.appearance.home, changed.appearance.home);
    current = next.appearance;
  }
  const persisted = readAppearance(JSON.parse(JSON.stringify(current)));
  assert.deepEqual(persisted.home, changed.appearance.home);
});

test("un campo guardado roto no borra módulos válidos ni permite ocultar el catálogo", () => {
  const home = readHome({ categoryLayout: "inventado", order: ["categorias", "catalogo"], hidden: ["hero", "catalogo"], editorial: { title: "Título conservado" }, inspiration: { title: "Fotos", captions: ["Fiesta"] } });
  assert.equal(home.categoryLayout, "cards");
  assert.equal(home.editorial.title, "Título conservado");
  assert.equal(home.inspiration.title, "Fotos");
  assert.deepEqual(home.hidden, ["hero"]);
  const moved = moveSectionTo(home.order, "contacto", home.order[0]);
  assert.equal(moved[0], "contacto");
  assert.equal(new Set(moved).size, DEFAULT_HOME.order.length);
  assert.ok(visibleSections({ ...home, order: moved }).includes("catalogo"));
  assert.ok(!visibleSections(home).includes("hero"));
  assert.equal(readHome({ categoryLayout: "accordion", editorial: null, inspiration: { title: "Sigue" } }).categoryLayout, "accordion");
});

test("preview real respeta orden y ocultos, portadas separadas y el acordeón compartido", () => {
  // Ejecuta el componente real: únicamente se omite el import CSS que pertenece al bundler.
  const url = new URL("../components/admin/modules/StorePreview.tsx", import.meta.url);
  const require = createRequire(url);
  const exports: Record<string, unknown> = {};
  const compiled = ts.transpileModule(readFileSync(url, "utf8"), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(compiled, { exports, require: (id: string) => id.endsWith(".css") ? {} : require(id), React });
  const Preview = exports.StorePreview as React.ComponentType<Record<string, unknown>>;
  const home = parseHome({ categoryLayout: "accordion", order: ["categorias", "catalogo", "hero"], hidden: ["destacados", "contacto"] });
  assert.ok(home.ok);
  const appearance = { ...DEFAULT_APPEARANCE, home: home.home };
  const render = (frame: string) => renderToStaticMarkup(createElement(Preview, { frame, appearance, brandColor: null, name: "Ejemplo", coverDesktop: "/desktop.jpg", coverMobile: "/mobile.jpg" }));
  const desktop = render("desktop"), mobile = render("mobile");
  assert.ok(desktop.indexOf('data-preview-section="categorias"') < desktop.indexOf('data-preview-section="catalogo"'));
  assert.ok(desktop.indexOf('data-preview-section="catalogo"') < desktop.indexOf('data-preview-section="hero"'));
  assert.ok(!desktop.includes('data-preview-section="destacados"'));
  assert.ok(!desktop.includes('data-preview-section="contacto"'));
  assert.match(desktop, /data-testid="category-accordion"/);
  assert.match(desktop, /src="\/desktop\.jpg"/);
  assert.match(mobile, /src="\/mobile\.jpg"/);
});
