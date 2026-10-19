import assert from "node:assert/strict";
import { test } from "node:test";
import { PRODUCT_LANDING_VARIANTS, isProductLandingVariant, productLandingPreviewMetadata, productLandingPreviewPath } from "../lib/product-landing-previews";

test("three product landing previews have isolated noindex metadata and share cards", () => {
  const variants = ["a", "b", "c"] as const;
  const metadata = variants.map((variant) => productLandingPreviewMetadata(variant));
  assert.deepEqual(variants.map((variant) => productLandingPreviewPath(variant)), [
    "/preview/landing/a", "/preview/landing/b", "/preview/landing/c",
  ]);
  assert.equal(new Set(metadata.map((entry) => entry.title)).size, 3);
  assert.equal(new Set(metadata.map((entry) => entry.openGraph?.url)).size, 3);
  for (const entry of metadata) {
    assert.equal(typeof entry.robots, "object");
    if (typeof entry.robots !== "object" || !entry.robots) throw new Error("Missing robots metadata");
    assert.equal(entry.robots.index, false);
    assert.equal(entry.robots.follow, false);
    const ogImages = Array.isArray(entry.openGraph?.images) ? entry.openGraph.images : [entry.openGraph?.images];
    const twitterImages = Array.isArray(entry.twitter?.images) ? entry.twitter.images : [entry.twitter?.images];
    const ogUrl = typeof ogImages[0] === "string" ? ogImages[0] : ogImages[0] instanceof URL ? ogImages[0].toString() : ogImages[0]?.url;
    const twitterUrl = typeof twitterImages[0] === "string" ? twitterImages[0] : twitterImages[0] instanceof URL ? twitterImages[0].toString() : twitterImages[0]?.url;
    assert.equal(ogUrl, twitterUrl);
    assert.match(String(ogUrl), /\/og$/);
  }
});

test("preview route accepts only the three published comparison keys", () => {
  assert.equal(isProductLandingVariant("a"), true);
  assert.equal(isProductLandingVariant("b"), true);
  assert.equal(isProductLandingVariant("c"), true);
  assert.equal(isProductLandingVariant("d"), false);
  assert.deepEqual(Object.keys(PRODUCT_LANDING_VARIANTS).sort(), ["a", "b", "c"]);
});
