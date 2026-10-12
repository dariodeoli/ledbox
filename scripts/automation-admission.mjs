import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { git, readJson, evidence, shaValid, productFile, atomicJson, assertNoPilotRejection } from "./automation-core.mjs";

export function checked(ref) {
  if (!ref?.path || !/^[a-f0-9]{64}$/.test(ref.sha256 ?? "") || evidence(ref.path).sha256 !== ref.sha256) throw new Error("Admission evidence missing or altered");
  return readJson(ref.path);
}

/** Explicit closed units only. Donor history is never merged wholesale. */
export function admittedInventory(cwd, config, base, remote = "origin/" + config.liveBranch, { manual = false } = {}) {
  const manifest = readJson(config.admissionFile);
  if (manifest.schema !== 1 || manifest.scope !== "#173" || manifest.authority !== "OWNER_HD_AUTO_20261010" || !Array.isArray(manifest.units)) throw new Error("Invalid closed-unit admission manifest");
  const baseSHA = git(cwd, "rev-parse", base), remoteBaseSHA = git(cwd, "rev-parse", remote);
  const patch = sha => {
    const files = git(cwd, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha).split("\n").filter(productFile);
    const parents = git(cwd, "show", "-s", "--format=%P", sha).split(" ").filter(Boolean);
    if (!files.length || parents.length > 1) return null;
    return git(cwd, "show", "--format=", "--full-index", sha, "--", ...files);
  };
  // Functional patch IDs are computed through Git; no SHA-only counting.
  const identity = sha => {
    const diff = patch(sha);
    return diff ? execFileSync("git", ["patch-id", "--stable"], { cwd, input: diff + "\n", encoding: "utf8" }).split(" ")[0].trim() : null;
  };
  const known = new Set(git(cwd, "rev-list", "--no-merges", baseSHA).split("\n").filter(Boolean).map(identity).filter(Boolean));
  const admitted = new Set(), functional = [], commits = [], excluded = [];
  for (const unit of manifest.units) {
    const pendingManual = manual && unit.manualOnly === true && unit.status === "SOURCE_CLOSED_CODEGATES_PENDING";
    if ((!pendingManual && unit.status !== "CLOSED") || unit.hold || unit.unresolvedContent?.length || !shaValid(unit.sourceSHA)) { excluded.push({ unit: unit.id, reason: unit.hold || "CONTENT_HOLD_OR_NOT_CLOSED" }); continue; }
    if (!Array.isArray(unit.commits)) throw new Error(`Unit ${unit.id} has no isolated commit list`);
    if (!pendingManual) {
      const gate = checked(unit.gate);
      const gateSHA = gate.sha ?? gate.approvedCandidateSHA;
      if (gate.status !== "PASS" || gateSHA !== unit.sourceSHA) throw new Error(`Unit ${unit.id} lacks exact source gates`);
    }
    for (const sha of unit.commits) {
      if (!shaValid(sha)) throw new Error("Admission requires full commit SHA");
      git(cwd, "merge-base", "--is-ancestor", sha, unit.sourceSHA);
      const id = identity(sha);
      if (id) admitted.add(id);
      if (id && known.has(id)) continue;
      if (!commits.includes(sha)) commits.push(sha);
      if (id) {
        known.add(id);
        functional.push({ sha, patch: id, subject: git(cwd, "show", "-s", "--format=%s", sha) });
      }
    }
  }
  for (const sha of git(cwd, "rev-list", "--no-merges", `${remoteBaseSHA}..HEAD`).split("\n").filter(Boolean)) {
    const id = identity(sha);
    if (id && !admitted.has(id)) throw new Error(`Local functional content not admitted: ${sha}`);
  }
  return { baseSHA, countBaseSHA: baseSHA, remoteBaseSHA, count: functional.length, functional, commits, branches: [], excluded, admissionEvidence: evidence(config.admissionFile) };
}

/** START_BY only admits a new START; a running lease uses its original budget. */
export function requireHeavyWindow(config, expected, now = Date.now()) {
  if (config.windowRequestFile) {
    const request = { schema: 1, status: "READY_WAITING_SECRETARIA_WINDOW", ownerSession: config.ownerSession, sourceSHA: expected.sha, sourceTree: git(expected.cwd, "rev-parse", `${expected.sha}^{tree}`), cwd: expected.cwd, runtime: process.execPath, runtimeSHA256: evidence(process.execPath).sha256, commands: expected.commands, budgetSeconds: 900, environment: { DATABASE_URL: "", SOURCE_COMMIT: expected.sha, GITHUB_SHA: expected.sha, LEDBOX_BUILD_SHA: expected.sha }, schemaValidation: "LOCAL_SYNTHETIC_URL_NO_CONNECTION", buildMigrationGuard: "DATABASE_URL_EMPTY_NO_MIGRATE", postgresStarted: false, providerCalls: false, grantFile: config.windowFile, grant: false };
    const previous = existsSync(config.windowRequestFile) ? readJson(config.windowRequestFile) : null;
    if (!previous || previous.sourceSHA !== request.sourceSHA || JSON.stringify(previous.commands) !== JSON.stringify(request.commands) || previous.runtimeSHA256 !== request.runtimeSHA256) atomicJson(config.windowRequestFile, { ...request, requestedAt: new Date(now).toISOString() });
  }
  if (!config.windowFile || !existsSync(config.windowFile)) throw new Error("WAIT_SECRETARIA_WINDOW: no current heavy grant");
  const grant = readJson(config.windowFile);
  if (grant.grant !== true || grant.issuer !== "Secretaria" || grant.revoked || grant.explicitRelease || grant.sourceSHA !== expected.sha || grant.cwd !== expected.cwd || grant.ownerSession !== config.ownerSession || !grant.leaseID || !Number.isSafeInteger(grant.budgetSeconds) || grant.budgetSeconds <= 0 || JSON.stringify(grant.commands) !== JSON.stringify(expected.commands)) throw new Error("WAIT_SECRETARIA_WINDOW: exact owner/source/argv/budget mismatch");
  if (grant.sourceTree !== git(expected.cwd, "rev-parse", `${expected.sha}^{tree}`) || grant.runtime !== process.execPath || grant.runtimeSHA256 !== evidence(process.execPath).sha256) throw new Error("WAIT_SECRETARIA_WINDOW: tree/runtime binding mismatch");
  const started = config.windowStart;
  if (started) {
    if (started.leaseID !== grant.leaseID || started.sha !== expected.sha || now >= started.at + grant.budgetSeconds * 1000) throw new Error("WAIT_SECRETARIA_WINDOW: running lease expired or changed");
  } else if (!Number.isFinite(Date.parse(grant.START_BY)) || now > Date.parse(grant.START_BY)) throw new Error("WAIT_SECRETARIA_WINDOW: START_BY expired, no START");
  return grant;
}

/** Deferred QA is explicit and source-bound; known content failures stay closed. */
export function requireCandidateGate(config, pending, pilotGate) {
  assertNoPilotRejection(config, pending);
  if (!pending.qaPolicyEvidence && (!config.qaPolicyFile || !existsSync(config.qaPolicyFile))) return pilotGate(config, pending);
  const policy = pending.qaPolicyEvidence ? checked(pending.qaPolicyEvidence) : readJson(config.qaPolicyFile);
  if (!pending.qaPolicyEvidence && policy.sha !== pending.candidateSHA) return pilotGate(config, pending);
  if (policy.status !== "QA_NOT_RUN_DEFERRED_OWNER" || policy.authority !== "OWNER_QA_DEFERRED_20261010" || policy.sha !== pending.candidateSHA || !policy.owner || !policy.scope || !policy.recover || !Array.isArray(policy.unresolvedContent) || policy.unresolvedContent.length) throw new Error("Candidate has known content holds or invalid deferred QA policy");
  const report = checked(pending.checks?.evidence);
  if (report.sha !== pending.candidateSHA || report.status !== "PASS" || !report.artifact || report.artifact.manifestSha256 !== pending.artifact?.manifestSha256 || ["npm ci", "prisma generate", "typecheck", "test:rules", "test:automation", "build"].some(label => report.commands?.[label] !== "PASS")) throw new Error("Exact code gates/artifact missing for deferred QA candidate");
  return policy;
}
