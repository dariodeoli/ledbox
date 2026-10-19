import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { storeFavicon } from "@/lib/store-branding";

test("store favicon prefers the light-surface company logo and versions its URL", () => {
  const icon = storeFavicon("la-vajilla", {
    dark: { variant: "dark", mime: "image/webp", updatedAt: new Date("2026-10-18T12:00:00.000Z") },
    light: { variant: "light", mime: "image/png", updatedAt: new Date("2026-10-17T12:00:00.000Z") },
  });

  assert.deepEqual(icon, {
    url: "/api/catalog/la-vajilla/logo/dark?v=2026-10-18T12%3A00%3A00.000Z",
    type: "image/webp",
  });
});

test("store favicon uses the only available tenant logo and encodes the slug", () => {
  const icon = storeFavicon("mi empresa", {
    dark: null,
    light: { variant: "light", mime: "image/jpeg", updatedAt: new Date("2026-10-18T12:00:00.000Z") },
  });

  assert.deepEqual(icon, {
    url: "/api/catalog/mi%20empresa/logo/light?v=2026-10-18T12%3A00%3A00.000Z",
    type: "image/jpeg",
  });
});

test("store favicon is absent when the company has no logo", () => {
  assert.equal(storeFavicon("sin-logo", { dark: null, light: null }), null);
});

test("store logo falls back to the company name after a missing or failed image", () => {
  const source = readFileSync("components/catalog-public/StoreLogo.tsx", "utf8");
  assert.match(source, /if \(!logos \|\| \(!logos\.light && !logos\.dark\) \|\| imageFailed\) return <span className="cp-brand-name cp-brand-name--fallback">\{name\}<\/span>/);
  assert.match(source, /const logoKey = `\$\{slug\}:/);
  assert.match(source, /onError=\{\(\) => setFailedLogoKey\(logoKey\)\}/);
  assert.match(source, /alt=\{`Logo de \$\{name\}`\}/);
});

test("tenant favicon is scoped to the public store layout and leaves the system icon unchanged", () => {
  const layout = readFileSync("app/(catalogo)/tienda/[orgSlug]/layout.tsx", "utf8");
  const appLayout = readFileSync("app/layout.tsx", "utf8");
  const logoRoute = readFileSync("app/api/catalog/[orgSlug]/logo/[variant]/route.ts", "utf8");

  assert.match(layout, /catalogAccessMode !== "OPEN"/);
  assert.match(layout, /context\.organization\.id/);
  assert.match(appLayout, /url: "\/icon\.svg"/);
  assert.match(logoRoute, /organizationId: context\.organization\.id/);
});
