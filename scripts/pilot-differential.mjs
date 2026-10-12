#!/usr/bin/env node
/** Independent differential intake and anonymous identity runner. No deployment or fixture mutations. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { artifactSeal, sameArtifact } from "./automation-core.mjs";

export const HEAVY_ISSUER = "ses_ede13132fffeogzgUkyt86i744";
export const HOSTS = Object.freeze([
  { origin: "https://ledbox.online", surface: "/" },
  { origin: "https://app.ledbox.online", surface: "/login" },
  { origin: "https://eventos.ledbox.online", surface: "/" },
  { origin: "https://clientes.ledbox.online", surface: "/" },
  { origin: "https://demo.ledbox.online", surface: "/login" },
]);
const scopes = new Set(["ops161", "calendar56-119", "auto173"]);
const shaPattern = /^[a-f0-9]{40}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
export const hashBytes = bytes => createHash("sha256").update(bytes).digest("hex");

export function readEvidence(ref) {
  requireThat(typeof ref?.path === "string" && digestPattern.test(ref.sha256 ?? ""), "Missing evidence reference");
  const bytes = readFileSync(ref.path);
  requireThat(hashBytes(bytes) === ref.sha256, "Evidence hash mismatch");
  return bytes;
}
const jsonEvidence = ref => JSON.parse(readEvidence(ref).toString("utf8"));

/** Adapter for the original integrator's receipts; preserves failed outer terminal and GET-only recovery. */
export function validateServedClosure(refs, target) {
  requireThat(shaPattern.test(target?.sha ?? "") && target.version === "2.1.76", "Explicit target76 required");
  const cut = jsonEvidence(refs.cut), served = jsonEvidence(refs.served), checks = jsonEvidence(refs.checks);
  const terminal = jsonEvidence(refs.codeTerminal), outer = jsonEvidence(refs.outerTerminal);
  const resume = jsonEvidence(refs.resume), hub = jsonEvidence(refs.hub), smoke = jsonEvidence(refs.smoke);
  const footer = jsonEvidence(refs.footer);
  requireThat(served.status === "SERVED" && served.served === true && served.releaseSHA === target.sha
    && served.lastServedSHA === target.sha && served.releaseVersion === target.version && shaPattern.test(served.releaseTree ?? ""), "SERVED target mismatch");
  requireThat(cut.scope === "MANUAL_OPS_CALENDAR_RECUT" && cut.candidateSHA === served.candidateSHA
    && cut.included?.length === 3 && ["OPS9c", "CalendarA91+isolatedPFb3d", "Scoped AUTO window/admission correction"].every(unit => cut.included.includes(unit)), "Cut scope mismatch");
  requireThat(["FIN620+SIGPDF", "services", "mobile", "OwnDataRUC"].every(unit => cut.excluded?.some(entry => entry.unit === unit)
    && served.excluded?.some(entry => entry.unit === unit)), "Cut exclusions missing");
  for (const [field, key] of [["releaseChecks", "checks"], ["hubEvidence", "hub"], ["smokeEvidence", "smoke"], ["footerEvidence", "footer"]]) {
    requireThat(served[field]?.sha256 === refs[key]?.sha256, "Receipt reference mismatch");
    readEvidence(served[field]);
  }
  requireThat(checks.sha === target.sha && checks.status === "PASS" && terminal.sha === target.sha
    && terminal.status === "PASS" && terminal.explicitRelease === true && outer.sourceSHA === target.sha, "Code terminal identity mismatch");
  const requiredCommands = ["npm ci", "prisma generate", "prisma validate", "typecheck", "test:rules", "build"];
  requireThat(requiredCommands.every(command => checks.commands?.[command] === "PASS"), "Code commands missing PASS");
  for (const label of requiredCommands) {
    const stage = outer.stages?.find(item => item.label === label);
    requireThat(stage && stage.exitCode === 0 && stage.signal === null && !stage.timedOut && stage.endedAt
      && Array.isArray(stage.argv) && stage.argv.length > 0 && stage.cleanupRemaining?.length === 0, "Actual code stage not terminal PASS");
    readEvidence(stage.log);
  }
  requireThat(resume.releaseSHA === target.sha && resume.version === target.version && resume.status === "SERVED"
    && resume.checksRepeated === false && resume.pushRepeated === false && resume.POSTAllowed === false, "GET-only recovery not bound");
  requireThat(hub.sha === target.sha && hub.status === "FINISHED" && served.hubStatus === "FINISHED", "Hub not finished");
  const deployment = hub.deployments?.filter(item => item.deployment_uuid === served.deploymentUUID);
  requireThat(deployment?.length === 1 && deployment[0].commit === target.sha && deployment[0].status === "finished"
    && deployment[0].application_uuid === hub.applicationUUID && deployment[0].rollback === false && deployment[0].finished_at, "Deployment ID/source/rollback mismatch");
  requireThat(smoke.ok === true && smoke.expected?.sha === target.sha && smoke.expected.version === target.version
    && smoke.results?.length === HOSTS.length && new Set(smoke.results.map(item => item.host)).size === HOSTS.length, "Full host smoke missing");
  for (const host of HOSTS) {
    const row = smoke.results.find(item => item.host === host.origin);
    requireThat(row?.ok === true && row.sha === target.sha && row.version === target.version && row.surfaceStatus === 200
      && row.healthStatus === 200 && row.database === "ok" && Number.isInteger(row.migrations), "Served host identity mismatch");
  }
  requireThat(footer.ok === true && footer.expectedVersion === target.version && footer.results?.length === HOSTS.length
    && new Set(footer.results.map(item => item.host)).size === HOSTS.length, "Footer host/version mismatch");
  for (const host of HOSTS) {
    const row = footer.results.find(item => item.host === host.origin);
    requireThat(row?.path === host.surface && row.status === 200 && row.footerPresent === true
      && row.footerVersion === `v${target.version}` && digestPattern.test(row.bodySHA256 ?? ""), "Footer identity mismatch");
  }
  requireThat(served.releaseArtifact?.sha === target.sha && served.releaseArtifact?.version === target.version
    && sameArtifact(served.releaseArtifact, checks.artifact), "Artifact closure mismatch");
  requireThat(served.pilotStatus === "QA_NOT_RUN_DEFERRED_OWNER" && served.authenticatedOPSCalendarFlowStatus === "QA_NOT_RUN_DEFERRED_OWNER", "Closure must preserve deferred QA");
  return { ...target, tree: served.releaseTree, deployID: served.deploymentUUID, applicationUUID: hub.applicationUUID,
    artifact: served.releaseArtifact, scopes: ["ops161", "calendar56-119", "auto173"], ancillary: ["123"],
    status: "SERVED_CLOSURE_BOUND_NOT_PILOT_PASS", priorOuterStatus: outer.status, recovery: "SAME_GET_ONLY_RESUME",
    independentRuntimeQA: "WAIT_INPUT_DIRECT_AND_CUSTODY", authenticatedQA: "QA_NOT_RUN_DEFERRED_OWNER", inheritedQACounts: false };
}

export function validateIntake(intake, target) {
  requireThat(shaPattern.test(target?.sha ?? "") && target.version === "2.1.76", "Explicit full target SHA/version2.1.76 required");
  requireThat(intake?.schema === 1 && intake.sha === target.sha && intake.version === target.version, "Intake target mismatch");
  const manifest = jsonEvidence(intake.manifest);
  requireThat(manifest.sha === target.sha && manifest.version === target.version && shaPattern.test(manifest.baseSHA ?? ""), "Cut manifest identity mismatch");
  requireThat(Array.isArray(manifest.scopes) && manifest.scopes.length > 0 && new Set(manifest.scopes).size === manifest.scopes.length
    && manifest.scopes.every(scope => scopes.has(scope)), "Cut contains unsupported or duplicate scopes; FIN/services/mobile/RUC excluded");
  requireThat(manifest.excludes?.includes("fin143") && manifest.excludes.includes("services") && manifest.excludes.includes("mobile") && manifest.excludes.includes("ruc"), "Explicit exclusions required");
  const checks = jsonEvidence(intake.checks);
  requireThat(checks.sha === target.sha && checks.version === target.version && checks.status === "PASS" && checks.terminal === true, "Whole checks not terminal PASS");
  requireThat(Array.isArray(checks.results) && checks.results.length > 0, "Nonzero checks required");
  for (const check of checks.results) {
    requireThat(check.sha === target.sha && check.status === "PASS" && check.exitCode === 0 && check.terminal === true
      && typeof check.command === "string" && check.command.length > 0, "Check identity/terminal mismatch");
    readEvidence(check.log);
  }
  const artifact = jsonEvidence(intake.artifact);
  requireThat(artifact.sha === target.sha && artifact.version === target.version && digestPattern.test(artifact.manifestSha256 ?? ""), "Stale artifact identity");
  const deployment = jsonEvidence(intake.deployment);
  requireThat(typeof intake.deployID === "string" && intake.deployID.length > 0 && deployment.deployID === intake.deployID
    && deployment.sha === target.sha && deployment.version === target.version, "Deployment identity mismatch");
  requireThat(deployment.terminal === true && deployment.status === "SERVED" && deployment.outcome === "FINISHED", "Deployment not terminal SERVED");
  requireThat(typeof intake.applicationUUID === "string" && intake.applicationUUID.length > 0 && deployment.applicationUUID === intake.applicationUUID, "Application identity mismatch");
  requireThat(Array.isArray(deployment.hosts) && deployment.hosts.length === HOSTS.length, "Full host identity missing");
  const seen = new Set();
  for (const host of deployment.hosts) {
    const identity = HOSTS.find(item => item.origin === host.origin);
    requireThat(identity && !seen.has(host.origin), "Unknown/duplicate host identity"); seen.add(host.origin);
    const health = jsonEvidence(host.health);
    requireThat(host.surface === identity.surface && host.surfaceStatus === 200 && host.healthStatus === 200
      && health.sha === target.sha && health.version === target.version && health.status === "ok" && health.database === "ok"
      && Number.isInteger(health.migrations) && health.migrations >= 0, "Served host SHA/version/surface mismatch");
  }
  return { sha: target.sha, version: target.version, deployID: intake.deployID, artifact, scopes: manifest.scopes,
    status: "INTAKE_BOUND_NOT_QA_PASS", excluded: manifest.excludes };
}

export function requireDirect(lease, target, action, now = Date.now()) {
  requireThat(lease?.issuerSession === HEAVY_ISSUER && lease.kind === "DIRECT" && lease.granted === true
    && lease.sha === target.sha && lease.action === action, "Current issuer DIRECT required");
  requireThat(Number.isFinite(Date.parse(lease.startBy)) && Number.isFinite(Date.parse(lease.expiresAt))
    && now >= Date.parse(lease.startsAt) && now <= Date.parse(lease.startBy) && now < Date.parse(lease.expiresAt), "DIRECT stale/not usable");
  requireThat(Number.isInteger(lease.maxDurationMs) && lease.maxDurationMs > 0 && lease.maxDurationMs <= 120000, "DIRECT budget invalid");
  return lease;
}

export async function anonymousDifferential(intake, target, { lease, artifactRoot, fetcher = fetch, now = Date.now() } = {}) {
  const bound = validateIntake(intake, target);
  requireDirect(lease, target, "anonymous-identity", now);
  requireThat(typeof artifactRoot === "string" && artifactRoot.length > 0, "Custodian readonly artifactRoot required");
  const before = artifactSeal(artifactRoot, target.sha, target.version);
  requireThat(sameArtifact(before, bound.artifact), "Actual artifact seal mismatch");
  const deadline = Math.min(now + lease.maxDurationMs, Date.parse(lease.expiresAt));
  const results = [];
  for (const identity of HOSTS) {
    const row = { origin: identity.origin, surface: identity.surface, status: "FAIL" };
    try {
      requireThat(Date.now() < deadline, "DIRECT budget exhausted");
      const get = path => {
        requireThat(Date.now() < deadline, "DIRECT budget exhausted");
        return fetcher(identity.origin + path, { method: "GET", redirect: "manual", cache: "no-store",
          credentials: "omit", signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))) });
      };
      const response = await get("/api/health"), health = await response.json();
      requireThat(response.status === 200 && health.sha === target.sha && health.version === target.version
        && health.status === "ok" && health.database === "ok" && Number.isInteger(health.migrations), "Runtime health mismatch");
      const page = await get(identity.surface);
      requireThat(page.status === 200, "Anonymous surface mismatch/redirect blocked");
      row.status = "PASS"; row.health = health; row.surfaceStatus = page.status;
    } catch (error) { row.error = error.message; }
    results.push(row);
  }
  requireThat(sameArtifact(before, artifactSeal(artifactRoot, target.sha, target.version)), "Artifact changed during QA");
  return { ...bound, status: results.every(row => row.status === "PASS") ? "PASS_SCOPED_ANONYMOUS_IDENTITY" : "FAIL",
    results, authenticatedSeams: { status: "WAIT_INPUT", required: "Actual scoped access and own isolated runtime custody; not executed" },
    unexecuted: ["Authenticated OPS/calendar/AUTO flows", "FIN/signature/PDF", "services", "mobile", "RUC"],
    aggregateApproval: false, inheritedQACounts: false, requests: "GET health plus safe surface only; no cookies, no redirect following" };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2), options = {};
    requireThat(args.length % 2 === 0, "Arguments require flag/value pairs");
    for (let i = 0; i < args.length; i += 2) {
      requireThat(["--intake", "--sha", "--version", "--mode", "--lease", "--artifact-root", "--output"].includes(args[i]) && !options[args[i]], "Unknown/duplicate argv");
      options[args[i]] = args[i + 1];
    }
    const target = { sha: options["--sha"], version: options["--version"] };
    requireThat(["closure", "validate", "anonymous"].includes(options["--mode"]), "Explicit closure/validate/anonymous mode required");
    const intake = JSON.parse(readFileSync(options["--intake"], "utf8"));
    const report = options["--mode"] === "closure" ? validateServedClosure(intake, target)
      : options["--mode"] === "validate" ? validateIntake(intake, target)
      : await anonymousDifferential(intake, target, { lease: JSON.parse(readFileSync(options["--lease"], "utf8")), artifactRoot: options["--artifact-root"] });
    if (options["--output"]) writeFileSync(options["--output"], JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "FAIL") process.exitCode = 1;
  } catch (error) { console.error(`[pilot] BLOCKED: ${error.message}`); process.exitCode = 1; }
}
