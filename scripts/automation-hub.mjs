import { existsSync, readFileSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Releer por request: el token renovado en archivo reemplaza valores de proceso. */
export function deploySettings(file, env = process.env, tokenFile) {
  const values = { ...env };
  if (existsSync(file)) for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^(?:export\s+)?(LEDBOX_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].trim();
    values[match[1]] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  const path = (values.LEDBOX_HUB_TOKEN_FILE || tokenFile || join(homedir(), ".config/herdr-deploy/coolify-token")).replace(/^~(?=\/)/, homedir());
  const stat = lstatSync(path);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) throw new Error("Token Hub requiere archivo privado regular modo0600");
  const token = readFileSync(path, "utf8").trim();
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
function applicationId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) return value;
  throw new Error("Hub sin ID de aplicación contractual verificable");
}

/** Sólo campos públicos de ApplicationDeploymentQueue; nunca logs/configuration_snapshot. */
export function deploymentOutcome(matches, sha, applicationUUID) {
  const valid = row => row.application_uuid === applicationUUID && typeof row.deployment_uuid === "string" && row.deployment_uuid.length > 0 && row.commit === sha && /^[a-f0-9]{40}$/.test(row.commit);
  const failed = matches.some(row => ["failed", "cancelled", "cancelled-by-user"].includes(row.status) || row.rollback === true);
  const finished = matches.length > 0 && matches.every(row => valid(row) && row.status === "finished" && row.rollback === false && typeof row.finished_at === "string" && Number.isFinite(Date.parse(row.finished_at)));
  return { applicationUUID, sha, status: failed ? "FAILED" : finished ? "FINISHED" : matches.length ? "PENDING" : "ABSENT", checkedAt: new Date().toISOString(), deployments: matches };
}

export function hubClient(config, fetcher = fetch, { readOnly = false } = {}) {
  const request = async (path, method = "GET") => {
     if (readOnly && method !== "GET") throw new Error("Diagnóstico Hub GET-only: POST prohibido");
    const settings = deploySettings(config.deployEnvFile, process.env, config.tokenFile);
    if (settings.trigger.pathname !== "/api/v1/deploy" || settings.trigger.searchParams.get("uuid") !== config.applicationUUID || settings.trigger.searchParams.get("force") === "true") throw new Error("Webhook no corresponde al UUID LedBox o fuerza rebuild");
    const url = method === "POST" ? settings.trigger : new URL(path, settings.origin);
    if (url.origin !== settings.origin) throw new Error("Origen Hub inesperado");
    const response = await fetcher(url.href, { method, redirect: "error", cache: "no-store", headers: { Accept: "application/json", Authorization: `Bearer ${settings.token}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Hub ${method}: HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 2000000) throw new Error("Respuesta Hub excedida");
    try { return JSON.parse(text); } catch { throw new Error("Hub sin JSON contractual"); }
  };
  const resource = async () => {
      // Hub 4.4.6 omite settings en la lista; sólo el detalle es contractual.
      const app = await request(`${config.hubApplicationsPath}/${encodeURIComponent(config.applicationUUID)}`);
      if (!app || Array.isArray(app) || app.uuid !== config.applicationUUID) throw new Error("Detalle Hub no corresponde al UUID LedBox configurado");
      const repo = repository(app.git_repository);
      const aliases = ["owncoding/ledbox", "dariodeoli/ledbox"];
      if (!aliases.includes(repo) || app.git_branch !== config.liveBranch) throw new Error("Hub repository/branch no corresponde a LedBox vivo");
      // Transferencia 2026-10-09: alias OwnCoding sólo con ID cotejado por integrador.
      if (config.canonicalRepositoryId !== 1312274819 || config.canonicalRepository !== "dariodeoli/ledbox") throw new Error("Falta cotejo de alias canónico GitHub");
      return { app, repo };
  };
  return {
    async preflight() {
      const { app, repo } = await resource();
      const settings = app.settings;
      if (!settings || Array.isArray(settings) || typeof settings !== "object" || typeof settings.is_auto_deploy_enabled !== "boolean" || typeof settings.include_source_commit_in_build !== "boolean") throw new Error("Detalle Hub sin settings/flags booleanos contractuales");
      if (settings.include_source_commit_in_build !== true) throw new Error("Hub no inyecta SOURCE_COMMIT verificable; requiere configuración autorizada del integrador");
      return { uuid: app.uuid, repository: repo, branch: app.git_branch, automatic: settings.is_auto_deploy_enabled };
    },
    async deployments(sha) {
      if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Deployment requiere SHA completo40");
      const { app } = await resource();
      // Installed Coolify omits Application.id. This exact UUID-scoped endpoint
      // resolves the application by UUID server-side, then queries application_id.
      // Never substitute destination/server IDs or infer binding from SHA alone.
      const path = config.hubDeploymentsPath.replace("{uuid}", encodeURIComponent(config.applicationUUID));
      if (path !== `/api/v1/deployments/applications/${encodeURIComponent(app.uuid)}`) throw new Error("Listado Hub no tiene scope contractual UUID de aplicación");
      let boundId = app.id === undefined ? null : applicationId(app.id);
      const list = [];
      let total;
      for (let page = 0; page < 100; page++) {
        const body = await request(page === 0 ? path : `${path}?skip=${list.length}&take=10`);
        const batch = rows(body);
        if (!Number.isSafeInteger(body?.count) || body.count < 0 || (total !== undefined && body.count !== total)) throw new Error("Listado Hub incompleto/ambiguo: count contractual requerido y estable");
        total = body.count;
        if (list.length + batch.length > total || (!batch.length && list.length < total)) throw new Error("Paginación Hub incompleta/ambigua");
        for (const d of batch) {
          if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("Deployment Hub inválido");
          const id = applicationId(d.application_id);
          if (boundId === null) boundId = id;
          if (id !== boundId || (d.application_uuid !== undefined && d.application_uuid !== app.uuid)) throw new Error("Deployment no corresponde al recurso Hub validado");
          if ((d.git_repository !== undefined && !["owncoding/ledbox", "dariodeoli/ledbox"].includes(repository(d.git_repository))) || (d.git_branch !== undefined && d.git_branch !== config.liveBranch)) throw new Error("Deployment repository/branch inconsistente");
          if (typeof d.deployment_uuid !== "string" || !d.deployment_uuid || !/^[a-f0-9]{40}$/.test(d.commit) || list.some(previous => previous.deployment_uuid === d.deployment_uuid)) throw new Error("Deployment Hub sin identidad/SHA40 único; ausencia incierta");
          list.push(d);
        }
        if (list.length === total) break;
        if (page === 99) throw new Error("Listado Hub excedido: ausencia incierta");
      }
      if (boundId === null) throw new Error("Hub sin ID de recurso verificable: listado vacío y detalle sin ID");
      // No usar prefijos de SHA ni inferir un deploy por versión/hora.
      return list.filter(d => d.commit === sha).map(d => {
        // UUID derives only from the validated endpoint binding above, never an
        // unscoped row or a conflicting resource identity.
        return { application_uuid: app.uuid, application_id: d.application_id, deployment_uuid: d.deployment_uuid,
          commit: d.commit, status: d.status, finished_at: d.finished_at ?? null, rollback: d.rollback ?? null };
      });
    },
    async trigger() { return request("", "POST"); },
  };
}
