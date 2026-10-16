import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync, strToU8 } from "fflate";
import { BACKUP_MODELS, backupHash, readInventoryBackup } from "../lib/server/inventory-backup";
const empty = (): Record<string, any[]> => Object.fromEntries(BACKUP_MODELS.map(name => [name, []]));
function pack(data: unknown, extra: Record<string, Uint8Array> = {}, version = 1) {
  const files = { "data.json": strToU8(JSON.stringify(data)), ...extra };
  return zipSync({ ...files, "manifest.json": strToU8(JSON.stringify({ format: "ledbox-inventory-backup", version, files: Object.entries(files).map(([path, b]) => ({ path, bytes: b.length, sha256: backupHash(b) })) })) });
}
test("bounded portable backup validates complete declared graph and empty preview without database writes", () => {
  const result = readInventoryBackup(pack(empty())); assert.equal(result.assetBytes, 0); assert.equal(result.summary.InventoryUnit, 0); assert.equal(result.digest.length, 64);
});
test("unrecognized scope/version/paths and tampered checksums are rejected, not restored partially", () => {
  for (const input of [pack({ ...empty(), AdminUser: [] }), pack(empty(), {}, 2), pack(empty(), { "../escape": strToU8("bad") }), pack(empty(), { "surprise.txt": strToU8("bad") }), new Uint8Array([1, 2, 3])]) assert.throws(() => readInventoryBackup(input));
  const file = strToU8(JSON.stringify(empty())); const input = zipSync({ "data.json": file, "manifest.json": strToU8(JSON.stringify({ format: "ledbox-inventory-backup", version: 1, files: [{ path: "data.json", bytes: file.length, sha256: "wrong" }] })) }); assert.throws(() => readInventoryBackup(input), /manifiesto/);
});
test("credentials and unknown scalar fields are not accepted even in an otherwise valid entity", () => {
  const data = empty(); data.Supplier = [{ passwordHash: "secret" }]; assert.throws(() => readInventoryBackup(pack(data)), /Campos no permitidos/);
});

function mutateHeaders(archive: Uint8Array, filename: string, changes: { length?: number; crc?: number }) {
  const out = archive.slice(), view = new DataView(out.buffer);
  let at = view.getUint32(out.length - 22 + 16, true);
  while (view.getUint32(at, true) === 0x02014b50) {
    const length = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    if (new TextDecoder().decode(out.subarray(at + 46, at + 46 + length)) === filename) {
      const local = view.getUint32(at + 42, true);
      if (changes.length !== undefined) { view.setUint32(at + 24, changes.length, true); view.setUint32(local + 22, changes.length, true); }
      if (changes.crc !== undefined) { view.setUint32(at + 16, changes.crc, true); view.setUint32(local + 14, changes.crc, true); }
      return out;
    }
    at += 46 + length + extra + comment;
  }
  throw new Error("Fixture entry missing");
}
test("forged ZIP output size cannot truncate a >20MiB bomb into a valid manifest prefix", () => {
  const prefix = strToU8(JSON.stringify(empty()));
  const actual = new Uint8Array(prefix.length + 21 * 1024 * 1024); actual.fill(32); actual.set(prefix);
  const archive = zipSync({ "data.json": actual, "manifest.json": strToU8(JSON.stringify({ format: "ledbox-inventory-backup", version: 1, files: [{ path: "data.json", bytes: prefix.length, sha256: backupHash(prefix) }] })) }, { level: 1 });
  const forged = mutateHeaders(archive, "data.json", { length: prefix.length });
  assert.ok(forged.byteLength < 30_000);
  assert.throws(() => readInventoryBackup(forged), /realmente descomprimidos|tamaño declarado|límite/);
});
test("CRC32 and exact local/central lengths must match decoded bytes, even when manifest hashes are valid", () => {
  const archive = pack(empty());
  assert.throws(() => readInventoryBackup(mutateHeaders(archive, "data.json", { crc: 0 })), /CRC32/);
  assert.throws(() => readInventoryBackup(mutateHeaders(archive, "data.json", { length: 1 })), /descomprimidos|tamaño/);
  const inconsistent = archive.slice(); new DataView(inconsistent.buffer).setUint32(22, 1, true);
  assert.throws(() => readInventoryBackup(inconsistent), /cabecera|directorio/);
});
