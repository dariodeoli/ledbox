import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { hostname, tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { acquireLock, artifactSeal, assertIntegrator, assertReleaseOnly, atomicJson, evidence, git, inventory, LIVE, readJson, requirePilotGate } from "../scripts/automation-core.mjs";
import { cycle, loadState } from "../scripts/automation-cycle.mjs";
import { deploySettings, hubClient } from "../scripts/automation-hub.mjs";
import { diagnostics } from "../scripts/automation-diagnostics.mjs";
import { verifyRelease } from "../scripts/verify-release.mjs";

const temp = () => { const root = join(tmpdir(), "opencode"); mkdirSync(root, { recursive: true }); return mkdtempSync(join(root, "ledbox-auto-test-")); };
function fixture() {
  const dir = temp(), cwd = join(dir, "repo"), remote = join(dir, "remote.git"); mkdirSync(cwd);
  execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
  execFileSync("git", ["init", "-b", LIVE, cwd], { stdio: "ignore" });
  git(cwd, "config", "user.name", "Automation QA"); git(cwd, "config", "user.email", "qa@example.invalid");
  mkdirSync(join(cwd, "app")); mkdirSync(join(cwd, "docs"));
  writeFileSync(join(cwd, "app/a.js"), "base\n"); writeFileSync(join(cwd, ".gitignore"), ".next\n");
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "qa", version: "1.0.0", private: true }));
  writeFileSync(join(cwd, "package-lock.json"), JSON.stringify({ name: "qa", version: "1.0.0", packages: { "": { name: "qa", version: "1.0.0" } } }));
  writeFileSync(join(cwd, "docs/NOVEDADES.md"), "# QA\n");
  git(cwd, "add", "."); git(cwd, "commit", "-m", "initial QA fixture"); git(cwd, "remote", "add", "origin", remote); git(cwd, "push", "-u", "origin", LIVE);
  const config = { applicationUUID: "qa-uuid", integratorCheckout: cwd, liveBranch: LIVE, enableFile: join(dir, "enable.json"), pauseFile: join(dir, "paused"), gateFile: join(dir, "approved.json"), rejectedGate: join(dir, "rejected.json"), manualPushAckFile: join(dir, "manual-ack.json"), candidateFile: join(dir, "candidate.json"), stateFile: join(dir, "state.json"), cycleLock: join(dir, "cycle.lock"), watcherLock: join(dir, "watcher.lock"), evidenceDir: join(dir, "evidence"), deployEnvFile: join(dir, "deploy.env"), autodeployWaitMs: 0, smokeTimeoutMs: 0, pollMs: 1 };
  writeFileSync(config.pauseFile, "only Emple\n");
  return { dir, cwd, config, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
function commit(cwd, path, body, subject = "fix(qa): cambio autorizado (Refs #173)") {
  mkdirSync(join(cwd, path, ".."), { recursive: true }); writeFileSync(join(cwd, path), body); git(cwd, "add", path); git(cwd, "commit", "-m", subject); return git(cwd, "rev-parse", "HEAD");
}
function build(cwd, sha) {
  const root = join(cwd, ".next/standalone"); mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "server.js"), JSON.stringify({ LEDBOX_BUILD_SHA: sha }));
  writeFileSync(join(root, "package.json"), readFileSync(join(cwd, "package.json")));
}
const fakeRunner = async (cwd, executable, args, opts) => {
  assert.equal(opts.env.DATABASE_URL, ""); assert.equal(opts.env.SOURCE_COMMIT, git(cwd, "rev-parse", "HEAD"));
  if (args.join(" ") === "run build") build(cwd, opts.env.SOURCE_COMMIT);
};
const finishedDeployment = sha => ({ application_uuid: "qa-uuid", application_id: 42, deployment_uuid: "deployment-qa", commit: sha, status: "finished", finished_at: "2026-10-09T17:30:41.000000Z", rollback: false });
function approve(f) {
  const pending = loadState(f.config).pending;
  const pilotFile = join(f.dir, "pilot.json"); atomicJson(pilotFile, { role: "lbx-pilot", status: "PASS", sha: pending.candidateSHA });
  atomicJson(f.config.gateFile, { schema: 1, issue: 173, approvedCandidateSHA: pending.candidateSHA, pilot: { role: "lbx-pilot", status: "PASS", sha: pending.candidateSHA, evidence: evidence(pilotFile) }, checks: { ...pending.checks, artifact: pending.artifact } });
  atomicJson(f.config.enableFile, { enabled: true, scope: "#173" });
  return pending;
}
function failPilot(f) {
  const sha = loadState(f.config).pending.candidateSHA;
  const path = join(f.dir, "pilot-fail.json");
  atomicJson(path, { role: "lbx-pilot", status: "FAIL", sha, findings: ["A15: editor item order not persisted"] });
  atomicJson(f.config.rejectedGate, { schema: 1, issue: 173, rejectedCandidateSHA: sha, pilot: { role: "lbx-pilot", status: "FAIL", sha, evidence: evidence(path) } });
  return path;
}
function manualAck(f) {
  atomicJson(f.config.manualPushAckFile, { schema: 1, issue: 173, sha: loadState(f.config).pending.candidateSHA, attribution: "owner:GitHub Desktop", allowForwardFixes: true });
}

test("real Git: union ahead/slots, dedup patch-id y scope sin backlog/pilot/docs/deps/tests/merges", () => {
  const f = fixture();
  try {
    const base = git(f.cwd, "rev-parse", "HEAD");
    const patchA = commit(f.cwd, "app/a.js", "nuevo\n");
    commit(f.cwd, "docs/qa.md", "docs\n", "docs(qa): evidencia (Refs #173)");
    commit(f.cwd, "tests/qa.js", "test\n", "test(qa): assertions (Refs #173)");
    commit(f.cwd, "package.json", JSON.stringify({ name: "qa", version: "1.0.0", private: true, dependencies: { demo: "1" } }), "chore(deps): pin (Refs #173)");
    const ahead = git(f.cwd, "rev-parse", "HEAD");
    git(f.cwd, "checkout", "-b", "slot/panel", base);
    commit(f.cwd, "app/a.js", "nuevo\n", "feat(panel): mismo patch distinto SHA (Refs #173)");
    const panelB = commit(f.cwd, "app/b.js", "funcional B\n");
    git(f.cwd, "push", "origin", "slot/panel");
    git(f.cwd, "checkout", "-b", "slot/finanzas", base);
    commit(f.cwd, "app/private.js", "backlog\n", "fix(fin): no autorizado (Refs #170)"); git(f.cwd, "push", "origin", "slot/finanzas");
    git(f.cwd, "checkout", "-b", "slot/pilot", base);
    commit(f.cwd, "app/pilot.js", "pilot jamás integrar\n"); git(f.cwd, "push", "origin", "slot/pilot");
    git(f.cwd, "checkout", LIVE); assert.equal(git(f.cwd, "rev-parse", "HEAD"), ahead);
    git(f.cwd, "fetch", "origin");
    const result = inventory(f.cwd);
    assert.equal(result.count, 2); assert.ok(result.functional.some(i => i.sha === patchA)); assert.ok(result.functional.some(i => i.sha === panelB));
    assert.deepEqual(result.excluded, ["slot/finanzas"]); assert.ok(result.branches.every(b => b.branch !== "slot/pilot"));
    git(f.cwd, "merge", "--no-ff", "origin/slot/panel", "-m", "Merge autorizado Refs #173");
    assert.equal(inventory(f.cwd).count, 2, "merges no aumentan count");
    assert.deepEqual(inventory(f.cwd).branches, [], "refs ya integradas no se proponen para merge; ahead sigue contando");
  } finally { f.cleanup(); }
});

test("cherry-pick duplicado cuenta un patch y una rama integrada no se vuelve a ofrecer", () => {
  const f = fixture();
  try {
    const base = git(f.cwd, "rev-parse", "HEAD");
    git(f.cwd, "checkout", "-b", "slot/panel");
    const original = commit(f.cwd, "app/a.js", "patch único\n");
    git(f.cwd, "push", "origin", "slot/panel");
    git(f.cwd, "checkout", LIVE);
    commit(f.cwd, "docs/qa.md", "ancillary autorizado\n", "docs(qa): evidencia (Refs #173)");
    git(f.cwd, "cherry-pick", original);
    assert.notEqual(git(f.cwd, "rev-parse", "HEAD"), original);
    assert.equal(inventory(f.cwd).count, 1);
    assert.equal(inventory(f.cwd).branches.length, 1, "patch equivalente no implica tip integrado");
    git(f.cwd, "merge", "--no-ff", "origin/slot/panel", "-m", "Merge autorizado (Refs #173)");
    const result = inventory(f.cwd);
    assert.equal(result.baseSHA, base); assert.equal(result.count, 1); assert.deepEqual(result.branches, []);
  } finally { f.cleanup(); }
});

test("checkout/issue/pausa/umbral/cooldown y nodiff detienen publicación sin borrar historia", async () => {
  const f = fixture();
  try {
    commit(f.cwd, "app/a.js", "new\n");
    await assert.rejects(cycle(f.cwd, f.config), /PAUSADA/);
    assert.equal(readFileSync(f.config.pauseFile, "utf8"), "only Emple\n");
    atomicJson(f.config.enableFile, { enabled: true, scope: "#173" });
    assert.equal((await cycle(f.cwd, f.config, { mode: "auto" })).status, "NO_AUTHORIZED_PRODUCT");
    atomicJson(f.config.stateFile, { schema: 1, deployments: {}, pending: null, lastAttemptAt: new Date().toISOString() });
    assert.equal((await cycle(f.cwd, f.config, { mode: "auto" })).status, "COOLDOWN");
    commit(f.cwd, "app/a.js", "base\n", "fix(qa): revert funcional (Refs #173)");
    assert.equal((await cycle(f.cwd, f.config, { mode: "prepare", runner: async () => assert.fail("nodiff no hace build/release") })).status, "NO_PRODUCT_DIFF_NO_RELEASE");
    commit(f.cwd, "app/foreign.js", "x\n", "fix(qa): backlog (Refs #170)");
    assert.throws(() => inventory(f.cwd), /fuera de #173/);
    git(f.cwd, "checkout", "-b", "slot/otro"); assert.throws(() => assertIntegrator(f.cwd, f.config), /rama viva/);
  } finally { f.cleanup(); }
});

test("locks wx exclusivos, watcher separado, señales y PID muerto recuperable", async () => {
  const dir = temp(), path = join(dir, "cycle.lock");
  const module = pathToFileURL(new URL("../scripts/automation-core.mjs", import.meta.url).pathname).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {acquireLock} from ${JSON.stringify(module)}; const done=acquireLock(${JSON.stringify(path)}); process.on('SIGTERM',()=>{done();process.exit(0)}); console.log('locked');setInterval(()=>{},1000);`]);
  try {
    await new Promise((resolvePromise, reject) => { child.stdout.once("data", resolvePromise); child.once("error", reject); });
    assert.throws(() => acquireLock(path), /ocupado/);
    const releaseWatcher = acquireLock(join(dir, "watcher.lock")); releaseWatcher();
    const ended = new Promise(resolvePromise => child.once("exit", resolvePromise)); child.kill("SIGTERM"); await ended;
    assert.equal(existsSync(path), false, "cleanup señal");
    atomicJson(path, { pid: child.pid, hostname: hostname(), token: "dead", startedAt: "old" });
    const release = acquireLock(path); assert.equal(readJson(path).pid, process.pid); release();
    assert.equal(existsSync(path), false); assert.equal(existsSync(path + ".reclaim"), false);
  } finally { child.kill(); rmSync(dir, { recursive: true, force: true }); }
});

test("candidato READY inmóvil requiere Pilot exacto, artefacto/evidencia y sin código postPASS", async () => {
  const f = fixture();
  try {
    commit(f.cwd, "app/a.js", "producto\n");
    const result = await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner }); assert.equal(result.status, "READY");
    assert.equal(git(f.cwd, "rev-parse", `origin/${LIVE}`), loadState(f.config).pending.baseSHA, "no push antes gate");
    atomicJson(f.config.enableFile, { enabled: true, scope: "#173" });
    assert.equal((await cycle(f.cwd, f.config)).status, "READY_WAITING_PILOT");
    const pending = approve(f); requirePilotGate(f.config, pending);
    const gate = readJson(f.config.gateFile); gate.pilot.sha = "0".repeat(40); atomicJson(f.config.gateFile, gate); assert.throws(() => requirePilotGate(f.config, pending));
    approve(f); writeFileSync(join(f.dir, "pilot.json"), "altered"); assert.throws(() => requirePilotGate(f.config, pending), /alterada/);
    commit(f.cwd, "app/b.js", "código después QA\n"); assert.throws(() => assertReleaseOnly(f.cwd, result.candidateSHA, git(f.cwd, "rev-parse", "HEAD")), /Código/);
  } finally { f.cleanup(); }
});

test("release retry no vuelve a versionar/POST y timeout smoke reanuda sólo GET; Git push temporal", async () => {
  const f = fixture(); let posts = 0, builds = 0, smokePass = false;
  const hub = { preflight: async () => ({}), deployments: async sha => smokePass ? [finishedDeployment(sha)] : [], trigger: async () => { posts++; } };
  const runner = async (cwd, executable, args, opts) => {
    if (executable === "node" && args[0] === "scripts/verify-release.mjs") { if (!smokePass) throw new Error("smoke timeout QA"); return; }
    if (args.join(" ") === "run build" && ++builds === 2) throw new Error("primer build release falla QA");
    await fakeRunner(cwd, executable, args, opts);
  };
  try {
    commit(f.cwd, "app/a.js", "producto\n"); await cycle(f.cwd, f.config, { mode: "prepare", runner }); approve(f);
    await assert.rejects(cycle(f.cwd, f.config, { runner, hub }), /build release/);
    const release = git(f.cwd, "rev-parse", "HEAD"); assert.equal(readJson(join(f.cwd, "package.json")).version, "1.0.1"); assert.equal(posts, 0);
    const first = await cycle(f.cwd, f.config, { runner, hub }); assert.equal(first.status, "SMOKE_PENDING_GET_ONLY"); assert.equal(posts, 1);
    smokePass = true;
    const second = await cycle(f.cwd, f.config, { runner, hub }); assert.equal(second.status, "SERVED"); assert.equal(posts, 1); assert.equal(second.releaseSHA, release);
    assert.equal((await cycle(f.cwd, f.config, { runner, hub })).status, "NO_AUTHORIZED_PRODUCT");
    assert.equal(git(f.cwd, "rev-parse", `origin/${LIVE}`), release); assert.ok(loadState(f.config).deployments[release].served);
  } finally { f.cleanup(); }
});

test("Hub token recargado, alias cotejado, SOURCE_COMMIT requerido y ningún POST de red real", async () => {
  const dir = temp(), file = join(dir, "deploy.env"), tokenFile = join(dir, "coolify-token");
  const config = { tokenFile, deployEnvFile: file, hubApplicationsPath: "/api/v1/applications", hubDeploymentsPath: "/api/v1/deployments/applications/{uuid}", applicationUUID: "qa-uuid", liveBranch: LIVE, canonicalRepository: "dariodeoli/ledbox", canonicalRepositoryId: 1312274819 };
  const listApp = { id: 42, uuid: "qa-uuid", git_repository: "dariodeoli/ledbox", git_branch: LIVE };
  const app = { ...listApp, settings: { is_auto_deploy_enabled: true, include_source_commit_in_build: false } };
  let requests = 0;
  try {
    writeFileSync(file, 'export LEDBOX_HUB_API_TOKEN="qa-old"\nexport LEDBOX_DEPLOY_WEBHOOK_URL="https://hub.example.invalid/api/v1/deploy?uuid=qa-uuid"\n');
    writeFileSync(tokenFile, "qa-old\n", { mode: 0o600 });
    const client = hubClient(config, async (url, options) => {
      requests++; assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.headers.Authorization, "Bearer qa-renewed");
      const path = new URL(url).pathname;
      if (path === "/api/v1/applications") return Response.json([listApp]);
      if (path === "/api/v1/applications/qa-uuid") return Response.json(app);
      if (path === "/api/v1/deployments/applications/qa-uuid") return Response.json({ count: 1, deployments: [finishedDeployment("a".repeat(40))] });
      assert.fail(`Ruta Hub inesperada: ${path}`);
    });
    writeFileSync(tokenFile, "qa-renewed\n");
    assert.equal(deploySettings(file, {}, tokenFile).token, "qa-renewed");
    await assert.rejects(client.preflight(), /SOURCE_COMMIT/);
    app.settings.include_source_commit_in_build = true;
    assert.deepEqual(await client.preflight(), { uuid: "qa-uuid", repository: "dariodeoli/ledbox", branch: LIVE, automatic: true });
    app.git_branch = "main"; await assert.rejects(client.preflight(), /branch/); app.git_branch = LIVE;
    app.uuid = "other-uuid"; await assert.rejects(client.preflight(), /UUID/); app.uuid = "qa-uuid";
    app.git_repository = "other/repo"; await assert.rejects(client.preflight(), /repository/); app.git_repository = listApp.git_repository;
    const settings = app.settings;
    for (const invalid of [undefined, [], {}, { ...settings, include_source_commit_in_build: "true" }, { ...settings, is_auto_deploy_enabled: 1 }]) {
      app.settings = invalid; await assert.rejects(client.preflight(), /settings\/flags/);
    }
    app.settings = { ...settings, is_auto_deploy_enabled: false };
    assert.equal((await client.preflight()).automatic, false);
    app.git_repository = "OwnCoding/ledbox";
    assert.equal((await client.preflight()).repository, "owncoding/ledbox", "alias con ID cotejado conserva repo");
    config.canonicalRepositoryId = 0;
    await assert.rejects(client.preflight(), /cotejo/);
    config.canonicalRepositoryId = 1312274819;
    config.canonicalRepository = "OwnCoding/ledbox";
    await assert.rejects(client.preflight(), /cotejo/, "canónico anterior no sustituye nueva configuración");
    config.canonicalRepository = "dariodeoli/ledbox";
    assert.equal((await client.deployments("a".repeat(40))).length, 1);
    assert.equal(requests, 16);
    app.id = 99;
    await assert.rejects(client.deployments("a".repeat(40)), /recurso Hub/);
    app.id = 42;
    await assert.rejects(client.deployments("a".repeat(7)), /SHA completo40/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("scope exacto y evidencia independiente: no autoaprobar Pilot ni publicar artefacto alterado", async () => {
  const f = fixture();
  try {
    commit(f.cwd, "app/a.js", "producto\n");
    for (const flag of [{ enabled: false, scope: "#173" }, { enabled: true, scope: "#170" }, { enabled: "true", scope: "#173" }]) {
      atomicJson(f.config.enableFile, flag); await assert.rejects(cycle(f.cwd, f.config), /PAUSADA/);
    }
    await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner });
    assert.equal(existsSync(f.config.gateFile), false, "prepare jamás fabrica PASS de Pilot");
    const pending = approve(f);
    const gate = readJson(f.config.gateFile);
    gate.pilot.evidence = gate.checks.evidence;
    atomicJson(f.config.gateFile, gate);
    assert.throws(() => requirePilotGate(f.config, pending), /Pilot independiente/);
    approve(f);
    writeFileSync(join(f.cwd, ".next/standalone/extra.js"), "alteración después QA\n");
    const originalHead = git(f.cwd, "rev-parse", "HEAD");
    await assert.rejects(cycle(f.cwd, f.config, { hub: { preflight: async () => assert.fail("no Hub con artefacto alterado") } }), /Artefacto candidato alterado/);
    assert.equal(git(f.cwd, "rev-parse", "HEAD"), originalHead);
    assert.equal(readJson(join(f.cwd, "package.json")).version, "1.0.0");
  } finally { f.cleanup(); }
});

test("POST incierto se retoma sólo GET/smoke; release reutilizado y autodeploy existente evita POST", async () => {
  for (const automatic of [false, true]) {
    const f = fixture(); let posts = 0, gets = 0, smokePass = false;
    const runner = async (cwd, executable, args, opts) => {
      if (args[0] === "scripts/verify-release.mjs") { if (!smokePass) throw new Error("aún no servido"); return; }
      await fakeRunner(cwd, executable, args, opts);
    };
    const hub = { preflight: async () => ({}), deployments: async sha => { gets++; return automatic || smokePass ? [finishedDeployment(sha)] : []; }, trigger: async () => { posts++; throw new Error("POST timeout ambiguo"); } };
    try {
      commit(f.cwd, "app/a.js", "producto\n"); await cycle(f.cwd, f.config, { mode: "prepare", runner }); approve(f);
      if (automatic) assert.equal((await cycle(f.cwd, f.config, { runner, hub })).status, "SMOKE_PENDING_GET_ONLY");
      else await assert.rejects(cycle(f.cwd, f.config, { runner, hub }), /ambiguo/);
      const releaseSHA = git(f.cwd, "rev-parse", "HEAD");
      assert.equal(posts, automatic ? 0 : 1);
      if (!automatic) assert.equal((await cycle(f.cwd, f.config, { runner, hub })).status, "TRIGGER_UNCERTAIN_GET_ONLY");
      const deployment = loadState(f.config).deployments[releaseSHA];
      writeFileSync(join(f.cwd, ".next/standalone/extra.js"), "altered\n");
      await assert.rejects(cycle(f.cwd, f.config, { runner, hub }), /Sello release/);
      rmSync(join(f.cwd, ".next/standalone/extra.js"));
      assert.deepEqual(artifactSeal(f.cwd, releaseSHA, "1.0.1"), deployment.artifact);
      smokePass = true;
      assert.equal((await cycle(f.cwd, f.config, { runner, hub })).status, "SERVED");
      assert.equal(posts, automatic ? 0 : 1); assert.ok(gets > 0);
      assert.equal(git(f.cwd, "rev-parse", "HEAD"), releaseSHA);
    } finally { f.cleanup(); }
  }
});

test("diagnósticos pp/pd/al conservan conceptos scoped con GET manual y sin despacho", async () => {
  const f = fixture();
  try {
    commit(f.cwd, "app/a.js", "producto\n");
    commit(f.cwd, "docs/PENDIENTES-DUENO.md", "## Pendientes\n- #173 pendiente scoped\n- #170 backlog\n## Resueltos\n- #173 resuelto\n", "docs(qa): pendientes (Refs #173)");
    const opts = { issueReader: () => ({ number: 173, state: "OPEN" }), fetcher: async (url, options) => {
      assert.equal(options.method, "GET"); assert.equal(options.redirect, "manual"); assert.equal(options.headers, undefined);
      return url.endsWith("/api/health") ? Response.json({ status: "ok", version: "1.0.0", sha: "a".repeat(40), database: "ok" }) : new Response(null, { status: 303 });
    } };
    const pp = await diagnostics(f.cwd, f.config, "pp", opts);
    assert.equal(pp.surfaces[0].health.sha, "a".repeat(40)); assert.equal(pp.surfaces[1].ok, false);
    assert.deepEqual(pp.ownerPending, ["- #173 pendiente scoped"]); assert.equal(pp.issue.number, 173);
    const pd = await diagnostics(f.cwd, f.config, "pd", opts);
    assert.equal(pd.count, 1); assert.equal(pd.commits[0].type, "fix");
    const al = await diagnostics(f.cwd, f.config, "al", opts);
    assert.equal(al.slots.length, 4); assert.equal(al.dispatch, "MANUAL_BRIEF_ONLY");
  } finally { f.cleanup(); }
});

test("CLI --prepare guarda principal sin habilitación; watcher singleton entre dos procesos y SIGTERM", async () => {
  const f = fixture();
  const cli = new URL("../scripts/orquestador.mjs", import.meta.url).pathname;
  let first;
  const cliRun = args => {
    try { execFileSync(process.execPath, [cli, ...args], { cwd: f.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); return ""; }
    catch (error) { return String(error.stderr); }
  };
  try {
    const config = { ...JSON.parse(readFileSync(new URL("../scripts/orquestador.config.json", import.meta.url))), ...f.config, logFile: join(f.dir, "log"), watchIntervalMs: 600000 };
    atomicJson(join(f.cwd, "scripts/orquestador.config.json"), config);
    git(f.cwd, "add", "scripts/orquestador.config.json"); git(f.cwd, "commit", "-m", "chore(qa): scoped config (Refs #173)");
    // Config del fixture es ancillary de QA: publicarla en remoto deja count0 para watcher.
    git(f.cwd, "push", "origin", LIVE);
    assert.match(cliRun(["watch", "--interval", "NaN"]), /--interval/);
    assert.match(cliRun(["watch"]), /PAUSADA/);
    const reserved = { ...config, integratorCheckout: f.dir };
    atomicJson(join(f.cwd, "scripts/orquestador.config.json"), reserved);
    assert.match(cliRun(["--prepare"]), /checkout principal/);
    assert.equal(existsSync(f.config.watcherLock), false);
    assert.equal(existsSync(f.config.enableFile), false);
    atomicJson(join(f.cwd, "scripts/orquestador.config.json"), config);
    atomicJson(f.config.enableFile, { enabled: true, scope: "#173" });
    first = spawn(process.execPath, [cli, "watch", "--interval", "1"], { cwd: f.cwd });
    await new Promise((resolvePromise, reject) => {
      first.stdout.once("data", resolvePromise); first.once("error", reject);
      first.once("exit", code => reject(new Error(`watcher inicial terminó ${code}`)));
    });
    assert.equal(readJson(f.config.watcherLock).pid, first.pid);
    assert.match(cliRun(["watch"]), /Lock ocupado/);
    const ended = new Promise(resolvePromise => first.once("exit", resolvePromise)); first.kill("SIGTERM"); await ended;
    assert.equal(existsSync(f.config.watcherLock), false); assert.equal(existsSync(f.config.cycleLock), false);
    assert.equal(readFileSync(f.config.pauseFile, "utf8"), "only Emple\n");
  } finally { first?.kill(); f.cleanup(); }
});

test("reject exige FAIL/hash exactos, archiva READY, admite nuevo diff sin release y no autoaprueba", async () => {
  const f = fixture();
  try {
    commit(f.cwd, "app/a.js", "candidato con fallo\n");
    const ready = await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner });
    const pending = loadState(f.config).pending;
    await assert.rejects(cycle(f.cwd, f.config, { mode: "reject" }), /ENOENT/);
    const unchanged = readFileSync(f.config.stateFile, "utf8");
    failPilot(f);
    let gate = readJson(f.config.rejectedGate); gate.pilot.status = "PASS"; atomicJson(f.config.rejectedGate, gate);
    await assert.rejects(cycle(f.cwd, f.config, { mode: "reject" }), /FAIL exacto/);
    failPilot(f); gate = readJson(f.config.rejectedGate); gate.rejectedCandidateSHA = "0".repeat(40); atomicJson(f.config.rejectedGate, gate);
    await assert.rejects(cycle(f.cwd, f.config, { mode: "reject" }), /FAIL exacto/);
    const path = failPilot(f); writeFileSync(path, JSON.stringify({ role: "lbx-pilot", status: "PASS", sha: ready.candidateSHA }));
    await assert.rejects(cycle(f.cwd, f.config, { mode: "reject" }), /alterada/);
    gate = readJson(f.config.rejectedGate); gate.pilot.evidence = evidence(path); atomicJson(f.config.rejectedGate, gate);
    await assert.rejects(cycle(f.cwd, f.config, { mode: "reject" }), /Evidencia Pilot FAIL inválida/, "hash válido no convierte un informe PASS en FAIL");
    assert.equal(readFileSync(f.config.stateFile, "utf8"), unchanged, "rechazo inválido no toca state");
    // Un gate PASS previo nunca vence el FAIL válido por mismo SHA.
    approve(f); failPilot(f); assert.throws(() => requirePilotGate(f.config, pending), /Pilot FAIL/);
    rmSync(f.config.enableFile);
    const rejected = await cycle(f.cwd, f.config, { mode: "reject" });
    assert.equal(rejected.status, "REJECTED");
    const archive = readJson(rejected.archiveFile); assert.deepEqual(archive.pending, pending); assert.equal(archive.pilot.status, "FAIL");
    assert.equal(loadState(f.config).pending, null); assert.equal(readJson(f.config.candidateFile).status, "REJECTED");
    await assert.rejects(cycle(f.cwd, f.config, { mode: "prepare", runner: async () => assert.fail("no rebuild del mismo SHA FAIL") }), /SHA rechazado/);
    const fixedSHA = commit(f.cwd, "app/a.js", "corrección legítima\n");
    const next = await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner });
    assert.equal(next.status, "READY"); assert.equal(next.candidateSHA, fixedSHA);
    assert.throws(() => requirePilotGate(f.config, loadState(f.config).pending), /SHA exacto/, "PASS viejo no autoriza fix");
    atomicJson(f.config.enableFile, { enabled: true, scope: "#173" });
    assert.equal((await cycle(f.cwd, f.config, { hub: { preflight: async () => assert.fail("sin PASS nuevo no hay Hub") } })).status, "READY_WAITING_PILOT");
    assert.equal(readJson(join(f.cwd, "package.json")).version, "1.0.0");
    assert.equal(git(f.cwd, "rev-parse", `origin/${LIVE}`), pending.baseSHA);
    assert.equal(readFileSync(f.config.pauseFile, "utf8"), "only Emple\n");
  } finally { f.cleanup(); }
});

test("reject sobre HEAD corregido no llama assertReleaseOnly ni requiere enable", async () => {
  const f = fixture();
  try {
    commit(f.cwd, "app/a.js", "old\n"); await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner });
    const pending = loadState(f.config).pending; failPilot(f);
    const fixed = commit(f.cwd, "app/a.js", "fix después FAIL\n");
    await assert.rejects(cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner }), /Pilot FAIL/, "prepare exige reject antes de aceptar diff nuevo");
    const result = await cycle(f.cwd, f.config, { mode: "reject" }); assert.equal(result.candidateSHA, pending.candidateSHA);
    assert.equal((await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner })).candidateSHA, fixed);
    assert.equal(existsSync(f.config.gateFile), false); assert.equal(existsSync(f.config.enableFile), false);
  } finally { f.cleanup(); }
});

test("reject no invalida release, flags push/trigger ni publicación remota sin state persistido", async () => {
  for (const kind of ["releaseSHA", "pushed", "triggerIntent", "triggerAccepted", "served", "deployment", "remote", "releaseCommitCrash"]) {
    const f = fixture();
    try {
      commit(f.cwd, "app/a.js", "producto\n"); await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner }); failPilot(f);
      const state = loadState(f.config), sha = state.pending.candidateSHA;
      if (kind === "deployment") state.deployments["a".repeat(40)] = { candidateSHA: sha, pushed: false };
      else if (kind === "remote") git(f.cwd, "push", "origin", LIVE);
      else if (kind === "releaseCommitCrash") {
        const pkg = readJson(join(f.cwd, "package.json")); pkg.version = "1.0.1";
        commit(f.cwd, "package.json", JSON.stringify(pkg), "chore(release): v1.0.1 (Refs #173)");
      } else state.pending[kind] = kind === "releaseSHA" ? "a".repeat(40) : true;
      atomicJson(f.config.stateFile, state);
      const before = readFileSync(f.config.stateFile, "utf8");
      await assert.rejects(cycle(f.cwd, f.config, { mode: "reject" }), /No invalidar/);
      assert.equal(readFileSync(f.config.stateFile, "utf8"), before, kind);
      assert.equal(readJson(f.config.candidateFile).status, "READY");
      assert.equal(existsSync(join(f.config.evidenceDir, sha, "rejection.json")), false);
    } finally { f.cleanup(); }
  }
});

test("supersede publicado FAIL: sin ACK/mismatch bloquea; ACK honesto archiva y prepare exige PASS nuevo", async () => {
  const f = fixture(); let gets = 0;
  try {
    commit(f.cwd, "app/a.js", "candidato manual FAIL\n"); await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner });
    const pending = loadState(f.config).pending, oldSHA = pending.candidateSHA;
    failPilot(f); git(f.cwd, "push", "origin", LIVE); const remoteBefore = git(f.cwd, "rev-parse", `origin/${LIVE}`);
    const newSHA = commit(f.cwd, "app/a.js", "fix forward autorizado\n");
    const hub = { deployments: async sha => { assert.equal(sha, oldSHA); gets++; return []; }, trigger: async () => assert.fail("supersede jamás POST"), preflight: async () => assert.fail("no gate de release para archivar") };
    const before = readFileSync(f.config.stateFile, "utf8");
    await assert.rejects(cycle(f.cwd, f.config, { mode: "reject" }), /ya pusheado/);
    await assert.rejects(cycle(f.cwd, f.config, { mode: "supersede-published-failed-ready", hub }), /ENOENT/);
    for (const change of [{ sha: "0".repeat(40) }, { issue: 170 }, { attribution: "unknown" }, { allowForwardFixes: false }]) {
      manualAck(f); atomicJson(f.config.manualPushAckFile, { ...readJson(f.config.manualPushAckFile), ...change });
      await assert.rejects(cycle(f.cwd, f.config, { mode: "supersede-published-failed-ready", hub }), /ACK operativo/);
    }
    assert.equal(readFileSync(f.config.stateFile, "utf8"), before); assert.equal(gets, 0);
    manualAck(f);
    const unrelated = { candidateSHA: "c".repeat(40), releaseSHA: "d".repeat(40), pushed: true, served: true };
    const state = loadState(f.config); state.deployments[unrelated.releaseSHA] = unrelated; atomicJson(f.config.stateFile, state);
    const result = await cycle(f.cwd, f.config, { mode: "supersede-published-failed-ready", hub });
    assert.equal(result.status, "SUPERSEDED_PUBLISHED_FAILED_READY"); assert.equal(result.forwardHEAD, newSHA);
    const archive = readJson(result.archiveFile);
    assert.deepEqual(archive.pending, pending); assert.equal(archive.pilot.status, "FAIL");
    assert.equal(archive.ack.attribution, "owner:GitHub Desktop"); assert.equal(archive.remoteSHA, oldSHA);
    assert.equal(loadState(f.config).pending, null); assert.deepEqual(loadState(f.config).deployments[unrelated.releaseSHA], unrelated);
    assert.equal(git(f.cwd, "rev-parse", `origin/${LIVE}`), remoteBefore); assert.equal(git(f.cwd, "rev-parse", "HEAD"), newSHA);
    assert.equal(existsSync(f.config.gateFile), false); assert.equal(existsSync(f.config.enableFile), false);
    const ready = await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner });
    assert.equal(ready.status, "READY"); assert.equal(ready.candidateSHA, newSHA); assert.equal(loadState(f.config).pending.baseSHA, oldSHA);
    manualAck(f); // ACK del nuevo SHA no permite reutilizar el FAIL anterior.
    await assert.rejects(cycle(f.cwd, f.config, { mode: "supersede-published-failed-ready", hub }), /FAIL exacto/);
    atomicJson(f.config.enableFile, { enabled: true, scope: "#173" });
    assert.equal((await cycle(f.cwd, f.config, { hub })).status, "READY_WAITING_PILOT"); assert.equal(gets, 1);
  } finally { f.cleanup(); }
});

test("supersede bloquea ACK stale, evidencia cambiante, deployment y diff no autorizado", async () => {
  for (const kind of ["staleRemote", "sameHEAD", "docsOnly", "foreignScope", "deployment", "release", "ackChanged", "pilotChanged"]) {
    const f = fixture();
    try {
      commit(f.cwd, "app/a.js", "manual publicado\n"); await cycle(f.cwd, f.config, { mode: "prepare", runner: fakeRunner });
      const sha = loadState(f.config).pending.candidateSHA; const pilotPath = failPilot(f); manualAck(f); git(f.cwd, "push", "origin", LIVE);
      if (kind === "docsOnly") commit(f.cwd, "docs/qa.md", "sólo docs\n", "docs(qa): sin producto (Refs #173)");
      else if (kind === "foreignScope") commit(f.cwd, "app/a.js", "ajeno\n", "fix(qa): backlog (Refs #170)");
      else if (kind !== "sameHEAD") commit(f.cwd, "app/a.js", "nuevo fix\n");
      if (kind === "staleRemote") git(f.cwd, "push", "origin", LIVE);
      if (kind === "release") { const state = loadState(f.config); state.pending.releaseSHA = "a".repeat(40); atomicJson(f.config.stateFile, state); }
      const before = readFileSync(f.config.stateFile, "utf8"), head = git(f.cwd, "rev-parse", "HEAD"), remote = git(f.cwd, "rev-parse", `origin/${LIVE}`);
      const hub = { deployments: async requested => {
        assert.equal(requested, sha);
        if (kind === "ackChanged") atomicJson(f.config.manualPushAckFile, { ...readJson(f.config.manualPushAckFile), comment: "edited during GET" });
        if (kind === "pilotChanged") writeFileSync(pilotPath, "altered after first FAIL read");
        return kind === "deployment" ? [{ commit: sha, status: "failed" }] : [];
      } };
      await assert.rejects(cycle(f.cwd, f.config, { mode: "supersede-published-failed-ready", hub }), /ACK stale|diff funcional|fuera de #173|deployment|No invalidar|cambió|alterada/);
      assert.equal(readFileSync(f.config.stateFile, "utf8"), before, kind);
      assert.equal(git(f.cwd, "rev-parse", "HEAD"), head); assert.equal(git(f.cwd, "rev-parse", `origin/${LIVE}`), remote);
      assert.equal(existsSync(join(f.config.evidenceDir, sha, "supersession.json")), false);
    } finally { f.cleanup(); }
  }
});

test("token runtime privado: ruta configurable/env, relectura,0600 y sin fallback al bearer antiguo", () => {
  const dir = temp(), file = join(dir, "deploy.env"), tokenFile = join(dir, "common-token");
  try {
    writeFileSync(file, 'LEDBOX_HUB_API_TOKEN=legacy-ignored\nLEDBOX_DEPLOY_WEBHOOK_URL=https://hub.example.invalid/api/v1/deploy?uuid=qa-uuid\n');
    writeFileSync(tokenFile, "private-fixture\n", { mode: 0o600 });
    assert.equal(deploySettings(file, {}, tokenFile).token, "private-fixture");
    assert.equal(deploySettings(file, { LEDBOX_HUB_TOKEN_FILE: tokenFile }, join(dir, "missing")).token, "private-fixture");
    writeFileSync(tokenFile, "renewed-fixture\n"); assert.equal(deploySettings(file, {}, tokenFile).token, "renewed-fixture");
    chmodSync(tokenFile, 0o644); assert.throws(() => deploySettings(file, {}, tokenFile), /0600/);
    chmodSync(tokenFile, 0o600); writeFileSync(tokenFile, "invalid\nmultiline"); assert.throws(() => deploySettings(file, {}, tokenFile), /Configuración Hub/);
    assert.throws(() => deploySettings(file, {}, join(dir, "missing")), /ENOENT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("verificar exige Hub finished/fecha/no rollback/recurso/SHA40 aunque todos los hosts sirvan SHA correcto", async () => {
  const sha = "a".repeat(40), config = { applicationUUID: "qa-uuid" };
  let requests = 0;
  const fetcher = async url => {
    requests++;
    return new URL(url).pathname === "/api/health" ? Response.json({ status: "ok", database: "ok", migrations: 46, version: "2.1.73", sha }) : new Response("page", { status: 200 });
  };
  for (const patch of [null, { status: "failed" }, { status: "in_progress", finished_at: null }, { finished_at: null }, { finished_at: "invalid" }, { rollback: true }, { rollback: null }, { application_uuid: "wrong-resource" }, { deployment_uuid: null }, { commit: sha.slice(0, 7) }]) {
    const rows = patch === null ? [] : [{ ...finishedDeployment(sha), ...patch }];
    const report = await verifyRelease("2.1.73", sha, { config, hub: { deployments: async () => rows }, fetcher, env: {} });
    assert.ok(report.results.every(row => row.ok)); assert.equal(report.ok, false, JSON.stringify(patch));
  }
  const report = await verifyRelease("2.1.73", sha, { config, hub: { deployments: async () => [finishedDeployment(sha)] }, fetcher, env: {} });
  assert.equal(report.ok, true); assert.equal(report.deployment.status, "FINISHED"); assert.equal(requests, 110);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(pkg.scripts["release:check"], "node scripts/orquestador.mjs prepare");
  assert.equal(pkg.scripts["release:publish"], "node scripts/orquestador.mjs hd");
  assert.equal(pkg.scripts["deploy:verificar"], "node scripts/verify-release.mjs");
});

test("deployment terminal fallido nunca duplica POST ni declara servido, reanuda diagnóstico GET del mismo SHA", async () => {
  const f = fixture(); let posts = 0, gets = 0, smokes = 0;
  const hub = { preflight: async () => ({}), deployments: async sha => { gets++; return [{ ...finishedDeployment(sha), status: "failed" }]; }, trigger: async () => { posts++; assert.fail("fallido existente no autoriza otro POST"); } };
  const runner = async (...args) => { if (args[2][0] === "scripts/verify-release.mjs") { smokes++; return; } await fakeRunner(...args); };
  try {
    commit(f.cwd, "app/a.js", "new product\n"); await cycle(f.cwd, f.config, { mode: "prepare", runner }); approve(f);
    const first = await cycle(f.cwd, f.config, { runner, hub }); assert.equal(first.status, "DEPLOYMENT_FAILED_GET_ONLY");
    const second = await cycle(f.cwd, f.config, { runner, hub }); assert.equal(second.status, "DEPLOYMENT_FAILED_GET_ONLY");
    assert.equal(second.releaseSHA, first.releaseSHA); assert.equal(posts, 0); assert.equal(smokes, 0); assert.ok(gets >= 3);
    const state = loadState(f.config); assert.ok(state.pending); assert.equal(state.deployments[first.releaseSHA].hubStatus, "FAILED"); assert.equal(state.deployments[first.releaseSHA].served, false);
    assert.equal(readJson(state.deployments[first.releaseSHA].hubEvidence.path).deployments[0].commit, first.releaseSHA);
  } finally { f.cleanup(); }
});
