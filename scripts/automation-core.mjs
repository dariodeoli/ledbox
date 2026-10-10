import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hostname } from "node:os";

export const LIVE = "codex/ledbox-gestion-multiempresa";
export const SLOTS = ["slot/panel", "slot/operacion", "slot/finanzas", "slot/plataforma"];
export const ISSUE = 173;
export const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim();
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const shaValid = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
export function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
export function atomicJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 }); renameSync(temp, path); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Lock inválido: requiere inspección manual");
  try { process.kill(pid, 0); return true; } catch (e) { if (e.code === "ESRCH") return false; if (e.code === "EPERM") return true; throw e; }
}
/** wx exclusivo; recupera sólo PID muerto bajo mutex de reclamación separado. */
export function acquireLock(path) {
  mkdirSync(dirname(path), { recursive: true });
  const owner = { pid: process.pid, hostname: hostname(), token: randomUUID(), startedAt: new Date().toISOString() };
  const create = () => { const fd = openSync(path, "wx", 0o600); try { writeFileSync(fd, JSON.stringify(owner)); } finally { closeSync(fd); } };
  try { create(); } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const guard = `${path}.reclaim`;
    // Un reclaim huérfano se inspecciona manualmente: no arriesgar borrar otro dueño.
    const fd = openSync(guard, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify(owner));
      if (existsSync(path)) {
        const stale = readJson(path);
        if (stale.hostname !== owner.hostname || typeof stale.token !== "string" || !stale.token) throw new Error("Lock sin dueño local verificable: requiere inspección manual");
        if (alive(stale.pid)) throw new Error(`Lock ocupado por PID ${stale.pid}`);
        unlinkSync(path);
      }
      create();
    } finally { closeSync(fd); unlinkSync(guard); }
  }
  return () => {
    if (existsSync(path) && readJson(path).token === owner.token) unlinkSync(path);
  };
}

export function scopedEnabled(config) {
  try { const flag = readJson(config.enableFile); return flag.enabled === true && flag.scope === "#173"; } catch { return false; }
}
export function assertPublicationEnabled(config) {
  if (!scopedEnabled(config)) throw new Error("PAUSADA: falta habilitación scoped #173 del integrador");
  // La excepción scoped nunca elimina la barrera global ni habilita otros scripts.
}
export function assertIntegrator(cwd, config) {
  if (realpathSync(cwd) !== realpathSync(config.integratorCheckout)) throw new Error("Sólo checkout principal del integrador");
  if (git(cwd, "rev-parse", "--show-toplevel") !== realpathSync(cwd) || git(cwd, "branch", "--show-current") !== LIVE) throw new Error("Se requiere rama viva en checkout principal");
  if (resolve(cwd, git(cwd, "rev-parse", "--git-dir")) !== resolve(cwd, git(cwd, "rev-parse", "--git-common-dir"))) throw new Error("No ejecutar ciclos desde worktree de carril");
  if (git(cwd, "status", "--porcelain") || existsSync(resolve(cwd, git(cwd, "rev-parse", "--git-path", "MERGE_HEAD")))) throw new Error("Checkout sucio o merge en curso; preservar y resolver manualmente");
}

export function productFile(path) {
  return /^(app\/|components\/|lib\/|prisma\/|scripts\/|public\/|assets\/|middleware\.|next\.config|Dockerfile|nixpacks\.|postcss\.|tailwind\.|\.node-version|\.dockerignore)/.test(path) && !/\.(?:md|test\.[^/]+|spec\.[^/]+)$/.test(path);
}
export function refs173(subject) { return /\bRefs\s+#173\b/i.test(subject); }
const commitCache = new Map();
function commitInfo(cwd, sha) {
  const key = `${cwd}:${sha}`;
  if (commitCache.has(key)) return commitCache.get(key);
  const subject = git(cwd, "show", "-s", "--format=%s", sha);
  const parents = git(cwd, "show", "-s", "--format=%P", sha).split(" ").filter(Boolean);
  const files = git(cwd, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", sha).split("\n").filter(Boolean);
  const product = files.filter(productFile);
  // Full-index conserva identidad binaria sin volcar imágenes codificadas gigantes.
  const diff = product.length && parents.length <= 1 ? git(cwd, "show", "--format=", "--full-index", sha, "--", ...product) : "";
  const patch = diff ? execFileSync("git", ["patch-id", "--stable"], { cwd, input: diff + "\n", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split(" ")[0].trim() : null;
  const info = { sha, subject, parents, files, product, patch, functional: parents.length <= 1 && product.length > 0 };
  commitCache.set(key, info); return info;
}
/** Unión ahead local + refs allowlist; SHA y patch-id funcional únicos. */
export function inventory(cwd, base = `origin/${LIVE}`, remoteBase = `origin/${LIVE}`) {
  const baseSHA = git(cwd, "rev-parse", base);
  const remoteBaseSHA = git(cwd, "rev-parse", remoteBase);
  const ahead = git(cwd, "rev-list", `${baseSHA}..HEAD`).split("\n").filter(Boolean);
  const branches = [];
  const union = new Set(ahead);
  for (const branch of SLOTS) {
    const ref = `refs/remotes/origin/${branch}`;
    try { git(cwd, "show-ref", "--verify", "--quiet", ref); }
    catch (error) { if (error.status === 1) continue; throw error; }
    const sha = git(cwd, "rev-parse", "--verify", ref);
    try { git(cwd, "merge-base", "--is-ancestor", sha, "HEAD"); continue; }
    catch (error) { if (error.status !== 1) throw error; }
    const commits = git(cwd, "rev-list", `${baseSHA}..${sha}`).split("\n").filter(Boolean);
    for (const commit of commits) union.add(commit);
    branches.push({ branch, ref, sha, commits });
  }
  const infos = new Map([...union].map(sha => [sha, commitInfo(cwd, sha)]));
  const forbidden = info => info.parents.length <= 1 && !refs173(info.subject);
  // Historia ya importada/remota se filtra del count; nunca legitima nuevo ahead ajeno.
  const unsafeAhead = git(cwd, "rev-list", `${remoteBaseSHA}..HEAD`).split("\n").filter(Boolean).map(sha => commitInfo(cwd, sha)).filter(forbidden);
  if (unsafeAhead.length) throw new Error(`Ahead local fuera de #173: ${unsafeAhead.map(i => i.sha).join(", ")}`);
  const eligibleBranches = branches.filter(b => !git(cwd, "rev-list", `HEAD..${b.sha}`).split("\n").filter(Boolean).some(sha => forbidden(commitInfo(cwd, sha))));
  const eligible = new Set([...ahead, ...eligibleBranches.flatMap(b => b.commits)]);
  // Patches ya presentes en la base no cuentan aunque sean cherry-picks nuevos.
  const known = new Set();
  for (const sha of git(cwd, "rev-list", "--no-merges", baseSHA).split("\n").filter(Boolean)) {
    const info = commitInfo(cwd, sha); if (info.patch) known.add(info.patch);
  }
  const functional = [];
  for (const sha of eligible) {
    const info = infos.get(sha);
    if (info.functional && refs173(info.subject) && info.patch && !known.has(info.patch)) { known.add(info.patch); functional.push(info); }
  }
  return { baseSHA, countBaseSHA: baseSHA, remoteBaseSHA, count: functional.length, functional, branches: eligibleBranches.filter(b => b.commits.some(sha => infos.get(sha).functional && refs173(infos.get(sha).subject))), excluded: branches.filter(b => !eligibleBranches.includes(b)).map(b => b.branch) };
}

/** Sólo recibos locales servidos con evidencia Hub exacta; nunca bootstrap por origin/health viejo. */
export function servedBaseline(cwd, config, state) {
  const candidates = state.lastServedSHA ? [state.lastServedSHA] : Object.entries(state.deployments ?? {})
    .filter(([sha, record]) => shaValid(sha) && record.served === true && typeof record.servedAt === "string" && Number.isFinite(Date.parse(record.servedAt)))
    .sort((a, b) => Date.parse(b[1].servedAt ?? "") - Date.parse(a[1].servedAt ?? "")).map(([sha]) => sha);
  for (const sha of candidates) {
    try {
      const record = state.deployments?.[sha];
      if (!shaValid(sha) || record?.served !== true || record.releaseSHA !== sha) continue;
      const proof = checkedEvidence(record.hubEvidence);
      if (proof.status !== "FINISHED" || proof.sha !== sha || proof.applicationUUID !== config.applicationUUID || !Array.isArray(proof.deployments) || !proof.deployments.length) continue;
      if (!proof.deployments.every(row => row.commit === sha && row.application_uuid === config.applicationUUID && typeof row.deployment_uuid === "string" && row.deployment_uuid && row.status === "finished" && row.rollback === false && typeof row.finished_at === "string" && Number.isFinite(Date.parse(row.finished_at)))) continue;
      git(cwd, "merge-base", "--is-ancestor", sha, "HEAD");
      return { sha, receipt: record };
    } catch { /* Evidencia ausente/alterada o historia divergente: no fabricar baseline. */ }
  }
  return null;
}

export function productChanged(cwd, baseSHA, head = "HEAD") {
  return git(cwd, "diff", "--name-only", baseSHA, head).split("\n").filter(Boolean).some(productFile);
}
export function assertReleaseOnly(cwd, candidateSHA, releaseSHA) {
  if (!shaValid(candidateSHA) || !shaValid(releaseSHA)) throw new Error("SHA completo requerido");
  if (git(cwd, "rev-parse", `${releaseSHA}^`) !== candidateSHA || git(cwd, "show", "-s", "--format=%P", releaseSHA).split(" ").length !== 1) throw new Error("Release debe ser un único commit hijo del candidato");
  const names = git(cwd, "diff", "--name-only", candidateSHA, releaseSHA).split("\n").filter(Boolean);
  if (!names.includes("package.json") || names.some(p => !["package.json", "package-lock.json", "docs/NOVEDADES.md"].includes(p))) throw new Error("Código cambió después de Pilot");
  const before = JSON.parse(git(cwd, "show", `${candidateSHA}:package.json`));
  const after = JSON.parse(git(cwd, "show", `${releaseSHA}:package.json`));
  const version = nextVersion(before.version);
  if (after.version !== version) throw new Error("Versión de release no corresponde al siguiente patch");
  after.version = before.version;
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error("package.json contiene cambios ajenos a versión");
  if (names.includes("package-lock.json")) {
    const a = JSON.parse(git(cwd, "show", `${candidateSHA}:package-lock.json`));
    const b = JSON.parse(git(cwd, "show", `${releaseSHA}:package-lock.json`));
    if (b.version !== version || b.packages?.[""]?.version !== version) throw new Error("Lock version incoherente");
    b.version = a.version; b.packages[""].version = a.packages[""].version;
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("Lock cambió dependencias después de Pilot");
  }
  return version;
}
export function nextVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Versión semver patch requerida");
  const parts = version.split(".").map(Number); parts[2]++; return parts.join(".");
}
export function artifactSeal(cwd, sha, version) {
  const root = join(cwd, ".next", "standalone");
  const server = readFileSync(join(root, "server.js"), "utf8");
  if (!server.includes(`"LEDBOX_BUILD_SHA":"${sha}"`) || readJson(join(root, "package.json")).version !== version) throw new Error("Standalone sin sello SHA/versión exactos");
  const digest = createHash("sha256");
  const visit = (dir, prefix = "") => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), relative = `${prefix}${name}`, stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("Artefacto contiene symlink no sellado");
      if (stat.isDirectory()) visit(path, relative + "/");
      else { digest.update(relative + "\0"); digest.update(hash(readFileSync(path)) + "\n"); }
    }
  };
  visit(root);
  return { sha, version, manifestSha256: digest.digest("hex") };
}
export function evidence(path) { return { path: resolve(path), sha256: hash(readFileSync(path)) }; }
export function sameArtifact(a, b) { return ["sha", "version", "manifestSha256"].every(key => a?.[key] === b?.[key]) && shaValid(a?.sha) && /^[a-f0-9]{64}$/.test(a?.manifestSha256 ?? ""); }
function checkedEvidence(ref) {
  if (!ref || typeof ref.path !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256 ?? "")) throw new Error("Evidencia ausente/alterada");
  const bytes = readFileSync(ref.path);
  if (hash(bytes) !== ref.sha256) throw new Error("Evidencia ausente/alterada");
  return JSON.parse(bytes.toString("utf8"));
}
export function requirePilotRejection(config, pending) {
  const bytes = readFileSync(config.rejectedGate);
  const gate = JSON.parse(bytes.toString("utf8")), sha = pending.candidateSHA;
  if (!shaValid(sha) || gate.schema !== 1 || gate.issue !== ISSUE || gate.rejectedCandidateSHA !== sha || gate.pilot?.role !== "lbx-pilot" || gate.pilot.status !== "FAIL" || gate.pilot.sha !== sha) throw new Error("Rechazo requiere Pilot FAIL exacto del candidato #173");
  const pilot = checkedEvidence(gate.pilot.evidence);
  if (pilot.role !== "lbx-pilot" || pilot.status !== "FAIL" || pilot.sha !== sha) throw new Error("Evidencia Pilot FAIL inválida");
  if (pending.checks?.evidence?.path && realpathSync(gate.pilot.evidence.path) === realpathSync(pending.checks.evidence.path)) throw new Error("Evidencia Pilot FAIL no independiente");
  return { gate, pilot, gateEvidence: { path: resolve(config.rejectedGate), sha256: hash(bytes) } };
}
export function requireManualPushAck(config, pending) {
  const bytes = readFileSync(config.manualPushAckFile), ack = JSON.parse(bytes.toString("utf8"));
  if (ack.schema !== 1 || ack.issue !== ISSUE || ack.sha !== pending.candidateSHA || ack.attribution !== "owner:GitHub Desktop" || ack.allowForwardFixes !== true) throw new Error("ACK operativo no autoriza forward fixes del candidato SHA exacto #173");
  return { ack, ackEvidence: { path: resolve(config.manualPushAckFile), sha256: hash(bytes) } };
}
export function assertNoPilotRejection(config, pending) {
  if (config.rejectedGate && existsSync(config.rejectedGate) && readJson(config.rejectedGate).rejectedCandidateSHA === pending.candidateSHA) {
    requirePilotRejection(config, pending);
    throw new Error("Pilot FAIL: candidato rechazado, requiere reject y nuevo prepare");
  }
}
export function requirePilotGate(config, pending) {
  const gate = readJson(config.gateFile);
  const sha = pending.candidateSHA;
  if (!shaValid(sha)) throw new Error("Candidato requiere SHA completo");
  assertNoPilotRejection(config, pending);
  if (gate.schema !== 1 || gate.issue !== ISSUE || gate.approvedCandidateSHA !== sha || gate.pilot?.role !== "lbx-pilot" || gate.pilot.status !== "PASS" || gate.pilot.sha !== sha || gate.checks?.status !== "PASS" || gate.checks.sha !== sha) throw new Error("Gate Pilot/checks no aprueba candidato SHA exacto #173");
  const pilot = checkedEvidence(gate.pilot.evidence), checks = checkedEvidence(gate.checks.evidence);
  if (pilot.role !== "lbx-pilot" || pilot.status !== "PASS" || pilot.sha !== sha || realpathSync(gate.pilot.evidence.path) === realpathSync(gate.checks.evidence.path)) throw new Error("Evidencia Pilot independiente inválida");
  if (checks.sha !== sha || checks.status !== "PASS" || ["npm ci", "prisma generate", "typecheck", "test:rules", "test:automation", "build"].some(c => checks.commands?.[c] !== "PASS")) throw new Error("Checks completos por candidato requeridos");
  if (!sameArtifact(gate.checks.artifact, pending.artifact) || !sameArtifact(checks.artifact, pending.artifact) || gate.checks.evidence.sha256 !== pending.checks.evidence.sha256) throw new Error("Gate no referencia artefacto/checks sellados del candidato");
  return gate;
}
