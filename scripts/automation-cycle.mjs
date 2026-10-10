import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactSeal, assertIntegrator, assertPublicationEnabled, assertReleaseOnly, atomicJson, evidence, git, inventory, LIVE, nextVersion, productChanged, readJson, requirePilotGate, requirePilotRejection, requireManualPushAck, assertNoPilotRejection, acquireLock, sameArtifact, servedBaseline } from "./automation-core.mjs";
import { hubClient, deploymentOutcome } from "./automation-hub.mjs";

export function command(cwd, executable, args, { env = process.env, signal, logFile } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const log = bytes => { if (logFile) appendFileSync(logFile, bytes); else process.stdout.write(bytes); };
    child.stdout.on("data", log); child.stderr.on("data", log);
    const abort = () => { try { process.platform === "win32" ? child.kill("SIGTERM") : process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") reject(error); } };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.on("error", reject);
    child.on("close", code => { signal?.removeEventListener("abort", abort); code === 0 && !signal?.aborted ? resolvePromise() : reject(new Error(`${executable} ${args.join(" ")} falló (${code})`)); });
  });
}
const wait = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
export function loadState(config) { return existsSync(config.stateFile) ? readJson(config.stateFile) : { schema: 1, pending: null, deployments: {} }; }
function save(config, state) { atomicJson(config.stateFile, state); }
function assertHead(cwd, sha) { if (git(cwd, "rev-parse", "HEAD") !== sha || git(cwd, "status", "--porcelain")) throw new Error("Checkout cambió durante ciclo: detener sin reset"); }
function assertNotRejected(state, sha) {
  if (state.rejectedCandidates?.[sha]) throw new Error("SHA rechazado por Pilot: requiere nuevo candidato autorizado y QA independiente");
}
function assertUnreleased(cwd, state, pending) {
  const sha = pending.candidateSHA;
  if (pending.releaseSHA || pending.version || pending.pushed || pending.triggerIntent || pending.triggerAccepted || pending.served || Object.entries(state.deployments ?? {}).some(([key, value]) => key === sha || value.candidateSHA === sha || value.releaseSHA === sha)) throw new Error("No invalidar candidato con release/push/trigger registrado");
  if (readJson(join(cwd, "package.json")).version !== pending.artifact.version || git(cwd, "log", "--format=%s", `${sha}..HEAD`).split("\n").some(s => /^chore\(release\):/.test(s))) throw new Error("No invalidar metadata release ya commiteada");
}

/** Invalida sólo READY sin release/publicación; nunca legitima diff nuevo como release. */
function rejectReady(cwd, config, state, signal) {
  const pending = state.pending;
  if (!pending) throw new Error("No hay candidato READY para rechazar");
  const rejection = requirePilotRejection(config, pending);
  const sha = pending.candidateSHA;
  git(cwd, "merge-base", "--is-ancestor", sha, "HEAD");
  // Incluye crash después de commit release y antes de persistir releaseSHA.
  assertUnreleased(cwd, state, pending);
  git(cwd, "fetch", "origin", "--prune");
  try { git(cwd, "merge-base", "--is-ancestor", sha, `origin/${LIVE}`); throw new Error("No invalidar candidato ya pusheado a rama viva"); }
  catch (error) { if (error.status !== 1) throw error; }
  signal?.throwIfAborted();
  // Releer el FAIL antes de archivar: evidencia cambiante no puede invalidar READY.
  const rechecked = requirePilotRejection(config, pending);
  if (rechecked.gateEvidence.sha256 !== rejection.gateEvidence.sha256) throw new Error("Gate de rechazo cambió durante validación");
  const archiveFile = join(config.evidenceDir, sha, "rejection.json");
  const rejectedAt = new Date().toISOString();
  atomicJson(archiveFile, { schema: 1, issue: 173, status: "REJECTED", rejectedAt, headAtRejection: git(cwd, "rev-parse", "HEAD"), pending, ...rejection });
  state.rejectedCandidates ??= {};
  state.rejectedCandidates[sha] = { rejectedAt, archive: evidence(archiveFile), pilotEvidence: rejection.gate.pilot.evidence };
  state.pending = null; save(config, state);
  atomicJson(config.candidateFile, { schema: 1, issue: 173, status: "REJECTED", rejectedCandidateSHA: sha, archive: state.rejectedCandidates[sha].archive });
  return { status: "REJECTED", candidateSHA: sha, archiveFile };
}

/** Excepción operativa explícita: preserva push manual y sólo avanza fixes con FAIL+ACK. */
async function supersedePublishedFailedReady(cwd, config, state, { hub, signal } = {}) {
  const pending = state.pending;
  if (!pending) throw new Error("No hay candidato READY para superseder");
  const sha = pending.candidateSHA, head = git(cwd, "rev-parse", "HEAD");
  assertNotRejected(state, sha);
  const rejection = requirePilotRejection(config, pending);
  const acknowledgment = requireManualPushAck(config, pending);
  git(cwd, "merge-base", "--is-ancestor", sha, head);
  assertUnreleased(cwd, state, pending);
  if (head === sha || !productChanged(cwd, sha, head)) throw new Error("Supersede requiere HEAD descendiente con nuevo diff funcional #173");
  git(cwd, "fetch", "origin", "--prune");
  if (git(cwd, "rev-parse", `origin/${LIVE}`) !== sha) throw new Error("ACK stale: rama viva remota ya no coincide exactamente con candidato rechazado");
  // inventory rechaza toda historia local no-merge ajena al scope; no importa carriles aquí.
  const work = inventory(cwd, sha);
  if (!work.count) throw new Error("Supersede requiere nuevo código autorizado #173");
  const client = hub ?? hubClient(config);
  if ((await client.deployments(sha)).length) throw new Error("Hay deployment del candidato publicado: supersede requiere nueva orden sin rollback");
  signal?.throwIfAborted(); assertHead(cwd, head);
  const rejectionNow = requirePilotRejection(config, pending), acknowledgmentNow = requireManualPushAck(config, pending);
  if (rejectionNow.gateEvidence.sha256 !== rejection.gateEvidence.sha256 || acknowledgmentNow.ackEvidence.sha256 !== acknowledgment.ackEvidence.sha256) throw new Error("FAIL/ACK cambió durante validación; no superseder");
  // Releer remoto tras el GET: no aceptar un ACK obsoleto por un push concurrente.
  git(cwd, "fetch", "origin", "--prune");
  if (git(cwd, "rev-parse", `origin/${LIVE}`) !== sha) throw new Error("ACK stale: rama remota cambió durante validación");
  const archiveFile = join(config.evidenceDir, sha, "supersession.json"), rejectedAt = new Date().toISOString();
  atomicJson(archiveFile, { schema: 1, issue: 173, status: "SUPERSEDED_PUBLISHED_FAILED_READY", rejectedAt, headAtRejection: head, remoteSHA: sha, hubDeploymentAbsentForSHA: sha, pending, ...rejection, ...acknowledgment });
  state.rejectedCandidates ??= {};
  state.rejectedCandidates[sha] = { rejectedAt, publishedManual: true, archive: evidence(archiveFile), pilotEvidence: rejection.gate.pilot.evidence, ackEvidence: acknowledgment.ackEvidence };
  state.pending = null; save(config, state);
  atomicJson(config.candidateFile, { schema: 1, issue: 173, status: "SUPERSEDED_PUBLISHED_FAILED_READY", rejectedCandidateSHA: sha, archive: state.rejectedCandidates[sha].archive });
  return { status: "SUPERSEDED_PUBLISHED_FAILED_READY", candidateSHA: sha, forwardHEAD: head, archiveFile };
}

async function checks(cwd, sha, config, signal, runner) {
  const version = readJson(join(cwd, "package.json")).version;
  const directory = join(config.evidenceDir, sha); mkdirSync(directory, { recursive: true });
  const env = { ...process.env, DATABASE_URL: "", SOURCE_COMMIT: sha, GITHUB_SHA: sha, LEDBOX_BUILD_SHA: sha };
  const commands = {};
  for (const [label, executable, args] of [["npm ci", "npm", ["ci"]], ["prisma generate", "npx", ["prisma", "generate"]], ["typecheck", "npm", ["run", "typecheck"]], ["test:rules", "npm", ["run", "test:rules"]], ["test:automation", "node", ["--test", "tests/automation.test.mjs"]], ["build", "npm", ["run", "build"]]]) {
    await runner(cwd, executable, args, { env, signal, logFile: join(directory, `${label.replace(/[^a-z]/g, "-")}.log`) });
    commands[label] = "PASS"; assertHead(cwd, sha);
  }
  const artifact = artifactSeal(cwd, sha, version);
  const report = join(directory, "checks.json");
  atomicJson(report, { sha, status: "PASS", commands, artifact, completedAt: new Date().toISOString() });
  return { artifact, checks: { sha, status: "PASS", evidence: evidence(report) } };
}

function releaseMetadata(cwd, pending) {
  const pkg = readJson(join(cwd, "package.json")); const version = nextVersion(pkg.version);
  pkg.version = version; writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
  const files = ["package.json", "docs/NOVEDADES.md"];
  if (existsSync(join(cwd, "package-lock.json"))) {
    const lock = readJson(join(cwd, "package-lock.json")); lock.version = version; lock.packages[""].version = version;
    writeFileSync(join(cwd, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n"); files.push("package-lock.json");
  }
  mkdirSync(join(cwd, "docs"), { recursive: true });
  appendFileSync(join(cwd, "docs/NOVEDADES.md"), `\n## v${version} — ${new Date().toISOString().slice(0, 10)}\n\n` + pending.subjects.map(s => `- ${s}`).join("\n") + "\n");
  git(cwd, "add", "--", ...files);
  git(cwd, "commit", "-m", `chore(release): v${version} (Refs #173)`);
  return git(cwd, "rev-parse", "HEAD");
}

/** El retry reusa SHA/versión; una intención POST persistida jamás se reenvía. */
export async function publishPrepared(cwd, config, state, { hub, runner = command, signal, sleep = wait } = {}) {
  assertPublicationEnabled(config);
  const pending = state.pending;
  assertNotRejected(state, pending.candidateSHA);
  const client = hub ?? hubClient(config);
  requirePilotGate(config, pending);
  assertHead(cwd, pending.releaseSHA ?? pending.candidateSHA);
  if (!pending.releaseSHA) {
    // Antes de escribir metadata, candidato exacto y artefacto aprobado presentes.
    if (!sameArtifact(artifactSeal(cwd, pending.candidateSHA, pending.artifact.version), pending.artifact)) throw new Error("Artefacto candidato alterado");
    await client.preflight(); // SOURCE_COMMIT y destino antes de crear release.
    signal?.throwIfAborted(); assertPublicationEnabled(config); assertHead(cwd, pending.candidateSHA);
    pending.releaseSHA = releaseMetadata(cwd, pending);
    pending.version = assertReleaseOnly(cwd, pending.candidateSHA, pending.releaseSHA);
    save(config, state);
  }
  const releaseSHA = pending.releaseSHA;
  const version = assertReleaseOnly(cwd, pending.candidateSHA, releaseSHA);
  let deployment = state.deployments[releaseSHA];
  if (!deployment) {
    const sealed = await checks(cwd, releaseSHA, config, signal, runner);
    deployment = state.deployments[releaseSHA] = { candidateSHA: pending.candidateSHA, releaseSHA, version, artifact: sealed.artifact, checks: sealed.checks, pushed: false, triggerAccepted: false, served: false };
    save(config, state);
  }
  assertHead(cwd, releaseSHA);
  requirePilotGate(config, pending); // Sin cambios de código después del PASS.
  if (!sameArtifact(artifactSeal(cwd, releaseSHA, version), deployment.artifact)) throw new Error("Sello release no coincide");
  signal?.throwIfAborted();
  if (!deployment.pushed) {
    assertPublicationEnabled(config);
    await client.preflight(); // GET autorizado, repo/branch/SOURCE_COMMIT verificables.
    git(cwd, "fetch", "origin", "--prune");
    const remote = git(cwd, "rev-parse", `origin/${LIVE}`);
    // Una publicación externa invalida la base: nunca rebase/reset/force.
    if (remote !== pending.baseSHA && remote !== releaseSHA) throw new Error("Rama remota cambió: nuevo candidato/Pilot requeridos");
    signal?.throwIfAborted(); assertPublicationEnabled(config); assertHead(cwd, releaseSHA);
    if (remote !== releaseSHA) git(cwd, "push", "origin", `HEAD:refs/heads/${LIVE}`);
    deployment.pushed = true; save(config, state);
  }
  if (deployment.served) return { status: "SERVED", releaseSHA, version };
  if (!deployment.triggerAccepted) {
    // Esperar autodeploy; nunca duplicar un deployment existente de ese SHA.
    const deadline = Date.now() + config.autodeployWaitMs;
    let matches;
    do {
      matches = await client.deployments(releaseSHA);
      if (matches.length || deployment.triggerIntent || Date.now() >= deadline || signal?.aborted) break;
      await sleep(config.pollMs);
    } while (true);
    if (matches.length) { deployment.triggerAccepted = true; deployment.deploymentSeen = true; save(config, state); }
    else if (!deployment.triggerIntent) {
      assertPublicationEnabled(config);
      await client.preflight();
      signal?.throwIfAborted();
      // Último GET tras preflight para evitar POST si apareció autodeploy.
      matches = await client.deployments(releaseSHA);
      if (matches.length) {
        deployment.triggerAccepted = true; deployment.deploymentSeen = true; save(config, state);
      } else {
        signal?.throwIfAborted(); assertPublicationEnabled(config);
        // fs persist antes de POST: crash/timeout posterior se retoma sólo con GET.
        deployment.triggerIntent = new Date().toISOString(); save(config, state);
        await client.trigger();
        deployment.triggerAccepted = true; save(config, state);
      }
    }
  }
  const deadline = Date.now() + config.smokeTimeoutMs;
  do {
    try {
      const proof = deploymentOutcome(await client.deployments(releaseSHA), releaseSHA, config.applicationUUID);
      const proofFile = join(config.evidenceDir, releaseSHA, "hub-deployment.json");
      atomicJson(proofFile, proof); deployment.hubEvidence = evidence(proofFile); deployment.hubStatus = proof.status; save(config, state);
      if (proof.status === "FAILED") return { status: "DEPLOYMENT_FAILED_GET_ONLY", releaseSHA, version, hubEvidence: deployment.hubEvidence };
      if (proof.status !== "FINISHED") throw new Error("Deployment pendiente: requiere finished/finished_at/no rollback y recurso/SHA exactos");
      await runner(cwd, "node", ["scripts/verify-release.mjs", version, releaseSHA], { signal, logFile: join(config.evidenceDir, releaseSHA, "smoke.log") });
      deployment.served = true; deployment.servedAt = new Date().toISOString();
      deployment.pilotCandidate = { candidateSHA: pending.candidateSHA, artifact: pending.artifact, checks: pending.checks };
      state.lastServedSHA = releaseSHA; state.lastServedAt = deployment.servedAt;
      state.autoPolicy = { issue: 173, threshold: 10, watchIntervalMs: 1200000, cooldownMs: 600000, countBaseSHA: releaseSHA };
      state.pending = null; save(config, state);
      return { status: "SERVED", releaseSHA, version };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (Date.now() >= deadline) return { status: deployment.triggerAccepted ? "SMOKE_PENDING_GET_ONLY" : "TRIGGER_UNCERTAIN_GET_ONLY", releaseSHA, version };
      await sleep(config.pollMs);
    }
  } while (true);
}

export async function cycle(cwd, config, { mode = "ht", runner = command, signal, hub, sleep } = {}) {
  if (!["prepare", "reject", "supersede-published-failed-ready", "ht", "auto"].includes(mode)) throw new Error("Modo de ciclo inválido");
  assertIntegrator(cwd, config);
  if (!["prepare", "reject", "supersede-published-failed-ready"].includes(mode)) assertPublicationEnabled(config);
  const unlock = acquireLock(config.cycleLock);
  try {
    const state = loadState(config);
    if (mode === "reject") return rejectReady(cwd, config, state, signal);
    if (mode === "supersede-published-failed-ready") return await supersedePublishedFailedReady(cwd, config, state, { hub, signal });
    if (state.pending) { assertNotRejected(state, state.pending.candidateSHA); assertNoPilotRejection(config, state.pending); }
    const baseline = mode === "auto" ? servedBaseline(cwd, config, state) : null;
    const policy = { threshold: 10, watchIntervalMs: 1200000, cooldownMs: 600000, countBaseSHA: baseline?.sha ?? null };
    if (mode === "auto" && !baseline) return { status: "AUTO_WAITING_SERVED_BASELINE", pid: process.pid, ...policy };
    if (state.pending) {
      const pending = state.pending;
      assertNotRejected(state, pending.candidateSHA);
      assertNoPilotRejection(config, pending); // FAIL jamás convierte un fix nuevo en metadata release.
      const head = git(cwd, "rev-parse", "HEAD");
      // Recupera crash entre commit metadata y persistencia: sólo release exacto.
      if (!pending.releaseSHA && head !== pending.candidateSHA) {
        pending.version = assertReleaseOnly(cwd, pending.candidateSHA, head); pending.releaseSHA = head; save(config, state);
      }
      assertHead(cwd, pending.releaseSHA ?? pending.candidateSHA);
      if (mode === "prepare") return { status: "READY", candidateSHA: pending.candidateSHA };
      try { requirePilotGate(config, pending); } catch (error) { return { status: "READY_WAITING_PILOT", candidateSHA: pending.candidateSHA, reason: error.message }; }
      return await publishPrepared(cwd, config, state, { runner, signal, hub, sleep });
    }
    if (mode === "auto" && Date.now() - Date.parse(state.lastAttemptAt ?? "1970-01-01") < 600000) return { status: "COOLDOWN", ...policy };
    git(cwd, "fetch", "origin", "--prune");
    const work = inventory(cwd, baseline?.sha ?? `origin/${LIVE}`);
    git(cwd, "merge-base", "--is-ancestor", work.remoteBaseSHA, "HEAD");
    git(cwd, "merge-base", "--is-ancestor", work.baseSHA, "HEAD");
    if (work.count < (mode === "auto" ? 10 : 1)) return { status: "NO_AUTHORIZED_PRODUCT", count: work.count, excluded: work.excluded, countBaseSHA: work.countBaseSHA, remoteBaseSHA: work.remoteBaseSHA };
    state.lastAttemptAt = new Date().toISOString(); save(config, state);
    for (const branch of work.branches) {
      // Nada de reset hard: en conflicto abortar sólo merge actual y preservar anteriores.
      try { git(cwd, "merge", "--no-ff", "--no-edit", branch.ref); }
      catch { try { git(cwd, "merge", "--abort"); } catch { /* revisar manualmente */ } throw new Error(`Conflicto ${branch.branch}; merges previos preservados`); }
    }
    if (!productChanged(cwd, work.baseSHA)) return { status: "NO_PRODUCT_DIFF_NO_RELEASE" };
    const candidateSHA = git(cwd, "rev-parse", "HEAD");
    assertNotRejected(state, candidateSHA);
    const result = await checks(cwd, candidateSHA, config, signal, runner);
    state.pending = { candidateSHA, baseSHA: work.remoteBaseSHA, countBaseSHA: work.countBaseSHA, remoteBaseSHA: work.remoteBaseSHA, count: work.count, subjects: work.functional.map(i => i.subject), ...result };
    if (mode === "auto") state.autoPolicy = { issue: 173, ...policy };
    save(config, state);
    atomicJson(config.candidateFile, { schema: 1, issue: 173, status: "READY", approvedCandidateSHA: candidateSHA, checks: { ...result.checks, artifact: result.artifact } });
    // Siempre parar en candidato: Pilot independiente antes de metadata/push.
    return { status: "READY", candidateSHA };
  } finally { unlock(); }
}
