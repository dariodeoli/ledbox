#!/usr/bin/env node
/** Ciclo canónico scoped #173. No backlog, espejo main, reset, ni E2E mutante. */
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireLock, assertIntegrator, assertPublicationEnabled, LIVE, SLOTS } from "./automation-core.mjs";
import { cycle } from "./automation-cycle.mjs";
import { diagnostics } from "./automation-diagnostics.mjs";

export function configuration(cwd = process.cwd()) {
  const config = JSON.parse(readFileSync(join(cwd, "scripts/orquestador.config.json"), "utf8"));
  if (config.issue !== 173 || config.umbral !== 10 || config.cooldownMin !== 20 || JSON.stringify(config.allowedBranches) !== JSON.stringify(SLOTS) || config.liveBranch !== LIVE) throw new Error("Autorización/config scoped #173 inválida");
  for (const field of ["integratorCheckout", "pauseFile", "enableFile", "gateFile", "candidateFile", "stateFile", "cycleLock", "watcherLock", "logFile", "evidenceDir", "deployEnvFile"]) {
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
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error("--interval requiere minutos entre 1 y 1440");
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
  if (!["prepare", "ht", "hd", "auto", "watch"].includes(command)) throw new Error("Comandos: pp/pd/al (lectura), prepare, ht/hd, auto, watch");
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
