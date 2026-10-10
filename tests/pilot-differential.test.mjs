import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateIntake, validateServedClosure, readEvidence, hashBytes, requireDirect, HOSTS, HEAVY_ISSUER } from "../scripts/pilot-differential.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pilot-intake-negative-"));
  let serial = 0;
  const ref = value => { const bytes = Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
    const path = join(root, `${serial++}.json`); writeFileSync(path, bytes); return { path, sha256: hashBytes(bytes) }; };
  const target = { sha: "a".repeat(40), version: "2.1.76" };
  const manifest = { ...target, baseSHA: "b".repeat(40), scopes: ["ops161", "calendar56-119", "auto173"], excludes: ["fin143", "services", "mobile", "ruc"] };
  const checks = { ...target, terminal: true, status: "PASS", results: [{ sha: target.sha, terminal: true, status: "PASS", exitCode: 0, command: "independent synthetic check", log: ref("actual fixture log bytes\n") }] };
  const artifact = { ...target, manifestSha256: "c".repeat(64) };
  const deployment = { ...target, terminal: true, status: "SERVED", outcome: "FINISHED", deployID: "fixture-deploy", applicationUUID: "fixture-app",
    hosts: HOSTS.map(host => ({ ...host, surfaceStatus: 200, healthStatus: 200, health: ref({ ...target, status: "ok", database: "ok", migrations: 47 }) })) };
  const intake = () => ({ schema: 1, ...target, applicationUUID: deployment.applicationUUID, deployID: deployment.deployID,
    manifest: ref(manifest), checks: ref(checks), artifact: ref(artifact), deployment: ref(deployment) });
  return { root, ref, target, manifest, checks, artifact, deployment, intake, close: () => rmSync(root, { recursive: true, force: true }) };
}
test("fresh hash-bound fixture admits identity only, never inherited QA PASS", () => {
  const f = fixture(); try { const result = validateIntake(f.intake(), f.target); assert.equal(result.status, "INTAKE_BOUND_NOT_QA_PASS"); assert.deepEqual(result.scopes, f.manifest.scopes); } finally { f.close(); }
});
for (const [name, mutate, expected] of [
  ["served75 cannot satisfy target76", f => { f.deployment.version = "2.1.75"; }, /Deployment identity/],
  ["wrong intake SHA", (f, i) => { i.sha = "d".repeat(40); }, /target mismatch/],
  ["stale artifact SHA", f => { f.artifact.sha = "d".repeat(40); }, /Stale artifact/],
  ["stale artifact version", f => { f.artifact.version = "2.1.75"; }, /Stale artifact/],
  ["six code PASS cannot override whole Hubcount FAIL", f => { f.checks.status = "FAIL"; }, /Whole checks/],
  ["nonterminal deployment", f => { f.deployment.terminal = false; }, /not terminal/],
  ["terminal failed deployment", f => { f.deployment.outcome = "FAILED"; }, /not terminal/],
  ["deployID mismatch", (f, i) => { i.deployID = "other-deploy"; }, /Deployment identity/],
  ["wrong application UUID", (f, i) => { i.applicationUUID = "other-app"; }, /Application identity/],
  ["incomplete host identity", f => { f.deployment.hosts.pop(); }, /Full host/],
  ["duplicate host masks missing one", f => { f.deployment.hosts[4] = f.deployment.hosts[0]; }, /duplicate host/],
  ["wrong served health SHA with freshly rehashed evidence", f => { f.deployment.hosts[0].health = f.ref({ sha: "d".repeat(40), version: "2.1.76", status: "ok", database: "ok", migrations: 47 }); }, /Served host/],
  ["unsafe demo session surface", f => { f.deployment.hosts[4].surface = "/api/demo/session"; }, /Served host/],
  ["FIN outside OPS calendar AUTO manifest", f => { f.manifest.scopes.push("fin143"); }, /unsupported/],
  ["empty scope cannot fabricate PASS", f => { f.manifest.scopes = []; }, /unsupported/],
  ["empty checks cannot fabricate PASS", f => { f.checks.results = []; }, /Nonzero checks/],
  ["changed check log despite PASS metadata", f => { writeFileSync(f.checks.results[0].log.path, "tampered log"); }, /hash mismatch/],
]) test(name, () => { const f = fixture(); try { let i = f.intake(); mutate(f, i); const fresh = f.intake(); i = { ...fresh, sha: i.sha, deployID: i.deployID, applicationUUID: i.applicationUUID }; assert.throws(() => validateIntake(i, f.target), expected); } finally { f.close(); } });

test("evidence hash compares actual bytes, not supplied filename", () => {
  const f = fixture(); try { const r = f.ref("raw evidence"); writeFileSync(r.path, "raw evidence\n"); assert.throws(() => readEvidence(r), /hash mismatch/); } finally { f.close(); }
});
test("DIRECT rejects expired, inherited issuer, wrong action and target", () => {
  const now = Date.parse("2026-10-10T20:30:00Z"), target = { sha: "a".repeat(40) };
  const lease = { issuerSession: HEAVY_ISSUER, kind: "DIRECT", granted: true, sha: target.sha, action: "anonymous-identity", startsAt: new Date(now - 1000).toISOString(), startBy: new Date(now + 1000).toISOString(), expiresAt: new Date(now + 20000).toISOString(), maxDurationMs: 20000 };
  assert.equal(requireDirect(lease, target, "anonymous-identity", now), lease);
  for (const patch of [{ issuerSession: "old-age227" }, { sha: "d".repeat(40) }, { action: "build" }, { kind: "FIFO" }, { expiresAt: new Date(now).toISOString() }, { startBy: new Date(now - 1).toISOString() }, { maxDurationMs: 0 }]) assert.throws(() => requireDirect({ ...lease, ...patch }, target, "anonymous-identity", now));
});

function closureFixture() {
  const f = fixture(), target = f.target, labels = ["npm ci", "prisma generate", "prisma validate", "typecheck", "test:rules", "build"];
  const excluded = ["FIN620+SIGPDF", "services", "mobile", "OwnDataRUC"].map(unit => ({ unit }));
  const cut = { scope: "MANUAL_OPS_CALENDAR_RECUT", candidateSHA: "b".repeat(40), included: ["OPS9c", "CalendarA91+isolatedPFb3d", "Scoped AUTO window/admission correction"], excluded };
  const checks = { sha: target.sha, status: "PASS", commands: Object.fromEntries(labels.map(label => [label, "PASS"])), artifact: f.artifact };
  const codeTerminal = { sha: target.sha, status: "PASS", explicitRelease: true };
  const outerTerminal = { sourceSHA: target.sha, status: "FAIL", reason: "postpush Hub count", stages: labels.map(label => ({ label, argv: ["fixture-check", label], exitCode: 0, signal: null, timedOut: false, endedAt: "2026-10-10T20:19:53Z", cleanupRemaining: [], log: f.ref(label + " actual log") })) };
  const resume = { releaseSHA: target.sha, version: target.version, status: "SERVED", checksRepeated: false, pushRepeated: false, POSTAllowed: false };
  const hub = { sha: target.sha, applicationUUID: "fixture-app", status: "FINISHED", deployments: [{ deployment_uuid: "fixture-deploy", application_uuid: "fixture-app", commit: target.sha, status: "finished", rollback: false, finished_at: "2026-10-10T20:24:41Z" }] };
  const smoke = { expected: target, ok: true, results: HOSTS.map(host => ({ host: host.origin, ...target, surfaceStatus: 200, healthStatus: 200, ok: true, database: "ok", migrations: 47 })) };
  const footer = { expectedVersion: target.version, ok: true, results: HOSTS.map(host => ({ host: host.origin, path: host.surface, status: 200, footerPresent: true, footerVersion: `v${target.version}`, bodySHA256: "f".repeat(64) })) };
  const served = { status: "SERVED", served: true, releaseSHA: target.sha, lastServedSHA: target.sha, releaseVersion: target.version, releaseTree: "e".repeat(40), candidateSHA: cut.candidateSHA,
    excluded, releaseArtifact: f.artifact, hubStatus: "FINISHED", deploymentUUID: "fixture-deploy", pilotStatus: "QA_NOT_RUN_DEFERRED_OWNER", authenticatedOPSCalendarFlowStatus: "QA_NOT_RUN_DEFERRED_OWNER" };
  return { ...f, cut, checks, codeTerminal, outerTerminal, resume, hub, smoke, footer, served,
    refs() { const refs = Object.fromEntries(Object.entries({ cut, checks, codeTerminal, outerTerminal, resume, hub, smoke, footer }).map(([key, value]) => [key, f.ref(value)]));
      served.releaseChecks = refs.checks; served.hubEvidence = refs.hub; served.smokeEvidence = refs.smoke; served.footerEvidence = refs.footer; refs.served = f.ref(served); return refs; } };
}
test("actual-shaped closure resolves outer FAIL only through bound GET resume, preserving deferred QA", () => {
  const f = closureFixture(); try { const result = validateServedClosure(f.refs(), f.target); assert.equal(result.status, "SERVED_CLOSURE_BOUND_NOT_PILOT_PASS"); assert.equal(result.priorOuterStatus, "FAIL"); assert.equal(result.authenticatedQA, "QA_NOT_RUN_DEFERRED_OWNER"); } finally { f.close(); }
});
for (const [name, mutate, error] of [
  ["code PASS without resolved SERVED", f => { f.served.served = false; }, /SERVED target/],
  ["unresolved GET-only recovery", f => { f.resume.status = "WAIT"; }, /GET-only/],
  ["Hub rollback cannot bind served", f => { f.hub.deployments[0].rollback = true; }, /rollback/],
  ["wrong deploy ID despite finished Hub", f => { f.served.deploymentUUID = "other"; }, /Deployment ID/],
  ["failed actual stage cannot hide behind checks PASS", f => { f.outerTerminal.stages[0].exitCode = 1; }, /Actual code stage/],
  ["actual stage log changed after closure", f => { writeFileSync(f.outerTerminal.stages[0].log.path, "changed"); }, /hash mismatch/],
  ["old served75 hosts cannot bind target76", f => { f.smoke.results[0].version = "2.1.75"; }, /Served host/],
  ["old rendered footer cannot bind target76", f => { f.footer.results[0].footerVersion = "v2.1.75"; }, /Footer identity/],
  ["closure cannot invent authenticated Pilot PASS", f => { f.served.pilotStatus = "PASS"; }, /deferred QA/],
]) test(name, () => { const f = closureFixture(); try { mutate(f); assert.throws(() => validateServedClosure(f.refs(), f.target), error); } finally { f.close(); } });
