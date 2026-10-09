import { existsSync, readFileSync } from "node:fs";

/** Releer por request: el token renovado en archivo reemplaza valores de proceso. */
export function deploySettings(file, env = process.env) {
  const values = { ...env };
  if (existsSync(file)) for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^(?:export\s+)?(LEDBOX_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].trim();
    values[match[1]] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  const token = values.LEDBOX_HUB_API_TOKEN;
  const webhook = values.LEDBOX_DEPLOY_WEBHOOK_URL;
  if (!token || !webhook || /[\r\n]/.test(token)) throw new Error("Configuración Hub ausente/inválida");
  const trigger = new URL(webhook);
  if (trigger.protocol !== "https:" || trigger.username || trigger.password) throw new Error("Hub requiere HTTPS sin credenciales en URL");
  return { token, trigger, origin: trigger.origin };
}
function rows(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.deployments)) return body.deployments;
  throw new Error("Envelope Hub no reconocido; no publicar");
}
const repository = value => String(value ?? "").replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").toLowerCase();

export function hubClient(config, fetcher = fetch) {
  const request = async (path, method = "GET") => {
    const settings = deploySettings(config.deployEnvFile);
    if (settings.trigger.pathname !== "/api/v1/deploy" || settings.trigger.searchParams.get("uuid") !== config.applicationUUID || settings.trigger.searchParams.get("force") === "true") throw new Error("Webhook no corresponde al UUID LedBox o fuerza rebuild");
    const url = method === "POST" ? settings.trigger : new URL(path, settings.origin);
    if (url.origin !== settings.origin) throw new Error("Origen Hub inesperado");
    const response = await fetcher(url.href, { method, redirect: "error", cache: "no-store", headers: { Accept: "application/json", Authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Hub ${method}: HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 2000000) throw new Error("Respuesta Hub excedida");
    try { return JSON.parse(text); } catch { throw new Error("Hub sin JSON contractual"); }
  };
  return {
    async preflight() {
      // Hub 4.4.6 omite settings en la lista; sólo el detalle es contractual.
      const app = await request(`${config.hubApplicationsPath}/${encodeURIComponent(config.applicationUUID)}`);
      if (!app || Array.isArray(app) || app.uuid !== config.applicationUUID) throw new Error("Detalle Hub no corresponde al UUID LedBox configurado");
      const repo = repository(app.git_repository);
      const aliases = ["owncoding/ledbox", "dariodeoli/ledbox"];
      if (!aliases.includes(repo) || app.git_branch !== config.liveBranch) throw new Error("Hub repository/branch no corresponde a LedBox vivo");
      // Transferencia 2026-10-09: alias OwnCoding sólo con ID cotejado por integrador.
      if (config.canonicalRepositoryId !== 1312274819 || config.canonicalRepository !== "dariodeoli/ledbox") throw new Error("Falta cotejo de alias canónico GitHub");
      const settings = app.settings;
      if (!settings || Array.isArray(settings) || typeof settings !== "object" || typeof settings.is_auto_deploy_enabled !== "boolean" || typeof settings.include_source_commit_in_build !== "boolean") throw new Error("Detalle Hub sin settings/flags booleanos contractuales");
      if (settings.include_source_commit_in_build !== true) throw new Error("Hub no inyecta SOURCE_COMMIT verificable; requiere configuración autorizada del integrador");
      return { uuid: app.uuid, repository: repo, branch: app.git_branch, automatic: settings.is_auto_deploy_enabled };
    },
    async deployments(sha) {
      const list = rows(await request(config.hubDeploymentsPath.replace("{uuid}", encodeURIComponent(config.applicationUUID))));
      // No usar prefijos de SHA ni inferir un deploy por versión/hora.
      return list.filter(d => d.commit === sha && (!d.application_uuid || d.application_uuid === config.applicationUUID));
    },
    async trigger() { return request("", "POST"); },
  };
}
