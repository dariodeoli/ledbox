import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppFooter } from "../components/app-footer";
import { PublicFooter } from "../components/public/PublicFooter";
import { APP_VERSION_LABEL } from "../lib/version";
import { siteProfileForHost } from "../lib/public-config";
import { readFileSync } from "node:fs";

// tsx usa JSX clásico en este runner; Next compila las mismas piezas con JSX automático.
Object.assign(globalThis, { React });

test("#156: cada pie renderiza una sola identidad, versión y crédito completo", () => {
  for (const variant of ["app", "product", "company", "portal"] as const) {
    const html = renderToStaticMarkup(createElement(AppFooter, { variant }));
    const text = html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    assert.equal((html.match(/<footer\b/g) ?? []).length, 1);
    assert.equal((text.match(/©/g) ?? []).length, 1);
    assert.equal(text.split(APP_VERSION_LABEL).length - 1, 1);
    assert.ok(text.includes(`© ${new Date().getUTCFullYear()}`));
    assert.ok(text.includes("Desarrollado en Paraguay por OwnCoding"));
    assert.ok(text.includes("Todos los derechos reservados"));
  }
  const publicHtml = renderToStaticMarkup(createElement(PublicFooter));
  assert.equal((publicHtml.match(/<footer\b/g) ?? []).length, 1);
  assert.equal((publicHtml.match(/©/g) ?? []).length, 1);
  assert.ok(publicHtml.includes('href="/privacidad"'));
});

test("#156: sólo LedBox y EventOS publican sitemap indexable; acceso y tokens no", () => {
  for (const host of ["ledbox.online", "eventos.ledbox.online"]) assert.equal(siteProfileForHost(host).indexable, true);
  for (const host of ["app.ledbox.online", "clientes.ledbox.online", "demo.ledbox.online"]) assert.equal(siteProfileForHost(host).indexable, false);
});

test("#156: el pie global se proyecta fuera del snapshot firmado y conserva su guard de impresión", () => {
  const root = readFileSync("app/layout.tsx", "utf8");
  const portal = readFileSync("app/(portal)/layout.tsx", "utf8");
  const css = readFileSync("app/globals.css", "utf8");
  const sheet = readFileSync("app/(portal)/_components/SignatureDocumentSheet.tsx", "utf8");
  assert.match(root, /<body>\{children\}/);
  assert.doesNotMatch(portal, /AppFooter/);
  assert.doesNotMatch(sheet, /AppFooter|ProductFooter|APP_VERSION_LABEL/);
  assert.match(css, /\.app-footer--portal,[^}]+display: none !important/);
  assert.match(css, /body:not\(:has\(\.portal-signature-sheet\)\) > \.app-footer--portal/);
});
