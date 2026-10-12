import assert from "node:assert/strict";
import { test } from "node:test";
import { completeGlyphCoverage, withinLabelInterval } from "./signature-print-glyph-oracle";

test("native coverage rejects a missing middle glyph although every line has boxes", () => {
  const lines = [{ glyphs: [{ text: "A", offset: 0 }] }, { glyphs: [{ text: "C", offset: 2 }] }];
  assert.equal(completeGlyphCoverage(lines, "ABC").complete, false);
});
test("native coverage rejects duplicate offsets masquerading as repeated letters", () => {
  assert.equal(completeGlyphCoverage([{ glyphs: [{ text: "A", offset: 0 }, { text: "A", offset: 0 }] }], "AA").complete, false);
});
test("native coverage preserves every composed character across reordered multiline boxes", () => {
  const lines = [{ glyphs: [{ text: "B", offset: 3 }] }, { glyphs: [{ text: "Á", offset: 0 }] }];
  assert.equal(completeGlyphCoverage(lines, "A\u0301 B").complete, true);
});
test("equal timestamp tokens bind to their own label, never first occurrence or both", () => {
  const created = { page: 2, top: 100, bottom: 110 }, signed = { page: 2, top: 150, bottom: 160 };
  const values = [{ page: 2, top: 112, bottom: 125 }, { page: 2, top: 162, bottom: 175 }];
  assert.deepEqual(withinLabelInterval(values, created, signed), [values[0]]);
  assert.deepEqual(withinLabelInterval(values, signed, undefined), [values[1]]);
  assert.deepEqual(withinLabelInterval(values, undefined, signed), []);
});
