#!/usr/bin/env node
/**
 * Comandos del orquestador para LedBox/EventOS (estándar del grupo:
 * `owncoding-ui/docs/COMANDOS.md`).
 *
 *   pp   → resumen de pendientes (producción, ramas sin integrar, slots, issues, dueño)
 *   pd   → pendiente de deploy (commit → qué cambia, con su tipo)
 *   al   → agentes/slots libres y reparto sugerido
 *   ht   → ciclo completo: merge → suite → push → NOVEDADES → release + smoke
 *   hd   → alias de ht
 *   auto → una pasada del disparo automático (≥15 commits, integrador libre, cooldown 20 min)
 *   watch→ queda corriendo y dispara `auto` cada N minutos (default 10)
 *
 * Nada de esto reescribe historia: solo mergea ramas limpias que pasan la
 * suite, y si algo falla deshace el merge y lo informa para resolverlo a mano.
 *
 * Uso: `npm run pp` · `npm run pd` · `npm run al` · `npm run ht` · `npm run auto-hd` · `npm run watch-hd`
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Configuración del repo ─────────────────────────────────────────────────
const LIVE_BRANCH = "codex/ledbox-gestion-multiempresa";
const SITE = process.env.LEDBOX_SITE_URL || "https://ledbox.online";
const APP = process.env.LEDBOX_APP_URL || "https://app.ledbox.online";
const HOSTS = [
  "https://ledbox.online/",
  "https://app.ledbox.online/login",
  "https://eventos.ledbox.online/",
  "https://clientes.ledbox.online/",
  "https://demo.ledbox.online/",
];
const CONFIG_FILE = "scripts/orquestador.config.json";
const config = (() => {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
})();
const EXCLUDE = (config.exclude ?? []).map((pattern) => new RegExp(pattern));
const UMBRAL_COMMITS = Number(config.umbral ?? 15);
const COOLDOWN_MIN = Number(config.cooldownMin ?? 20);
const CONFIG_DIR = join(homedir(), ".config", "ledbox");
const STATE_FILE = join(CONFIG_DIR, "auto-hd.json");
const LOG_FILE = join(CONFIG_DIR, "auto-hd.log");
const LOCK_FILE = join(CONFIG_DIR, "auto-hd.lock");
const NOVEDADES = "docs/NOVEDADES.md";

// ── Utilidades ─────────────────────────────────────────────────────────────
const args = new Set(process.argv.slice(3));
const dryRun = args.has("--dry-run") || process.argv.includes("--dry-run");

function git(...argv) {
  return execFileSync("git", argv, { encoding: "utf8" }).trim();
}
function gitOk(...argv) {
  const r = spawnSync("git", argv, { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}
function run(label, command, argv, opts = {}) {
  log(`$ ${command} ${argv.join(" ")}`);
  const r = spawnSync(command, argv, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8" });
  if (r.status !== 0) {
    log(`✗ ${label} falló (exit ${r.status})`);
    return false;
  }
  log(`✓ ${label}`);
  return true;
}
function log(line) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const text = `[${stamp}] ${line}`;
  console.log(text);
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, text + "\n");
  } catch {
    /* sin log persistente: queda en consola */
  }
}
function state() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastRun: null, lastOutcome: null };
  }
}
function saveState(next) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ ...state(), ...next }, null, 2) + "\n");
}
function curl(url, timeout = 15) {
  // Con jar de cookies: el flujo de la demo (raíz → sesión → raíz) completa y
  // termina en 200 en vez de cortar en el 303 del endpoint de sesión.
  const jar = join(CONFIG_DIR, "pp-cookies.txt");
  const r = spawnSync(
    "curl",
    ["-s", "-L", "-c", jar, "-b", jar, "-o", "/dev/null", "-w", "%{http_code}", "--max-time", String(timeout), url],
    { encoding: "utf8" },
  );
  return (r.stdout || "").trim() || "000";
}
function curlBody(url, timeout = 15) {
  const r = spawnSync("curl", ["-s", "--max-time", String(timeout), url], { encoding: "utf8" });
  return r.stdout || "";
}
function currentVersion() {
  return JSON.parse(readFileSync("package.json", "utf8")).version;
}
function nextVersion(version) {
  const [maj, min, patch] = String(version).split(".").map(Number);
  return `${maj}.${min}.${(patch || 0) + 1}`;
}

// ── Estado del repo ────────────────────────────────────────────────────────
function integratorBusy() {
  if (existsSync(join(git("rev-parse", "--git-dir"), "MERGE_HEAD"))) return "merge en curso";
  if (git("status", "--porcelain")) return "árbol del integrador con cambios sin commitear";
  if (existsSync(LOCK_FILE)) return "hay un ciclo corriendo (lock)";
  return null;
}
function slots() {
  fetch();
  const names = new Set();
  for (const ref of ["refs/heads", "refs/remotes/origin"]) {
    const out = git("for-each-ref", "--format=%(refname:short)", ref);
    for (const name of out ? out.split("\n") : []) {
      const short = name.replace(/^origin\//, "");
      if (short === "HEAD" || short === LIVE_BRANCH || short === "main") continue;
      // Ramas de trabajo: `feat/*` (workstreams) y `slot/*` (topología herdr).
      if (!/^(feat|slot)\//.test(short)) continue;
      if (EXCLUDE.some((pattern) => pattern.test(short))) continue;
      names.add(short);
    }
  }
  const list = [];
  for (const branch of names) {
    const ref = gitOk("rev-parse", "--verify", `refs/remotes/origin/${branch}`).ok ? `origin/${branch}` : branch;
    const delta = gitOk("rev-list", "--count", `${LIVE_BRANCH}..${ref}`);
    if (!delta.ok || Number(delta.out) === 0) continue;
    const commits = git("log", "--oneline", `${LIVE_BRANCH}..${ref}`).split("\n").filter(Boolean);
    list.push({
      branch,
      ref,
      count: commits.length,
      commits: commits.map((line) => ({ sha: line.slice(0, 7), subject: line.slice(8) })),
      pushed: ref.startsWith("origin/"),
    });
  }
  list.sort((a, b) => b.count - a.count);
  return list;
}
function worktrees() {
  const out = git("worktree", "list", "--porcelain");
  const list = [];
  let current = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current) list.push(current);
      current = { path: line.slice(9), branch: "", dirty: 0 };
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice(7).replace("refs/heads/", "");
    }
  }
  if (current) list.push(current);
  for (const wt of list) {
    const r = spawnSync("git", ["status", "--porcelain"], { cwd: wt.path, encoding: "utf8" });
    wt.dirty = (r.stdout || "").split("\n").filter(Boolean).length;
  }
  return list;
}
function fetch() {
  spawnSync("git", ["fetch", "origin", "--prune", "-q"], { encoding: "utf8" });
}
function typeOf(subject) {
  const m = /^(\w+)(\(|!|:)/.exec(subject);
  const prefix = m ? m[1] : "";
  const map = { feat: "feature", fix: "fix", test: "test", docs: "docs", chore: "chore", refactor: "refactor", perf: "feature" };
  return map[prefix] ?? "otros";
}

// ── Comandos ───────────────────────────────────────────────────────────────
function pp() {
  const health = curlBody(`${SITE}/api/health`);
  const version = (/v2\.\d+\.\d+/.exec(curlBody(`${APP}/login`)) || ["—"])[0];
  log("═══ pp · pendientes ═══");
  console.log("\n▌ Producción");
  console.log(`  versión: ${version} · health: ${health || "sin respuesta"}`);
  for (const host of HOSTS) console.log(`  ${curl(host) === "200" ? "✓" : "·"} ${host} → ${curl(host)}`);

  const list = slots();
  const total = list.reduce((sum, s) => sum + s.count, 0);
  console.log(`\n▌ Ramas con trabajo sin integrar (${total} commit/s en ${list.length} rama/s)`);
  if (!list.length) console.log("  (nada pendiente)");
  for (const s of list) {
    const wt = worktrees().find((w) => w.branch === s.branch);
    console.log(`  ${s.branch} · ${s.count} commits${wt ? (wt.dirty ? ` · slot con ${wt.dirty} cambios sin commitear` : " · slot limpio") : " · sin worktree"}${s.pushed ? "" : " · sin push"}`);
  }

  console.log("\n▌ Slots (worktrees)");
  for (const wt of worktrees()) console.log(`  ${wt.branch || "(detached)"} · ${wt.dirty ? `${wt.dirty} cambios` : "limpio"} · ${wt.path.replace(homedir(), "~")}`);

  const issues = spawnSync("gh", ["issue", "list", "-R", "dariodeoli/ledbox", "--state", "open", "--limit", "20", "--json", "number,title", "--jq", '.[] | "#\\(.number) \\(.title)"'], { encoding: "utf8" });
  console.log("\n▌ Issues abiertas");
  console.log(issues.stdout?.trim() ? issues.stdout.trim().split("\n").map((l) => "  " + l).join("\n") : "  (ninguna)");

  console.log("\n▌ Pendientes del dueño");
  const pend = existsSync("docs/PENDIENTES-DUENO.md") ? readFileSync("docs/PENDIENTES-DUENO.md", "utf8") : "";
  // Solo secciones pendientes: «Resueltos …» no se lista.
  const bullets = pend
    .split(/\n(?=##\s)/)
    .filter((seccion) => !/^##\s+Resuelt/i.test(seccion))
    .flatMap((seccion) => seccion.split(/\n(?=- )/))
    .filter((block) => block.trim().startsWith("- "))
    .map((block) => "  " + block.replace(/\s+/g, " ").trim().slice(0, 130));
  console.log(bullets.length ? bullets.join("\n") : "  (nada anotado)");
  console.log("");
}

function pd() {
  const list = slots();
  const total = list.reduce((sum, s) => sum + s.count, 0);
  log("═══ pd · pendiente de deploy ═══");
  if (!list.length) {
    console.log("No hay commits nuevos sin integrar.\n");
    return;
  }
  console.log(`\n${total} commits en ${list.length} rama/s (main del integrador: ${LIVE_BRANCH})\n`);
  for (const s of list.sort((a, b) => a.branch.localeCompare(b.branch))) {
    console.log(`▌ ${s.branch} (${s.count})`);
    for (const c of s.commits) console.log(`  ${c.sha}  ${typeOf(c.subject).padEnd(9)} ${c.subject}`);
    console.log("");
  }
}

function al() {
  log("═══ al · slots y reparto ═══");
  const wts = worktrees();
  console.log("");
  for (const wt of wts) {
    const isIntegrator = wt.branch === LIVE_BRANCH;
    const label = wt.dirty ? "OCUPADO" : "libre";
    console.log(`  ${label.padEnd(8)} ${(wt.branch || "(detached)").padEnd(34)} ${isIntegrator ? "integrador" : "slot"}`);
  }
  const issues = spawnSync("gh", ["issue", "list", "-R", "dariodeoli/ledbox", "--state", "open", "--limit", "20", "--json", "number,title", "--jq", ".[] | \"#\\(.number) \\(.title)\""], { encoding: "utf8" });
  const openIssues = (issues.stdout || "").trim();
  console.log("\n  Trabajo pendiente (issues):");
  console.log(openIssues ? openIssues.split("\n").map((l) => "    " + l).join("\n") : "    (ninguna issue abierta)");
  console.log("\n  Regla: un dominio por slot (panel, portal, librería, operación), brief con archivos y puertos propios.\n");
}

function novedadesEntry(version, subjects) {
  const bullets = [];
  for (const subject of subjects) {
    const clean = subject
      .replace(/^(\w+)(\([^)]*\))?!?:\s*/, "")
      .replace(/\s*(\(?Refs #\d+(?:,\s*#\d+)*\)?)\s*$/i, "")
      .trim();
    if (!bullets.includes(clean)) bullets.push(clean);
  }
  const today = new Date().toISOString().slice(0, 10);
  const lines = [`## v${version} — ${today}`, "", ...bullets.slice(0, 12).map((b) => `- ${b}`), ""];
  const header = existsSync(NOVEDADES) ? "" : "# Novedades para el dueño\n\nLo que cambia en cada ronda, en lenguaje de producto.\n\n";
  appendFileSync(NOVEDADES, header + lines.join("\n") + "\n");
  return bullets.length;
}

function ht() {
  const busy = integratorBusy();
  if (busy) {
    log(`ht: no puedo arrancar — ${busy}`);
    return false;
  }
  const list = slots();
  const localAhead = Number(git("rev-list", "--count", `origin/${LIVE_BRANCH}..HEAD`) || 0);
  if (!list.length && localAhead === 0) {
    log("ht: no hay ramas ni commits locales pendientes; nada que integrar");
    return false;
  }
  log(`═══ ht · ciclo completo (${list.length} rama/s, ${localAhead} commit/s locales) ═══`);
  if (dryRun) {
    log("(dry-run) mergearía: " + list.map((s) => `${s.branch} (${s.count})`).join(", "));
    return true;
  }
  writeFileSync(LOCK_FILE, String(process.pid));
  const merged = [];
  const skipped = [];
  try {
    const base = git("rev-parse", "HEAD");
    for (const slot of list) {
      const wt = worktrees().find((w) => w.branch === slot.branch);
      if (wt && wt.dirty) {
        log(`· ${slot.branch}: slot con cambios sin commitear — se saltea`);
        skipped.push(`${slot.branch} (slot ocupado)`);
        continue;
      }
      const merge = gitOk("merge", "--no-ff", "--no-edit", slot.ref);
      if (!merge.ok) {
        const aborted = gitOk("merge", "--abort").ok;
        log(`✗ ${slot.branch}: conflicto de merge — deshecho${aborted ? "" : " (revisar a mano)"}`);
        skipped.push(`${slot.branch} (conflicto)`);
        continue;
      }
      const suiteOk =
        // Con migraciones nuevas el cliente generado queda viejo: regenerar antes de tipar.
        run(`${slot.branch}: prisma generate`, "npm", ["run", "prisma:generate"], { quiet: true }) &&
        run(`${slot.branch}: typecheck`, "npm", ["run", "typecheck"], { quiet: true }) &&
        run(`${slot.branch}: tests`, "npm", ["run", "test:rules"], { quiet: true }) &&
        run(`${slot.branch}: campos`, "npm", ["run", "check:fields"], { quiet: true }) &&
        run(`${slot.branch}: build`, "npm", ["run", "build"], { quiet: true });
      if (!suiteOk) {
        gitOk("reset", "--hard", base);
        log(`✗ ${slot.branch}: la suite falló — merge deshecho`);
        skipped.push(`${slot.branch} (suite en rojo)`);
        continue;
      }
      merged.push(slot);
      log(`✓ ${slot.branch} integrada (${slot.count} commits)`);
    }

    if (!merged.length && localAhead === 0) {
      log("ht: no se integró nada; revisar los motivos arriba");
      saveState({ lastRun: new Date().toISOString(), lastOutcome: "nothing-merged" });
      return false;
    }

    const version = nextVersion(currentVersion());
    const subjects = merged.length
      ? merged.flatMap((slot) => slot.commits.map((c) => c.subject))
      : git("log", "--format=%s", `origin/${LIVE_BRANCH}..HEAD`).split("\n").filter(Boolean);
    const bullets = novedadesEntry(version, subjects);
    log(`NOVEDADES.md actualizado (${bullets} bullets, v${version})`);
    if (!run("commit de novedades", "git", ["add", NOVEDADES]) || !run("commit", "git", ["commit", "-q", "-m", `docs(novedades): ronda hacia v${version}`])) {
      log("✗ no pude commitear NOVEDADES.md");
      return false;
    }
    if (merged.length && !run("push", "git", ["push", "origin", LIVE_BRANCH])) return false;
    if (!run("release + deploy", "npm", ["run", "deploy:patch"], { quiet: true })) return false;

    // Smoke: versión desplegada y superficies.
    const version2 = JSON.parse(readFileSync("package.json", "utf8")).version;
    let versionOk = false;
    for (let i = 0; i < 26; i++) {
      if (curlBody(`${APP}/login`).includes(`v${version2}`)) {
        versionOk = true;
        break;
      }
      spawnSync("sleep", ["20"]);
    }
    log(versionOk ? `smoke: v${version2} en producción ✓` : `smoke: no vi v${version2} en producción tras ~9 min`);
    const states = HOSTS.map((h) => `${curl(h) === "200" ? "✓" : "·"} ${h}`);
    log("smoke superficies:\n" + states.join("\n"));
    saveState({ lastRun: new Date().toISOString(), lastOutcome: versionOk ? `released v${version2}` : "released-sin-smoke" });
    return versionOk;
  } finally {
    try {
      if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
    } catch {
      /* lock liberado por el SO al salir */
    }
  }
}

function auto() {
  const list = slots();
  const total = list.reduce((sum, s) => sum + s.count, 0);
  const busy = integratorBusy();
  const st = state();
  const lastRun = st.lastRun ? new Date(st.lastRun).getTime() : 0;
  const sinceMin = (Date.now() - lastRun) / 60000;
  if (total < UMBRAL_COMMITS) {
    log(`auto: ${total} commits sin integrar (< ${UMBRAL_COMMITS}) — espera`);
    return false;
  }
  if (busy) {
    log(`auto: ${total} commits pero el integrador no está libre (${busy})`);
    return false;
  }
  if (sinceMin < COOLDOWN_MIN) {
    log(`auto: ${total} commits pero el cooldown no pasó (${sinceMin.toFixed(1)} min < ${COOLDOWN_MIN})`);
    return false;
  }
  log(`auto: ${total} commits y el integrador libre → disparo el ciclo`);
  return ht();
}

function watch(intervalMin) {
  log(`watch: vigilando cada ${intervalMin} min (umbral ${UMBRAL_COMMITS} commits, cooldown ${COOLDOWN_MIN} min)`);
  auto();
  setInterval(() => {
    try {
      auto();
    } catch (error) {
      log(`auto falló: ${error instanceof Error ? error.message : error}`);
    }
  }, Math.max(1, intervalMin) * 60000);
}

// ── CLI ────────────────────────────────────────────────────────────────────
const command = process.argv[2] || "pp";
switch (command) {
  case "pp":
    pp();
    break;
  case "pd":
    pd();
    break;
  case "al":
    al();
    break;
  case "ht":
  case "hd":
    ht();
    break;
  case "auto":
    auto();
    break;
  case "watch": {
    const idx = process.argv.indexOf("--interval");
    watch(idx > -1 ? Number(process.argv[idx + 1]) : 10);
    break;
  }
  default:
    console.log("Comandos: pp · pd · al · ht (hd) · auto · watch [--interval <min>] [--dry-run]");
}
