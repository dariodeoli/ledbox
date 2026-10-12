import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateRecovery, recoveryCLI } from "../scripts/pilot-inventory-recovery.mjs";

// Synthetic local evidence, never authenticated product QA or an OPS ownership claim.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pilot-recovery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const expected = { sourceSHA: "a".repeat(40), sourceTree: "b".repeat(40), sourceRef: "slot/test-only", organizationId: "tenant-test" };
  const owner = { ownerId: "fixture-author", ownerSession: "fixture-session", organizationId: expected.organizationId };
  const trace = { schema: 1, ...expected, unitId: "unit-test", ownerId: owner.ownerId, ownerSession: owner.ownerSession,
    inventoryTrace: [{ inventoryId: "inventory-test", action: "recorded", recordedUTC: "2026-10-12T15:23:00Z" }] };
  const path = join(root, "trace.json");
  const seal = (value = trace) => {
    const bytes = typeof value === "string" ? value : JSON.stringify(value);
    writeFileSync(path, bytes); return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
  };
  const input = { schema: 1, expected, ownerRegistry: [owner], units: [{ unitId: trace.unitId, ownerId: owner.ownerId,
    ownerSession: owner.ownerSession, reference: seal() }] };
  return { root, trace, input, seal };
}

test("valid structured trace validates offline without inventing product values", t => {
  const { input } = fixture(t), output = validateRecovery(input);
  assert.equal(output.status, "TRACE_VALIDATED_OFFLINE");
  assert.equal(output.units[0].status, "TRACE_VALIDATED_OFFLINE");
  assert.equal(output.productPASS, false); assert.equal(output.product100, false);
  for (const key of ["quantity", "cost", "knownAuthor", "provenancePASS", "count"]) assert.equal(key in output, false);
});
for (const empty of [null, undefined, {}, { schema: 1 }, { schema: 1, expected: null }])
  test(`missing input ${JSON.stringify(empty)} is NOT_RUN with field`, () => {
    const output = validateRecovery(empty); assert.equal(output.status, "NOT_RUN"); assert.ok(output.field);
    assert.equal("units" in output, false);
  });
for (const units of [null, [], undefined]) test(`absent units ${JSON.stringify(units)} never become zero`, t => {
  const { input } = fixture(t); input.units = units;
  const output = validateRecovery(input); assert.equal(output.status, "NOT_RUN"); assert.match(output.field, /units/);
  assert.equal("units" in output, false);
});
for (const identity of ["ownerId", "ownerSession"]) test(`unknown ${identity} is NOT_RUN`, t => {
  const { input } = fixture(t); input.units[0][identity] = "unknown";
  const output = validateRecovery(input); assert.equal(output.status, "NOT_RUN"); assert.match(output.units[0].field, /unknown/);
});
test("registry from another tenant cannot establish identity", t => {
  const { input } = fixture(t); input.ownerRegistry[0].organizationId = "foreign";
  assert.equal(validateRecovery(input).status, "NOT_RUN");
});
for (const reference of [null, {}, { path: "missing" }]) test(`missing reference ${JSON.stringify(reference)}`, t => {
  const { input } = fixture(t); input.units[0].reference = reference;
  assert.match(validateRecovery(input).units[0].field, /reference/);
  assert.equal(validateRecovery(input).status, "NOT_RUN");
});
test("missing local bytes remain NOT_RUN", t => {
  const { input, root } = fixture(t); input.units[0].reference.path = join(root, "absent");
  assert.equal(validateRecovery(input).status, "NOT_RUN");
});
test("empty referenced output is NOT_RUN", t => {
  const { input, seal } = fixture(t); input.units[0].reference = seal(" \n");
  assert.equal(validateRecovery(input).status, "NOT_RUN");
});
test("tampered raw bytes FAIL", t => {
  const { input, seal, trace } = fixture(t); seal({ ...trace, unitId: "tampered" });
  const output = validateRecovery(input); assert.equal(output.status, "FAIL"); assert.match(output.units[0].field, /hash mismatch/);
});
for (const key of ["sourceSHA", "sourceTree", "sourceRef", "organizationId", "ownerId", "ownerSession", "unitId"])
  test(`sealed foreign ${key} FAIL`, t => {
    const { input, trace, seal } = fixture(t); trace[key] = key === "sourceSHA" || key === "sourceTree" ? "c".repeat(40) : "foreign";
    input.units[0].reference = seal(); assert.equal(validateRecovery(input).status, "FAIL");
  });
test("empty structured trace remains NOT_RUN", t => {
  const { input, trace, seal } = fixture(t); trace.inventoryTrace = []; input.units[0].reference = seal();
  assert.equal(validateRecovery(input).status, "NOT_RUN");
});
test("invalid UTC fails without inventing timestamp", t => {
  const { input, trace, seal } = fixture(t); trace.inventoryTrace[0].recordedUTC = "not-a-dateZ";
  input.units[0].reference = seal(); assert.equal(validateRecovery(input).status, "FAIL");
});
test("duplicate units fail and mixed unknown unit prevents aggregate validation", t => {
  const { input } = fixture(t); input.units.push({ ...input.units[0] });
  assert.equal(validateRecovery(input).status, "FAIL");
  input.units[1] = { ...input.units[0], unitId: "unresolved", ownerId: "unknown" };
  const output = validateRecovery(input); assert.equal(output.status, "NOT_RUN");
  assert.equal(output.units[0].status, "TRACE_VALIDATED_OFFLINE"); assert.equal(output.units[1].status, "NOT_RUN");
});
test("CLI returns actual structured output and distinct exits for empty, unknown and tampered", t => {
  const { input, root, seal, trace } = fixture(t), path = join(root, "input.json");
  const run = () => {
    writeFileSync(path, JSON.stringify(input));
    const process = spawnSync(globalThis.process.execPath, ["scripts/pilot-inventory-recovery.mjs", path], { encoding: "utf8" });
    assert.equal(process.stderr, ""); return { exit: process.status, output: JSON.parse(process.stdout) };
  };
  assert.equal(run().exit, 0);
  input.units[0].ownerId = "unknown"; assert.equal(run().exit, 2);
  input.units[0].ownerId = trace.ownerId; seal("tampered"); assert.equal(run().exit, 1);
  writeFileSync(path, ""); assert.equal(recoveryCLI([path]).exitCode, 2);
  writeFileSync(path, "null"); assert.equal(recoveryCLI([path]).output.status, "NOT_RUN");
  assert.equal(recoveryCLI([]).exitCode, 2); assert.equal(recoveryCLI([join(root, "absent")]).exitCode, 2);
});
