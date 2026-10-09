import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactSeal, assertIntegrator, assertPublicationEnabled, assertReleaseOnly, atomicJson, evidence, git, inventory, LIVE, nextVersion, productChanged, readJson, requirePilotGate, acquireLock, sameArtifact } from "./automation-core.mjs";
import { hubClient } from "./automation-hub.mjs";

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
      await runner(cwd, "node", ["scripts/verify-release.mjs", version, releaseSHA], { signal, logFile: join(config.evidenceDir, releaseSHA, "smoke.log") });
      deployment.served = true; state.lastServedAt = new Date().toISOString(); state.pending = null; save(config, state);
      return { status: "SERVED", releaseSHA, version };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (Date.now() >= deadline) return { status: deployment.triggerAccepted ? "SMOKE_PENDING_GET_ONLY" : "TRIGGER_UNCERTAIN_GET_ONLY", releaseSHA, version };
      await sleep(config.pollMs);
    }
  } while (true);
}

export async function cycle(cwd, config, { mode = "ht", runner = command, signal, hub, sleep } = {}) {
  if (!["prepare", "ht", "auto"].includes(mode)) throw new Error("Modo de ciclo inválido");
  assertIntegrator(cwd, config);
  if (mode !== "prepare") assertPublicationEnabled(config);
  const unlock = acquireLock(config.cycleLock);
  try {
    const state = loadState(config);
    if (state.pending) {
      const pending = state.pending;
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
    if (mode === "auto" && Date.now() - Date.parse(state.lastAttemptAt ?? "1970-01-01") < 20 * 60000) return { status: "COOLDOWN" };
    git(cwd, "fetch", "origin", "--prune");
    const work = inventory(cwd);
    git(cwd, "merge-base", "--is-ancestor", work.baseSHA, "HEAD");
    if (work.count < (mode === "auto" ? 10 : 1)) return { status: "NO_AUTHORIZED_PRODUCT", count: work.count, excluded: work.excluded };
    state.lastAttemptAt = new Date().toISOString(); save(config, state);
    for (const branch of work.branches) {
      // Nada de reset hard: en conflicto abortar sólo merge actual y preservar anteriores.
      try { git(cwd, "merge", "--no-ff", "--no-edit", branch.ref); }
      catch { try { git(cwd, "merge", "--abort"); } catch { /* revisar manualmente */ } throw new Error(`Conflicto ${branch.branch}; merges previos preservados`); }
    }
    if (!productChanged(cwd, work.baseSHA)) return { status: "NO_PRODUCT_DIFF_NO_RELEASE" };
    const candidateSHA = git(cwd, "rev-parse", "HEAD");
    const result = await checks(cwd, candidateSHA, config, signal, runner);
    state.pending = { candidateSHA, baseSHA: work.baseSHA, count: work.count, subjects: work.functional.map(i => i.subject), ...result };
    save(config, state);
    atomicJson(config.candidateFile, { schema: 1, issue: 173, status: "READY", approvedCandidateSHA: candidateSHA, checks: { ...result.checks, artifact: result.artifact } });
    // Siempre parar en candidato: Pilot independiente antes de metadata/push.
    return { status: "READY", candidateSHA };
  } finally { unlock(); }
}
