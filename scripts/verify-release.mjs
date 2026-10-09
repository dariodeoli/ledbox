#!/usr/bin/env node
/** Sonda de publicación por artefacto: no dispara deploy ni escribe datos. */
const [version, sha] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || "") || !/^[a-f0-9]{40}$/i.test(sha || "")) {
  console.error("Uso: node scripts/verify-release.mjs <versión> <SHA completo>");
  process.exit(2);
}

const hosts = [
  [process.env.LEDBOX_SITE_URL || "https://ledbox.online", "/"],
  [process.env.LEDBOX_APP_URL || "https://app.ledbox.online", "/login"],
  [process.env.LEDBOX_EVENTOS_URL || "https://eventos.ledbox.online", "/"],
  [process.env.LEDBOX_CLIENT_URL || "https://clientes.ledbox.online", "/"],
  [process.env.LEDBOX_DEMO_URL || "https://demo.ledbox.online", "/login"],
];

const results = await Promise.all(hosts.map(async ([origin, surface]) => {
  const host = origin.replace(/\/$/, "");
  try {
    const response = await fetch(`${host}/api/health`, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(20000) });
    const health = await response.json();
    // No seguir redirects hacia endpoints de sesión/demo con efectos laterales.
    const page = await fetch(`${host}${surface}`, { redirect: "manual", signal: AbortSignal.timeout(20000) });
    const reachable = page.ok || [301, 302, 303, 307, 308].includes(page.status);
    const ok = response.ok && reachable && health.status === "ok" && health.database === "ok"
      && Number.isInteger(health.migrations) && health.version === version && health.sha === sha.toLowerCase();
    return { host, ok, surfaceStatus: page.status, healthStatus: response.status,
      version: health.version ?? null, sha: health.sha ?? null, database: health.database, migrations: health.migrations };
  } catch (error) {
    return { host, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}));
console.log(JSON.stringify({ expected: { version, sha }, checkedAt: new Date().toISOString(), results }, null, 2));
if (results.some((result) => !result.ok)) process.exitCode = 1;
