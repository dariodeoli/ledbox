import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { storeAbsoluteUrl, storefrontMetadata } from "@/lib/store-seo";

test("el origen de tienda permite configurar EventOS y conserva fallback", async () => {
  const { publicConfig } = await import("@/lib/public-config");
  assert.match(publicConfig.storeUrl, /^https?:\/\//);
  assert.equal(publicConfig.storeUrl.endsWith("/"), false);
  const configSource = readFileSync("lib/public-config.ts", "utf8");
  assert.match(configSource, /NEXT_PUBLIC_STORE_URL \|\| process\.env\.NEXT_PUBLIC_EVENTOS_URL \|\| process\.env\.NEXT_PUBLIC_SITE_URL/);
  assert.doesNotMatch(configSource, /https:\/\/eventos\.online/);
});

test("store metadata uses the explicitly configured store origin for canonical and share previews", () => {
  const metadata = storefrontMetadata({
    organizationSlug: "la-vajilla",
    organizationName: "La Vajilla",
    title: "La Vajilla · Tienda de alquiler",
    description: "Catálogo y disponibilidad de La Vajilla.",
    canonicalPath: "/tienda/la-vajilla",
    socialImagePath: "/api/catalog/la-vajilla/cover/desktop?v=2026-10-19T03%3A00%3A00.000Z",
    indexable: true,
  }, "https://tienda.eventoss.online/");

  assert.equal(metadata.alternates?.canonical, "https://tienda.eventoss.online/tienda/la-vajilla");
  assert.equal(metadata.openGraph?.url, "https://tienda.eventoss.online/tienda/la-vajilla");
  assert.equal(metadata.openGraph?.siteName, "La Vajilla");
  assert.deepEqual(metadata.openGraph?.images, [{ url: "https://tienda.eventoss.online/api/catalog/la-vajilla/cover/desktop?v=2026-10-19T03%3A00%3A00.000Z", alt: "La Vajilla" }]);
  assert.equal((metadata.twitter as unknown as Record<string, unknown>)?.card, "summary_large_image");
  assert.equal(metadata.robots && typeof metadata.robots === "object" && "index" in metadata.robots ? metadata.robots.index : null, true);
});

test("store metadata rejects a social image belonging to another tenant", () => {
  const metadata = storefrontMetadata({
    organizationSlug: "la-vajilla",
    organizationName: "La Vajilla",
    title: "La Vajilla",
    description: "Catálogo de La Vajilla.",
    canonicalPath: "/tienda/la-vajilla",
    socialImagePath: "/api/catalog/ledbox/cover/desktop?v=other-tenant",
    indexable: true,
  }, "https://tienda.eventoss.online");

  assert.equal(metadata.openGraph?.images, undefined);
  assert.equal(metadata.twitter?.images, undefined);
  assert.equal((metadata.twitter as unknown as Record<string, unknown>)?.card, "summary");
});

test("store metadata rejects escaped or external tenant image paths", () => {
  for (const socialImagePath of [
    "//attacker.example/image.png",
    "/api/catalog/la-vajilla/%2e%2e/ledbox/cover.png",
    "/api/catalog/la-vajilla/cover.png#private-fragment",
  ]) {
    const metadata = storefrontMetadata({
      organizationSlug: "la-vajilla",
      organizationName: "La Vajilla",
      title: "La Vajilla",
      description: "Catálogo de La Vajilla.",
      canonicalPath: "/tienda/la-vajilla",
      socialImagePath,
      indexable: true,
    }, "https://tienda.eventoss.online");
    assert.equal(metadata.openGraph?.images, undefined, socialImagePath);
  }
});

test("private storefront metadata is noindex and does not expose a social image", () => {
  const metadata = storefrontMetadata({
    organizationSlug: "la-vajilla",
    organizationName: "La Vajilla",
    title: "La Vajilla · Catálogo privado",
    description: "Catálogo privado.",
    canonicalPath: "/tienda/la-vajilla/mayorista/private-token",
    socialImagePath: "/api/catalog/la-vajilla/cover/desktop?v=secret-ish",
    indexable: false,
  });

  assert.equal(metadata.openGraph?.images, undefined);
  assert.equal(metadata.twitter?.images, undefined);
  assert.equal(metadata.robots && typeof metadata.robots === "object" && "index" in metadata.robots ? metadata.robots.index : null, false);
  assert.equal(metadata.referrer, "no-referrer");
});

test("canonical origin ignores request hosts and has a safe invalid-origin fallback", () => {
  assert.equal(storeAbsoluteUrl("/tienda/la-vajilla", "https://eventoss.online"), "https://eventoss.online/tienda/la-vajilla");
  assert.equal(storeAbsoluteUrl("/tienda/la-vajilla", "javascript:alert(1)"), "https://ledbox.online/tienda/la-vajilla");
});

test("tenant favicon override is isolated to storefront routes; app brand remains global", () => {
  const storeLayout = readFileSync("app/(catalogo)/tienda/[orgSlug]/layout.tsx", "utf8");
  const adminLayout = readFileSync("app/layout.tsx", "utf8");
  assert.match(storeLayout, /loadStoreFavicon\(context\.organization\.id, context\.organization\.slug\)/);
  assert.match(storeLayout, /metadataBase/);
  assert.match(adminLayout, /url: "\/icon\.svg"/);
});

test("public canonical pages use the shared tenant SEO builder and private pages stay noindex", () => {
  const routes = [
    "app/(catalogo)/tienda/[orgSlug]/page.tsx",
    "app/(catalogo)/tienda/[orgSlug]/categoria/[categoria]/page.tsx",
    "app/(catalogo)/tienda/[orgSlug]/c/[coleccion]/page.tsx",
    "app/(catalogo)/tienda/[orgSlug]/p/[code]/page.tsx",
  ];
  for (const route of routes) assert.match(readFileSync(route, "utf8"), /storefrontMetadata\(/, route);

  for (const route of [
    "app/(catalogo)/tienda/[orgSlug]/acceso/[token]/page.tsx",
    "app/(catalogo)/tienda/[orgSlug]/mayorista/[token]/page.tsx",
    "app/(catalogo)/tienda/[orgSlug]/carrito/[token]/page.tsx",
  ]) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /index: false, follow: false/, route);
    assert.match(source, /referrer: "no-referrer"/, route);
  }
});
