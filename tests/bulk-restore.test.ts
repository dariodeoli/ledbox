import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreTrashBatch, type RestoreCandidate } from "../lib/bulk-restore";

const row = (id: string, restorable = true): RestoreCandidate => ({ key: `Client:${id}`, id, name: `Cliente ${id}`, restorable });

test("bulk restore sends only explicit eligible rows, in order, and reports per-row conflicts", async () => {
  const calls: string[] = [];
  const report = await restoreTrashBatch([row("a"), row("anon", false), row("b")], async (candidate) => {
    calls.push(candidate.id);
    return candidate.id === "b" ? { ok: false, error: "Ya no está en la papelera." } : { ok: true };
  });
  assert.deepEqual(calls, ["a", "b"]);
  assert.deepEqual(report.map(({ status }) => status), ["success", "blocked", "failed"]);
  assert.equal(report[1].message, "No se puede restaurar este registro.");
  assert.equal(report[2].message, "Ya no está en la papelera.");
});

test("bulk restore stops after an uncertain response and never retries or sends later rows", async () => {
  const calls: string[] = [];
  const report = await restoreTrashBatch([row("a"), row("b"), row("c")], async (candidate) => {
    calls.push(candidate.id);
    return candidate.id === "b" ? { ok: false, uncertain: true } : { ok: true };
  });
  assert.deepEqual(calls, ["a", "b"]);
  assert.deepEqual(report.map(({ status }) => status), ["success", "unknown"]);
  assert.match(report[1].message, /no se reintentó/i);
});

test("a thrown connection failure is treated as uncertain and halts the batch", async () => {
  const calls: string[] = [];
  const report = await restoreTrashBatch([row("a"), row("b")], async (candidate) => {
    calls.push(candidate.id);
    if (candidate.id === "a") throw new Error("socket closed");
    return { ok: true };
  });
  assert.deepEqual(calls, ["a"]);
  assert.equal(report[0].status, "unknown");
});
