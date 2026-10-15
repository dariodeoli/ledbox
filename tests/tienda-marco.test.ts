import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoreFooter, storeFooterLinks } from "../components/catalog-public/StoreFooter";
import { StoreHeader, storeNavLinks } from "../components/catalog-public/StoreHeader";

// tsx usa JSX clásico en este runner; Next compila las mismas piezas con JSX automático.
Object.assign(globalThis, { React });

const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

test("pie de la tienda: crédito de OwnCoding con la versión de package.json (la de /api/health)", () => {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version as string;
  const nav = storeNavLinks("/tienda/demo", { contact: true });
  const html = renderToStaticMarkup(createElement(StoreFooter, { name: "La Vajilla Alquileres", links: storeFooterLinks(nav) }));
  assert.equal((html.match(/<footer\b/g) ?? []).length, 1);
  assert.equal((html.match(/class="cp-footer-col"/g) ?? []).length, 3, "tres columnas principales");
  assert.ok(text(html).includes(`Desarrollado por OwnCoding · EventOS v${version}`));
  assert.ok(html.includes("La Vajilla Alquileres"));
  for (const label of ["Catálogo", "Cómo funciona", "Contacto"]) assert.ok(text(html).includes(label), label);
  // Sin datos cargados no se inventa nada: ni WhatsApp ni correo.
  assert.ok(!html.includes("mailto:"));
  assert.ok(!text(html).includes("WhatsApp"));
});

test("encabezado de la tienda: identidad de la empresa y navegación compacta; crédito EventOS en el pie", () => {
  const html = renderToStaticMarkup(createElement(StoreHeader, {
    name: "La Vajilla Alquileres", slug: "la-vajilla", logos: { light: true, dark: true }, homeHref: "/tienda/la-vajilla",
    nav: storeNavLinks("", { contact: true }), cart: "button",
  }));
  assert.ok(html.includes("Inicio de La Vajilla Alquileres"));
  assert.ok(!html.includes("EventOS") && !html.includes("eventos-mark.png") && !html.includes("cp-hd-sep"));
  assert.ok(html.includes("/api/catalog/la-vajilla/logo/light") && html.includes("/api/catalog/la-vajilla/logo/dark"), "logo por tema");
  for (const label of ["Catálogo", "Contacto"]) assert.ok(html.includes(label), label);
  assert.ok(!html.includes("Cómo funciona"));
  assert.ok(html.includes("cp-hd-cart"));
  const fallback = renderToStaticMarkup(createElement(StoreHeader, {
    name: "Negocio sin logo", slug: "negocio", homeHref: "/tienda/negocio", nav: [], cart: null,
  }));
  assert.ok(text(fallback).includes("Negocio sin logo"));
});

test("sin contacto cargado, el menú no ofrece «Contacto»", () => {
  assert.deepEqual(storeNavLinks("", { contact: false }).map((link) => link.label), ["Catálogo", "Cómo funciona"]);
});

test("todas las páginas de la tienda usan el mismo pie y encabezado", () => {
  for (const file of [
    "components/catalog-public/StoreFront.tsx",
    "components/catalog-public/ProductPage.tsx",
    "components/catalog-public/AccessPage.tsx",
    "app/(catalogo)/pedido/[token]/page.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<StoreFooter\b/, `${file} debe usar StoreFooter`);
    assert.match(source, /<StoreHeader\b/, `${file} debe usar StoreHeader`);
    assert.doesNotMatch(source, /className="cp-foot"/, `${file} no debe tener un pie propio`);
  }
});
