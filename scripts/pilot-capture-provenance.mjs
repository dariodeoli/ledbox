#!/usr/bin/env node
/** Offline provenance gate for the same Pilot173 case. No transport, credentials, browser or DB. */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashBytes, HEAVY_ISSUER } from "./pilot-differential.mjs";
import { TARGET, OWNER_SESSION, readPlan, validateCapture } from "./pilot-ops-calendar-flow.mjs";

const SHA = /^[a-f0-9]{40}$/, HASH = /^[a-f0-9]{64}$/;
class MissingInput extends Error { constructor(field) { super(field); this.field = field; } }
const need = (condition, field) => { if (!condition) throw new MissingInput(field); };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const timestamp = (value, field) => { need(typeof value === "string", field); const t = Date.parse(value); assert(Number.isFinite(t), `Invalid UTC: ${field}`); assert(/(?:Z|\+00:00)$/.test(value), `Non-UTC: ${field}`); return t; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function referenced(ref, field, index) {
  need(typeof ref?.path === "string" && HASH.test(ref.sha256 ?? ""), `${field}.path/sha256`);
  const bytes = readFileSync(ref.path), path = realpathSync(ref.path), stat = statSync(path);
  assert(hashBytes(bytes) === ref.sha256, `Raw byte hash mismatch: ${field}`);
  index.push({ field, path, sha256: ref.sha256, inode: `${stat.dev}:${stat.ino}` });
  return bytes;
}
const document = (ref, field, index) => JSON.parse(referenced(ref, field, index).toString("utf8"));
function independent(a, b, label) {
  assert(a.path !== b.path && a.inode !== b.inode && a.sha256 !== b.sha256, `Expected/observed reference reuse: ${label}`);
}
const bound = (value, label) => assert(value.sha === TARGET.sha && value.version === TARGET.version, `Wrong source/version: ${label}`);

/** Only local file validation. A successful result explicitly remains NOT_PRODUCT_PASS. */
export function validateProvenance(bundle) {
  const index = [];
  try {
    need(bundle && !bundle.templateOnly, "Actual provenance bundle (not nullable template)");
    for (const key of ["expectations", "custody", "capture", "grant"]) need(bundle[key], `${key} reference`);
    const expected = document(bundle.expectations, "expectations", index);
    need(expected.organizationId && expected.role && expected.range?.from && expected.range?.to
      && Array.isArray(expected.inventory) && expected.inventory.length > 0 && Array.isArray(expected.events) && expected.events.length > 0, "Owner values: role/org/range/nonzero inventory and original events");
    assert(!expected.templateOnly, "Expectations template not actual fixture"); bound(expected, "expectations");
    const custody = document(bundle.custody, "custody", index), capture = document(bundle.capture, "capture", index), grant = document(bundle.grant, "grant", index);
    assert(!custody.templateOnly && !capture.templateOnly, "Custody/capture template not actual evidence");
    bound(capture, "capture"); bound(custody.runtime ?? {}, "custody runtime");
    need(custody.channel?.connectionEvent && custody.session?.bindingID && custody.session?.role && custody.session?.organizationId, "Actual connection event/session role/org binding");
    assert(custody.ownerSession === OWNER_SESSION && custody.channel.ownerSession === OWNER_SESSION, "Wrong original owner session");
    assert(custody.session.authorized === true && custody.session.role === expected.role
      && custody.organizationId === expected.organizationId && custody.session.organizationId === expected.organizationId, "Wrong role/org custody");
    assert(custody.runtime.custodyApproved === true && HASH.test(custody.runtime.bindingEvidenceSHA256 ?? ""), "Runtime custody not bound");
    assert(custody.readScope?.authorized === true && custody.readScope.effects === "NONE" && custody.readScope.viewedAtAllowed === false, "Effectful/unapproved read scope");
    const connection = document(custody.channel.connectionEvent, "connectionEvent", index);
    assert(connection.ownerSession === OWNER_SESSION && connection.connected === true && connection.bindingID === capture.channelBindingID, "Connection event not bound");
    assert(capture.sessionBindingID === custody.session.bindingID && capture.organizationId === expected.organizationId && capture.role === expected.role, "Capture session role/org mismatch");

    need(capture.execution?.source && capture.execution?.tree && capture.execution?.argv && capture.execution?.runtimeSHA256, "Actual capture source/tree/argv/runtime pins");
    assert(SHA.test(capture.execution.source) && SHA.test(capture.execution.tree) && HASH.test(capture.execution.runtimeSHA256), "Malformed execution pins");
    assert(grant.kind === "DIRECT" && grant.grant === true && grant.issuerSession === HEAVY_ISSUER && grant.ownerSession === OWNER_SESSION
      && grant.action === "ops-calendar-readonly", "Wrong issuer/action DIRECT (old unit/closure grant forbidden)");
    assert(grant.source === capture.execution.source && grant.tree === capture.execution.tree && grant.target?.sha === TARGET.sha
      && grant.target.version === TARGET.version && grant.leaseID === capture.leaseID && custody.directLeaseID === grant.leaseID, "Grant source/target/lease mismatch");
    assert(Array.isArray(grant.stages) && grant.stages.length === 1 && same(grant.stages[0].argv, capture.execution.argv)
      && capture.execution.argv[0] === grant.runtime?.path && capture.execution.runtimeSHA256 === grant.runtime.sha256, "Grant argv/runtime mismatch");
    const sourcePins = bundle.executionSourceReferences;
    need(Array.isArray(sourcePins) && sourcePins.length > 0, "Execution source file references");
    assert(Object.keys(grant.sourcePins ?? {}).length === sourcePins.length, "Grant source pin count mismatch");
    for (const source of sourcePins) {
      assert(grant.sourcePins[source.relativePath] === source.reference?.sha256, "Grant/source file hash mismatch");
      referenced(source.reference, `source:${source.relativePath}`, index);
    }
    const start = timestamp(capture.startedUTC, "capture.startedUTC"), end = timestamp(capture.endedUTC, "capture.endedUTC");
    const issued = timestamp(grant.issuedUTC, "grant.issuedUTC"), startBy = timestamp(grant.START_BY, "grant.START_BY");
    assert(Number.isInteger(grant.MAXsecondsFromActualSTART) && grant.MAXsecondsFromActualSTART > 0
      && grant.MAXsecondsFromActualSTART <= 120 && Number.isFinite(grant.stages[0].maxSeconds)
      && grant.stages[0].maxSeconds > 0 && grant.stages[0].maxSeconds <= grant.MAXsecondsFromActualSTART, "Grant budget invalid");
    assert(start >= issued && start <= startBy && end >= start && end - start <= grant.stages[0].maxSeconds * 1000, "Capture outside actual grant window/budget");
    assert(timestamp(connection.UTC, "connection.UTC") <= start, "Connection event after capture");
    const captureUTC = timestamp(capture.captureUTC, "capture.captureUTC");
    assert(captureUTC >= start && captureUTC <= end, "Capture UTC outside execution");

    const baselines = expected.expectedFixtureReferences;
    need(baselines?.inventory && baselines.events, "Independent expectedFixtureReferences inventory/events");
    const expectedRefs = [];
    for (const kind of ["inventory", "events"]) {
      const source = baselines[kind], baseline = document(source.reference, `baseline:${kind}`, index);
      expectedRefs.push(index.at(-1)); bound(baseline, `baseline:${kind}`);
      assert(source.ownerSession && baseline.ownerSession === source.ownerSession && baseline.kind === "OWNER_BASELINE"
        && baseline.organizationId === expected.organizationId && baseline.phase === "PRE_CAPTURE", "Fixture source ownership/provenance mismatch");
      assert(timestamp(baseline.recordedUTC, `baseline:${kind}.recordedUTC`) <= start, "Baseline created after actual capture");
      assert(custody.approvedExpectedSources?.some(item => item.kind === kind && item.ownerSession === source.ownerSession
        && item.sha256 === source.reference.sha256), "Fixture reference not in custody-approved source list");
      assert(same(baseline[kind], expected[kind]), "Expected values differ from independent owner source");
    }
    const plan = readPlan(expected.range);
    need(Array.isArray(capture.responses) && capture.responses.length === 3, "Three actual raw response references");
    const responses = [], observedRefs = [];
    let previousUTC = start;
    for (let i = 0; i < plan.length; i++) {
      const row = capture.responses[i];
      assert(row.index === i && row.method === plan[i].method && row.path === plan[i].path && row.status === 200
        && row.sha === TARGET.sha && row.version === TARGET.version && row.redirected === false, "Response order/status/source/version mismatch");
      assert(row.organizationId === expected.organizationId && row.sessionBindingID === custody.session.bindingID && row.effects === "NONE", "Response custody/effect mismatch");
      const time = timestamp(row.UTC, `responses[${i}].UTC`);
      assert(time >= previousUTC && time <= captureUTC, "Response timestamp order/window mismatch"); previousUTC = time;
      const body = document(row.rawResponse, `rawResponse:${i}`, index); observedRefs.push(index.at(-1));
      responses.push({ method: row.method, path: row.path, status: row.status, body });
    }
    for (const expectedRef of expectedRefs) for (const observedRef of observedRefs) independent(expectedRef, observedRef, expectedRef.field);
    const metadata = index.find(item => item.field === "expectations");
    for (const observedRef of observedRefs) independent(metadata, observedRef, "expectations document");
    need(capture.visual?.dom && capture.visual.screenshot && capture.visual.UTC, "Actual DOM390/screenshot/hash/UTC evidence");
    const visualUTC = timestamp(capture.visual.UTC, "visual.UTC");
    assert(visualUTC >= previousUTC && visualUTC <= end && capture.visual.channelBindingID === connection.bindingID, "Visual channel/UTC mismatch");
    const dom = document(capture.visual.dom, "dom390", index);
    bound(dom, "DOM390");
    assert(dom.channelBindingID === connection.bindingID && dom.sessionBindingID === custody.session.bindingID
      && dom.organizationId === expected.organizationId && dom.role === expected.role && dom.UTC === capture.visual.UTC
      && dom.observationKind === "ACTUAL_AUTHORIZED_DOM" && dom.screenshotSHA256 === capture.visual.screenshot.sha256, "DOM provenance mismatch");
    const screenshot = referenced(capture.visual.screenshot, "screenshot390", index);
    assert(screenshot.length > 8 && screenshot.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Screenshot not PNG bytes");
    const caseResult = validateCapture({ responses, visual: dom.observation }, expected);
    return { status: "OFFLINE_PROVENANCE_VALIDATED_NOT_PRODUCT_PASS", target: TARGET, caseResult,
      captureSource: capture.execution.source, leaseID: capture.leaseID, verifiedReferences: index.map(({ inode, ...ref }) => ref),
      networkRequests: 0, runtimeExecutedByChecker: false, productFlowPASS: false, authenticatedProduct100: false };
  } catch (error) {
    return { status: error instanceof MissingInput ? "MISSING_INPUT" : "REJECTED_PROVENANCE",
      ...(error instanceof MissingInput ? { missing: error.field } : { reason: error.message }),
      target: TARGET, networkRequests: 0, runtimeExecutedByChecker: false, productFlowPASS: false, authenticatedProduct100: false };
  }
}

/** Consume original integrator adapter outputs without changing its bytes or inventing missing metadata. */
export function validateAdapterReceipt(input) {
  const index = [];
  try {
    for (const field of ["adapter", "adapterReceipt", "context", "runtimeCustody", "expectations"]) need(input?.[field], `${field} actual reference`);
    referenced(input.adapter, "adapter", index);
    const receipt = document(input.adapterReceipt, "adapterReceipt", index), context = document(input.context, "context", index);
    const custody = document(input.runtimeCustody, "runtimeCustody", index), expected = document(input.expectations, "expectations", index);
    const metadata = statSync(input.context.path);
    assert((metadata.mode & 0o077) === 0, "Private context permissions not owner-only");
    assert(receipt.status === "CAPTURE_BOUND_FOR_ORIGINAL_PILOT_VALIDATION_NOT_GLOBAL_PASS" && receipt.requests === 3
      && receipt.effects === "NONE" && receipt.productFlowPASS === false && receipt.globalPilotPASS === false, "Adapter receipt not completed scoped capture");
    bound(receipt.target ?? {}, "adapter target"); bound(custody, "runtime custody"); bound(expected, "expectations");
    assert(receipt.target.deployID === "rvrqkw2ppxvvv5ow4izhudhk" && custody.deployID === receipt.target.deployID
      && receipt.ownerSession === OWNER_SESSION && custody.ownerSession === OWNER_SESSION, "Adapter deployment/original owner mismatch");
    assert(custody.adapterSHA256 === input.adapter.sha256 && context.runtime?.bindingEvidenceSHA256 === input.runtimeCustody.sha256
      && custody.expectationsSHA256 === input.expectations.sha256 && custody.effects === "NONE", "Adapter input source/custody pins mismatch");
    assert(receipt.sessionBindingID === context.session?.bindingID && receipt.organizationId === expected.organizationId
      && receipt.role === expected.role && context.organizationId === expected.organizationId
      && context.session.role === expected.role && context.session.authorized === true
      && context.readScope?.authorized === true && context.readScope.effects === "NONE" && context.readScope.viewedAtAllowed === false
      && receipt.leaseID === context.direct?.leaseID, "Adapter session/role/org mismatch");
    for (const reference of [input.context, input.runtimeCustody, input.expectations]) {
      assert(receipt.inputs?.some(item => item.sha256 === reference.sha256 && realpathSync(item.path) === realpathSync(reference.path)), "Adapter receipt handed input reference mismatch");
    }
    const capture = document(receipt.capture, "adapter capture", index), plan = readPlan(expected.range);
    const raw = receipt.captures?.filter(item => item.kind !== "visual");
    need(Array.isArray(raw) && raw.length === 3 && Array.isArray(capture.responses) && capture.responses.length === 3, "Adapter three raw responses");
    const start = timestamp(receipt.startedAt, "adapter.startedAt"), end = timestamp(receipt.endedAt, "adapter.endedAt");
    assert(end >= start, "Adapter capture time reversed");
    let previous = start;
    for (let i = 0; i < 3; i++) {
      assert(raw[i].index === i && raw[i].method === "GET" && raw[i].path === plan[i].path && raw[i].status === 200, "Adapter response order/status mismatch");
      const t = timestamp(raw[i].capturedAt, `adapter response${i}.capturedAt`);
      assert(t >= previous && t <= end, "Adapter raw response UTC mismatch"); previous = t;
      const actual = document(raw[i].bodyReference, `adapter raw${i}`, index);
      assert(capture.responses[i].path === raw[i].path && capture.responses[i].method === "GET"
        && capture.responses[i].status === 200 && same(actual, capture.responses[i].body), "Adapter raw/capture JSON mismatch");
    }
    const visual = receipt.captures.filter(item => item.kind === "visual");
    need(visual.length === 1 && capture.visual, "Actual adapter390 observation/screenshot references (not supplied)");
    assert(visual[0].ownerSession === OWNER_SESSION, "Adapter visual foreign owner");
    const observation = document(visual[0].observationReference, "adapter DOM observation", index);
    referenced(visual[0].screenshotReference, "adapter screenshot", index);
    assert(same(observation, capture.visual), "Adapter DOM/capture observation mismatch");
    // The adapter's capture terminal is not a supervisor DIRECT or a connection/fixture attestation.
    need(input.provenanceBundle, "Actual connection event/independent fixture sources/supervised grant execution provenance bundle");
    const proof = validateProvenance(input.provenanceBundle);
    if (proof.status !== "OFFLINE_PROVENANCE_VALIDATED_NOT_PRODUCT_PASS") return proof;
    const normalized = document(input.provenanceBundle.capture, "supervised capture metadata", index);
    assert(input.provenanceBundle.expectations.sha256 === input.expectations.sha256 && normalized.leaseID === receipt.leaseID
      && timestamp(normalized.startedUTC, "supervised.startedUTC") <= start && timestamp(normalized.endedUTC, "supervised.endedUTC") >= end, "Adapter/supervisor provenance association mismatch");
    for (let i = 0; i < 3; i++) assert(normalized.responses[i].rawResponse.sha256 === raw[i].bodyReference.sha256, "Adapter/supervisor raw reference mismatch");
    assert(normalized.visual.screenshot.sha256 === visual[0].screenshotReference.sha256, "Adapter/supervisor screenshot reference mismatch");
    return { status: "OFFLINE_ADAPTER_AND_PROVENANCE_VALIDATED_NOT_PRODUCT_PASS", target: TARGET,
      leaseID: receipt.leaseID, verifiedAdapterReferences: index.map(({ inode, ...ref }) => ref), proof,
      networkRequests: 0, runtimeExecutedByChecker: false, productFlowPASS: false, authenticatedProduct100: false };
  } catch (error) {
    return { status: error instanceof MissingInput ? "MISSING_INPUT" : "REJECTED_PROVENANCE",
      ...(error instanceof MissingInput ? { missing: error.field } : { reason: error.message }),
      target: TARGET, networkRequests: 0, runtimeExecutedByChecker: false, productFlowPASS: false, authenticatedProduct100: false };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    assert(process.argv.length === 3, "Usage: node scripts/pilot-capture-provenance.mjs <actual-bundle.json>");
    const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const result = input?.format === "integrator-adapter" ? validateAdapterReceipt(input) : validateProvenance(input);
    console.log(JSON.stringify(result, null, 2));
    if (!["OFFLINE_PROVENANCE_VALIDATED_NOT_PRODUCT_PASS", "OFFLINE_ADAPTER_AND_PROVENANCE_VALIDATED_NOT_PRODUCT_PASS"].includes(result.status)) process.exitCode = 1;
  } catch (error) { console.error(`[provenance] REJECTED: ${error.message}`); process.exitCode = 1; }
}
