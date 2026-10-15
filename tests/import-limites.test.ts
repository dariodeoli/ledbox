import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CATALOG_LIMITS } from "../lib/import-catalog";

test("importar fotos: tope de memoria del descomprimido y de píxeles", () => {
  assert.equal(CATALOG_LIMITS.zipInflatedBytes, 150 * 1024 * 1024);
  const source = readFileSync(new URL("../lib/server/import-photos.ts", import.meta.url), "utf8");
  assert.match(source, /limitInputPixels:\s*40_000_000/);
});
