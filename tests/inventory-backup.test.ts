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
