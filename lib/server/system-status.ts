import { readFile, readdir, stat, statfs, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formatDateTime } from "@/lib/admin-format";
import { backupStatusOf as pureBackupStatus, formatAgeLabel } from "@/lib/backup-status";
import type { AdminBackupRun, AdminSystemStatus } from "@/lib/admin-types";
import { publicConfig } from "@/lib/public-config";
import { APP_VERSION_LABEL } from "@/lib/version";
import { recordAudit } from "./audit";
import { db } from "./db";
import { isDemoOrganizationSlug } from "./demo-data";
import { renderMail, renderMailText, sendMail } from "./mail";
import { dayKeyOf, dayStart } from "./notifications";
import type { AdminContext } from "./tenancy";

/**
 * Estado del sistema y alerta de respaldo (issue #43).
 *
 * El respaldo lo hace `scripts/backup.mjs` en el servidor (cron documentado en
 * `docs/OPERACION.md`) y deja dos archivos reales en `BACKUP_DIR`:
 * `backup-state.json` (última corrida, último ok, historial, retención) y
 * `backup.log`. Este módulo **lee esos archivos**, no inventa nada: sin estado,
 * el panel dice honestamente que no hay respaldos registrados.
 *
 * Además arma el aviso por correo a OWNER/ADMIN cuando el respaldo falta, está
 * vencido (`BACKUP_MAX_AGE_HOURS`) o el último intento falló. El envío es
 * idempotente por día y tipo de problema (`MailLog` con categoría `alert`,
 * entidad `System`), queda registrado en auditoría con el actor real que abrió
 * el panel y viaja por el mailer único de la app (`sendMail`).
 */

const BACKUP_FILE_SUFFIX = ".sql.gz";
const DEFAULT_MAX_AGE_HOURS = 26;
const MAX_ALERT_RECIPIENTS = 10;
const MAX_HISTORY_ROWS = 20;
/** Reintento de la alerta: un aviso enviado hoy no se repite; un intento reciente espera. */
const RETRY_AFTER_MS = 30 * 60_000;

type RawBackupRun = {
  startedAt?: unknown;
  finishedAt?: unknown;
  status?: unknown;
  durationMs?: unknown;
  file?: unknown;
  bytes?: unknown;
  uncompressedBytes?: unknown;
  tables?: unknown;
  verified?: unknown;
  error?: unknown;
};

type RawBackupState = {
  updatedAt?: unknown;
  lastRun?: RawBackupRun | null;
  lastSuccess?: RawBackupRun | null;
  history?: unknown;
  config?: { maxAgeHours?: unknown; retentionDays?: unknown; minKeep?: unknown } | null;
};

// ── Configuración (mismas variables que `scripts/backup.mjs`) ───────────────

/** Directorio de respaldos: `BACKUP_DIR` o `./backups` (igual que el script). */
function backupDir(): string {
  return resolve((process.env.BACKUP_DIR || join(process.cwd(), "backups")).trim() || join(process.cwd(), "backups"));
}

/** Archivo de estado del respaldo: `BACKUP_STATE_FILE` o `<dir>/backup-state.json`. */
function backupStateFile(): string {
  const configured = (process.env.BACKUP_STATE_FILE || "").trim();
  return resolve(configured || join(backupDir(), "backup-state.json"));
}

/** Umbral de respaldo vencido en horas (`BACKUP_MAX_AGE_HOURS`, default 26). */
function backupMaxAgeHours(): number {
  const parsed = Number(process.env.BACKUP_MAX_AGE_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_AGE_HOURS;
}

// ── Lectura del estado real ─────────────────────────────────────────────────

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asDateText(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRun(value: unknown): AdminBackupRun | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawBackupRun;
  const finishedAt = asDateText(raw.finishedAt);
  const status = raw.status === "failed" ? "failed" : raw.status === "ok" ? "ok" : null;
  if (!finishedAt || !status) return null;
  return {
    startedAt: asDateText(raw.startedAt) ?? finishedAt,
    finishedAt,
    status,
    durationMs: asNumber(raw.durationMs) ?? 0,
    file: asText(raw.file),
    bytes: asNumber(raw.bytes),
    uncompressedBytes: asNumber(raw.uncompressedBytes),
    tables: asNumber(raw.tables),
    verified: raw.verified === true,
    error: asText(raw.error),
  };
}

/** Estado crudo del respaldo; `error` describe un archivo ilegible o corrupto. */
async function readBackupState(): Promise<{ state: RawBackupState | null; error: string | null }> {
  const file = backupStateFile();
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { state: null, error: "El estado del respaldo no tiene el formato esperado." };
    return { state: parsed as RawBackupState, error: null };
  } catch (caught) {
    const code = (caught as { code?: string }).code;
    if (code === "ENOENT") return { state: null, error: null };
    return { state: null, error: `No se pudo leer el estado del respaldo (${file}): ${message(caught)}` };
  }
}

function message(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

type BackupFile = { name: string; bytes: number; modifiedAt: string };

/** Archivos de respaldo reales del directorio, del más nuevo al más viejo. */
async function listBackupFiles(dir = backupDir()): Promise<BackupFile[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: BackupFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(BACKUP_FILE_SUFFIX)) continue;
    const info = await stat(join(dir, entry.name)).catch(() => null);
    if (!info) continue;
    files.push({ name: entry.name, bytes: info.size, modifiedAt: info.mtime.toISOString() });
  }
  files.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return files;
}

/** Horas transcurridas desde un instante ISO, con un decimal. */
function ageHours(fromIso: string, now: Date): number {
  return Math.round(((now.getTime() - new Date(fromIso).getTime()) / 3_600_000) * 10) / 10;
}

/**
 * Estado de la base y las migraciones aplicadas (`_prisma_migrations`), con
 * latencia y tamaño reales. Si la base no responde, se dice tal cual.
 */
async function probeDatabase(now: Date): Promise<{
  database: AdminSystemStatus["database"];
  migrations: AdminSystemStatus["migrations"];
}> {
  const started = Date.now();
  try {
    await db.$queryRawUnsafe("select 1");
    const latencyMs = Date.now() - started;
    const [sizeRows, migrationRows, lastRows] = await Promise.all([
      db.$queryRawUnsafe<Array<{ size: bigint | number }>>("select pg_database_size(current_database()) as size"),
      db.$queryRawUnsafe<Array<{ count: number }>>(
        `select count(*)::int as count from _prisma_migrations where finished_at is not null and rolled_back_at is null`,
      ),
      db.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date }>>(
        `select migration_name, finished_at from _prisma_migrations where finished_at is not null and rolled_back_at is null order by finished_at desc limit 1`,
      ),
    ]);
    const last = lastRows[0] ?? null;
    return {
      database: {
        status: "ok",
        latencyMs,
        sizeBytes: sizeRows[0] ? Number(sizeRows[0].size) : null,
        error: null,
      },
      migrations: {
        applied: migrationRows[0] ? Number(migrationRows[0].count) : null,
        last: last ? { name: last.migration_name, finishedAt: new Date(last.finished_at).toISOString() } : null,
      },
    };
  } catch (caught) {
    return {
      database: { status: "unavailable", latencyMs: null, sizeBytes: null, error: message(caught) },
      migrations: { applied: null, last: null },
    };
  }
}

/** Espacio libre y total del volumen de respaldos (uso estimado). */
async function probeDisk(dir: string): Promise<AdminSystemStatus["disk"]> {
  try {
    const info = await statfs(dir);
    return { freeBytes: info.bavail * info.bsize, totalBytes: info.blocks * info.bsize };
  } catch {
    return { freeBytes: null, totalBytes: null };
  }
}

/**
 * Estado real del respaldo: sin estado, sin archivo, fallido, vencido u ok.
 * La regla pura vive en `lib/backup-status.ts` (probada y compartida).
 */
function backupStatusOf(input: {
  lastRun: AdminBackupRun | null;
  lastSuccess: AdminBackupRun | null;
  fileExists: boolean | null;
  ageHours: number | null;
  maxAgeHours: number;
}): AdminSystemStatus["backup"]["status"] {
  return pureBackupStatus({
    lastRunStatus: input.lastRun?.status ?? null,
    hasSuccess: Boolean(input.lastSuccess),
    fileExists: input.fileExists,
    ageHours: input.ageHours,
    maxAgeHours: input.maxAgeHours,
  });
}

/** Estado completo del sistema que dibuja `/sistema` (OWNER/ADMIN). */
export async function systemStatus(now = new Date()): Promise<AdminSystemStatus> {
  const dir = backupDir();
  const [{ state, error: stateError }, files, probe] = await Promise.all([
    readBackupState(),
    listBackupFiles(dir),
    probeDatabase(now),
  ]);
  const disk = await probeDisk((await exists(dir)) ? dir : process.cwd());

  const lastRun = asRun(state?.lastRun ?? null);
  const lastSuccess = asRun(state?.lastSuccess ?? null);
  const maxAgeHours = backupMaxAgeHours();
  const age = lastSuccess ? ageHours(lastSuccess.finishedAt, now) : null;
  const fileExists = lastSuccess?.file ? files.some((file) => file.name === lastSuccess.file) : null;
  const history = Array.isArray(state?.history)
    ? state.history.map(asRun).filter((run): run is AdminBackupRun => Boolean(run)).slice(0, MAX_HISTORY_ROWS)
    : [];
  const retentionDays = asNumber(state?.config?.retentionDays);
  const minKeep = asNumber(state?.config?.minKeep);
  const status = backupStatusOf({ lastRun, lastSuccess, fileExists, ageHours: age, maxAgeHours });

  const result: AdminSystemStatus = {
    version: APP_VERSION_LABEL,
    checkedAt: now.toISOString(),
    database: probe.database,
    migrations: probe.migrations,
    backup: {
      status,
      issue: null,
      maxAgeHours,
      ageHours: age,
      lastRun,
      lastSuccess,
      history,
      files: {
        count: files.length,
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        latest: files[0] ?? null,
      },
      retention:
        retentionDays !== null && minKeep !== null
          ? { days: retentionDays, minKeep }
          : null,
      fileExists,
      stateError,
    },
    disk,
    lastError: lastRun?.status === "failed" && lastRun.error ? { message: lastRun.error, at: lastRun.finishedAt } : null,
  };

  const issue = alertIssueOf(result);
  if (issue) result.backup.issue = { kind: issue, detail: issueDetail(result, issue) };
  return result;
}

// ── Alerta por correo a OWNER/ADMIN ─────────────────────────────────────────

type BackupAlertIssue = "never" | "stale" | "failed" | "missing";

const ISSUE_KEY: Record<BackupAlertIssue, string> = {
  never: "backup-never",
  stale: "backup-stale",
  failed: "backup-failed",
  missing: "backup-missing-file",
};

const ISSUE_TITLE: Record<BackupAlertIssue, string> = {
  never: "La base todavía no tiene respaldos",
  stale: "El respaldo de la base está vencido",
  failed: "Falló el respaldo de la base",
  missing: "Falta el archivo del último respaldo",
};

/** Problema que amerita alerta: `null` cuando el respaldo está en orden. */
function alertIssueOf(status: AdminSystemStatus): BackupAlertIssue | null {
  return status.backup.status === "ok" ? null : status.backup.status;
}

export type BackupAlertOutcome = {
  /** Problema detectado; `null` si el respaldo está en orden. */
  issue: BackupAlertIssue | null;
  /** Ya se avisó hoy por este problema. */
  alreadyAlertedToday: boolean;
  recipients: number;
  sent: number;
  failed: number;
  /** Por qué no se envió nada: sin destinatarios o sin proveedor de correo. */
  reason: "no_recipients" | "mail_not_configured" | null;
};

/** Destinatarios reales: OWNER/ADMIN activos de empresas activas (sin la demo). */
async function alertRecipients(): Promise<Array<{ name: string; email: string }>> {
  const memberships = await db.adminMembership.findMany({
    where: {
      active: true,
      role: { in: ["OWNER", "ADMIN"] },
      user: { active: true },
      organization: { active: true },
    },
    select: {
      organization: { select: { slug: true } },
      user: { select: { name: true, email: true } },
    },
    take: 200,
  });
  const recipients = new Map<string, { name: string; email: string }>();
  for (const membership of memberships) {
    if (isDemoOrganizationSlug(membership.organization.slug)) continue;
    const email = membership.user.email.trim().toLowerCase();
    if (!email || recipients.has(email)) continue;
    recipients.set(email, { name: membership.user.name, email });
  }
  return [...recipients.values()].slice(0, MAX_ALERT_RECIPIENTS);
}

/** Texto del problema para la alerta y el panel; nunca inventa datos faltantes. */
function issueDetail(status: AdminSystemStatus, issue: BackupAlertIssue): string {
  if (issue === "never") {
    return "No hay ningún respaldo registrado. Revisá el cron de `node scripts/backup.mjs` en el servidor.";
  }
  if (issue === "failed") {
    return status.lastError?.message ?? "El último intento de respaldo falló sin detalle.";
  }
  if (issue === "missing") {
    return `El archivo «${status.backup.lastSuccess?.file ?? "(sin nombre)"}» ya no está en el directorio de respaldos.`;
  }
  return `El último respaldo tiene ${formatAgeLabel(status.backup.ageHours)} y el umbral es ${formatAgeLabel(status.backup.maxAgeHours)}.`;
}

/** Aviso de respaldo: mismo asunto y filas para todo el equipo. */
function buildBackupAlertMail(input: {
  issue: BackupAlertIssue;
  status: AdminSystemStatus;
  recipientName: string;
}) {
  const { status, issue } = input;
  const lastSuccess = status.backup.lastSuccess;
  const rows = [
    { label: "Problema", value: ISSUE_TITLE[issue], strong: true },
    {
      label: "Último respaldo ok",
      value: lastSuccess
        ? `${formatDateTime(lastSuccess.finishedAt)} · hace ${formatAgeLabel(status.backup.ageHours)}`
        : "sin respaldos",
      strong: true,
    },
    { label: "Umbral configurado", value: `${status.backup.maxAgeHours} h sin respaldo` },
  ];
  if (status.lastError) rows.push({ label: "Último error", value: status.lastError.message });
  if (status.backup.stateError) rows.push({ label: "Estado del respaldo", value: status.backup.stateError });
  rows.push({ label: "Base", value: status.database.status === "ok" ? "responde" : "sin conexión" });
  rows.push({ label: "Versión del panel", value: status.version });

  const content = {
    title: ISSUE_TITLE[issue],
    intro: [
      `Hola ${input.recipientName}:`,
      "El chequeo automático del respaldo de la base de EventOS detectó un problema.",
    ],
    rows,
    cta: { label: "Ver el estado del sistema", url: `${publicConfig.adminUrl}/sistema` },
    note: [
      "El respaldo lo corre el cron del servidor (`node scripts/backup.mjs`); el procedimiento está en docs/OPERACION.md.",
      "Este aviso se manda una vez por día mientras el problema siga.",
    ],
    preheader: `${ISSUE_TITLE[issue]} · ${issueDetail(status, issue)}`,
    organization: null,
    reason: "estás en la lista de propietarios y administradores del panel",
  };
  return { subject: `EventOS · ${ISSUE_TITLE[issue]}`, html: renderMail(content), text: renderMailText(content) };
}

// Evita que dos requests simultáneos del panel manden la alerta dos veces.
let alertInFlight: Promise<BackupAlertOutcome> | null = null;

/**
 * Evalúa el respaldo y avisa por correo si falta, está vencido o falló.
 * Idempotente por día y tipo de problema: el panel lo llama al abrir el
 * dashboard o `/sistema` (nunca en la demo) y repetirlo no duplica correos.
 */
export function alertBackupIssueIfNeeded(context: AdminContext, now = new Date()): Promise<BackupAlertOutcome> {
  if (alertInFlight) return alertInFlight;
  const run = alertBackupIssue(context, now).finally(() => {
    alertInFlight = null;
  });
  alertInFlight = run;
  return run;
}

async function alertBackupIssue(context: AdminContext, now: Date): Promise<BackupAlertOutcome> {
  const status = await systemStatus(now);
  const issue = alertIssueOf(status);
  const empty: BackupAlertOutcome = {
    issue,
    alreadyAlertedToday: false,
    recipients: 0,
    sent: 0,
    failed: 0,
    reason: null,
  };
  if (!issue) return empty;

  const entityId = ISSUE_KEY[issue];
  // Ya avisado hoy (enviado) o intento reciente (para no golpear al proveedor
  // en cada carga del panel cuando el correo no está configurado o falla).
  const lastAttempt = await db.mailLog.findFirst({
    where: { category: "alert", entity: "System", entityId },
    orderBy: { sentAt: "desc" },
    select: { status: true, sentAt: true },
  });
  if (lastAttempt) {
    const sentToday = lastAttempt.status === "sent" && lastAttempt.sentAt >= dayStart(dayKeyOf(now));
    const recentAttempt = now.getTime() - lastAttempt.sentAt.getTime() < RETRY_AFTER_MS;
    if (sentToday || recentAttempt) return { ...empty, alreadyAlertedToday: true };
  }

  const recipients = await alertRecipients();
  if (recipients.length === 0) return { ...empty, reason: "no_recipients" };

  const detail = issueDetail(status, issue);
  const summary = `${ISSUE_TITLE[issue]}: ${detail}`;
  let sent = 0;
  let failed = 0;
  let skippedReason: BackupAlertOutcome["reason"] = null;
  for (const recipient of recipients) {
    const content = buildBackupAlertMail({ issue, status, recipientName: recipient.name });
    const result = await sendMail({
      to: recipient.email,
      subject: content.subject,
      category: "alert",
      html: content.html,
      text: content.text,
      organizationId: null,
      entity: "System",
      entityId,
      actor: { id: context.user.id, name: context.user.name, email: context.user.email },
    });
    if (result.status === "sent") sent += 1;
    else if (result.status === "failed") failed += 1;
    else skippedReason = "mail_not_configured";
  }

  await recordAudit({
    context,
    action: "send",
    entity: "System",
    entityId,
    summary: `${summary} — alerta a ${recipients.length} propietario(s)/administrador(es) (${sent} enviados, ${failed} fallidos)`,
    detail: {
      fields: {
        issue,
        recipients: recipients.map((recipient) => recipient.email),
        sent,
        failed,
        lastSuccessAt: status.backup.lastSuccess?.finishedAt ?? null,
        lastRunStatus: status.backup.lastRun?.status ?? null,
        maxAgeHours: status.backup.maxAgeHours,
      },
    },
  });

  return { issue, alreadyAlertedToday: false, recipients: recipients.length, sent, failed, reason: skippedReason };
}
