type Glyph = { text: string; offset: number };
type Line = { glyphs: Glyph[] };
const visible = (text: string) => text.normalize("NFC").replace(/\s/gu, "");

/** Presence of some glyphs is not full coverage. Offset identity prevents one
 * matched character being counted twice when native line boxes overlap. */
export function completeGlyphCoverage(lines: Line[], expected: string, caseInsensitive = false) {
  const glyphs = lines.flatMap(line => line.glyphs);
  const offsets = new Set<number>();
  let unique = true;
  for (const glyph of glyphs) {
    if (!Number.isInteger(glyph.offset) || glyph.offset < 0 || offsets.has(glyph.offset) || !visible(glyph.text)) unique = false;
    offsets.add(glyph.offset);
  }
  const actual = glyphs.slice().sort((a, b) => a.offset - b.offset).map(glyph => glyph.text).join("");
  const comparable = (text: string) => caseInsensitive ? visible(text).toUpperCase() : visible(text);
  return { complete: unique && glyphs.length > 0 && comparable(actual) === comparable(expected), expected: visible(expected), actual: visible(actual), uniqueOffsets: unique };
}
export function withinLabelInterval<T extends { page: number; top: number; bottom: number }>(boxes: T[], label: T | undefined, next: T | undefined) {
  return boxes.filter(box => label && box.page === label.page && box.top >= label.bottom - .1
    && (!next || next.page !== label.page || box.bottom <= next.top + .1));
}
