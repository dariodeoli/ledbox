#!/usr/bin/env node
/** Sonda GET de deployment terminal y artefacto servido; jamás dispara deploy. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { configuration } from "./orquestador.mjs";
import { hubClient, deploymentOutcome } from "./automation-hub.mjs";

export async function verifyRelease(version, sha, { config = configuration(), hub = hubClient(config), fetcher = fetch, env = process.env } = {}) {
if (!/^\d+\.\d+\.\d+$/.test(version || "") || !/^[a-f0-9]{40}$/.test(sha || "")) throw new Error("Uso: node scripts/verify-release.mjs <versión> <SHA completo40>");
const deployment = deploymentOutcome(await hub.deployments(sha), sha, config.applicationUUID);

const hosts = [
  [env.LEDBOX_SITE_URL || "https://ledbox.online", "/"],
  [env.LEDBOX_APP_URL || "https://app.ledbox.online", "/login"],
  [env.LEDBOX_EVENTOS_URL || "https://eventos.ledbox.online", "/"],
  [env.LEDBOX_CLIENT_URL || "https://clientes.ledbox.online", "/"],
  [env.LEDBOX_DEMO_URL || "https://demo.ledbox.online", "/login"],
];

const results = await Promise.all(hosts.map(async ([origin, surface]) => {
  const host = origin.replace(/\/$/, "");
  try {
    const response = await fetcher(`${host}/api/health`, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(20000) });
    const health = await response.json();
    // No seguir redirects hacia endpoints de sesión/demo con efectos laterales.
    const page = await fetcher(`${host}${surface}`, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    const reachable = page.status === 200;
    const ok = response.ok && reachable && health.status === "ok" && health.database === "ok"
      && Number.isInteger(health.migrations) && health.version === version && health.sha === sha.toLowerCase();
    return { host, ok, surfaceStatus: page.status, healthStatus: response.status,
      version: health.version ?? null, sha: health.sha ?? null, database: health.database, migrations: health.migrations };
  } catch (error) {
    return { host, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}));
return { expected: { version, sha }, checkedAt: new Date().toISOString(), deployment, results, ok: deployment.status === "FINISHED" && results.every(result => result.ok) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyRelease(...process.argv.slice(2)).then(report => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  }).catch(error => { console.error(`[verificar] BLOCKED: ${error.message}`); process.exitCode = 1; });
}
