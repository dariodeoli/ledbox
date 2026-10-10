#!/usr/bin/env node
/** Ciclo canónico scoped #173. No backlog, espejo main, reset, ni E2E mutante. */
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireLock, assertIntegrator, assertPublicationEnabled, LIVE, SLOTS, servedBaseline, requirePilotGate } from "./automation-core.mjs";
import { cycle, loadState } from "./automation-cycle.mjs";
import { diagnostics } from "./automation-diagnostics.mjs";

export function configuration(cwd = process.cwd()) {
  const config = JSON.parse(readFileSync(join(cwd, "scripts/orquestador.config.json"), "utf8"));
  if (config.issue !== 173 || config.umbral !== 10 || config.cooldownMin !== 10 || config.watchIntervalMs !== 1200000 || JSON.stringify(config.allowedBranches) !== JSON.stringify(SLOTS) || config.liveBranch !== LIVE) throw new Error("Autorización/config scoped #173 inválida");
  for (const field of ["integratorCheckout", "pauseFile", "enableFile", "gateFile", "rejectedGate", "manualPushAckFile", "candidateFile", "stateFile", "cycleLock", "watcherLock", "logFile", "evidenceDir", "deployEnvFile", "tokenFile"]) {
    if (typeof config[field] !== "string") throw new Error(`Falta configuración ${field}`);
    config[field] = config[field].replace(/^~(?=\/)/, homedir());
  }
  return config;
}
export async function main(argv = process.argv.slice(2)) {
  const cwd = process.cwd(), config = configuration(cwd);
  let command = argv[0] ?? "pp";
  if (command === "--prepare" && argv.length === 1) command = "prepare";
  else if (argv.length === 2 && argv[1] === "--prepare" && ["ht", "hd"].includes(command)) command = "prepare";
  else if (command === "watch" && argv.length === 3 && argv[1] === "--interval") {
    const minutes = Number(argv[2]);
    if (minutes !== 20) throw new Error("--interval autorizado: 20 minutos scoped #173");
    config.watchIntervalMs = minutes * 60000;
  }
  else if (argv.length > 1 && !(argv.length === 2 && argv[1] === "--dry-run")) throw new Error("Flags no admitidos; no existe bypass de gates");
  const log = result => {
    mkdirSync(resolve(config.logFile, ".."), { recursive: true });
    const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, command, ...result });
    appendFileSync(config.logFile, line + "\n"); console.log(line);
  };
  if (["pp", "pd", "al"].includes(command) || argv.includes("--dry-run")) {
    // Dry-run del ciclo sólo inventaría Git; pp/al conservan diagnósticos propios.
    log(await diagnostics(cwd, config, argv.includes("--dry-run") ? "pd" : command));
    return;
  }
  if (!["prepare", "reject", "supersede-published-failed-ready", "ht", "hd", "auto", "watch"].includes(command)) throw new Error("Comandos: pp/pd/al (lectura), prepare/reject, supersede-published-failed-ready, ht/hd, auto, watch");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  let releaseWatcher;
  try {
    if (command !== "watch") {
      log(await cycle(cwd, config, { mode: command === "hd" ? "ht" : command, signal: controller.signal }));
      return;
    }
    assertIntegrator(cwd, config); assertPublicationEnabled(config);
    releaseWatcher = acquireLock(config.watcherLock);
    const startupUnlock = acquireLock(config.cycleLock);
    try {
      const state = loadState(config), baseline = servedBaseline(cwd, config, state);
      if (!baseline || state.pending) throw new Error("AUTO_WAITING_SERVED_BASELINE: watcher requiere primer HD servido acreditado y ningún pending");
      if (!baseline.receipt.pilotCandidate) throw new Error("Watcher requiere Pilot final acreditado del primer HD servido");
      requirePilotGate(config, baseline.receipt.pilotCandidate);
      log({ status: "WATCH_READY", countBaseSHA: baseline.sha, threshold: 10, watchIntervalMs: config.watchIntervalMs, cooldownMs: 600000 });
    } finally { startupUnlock(); }
    while (!controller.signal.aborted) {
      try { log(await cycle(cwd, config, { mode: "auto", signal: controller.signal })); }
      catch (error) { log({ status: "BLOCKED", reason: error.message }); }
      if (!controller.signal.aborted) await new Promise(resolvePromise => {
        const timer = setTimeout(done, config.watchIntervalMs);
        function done() { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolvePromise(); }
        controller.signal.addEventListener("abort", done, { once: true });
      });
    }
  } finally { releaseWatcher?.(); process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`[orquestador] BLOCKED: ${error.message}`); process.exitCode = 1; });
}
