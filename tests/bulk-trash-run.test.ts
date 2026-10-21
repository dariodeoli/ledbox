import assert from "node:assert/strict";
import { test } from "node:test";
import { readStoredTrashOutcomes } from "../lib/bulk-trash-run";

test("bulk trash reports keep only explicit IDs, names, safe statuses, and bounded messages", () => {
  assert.deepEqual(readStoredTrashOutcomes([{ row: { id: "Client:c1", name: "Ana", archivedAt: null }, status: "success", message: "Restaurado" }]), [
    { id: "Client:c1", name: "Ana", status: "success", message: "Restaurado" },
  ]);
  assert.equal(readStoredTrashOutcomes([{ id: "x", name: "X", status: "other", message: "ok" }]), null);
  assert.equal(readStoredTrashOutcomes([{ id: "x", name: "X", status: "failed", message: "x".repeat(501) }]), null);
  assert.equal(readStoredTrashOutcomes(Array.from({ length: 2001 }, (_, id) => ({ id: String(id), name: "X", status: "success", message: "ok" }))), null);
});
