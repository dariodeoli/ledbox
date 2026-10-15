import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DELIVERY_NOTE_PHOTO_MAX_BYTES,
  checkDeliveryPhoto,
  deliveryNoteNumberLabel,
  deliveryNoteTotals,
  mergeDeliveryNoteLine,
  parseDeliveryNoteSigner,
  readDeliveryNoteLines,
  type DeliveryNoteLine,
} from "../lib/delivery-note";

const line = (overrides: Partial<DeliveryNoteLine> = {}): DeliveryNoteLine => ({
  assignmentId: "a1",
  inventoryId: "i1",
  name: "Silla",
  sku: null,
  ordered: 10,
  moved: 4,
  damaged: 0,
  missing: 0,
  ...overrides,
});

test("una salida parcial queda con lo despachado y lo pedido aparte", () => {
  const lines = mergeDeliveryNoteLine([], line());
  assert.deepEqual(deliveryNoteTotals(lines), { moved: 4, damaged: 0, missing: 0 });
  assert.equal(lines[0].ordered, 10);
});

test("despachos del mismo ítem antes de firmar se acumulan en una sola línea", () => {
  const lines = mergeDeliveryNoteLine(mergeDeliveryNoteLine([], line()), line({ moved: 3 }));
  assert.equal(lines.length, 1);
  assert.equal(lines[0].moved, 7);
  const other = mergeDeliveryNoteLine(lines, line({ assignmentId: "a2", name: "Mesa" }));
  assert.equal(other.length, 2);
});

test("la lectura del snapshot descarta lo que no tiene la forma esperada", () => {
  assert.deepEqual(readDeliveryNoteLines(null), []);
  const read = readDeliveryNoteLines([{ assignmentId: "a", name: "X", moved: -3, ordered: 2.5 }, 7, { name: "sin id" }]);
  assert.equal(read.length, 1);
  assert.equal(read[0].moved, 0);
  assert.equal(read[0].ordered, 0);
});

test("el firmante necesita nombre y documento", () => {
  assert.equal(parseDeliveryNoteSigner({ name: "  ", document: "123" }).ok, false);
  assert.equal(parseDeliveryNoteSigner({ name: "Juan Pérez", document: "" }).ok, false);
  const ok = parseDeliveryNoteSigner({ name: "  Juan   Pérez ", document: " 1.234.567 " });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.value, { name: "Juan Pérez", document: "1.234.567" });
});

test("el número se muestra con ceros a la izquierda", () => {
  assert.equal(deliveryNoteNumberLabel(12), "Nº 000012");
});

test("la foto se valida por magic bytes: un archivo renombrado se rechaza", () => {
  const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
  const fake = checkDeliveryPhoto(html);
  assert.equal(fake.ok, false);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
  assert.deepEqual(checkDeliveryPhoto(jpeg), { ok: true, mime: "image/jpeg" });
  const big = new Uint8Array(DELIVERY_NOTE_PHOTO_MAX_BYTES + 1);
  big.set(jpeg);
  const tooBig = checkDeliveryPhoto(big);
  assert.ok(!tooBig.ok && tooBig.status === 413);
  assert.equal(checkDeliveryPhoto(new Uint8Array()).ok, false);
});

test("firmar y subir fotos exigen events.write y los GET quedan abiertos a todos los roles", () => {
  const read = (path: string) => readFileSync(new URL(`../app/api/admin/delivery-notes/${path}`, import.meta.url), "utf8");
  assert.match(read("[id]/sign/route.ts"), /requireAdminContext\("events\.write"\)/);
  assert.match(read("[id]/photos/route.ts"), /requireAdminContext\("events\.write"\)/);
  assert.match(read("[id]/photos/[photoId]/route.ts"), /export async function DELETE[\s\S]*requireAdminContext\("events\.write"\)/);
  for (const file of ["route.ts", "[id]/route.ts", "[id]/signature/route.ts"]) assert.match(read(file), /requireAdminContext\(\)/);
});

test("el movimiento genera el remito dentro de la misma transacción", () => {
  const source = readFileSync(new URL("../lib/server/inventory-operations.ts", import.meta.url), "utf8");
  assert.match(source, /recordDeliveryNoteLine\(tx, \{[\s\S]*kind: "OUT"/);
  assert.match(source, /recordDeliveryNoteLine\(tx, \{[\s\S]*kind: "IN"/);
});
