import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBytes, HEAVY_ISSUER } from "../scripts/pilot-differential.mjs";
import { TARGET, OWNER_SESSION, readPlan } from "../scripts/pilot-ops-calendar-flow.mjs";
import { validateProvenance, validateAdapterReceipt } from "../scripts/pilot-capture-provenance.mjs";

// New file-provenance scenarios. All data below is synthetic test input, never product QA evidence.
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pilot-provenance-")); let serial = 0;
  const ref = value => { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
    const path = join(root, `${serial++}.bin`); writeFileSync(path, bytes); return { path, sha256: hashBytes(bytes) }; };
  const expected = { ...TARGET, organizationId: "org-provenance-only", role: "VIEWER",
    range: { from: "2026-12-05", to: "2026-12-06", fromAt: "2026-12-05T03:00:00.000Z", untilAt: "2026-12-07T03:00:00.000Z" },
    inventory: [{ id: "prov-unit", organizationId: "org-provenance-only", name: "Provenance-only item", sku: "PROV" }],
    events: [{ id: "prov-duration", organizationId: "org-provenance-only", name: "December source reference", clientId: "prov-client", status: "CONFIRMED",
      startsAt: "2026-12-04T16:00:00.000Z", endsAt: "2026-12-06T15:00:00.000Z", setupAt: null, strikeAt: null }] };
  const baselines = Object.fromEntries(["inventory", "events"].map(kind => [kind, { ...TARGET, ownerSession: "existing-owner-attestation", kind: "OWNER_BASELINE", phase: "PRE_CAPTURE", organizationId: expected.organizationId, recordedUTC: "2026-10-10T21:00:00Z", [kind]: structuredClone(expected[kind]) }]));
  const connection = { ownerSession: OWNER_SESSION, connected: true, bindingID: "test-channel-reference", UTC: "2026-10-10T21:00:00Z" };
  const custody = { ownerSession: OWNER_SESSION, organizationId: expected.organizationId, channel: { ownerSession: OWNER_SESSION },
    session: { authorized: true, bindingID: "test-session-reference", role: "VIEWER", organizationId: expected.organizationId },
    runtime: { ...TARGET, custodyApproved: true, bindingEvidenceSHA256: "a".repeat(64) }, readScope: { authorized: true, effects: "NONE", viewedAtAllowed: false }, directLeaseID: "test-capture-DIRECT" };
  const grant = { kind: "DIRECT", grant: true, issuerSession: HEAVY_ISSUER, ownerSession: OWNER_SESSION, action: "ops-calendar-readonly", source: "c".repeat(40), tree: "d".repeat(40), target: TARGET, leaseID: "test-capture-DIRECT",
    runtime: { path: "/test/absolute-node", sha256: "e".repeat(64) }, stages: [{ argv: ["/test/absolute-node", "test-owned-capture"], maxSeconds: 10 }],
    issuedUTC: "2026-10-10T21:00:00Z", START_BY: "2026-10-10T21:00:10Z", MAXsecondsFromActualSTART: 15 };
  const bodies = [{ inventory: [{ id: "prov-unit", name: "Provenance-only item", sku: "PROV" }] },
    { events: expected.events.map(({ clientId, ...row }) => ({ ...row, client: { id: clientId } })) },
    { range: { from: expected.range.from, to: expected.range.to }, items: [{ id: "event:prov-duration", kind: "event", title: "December source reference", href: "/eventos", date: "2026-12-05", at: expected.events[0].startsAt, endAt: expected.events[0].endsAt, endDate: "2026-12-06" }] }];
  const observation = { viewportWidth: 390, selector: { label: "Vista de eventos", visible: true, options: ["list", "grid", "calendar"], selected: "calendar", left: 20, width: 350 }, calendarViews: ["month", "week", "next30", "twoMonths"], mutatingActions: [],
    rows: [{ eventId: "prov-duration", title: "December source reference", clientId: "prov-client", startsAt: expected.events[0].startsAt, endsAt: expected.events[0].endsAt }] };
  const dom = { ...TARGET, channelBindingID: connection.bindingID, sessionBindingID: custody.session.bindingID, organizationId: expected.organizationId, role: "VIEWER", UTC: "2026-10-10T21:00:05Z", observationKind: "ACTUAL_AUTHORIZED_DOM", observation };
  const capture = { ...TARGET, role: "VIEWER", organizationId: expected.organizationId, channelBindingID: connection.bindingID, sessionBindingID: custody.session.bindingID,
    execution: { source: grant.source, tree: grant.tree, argv: [...grant.stages[0].argv], runtimeSHA256: grant.runtime.sha256 }, leaseID: grant.leaseID,
    startedUTC: "2026-10-10T21:00:01Z", endedUTC: "2026-10-10T21:00:06Z", captureUTC: "2026-10-10T21:00:05Z",
    responses: readPlan(expected.range).map((request, i) => ({ ...request, index: i, status: 200, ...TARGET, organizationId: expected.organizationId, sessionBindingID: custody.session.bindingID, effects: "NONE", redirected: false, UTC: `2026-10-10T21:00:0${i + 2}Z` })),
    visual: { UTC: dom.UTC, channelBindingID: connection.bindingID } };
  return { root, ref, expected, baselines, connection, custody, grant, bodies, dom, capture,
    bundle() {
      const refs = Object.fromEntries(Object.entries(baselines).map(([kind, value]) => [kind, ref(value)]));
      expected.expectedFixtureReferences = Object.fromEntries(Object.entries(refs).map(([kind, reference]) => [kind, { ownerSession: baselines[kind].ownerSession, reference }]));
      custody.approvedExpectedSources = Object.entries(refs).map(([kind, reference]) => ({ kind, ownerSession: baselines[kind].ownerSession, sha256: reference.sha256 }));
      custody.channel.connectionEvent = ref(connection);
      capture.responses.forEach((row, i) => { row.rawResponse = ref(bodies[i]); });
      capture.visual.screenshot = ref(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])); dom.screenshotSHA256 = capture.visual.screenshot.sha256; capture.visual.dom = ref(dom);
      const sourceRef = ref("synthetic independently hash-pinned capture-source bytes"); grant.sourcePins = { "test-owned-capture": sourceRef.sha256 };
      return { expectations: ref(expected), custody: ref(custody), capture: ref(capture), grant: ref(grant), executionSourceReferences: [{ relativePath: "test-owned-capture", reference: sourceRef }] };
    }, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("new raw-file provenance verifies hashes/source/order/UTC/DOM but never product PASS", () => {
  const f = fixture(); try { const result = validateProvenance(f.bundle()); assert.equal(result.status, "OFFLINE_PROVENANCE_VALIDATED_NOT_PRODUCT_PASS"); assert.equal(result.productFlowPASS, false); assert.equal(result.networkRequests, 0); } finally { f.close(); }
});
test("nullable custody template is MISSING_INPUT, never empty PASS", () => { const result = validateProvenance({ templateOnly: true }); assert.equal(result.status, "MISSING_INPUT"); assert.equal(result.productFlowPASS, false); });
test("missing owner values are MISSING_INPUT even with hash-bound template file", () => { const f = fixture(); try { f.expected.organizationId = null; assert.equal(validateProvenance(f.bundle()).status, "MISSING_INPUT"); } finally { f.close(); } });

for (const [name, mutate, reason] of [
  ["expected values do not match owner baseline", f => { f.expected.inventory[0].name = "Copied observation"; }, /independent owner source/],
  ["baseline has old source SHA", f => { f.baselines.events.sha = "b".repeat(40); }, /Wrong source/],
  ["baseline created after capture", f => { f.baselines.inventory.recordedUTC = "2026-10-10T21:00:07Z"; }, /Baseline created after/],
  ["wrong custody role", f => { f.custody.session.role = "OWNER"; }, /role\/org/],
  ["wrong captured org", f => { f.capture.organizationId = "other-company"; }, /role\/org/],
  ["old captured version", f => { f.capture.version = "2.1.75"; }, /source\/version/],
  ["effectful read scope", f => { f.custody.readScope.effects = "VIEWED_AT"; }, /Effectful/],
  ["foreign browser connection", f => { f.connection.ownerSession = "foreign-session"; }, /Connection event/],
  ["disconnected evidence", f => { f.connection.connected = false; }, /Connection event/],
  ["old closure grant action", f => { f.grant.action = "closure"; }, /issuer\/action/],
  ["wrong source grant", f => { f.grant.source = "f".repeat(40); }, /Grant source/],
  ["runtime binary hash mismatch", f => { f.capture.execution.runtimeSHA256 = "f".repeat(64); }, /argv\/runtime/],
  ["different supervised argv", f => { f.capture.execution.argv.push("unapproved-option"); }, /argv\/runtime/],
  ["START outside grant", f => { f.capture.startedUTC = "2026-10-10T21:00:11Z"; f.capture.endedUTC = "2026-10-10T21:00:12Z"; }, /grant window/],
  ["capture exceeds grant stage budget", f => { f.capture.endedUTC = "2026-10-10T21:00:20Z"; }, /grant window/],
  ["wrong response order index", f => { f.capture.responses[0].index = 1; }, /order\/status/],
  ["wrong response status", f => { f.capture.responses[1].status = 403; }, /order\/status/],
  ["redirected captured response", f => { f.capture.responses[0].redirected = true; }, /order\/status/],
  ["response UTC goes backwards", f => { f.capture.responses[1].UTC = "2026-10-10T21:00:01Z"; }, /timestamp order/],
  ["DOM belongs to wrong role", f => { f.dom.role = "OWNER"; }, /DOM provenance/],
  ["DOM claims synthetic observation", f => { f.dom.observationKind = "SYNTHETIC"; }, /DOM provenance/],
  ["DOM hash valid but selector actual width wrong", f => { f.dom.observation.viewportWidth = 1440; }, /390/],
]) test(name, () => { const f = fixture(); try { mutate(f); const result = validateProvenance(f.bundle()); assert.equal(result.status, "REJECTED_PROVENANCE"); assert.match(result.reason, reason); } finally { f.close(); } });

test("tampered raw response bytes reject despite valid metadata", () => { const f = fixture(); try { const bundle = f.bundle(); writeFileSync(f.capture.responses[0].rawResponse.path, "different bytes"); const result = validateProvenance(bundle); assert.match(result.reason, /Raw byte hash mismatch/); } finally { f.close(); } });
test("missing raw response hash is MISSING_INPUT", () => { const f = fixture(); try { const bundle = f.bundle(); delete f.capture.responses[0].rawResponse.sha256; bundle.capture = f.ref(f.capture); assert.equal(validateProvenance(bundle).status, "MISSING_INPUT"); } finally { f.close(); } });
test("baseline reused as observed response fails independence even if rehashed metadata", () => { const f = fixture(); try { const bundle = f.bundle(); f.capture.responses[0].rawResponse = f.expected.expectedFixtureReferences.inventory.reference; bundle.capture = f.ref(f.capture); assert.match(validateProvenance(bundle).reason, /reference reuse/); } finally { f.close(); } });
test("custody approval list cannot be replaced with unrelated fixture hash", () => { const f = fixture(); try { const bundle = f.bundle(); f.custody.approvedExpectedSources[0].sha256 = "f".repeat(64); bundle.custody = f.ref(f.custody); assert.match(validateProvenance(bundle).reason, /custody-approved/); } finally { f.close(); } });
test("tampered DOM file fails its byte hash before observation acceptance", () => { const f = fixture(); try { const bundle = f.bundle(); writeFileSync(f.capture.visual.dom.path, "changed DOM"); assert.match(validateProvenance(bundle).reason, /Raw byte hash mismatch/); } finally { f.close(); } });
test("rehashed unrelated screenshot cannot replace DOM-bound evidence", () => { const f = fixture(); try { const bundle = f.bundle(); f.capture.visual.screenshot = f.ref(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 9, 9])); bundle.capture = f.ref(f.capture); assert.match(validateProvenance(bundle).reason, /DOM provenance/); } finally { f.close(); } });
test("delivered adapter source alone never substitutes actual capture receipt", () => {
  const result = validateAdapterReceipt({ format: "integrator-adapter", adapter: { path: "source-only", sha256: "a".repeat(64) } });
  assert.equal(result.status, "MISSING_INPUT"); assert.equal(result.missing, "adapterReceipt actual reference"); assert.equal(result.networkRequests, 0);
});

function adapterFixture() {
  const f = fixture(), proof = f.bundle(), adapter = f.ref("synthetic adapter source bytes, not integrator code execution");
  const runtime = { ...TARGET, deployID: "rvrqkw2ppxvvv5ow4izhudhk", ownerSession: OWNER_SESSION, effects: "NONE", adapterSHA256: adapter.sha256, expectationsSHA256: proof.expectations.sha256 };
  const runtimeCustody = f.ref(runtime), context = { organizationId: f.expected.organizationId, session: { ...f.custody.session },
    runtime: { bindingEvidenceSHA256: runtimeCustody.sha256 }, direct: { leaseID: f.grant.leaseID }, readScope: { ...f.custody.readScope } };
  const captured = { responses: f.capture.responses.map((row, i) => ({ method: row.method, path: row.path, status: row.status, body: f.bodies[i] })), visual: f.dom.observation };
  const raw = f.capture.responses.map(row => ({ index: row.index, method: row.method, path: row.path, status: row.status, capturedAt: row.UTC, bodyReference: row.rawResponse }));
  const observationRef = f.ref(f.dom.observation);
  const receipt = { status: "CAPTURE_BOUND_FOR_ORIGINAL_PILOT_VALIDATION_NOT_GLOBAL_PASS", requests: 3, effects: "NONE", productFlowPASS: false, globalPilotPASS: false,
    target: { ...TARGET, deployID: runtime.deployID }, ownerSession: OWNER_SESSION, sessionBindingID: context.session.bindingID, organizationId: context.organizationId, role: context.session.role, leaseID: context.direct.leaseID,
    startedAt: f.capture.startedUTC, endedAt: f.capture.endedUTC, captures: [...raw, { kind: "visual", ownerSession: OWNER_SESSION, observationReference: observationRef, screenshotReference: f.capture.visual.screenshot }] };
  return { ...f, proof, adapter, context, runtimeCustody, captured, receipt,
    adapterBundle() {
      const contextRef = f.ref(context); chmodSync(contextRef.path, 0o600);
      receipt.inputs = [contextRef, runtimeCustody, proof.expectations]; receipt.capture = f.ref(captured);
      return { format: "integrator-adapter", adapter, adapterReceipt: f.ref(receipt), context: contextRef, runtimeCustody, expectations: proof.expectations, provenanceBundle: proof };
    } };
}
test("actual-shaped adapter raw refs and supervisor provenance are joined without duplicate oracle", () => {
  const f = adapterFixture(); try { const result = validateAdapterReceipt(f.adapterBundle()); assert.equal(result.status, "OFFLINE_ADAPTER_AND_PROVENANCE_VALIDATED_NOT_PRODUCT_PASS"); assert.equal(result.productFlowPASS, false); } finally { f.close(); }
});
test("adapter reconstructed body differing from raw response bytes is rejected", () => {
  const f = adapterFixture(); try { f.captured.responses[0].body = { inventory: [] }; assert.match(validateAdapterReceipt(f.adapterBundle()).reason, /raw\/capture JSON/); } finally { f.close(); }
});
test("adapter capture terminal cannot substitute supervisor provenance", () => {
  const f = adapterFixture(); try { const input = f.adapterBundle(); delete input.provenanceBundle; const result = validateAdapterReceipt(input); assert.equal(result.status, "MISSING_INPUT"); assert.match(result.missing, /supervised grant/); } finally { f.close(); }
});
