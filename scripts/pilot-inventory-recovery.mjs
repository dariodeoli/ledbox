#!/usr/bin/env node
/** Local evidence only. Registry is supplied independently; no product repair or QA. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
const text = value => typeof value === "string" && value.trim().length > 0;
class Missing extends Error {}
const need = (condition, field) => { if (!condition) throw new Missing(field); };
const check = (condition, field) => { if (!condition) throw new Error(field); };
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const result = (status, field, unitId = null) => ({ status, unitId, field, productPASS: false, product100: false });

function binding(value, expected, label) {
  need(value && SHA.test(value.sourceSHA ?? "") && SHA.test(value.sourceTree ?? "")
    && text(value.sourceRef) && text(value.organizationId), `${label}.binding`);
  for (const key of ["sourceSHA", "sourceTree", "sourceRef", "organizationId"])
    check(value[key] === expected[key], `${label}.${key}: mismatch`);
}

/** schema1: expected binding, independent ownerRegistry, units[{unitId,ownerId,ownerSession,reference}].
 * Each referenced JSON is {schema:1,unitId,ownerId,ownerSession,...binding,inventoryTrace:[{inventoryId,action,recordedUTC}]}.
 * A validated trace makes no claim about product state, quantities, costs or authenticated provenance.
 */
export function validateRecovery(input) {
  try {
    need(input?.schema === 1, "schema");
    const expected = input.expected;
    binding(expected, expected, "expected");
    need(Array.isArray(input.ownerRegistry) && input.ownerRegistry.length > 0, "ownerRegistry");
    const identities = new Set();
    for (const owner of input.ownerRegistry) {
      need(text(owner?.ownerId) && text(owner.ownerSession) && text(owner.organizationId), "ownerRegistry.identity");
      const key = JSON.stringify([owner.ownerId, owner.ownerSession, owner.organizationId]);
      check(!identities.has(key), "ownerRegistry.duplicateIdentity"); identities.add(key);
    }
    need(Array.isArray(input.units) && input.units.length > 0, "units: no recovery output");
    const ids = new Set();
    const units = input.units.map((unit, index) => {
      try {
        need(text(unit?.unitId), `units[${index}].unitId`);
        check(!ids.has(unit.unitId), `units[${index}].duplicateUnitId`); ids.add(unit.unitId);
        need(text(unit.ownerId) && text(unit.ownerSession), `units[${index}].ownerIdentity`);
        need(identities.has(JSON.stringify([unit.ownerId, unit.ownerSession, expected.organizationId])),
          `units[${index}].ownerIdentity: unknown in supplied registry`);
        const ref = unit.reference;
        need(text(ref?.path) && HASH.test(ref.sha256 ?? ""), `units[${index}].reference.path/sha256`);
        let bytes;
        try { bytes = readFileSync(ref.path); }
        catch (error) { if (error.code === "ENOENT") throw new Missing(`units[${index}].reference: missing file`); throw error; }
        need(bytes.toString("utf8").trim().length > 0, `units[${index}].reference: empty output`);
        check(digest(bytes) === ref.sha256, `units[${index}].reference: hash mismatch`);
        const trace = JSON.parse(bytes.toString("utf8"));
        need(trace?.schema === 1, `units[${index}].trace.schema`);
        binding(trace, expected, `units[${index}].trace`);
        for (const key of ["unitId", "ownerId", "ownerSession"])
          check(trace[key] === unit[key], `units[${index}].trace.${key}: mismatch`);
        need(Array.isArray(trace.inventoryTrace) && trace.inventoryTrace.length > 0,
          `units[${index}].inventoryTrace: no recovery output`);
        trace.inventoryTrace.forEach((entry, position) => {
          need(text(entry?.inventoryId) && text(entry.action) && text(entry.recordedUTC),
            `units[${index}].inventoryTrace[${position}].inventoryId/action/recordedUTC`);
          check(/Z$/.test(entry.recordedUTC) && Number.isFinite(Date.parse(entry.recordedUTC)),
            `units[${index}].inventoryTrace[${position}].recordedUTC: invalid UTC`);
        });
        return { ...result("TRACE_VALIDATED_OFFLINE", null, unit.unitId), reference: { ...ref } };
      } catch (error) { return result(error instanceof Missing ? "NOT_RUN" : "FAIL", error.message, unit?.unitId ?? null); }
    });
    const status = units.some(unit => unit.status === "FAIL") ? "FAIL"
      : units.some(unit => unit.status === "NOT_RUN") ? "NOT_RUN" : "TRACE_VALIDATED_OFFLINE";
    return { ...result(status, null), units };
  } catch (error) { return result(error instanceof Missing ? "NOT_RUN" : "FAIL", error.message); }
}

export function recoveryCLI(argv) {
  let output;
  try {
    need(argv.length === 1 && text(argv[0]), "usage: node scripts/pilot-inventory-recovery.mjs <local-input.json>");
    let bytes;
    try { bytes = readFileSync(argv[0], "utf8"); }
    catch (error) { if (error.code === "ENOENT") throw new Missing("input: missing file"); throw error; }
    need(bytes.trim().length > 0, "input: empty output");
    output = validateRecovery(JSON.parse(bytes));
  } catch (error) { output = result(error instanceof Missing ? "NOT_RUN" : "FAIL", error.message); }
  return { output, exitCode: output.status === "TRACE_VALIDATED_OFFLINE" ? 0 : output.status === "NOT_RUN" ? 2 : 1 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { output, exitCode } = recoveryCLI(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); process.exitCode = exitCode;
}
