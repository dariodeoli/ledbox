#!/usr/bin/env node
/**
 * Respaldo de la base de LedBox (issue #43).
 *
 * Alcance:
 *  - `pg_dump` del entorno (binario del sistema, sin dependencias nuevas) a un
 *    SQL plano comprimido con gzip en un directorio configurable.
 *  - **Verificación real** de cada respaldo: se descomprime el archivo recién
 *    escrito y se comprueba que el dump cierra con el marcador de `pg_dump`
 *    («PostgreSQL database dump complete», que solo aparece en un dump
 *    completo). El estado guarda el tamaño descomprimido y las tablas contadas.
 *  - Retención configurable: borra los respaldos más viejos que N días, sin
 *    bajar nunca de un mínimo de archivos.
 *  - Log de corridas (`backup.log`) y **archivo de estado** (`backup-state.json`)
 *    que lee el panel en `/sistema` (nunca se inventan datos: si no hay estado,
 *    el panel dice que no hay respaldos).
 *  - `--check`: falla (exit 1) si no hay respaldos, si el último intento falló,
 *    si el último respaldo supera el umbral o si el archivo ya no está.
 *  - Cliente `pg_dump`: si `PG_DUMP_BIN` no está, se usa el más nuevo instalado
 *    por versión mayor; si todavía es más viejo que la base (la ventana en la
 *    que el deploy está instalando el suyo), espera y reintenta en vez de fallar.
 *
 * Uso:
 *   node scripts/backup.mjs                 # respalda, verifica, poda y registra
 *   node scripts/backup.mjs --check         # chequeo para cron/monitoreo
 *   node scripts/backup.mjs --check --json  # mismo chequeo, salida JSON
 *   node scripts/backup.mjs --now=<ISO>     # instante de referencia (pruebas)
 *   node scripts/backup.mjs --help
 *
 * Variables de entorno (todas opcionales salvo `DATABASE_URL`):
 *   BACKUP_DIR              directorio de respaldos (default `./backups`)
 *   BACKUP_STATE_FILE       archivo de estado (default `<BACKUP_DIR>/backup-state.json`)
 *   BACKUP_LOG              log de corridas (default `<BACKUP_DIR>/backup.log`)
 *   BACKUP_FILE_PREFIX      prefijo del archivo (default `ledbox`)
 *   BACKUP_MAX_AGE_HOURS    horas máximas desde el último respaldo ok (default 26)
 *   BACKUP_RETENTION_DAYS   días de retención (default 30)
 *   BACKUP_MIN_KEEP         respaldos que nunca se borran (default 7)
 *   BACKUP_HISTORY          corridas que guarda el estado (default 20)
 *   BACKUP_VERIFY           `0` desactiva la verificación del dump (default activa)
 *   PG_DUMP_BIN             binario de pg_dump (default: el más nuevo instalado)
 *
 * El procedimiento de restauración y el cron están en `docs/OPERACION.md`.
 * La contraseña de la base viaja por entorno del proceso hijo (PGPASSWORD),
 * nunca por la línea de comandos ni por el estado.
 */
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, readdirSync } from "node:fs";
import { access, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

const STATE_VERSION = 1;
const SERVICE = "ledbox-backups";
const FILE_SUFFIX = ".sql.gz";
const DUMP_COMPLETE_MARKER = "PostgreSQL database dump complete";
const DEFAULT_MAX_AGE_HOURS = 26;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MIN_KEEP = 7;
const DEFAULT_HISTORY = 20;
const TIME_ZONE = "America/Asuncion";
const MAX_ERROR = 500;
/**
 * El deploy de Coolify marca «finished» unos segundos antes de que su hook
 * termine de instalar el cliente nuevo (ventana real medida: ~20 s, issue #71).
 * Si la corrida cae justo ahí, `pg_dump` del sistema es más viejo que la base:
 * en vez de fallar se espera y se reintenta con el binario ya actualizado.
 */
const MISMATCH_RETRY_MS = 20_000;
const MISMATCH_ATTEMPTS = 3;

const logger = {
  info: (message) => console.log(`[backup] ${message}`),
  warn: (message) => console.warn(`[backup] ${message}`),
  error: (message) => console.error(`[backup] ${message}`),
};

// ── Configuración ───────────────────────────────────────────────────────────

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Binario de `pg_dump` a usar (issue #71): `PG_DUMP_BIN` manda; si no está, se
 * elige el cliente **más nuevo por versión mayor** de `/usr/lib/postgresql/<N>/
 * bin/pg_dump` —lo que deja el instalador del deploy (`scripts/install-pgdump.sh`)
 * cuando el contenedor arranca— y, como último recurso, el `pg_dump` del PATH.
 * Así la configuración no queda atada a una ruta fija si la base sube de versión:
 * el binario correcto aparece solo cuando el hook lo instala.
 */
function resolvePgDump(explicit) {
  const requested = (explicit || "").trim();
  if (requested) return requested;
  try {
    const majors = readdirSync("/usr/lib/postgresql")
      .map((name) => Number.parseInt(name, 10))
      .filter((major) => Number.isInteger(major) && major > 0)
      .sort((a, b) => b - a);
    for (const major of majors) {
      const candidate = `/usr/lib/postgresql/${major}/bin/pg_dump`;
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    /* sin directorio de versiones (otros sistemas): se usa el del PATH */
  }
  return "pg_dump";
}

function loadConfig() {
  const dir = resolve(process.env.BACKUP_DIR || join(process.cwd(), "backups"));
  return {
    dir,
    stateFile: resolve(process.env.BACKUP_STATE_FILE || join(dir, "backup-state.json")),
    logFile: resolve(process.env.BACKUP_LOG || join(dir, "backup.log")),
    prefix: (process.env.BACKUP_FILE_PREFIX || "ledbox").trim() || "ledbox",
    maxAgeHours: positiveNumber(process.env.BACKUP_MAX_AGE_HOURS, DEFAULT_MAX_AGE_HOURS),
    retentionDays: positiveNumber(process.env.BACKUP_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
    minKeep: positiveInt(process.env.BACKUP_MIN_KEEP, DEFAULT_MIN_KEEP),
    historyLimit: positiveInt(process.env.BACKUP_HISTORY, DEFAULT_HISTORY),
    verify: process.env.BACKUP_VERIFY !== "0",
    pgDumpBin: resolvePgDump(process.env.PG_DUMP_BIN),
    /** ¿El binario lo eligió una persona? Entonces no se reintenta por versión. */
    pgDumpExplicit: Boolean((process.env.PG_DUMP_BIN || "").trim()),
    databaseUrl: (process.env.DATABASE_URL || "").trim(),
  };
}

function parseArgs(argv) {
  const options = { check: false, json: false, help: false, now: null };
  for (const raw of argv) {
    if (raw === "--check") options.check = true;
    else if (raw === "--json") options.json = true;
    else if (raw === "--help" || raw === "-h") options.help = true;
    else if (raw.startsWith("--now=")) options.now = raw.slice("--now=".length);
    else throw new Error(`Opción desconocida: ${raw} (probá --help)`);
  }
  if (options.now !== null && Number.isNaN(new Date(options.now).getTime())) {
    throw new Error(`--now no es una fecha válida: ${options.now}`);
  }
  return options;
}

/** Partes de la base sin credenciales: es lo único que se guarda y se loguea. */
function databaseTarget(databaseUrl) {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL no es una URL de PostgreSQL.");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
  return {
    host: url.hostname,
    port: url.port || "5432",
    database,
    user: decodeURIComponent(url.username || "postgres"),
  };
}

/** Entorno del proceso hijo: la contraseña viaja acá, nunca en la línea de comandos. */
function pgEnv(databaseUrl) {
  const url = new URL(databaseUrl);
  const target = databaseTarget(databaseUrl);
  const env = { ...process.env, PGHOST: target.host, PGPORT: target.port, PGUSER: target.user, PGDATABASE: target.database };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

// ── Procesos y archivos ─────────────────────────────────────────────────────

/** Corre un binario y devuelve `{ code, stdout, stderr }`; nunca imprime credenciales. */
function runProcess(bin, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 4000) stdout = stdout.slice(-4000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

async function pgDumpVersion(bin) {
  const { code, stdout, stderr } = await runProcess(bin, ["--version"]);
  if (code !== 0) throw new Error(`No se pudo ejecutar ${bin}: ${stderr || stdout || "sin salida"}`);
  return stdout.replace(/^pg_dump\s*\(PostgreSQL\)\s*/i, "").trim();
}

/** `YYYYMMDD-HHMMSS` en hora de Asunción (el mismo día que ve el equipo). */
function fileStamp(instant) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}${pick("month")}${pick("day")}-${pick("hour")}${pick("minute")}${pick("second")}`;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Nombre libre `<prefijo>-<fecha>.sql.gz` (dos corridas en el mismo segundo no se pisan). */
async function freeBackupName(dir, prefix, stamp) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const name = `${prefix}-${stamp}${suffix}${FILE_SUFFIX}`;
    if (!(await exists(join(dir, name)))) return name;
  }
  throw new Error("No hay nombre libre para el respaldo.");
}

/** `pg_dump` en SQL plano a un temporal; lanza con el error real si falla. */
async function dumpToFile({ bin, env, plainFile, target }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, ["--no-owner", "--no-privileges", "--format=plain", "--verbose"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const writing = pipeline(child.stdout, createWriteStream(plainFile));
    child.once("error", (error) => {
      writing.catch(() => {});
      reject(error);
    });
    child.once("close", (code) => {
      writing.then(
        () => {
          if (code !== 0) {
            const detail = stderr.split("\n").filter(Boolean).slice(-3).join(" · ") || "sin detalle";
            reject(
              new Error(
                `pg_dump terminó con código ${code} (${target.user}@${target.host}:${target.port}/${target.database}): ${detail}`,
              ),
            );
            return;
          }
          resolvePromise();
        },
        (error) => reject(error),
      );
    });
  });
}

/**
 * Verifica el respaldo ya comprimido: lo descomprime de punta a punta y exige
 * el marcador de cierre de `pg_dump`. Devuelve el tamaño descomprimido exacto
 * y las tablas creadas por el dump. Un archivo truncado falla acá.
 */
async function verifyDump(file) {
  const gunzip = createGunzip();
  const input = createReadStream(file);
  input.once("error", (error) => gunzip.destroy(error));
  let bytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  let tables = 0;
  let complete = false;
  let lastLine = "";
  const lines = createInterface({ input: input.pipe(gunzip).pipe(counter), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.startsWith("CREATE TABLE ")) tables += 1;
    if (line.includes(DUMP_COMPLETE_MARKER)) complete = true;
    lastLine = line;
  }
  if (!complete) {
    throw new Error(
      `El dump no cierra con «${DUMP_COMPLETE_MARKER}» (última línea: «${lastLine.slice(0, 120)}»): copia truncada.`,
    );
  }
  return { bytes, tables };
}

async function compressFile(plainFile, gzipFile) {
  await pipeline(createReadStream(plainFile), createGzip({ level: 9 }), createWriteStream(gzipFile));
}

/** Respaldos reales del directorio, ordenados del más nuevo al más viejo. */
async function listBackups(config) {
  let entries;
  try {
    entries = await readdir(config.dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(`${config.prefix}-`) || !entry.name.endsWith(FILE_SUFFIX)) continue;
    const info = await stat(join(config.dir, entry.name)).catch(() => null);
    if (!info) continue;
    files.push({ name: entry.name, bytes: info.size, modifiedAt: info.mtime.toISOString() });
  }
  files.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return files;
}

/**
 * Retención: borra los respaldos más viejos que `retentionDays`, protegiendo
 * siempre los `minKeep` más nuevos y el archivo que se acaba de escribir.
 */
async function pruneBackups(config, files, keepNames) {
  const protectedNames = new Set([...files.slice(0, config.minKeep).map((file) => file.name), ...keepNames]);
  const cutoff = Date.now() - config.retentionDays * 86_400_000;
  const deleted = [];
  for (const file of files) {
    if (protectedNames.has(file.name)) continue;
    if (new Date(file.modifiedAt).getTime() >= cutoff) continue;
    try {
      await unlink(join(config.dir, file.name));
      deleted.push(file.name);
    } catch (error) {
      logger.warn(`No se pudo borrar ${file.name}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return deleted;
}

// ── Estado y log ────────────────────────────────────────────────────────────

async function readState(config) {
  try {
    const raw = await readFile(config.stateFile, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeState(config, state) {
  await mkdir(config.dir, { recursive: true });
  const temporary = `${config.stateFile}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, config.stateFile);
}

function runLine(run) {
  const parts = [`[${run.finishedAt}]`, `status=${run.status}`];
  if (run.file) parts.push(`file=${run.file}`);
  if (run.bytes !== null && run.bytes !== undefined) parts.push(`bytes=${run.bytes}`, `size=${run.uncompressedBytes ?? "-"}`);
  if (run.tables !== null && run.tables !== undefined) parts.push(`tables=${run.tables}`);
  parts.push(`durationMs=${run.durationMs}`);
  if (run.verified) parts.push("verified=yes");
  if (run.error) parts.push(`error=${run.error.replace(/\s+/g, " ").slice(0, MAX_ERROR)}`);
  return parts.join(" ");
}

async function appendLog(config, line) {
  try {
    await mkdir(config.dir, { recursive: true });
    const previous = await readFile(config.logFile, "utf8").catch(() => "");
    const body = previous.endsWith("\n") || previous === "" ? previous : `${previous}\n`;
    await writeFile(config.logFile, `${body}${line}\n`, "utf8");
  } catch (error) {
    logger.warn(`No se pudo escribir el log: ${error instanceof Error ? error.message : error}`);
  }
}

function trimmedRun(run) {
  return {
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    status: run.status,
    durationMs: run.durationMs,
    file: run.file,
    bytes: run.bytes,
    uncompressedBytes: run.uncompressedBytes,
    tables: run.tables,
    verified: run.verified,
    error: run.error,
  };
}

// ── Corrida de respaldo ─────────────────────────────────────────────────────

async function backup(config, now) {
  if (!config.databaseUrl) throw new Error("Falta DATABASE_URL: no hay base que respaldar.");
  const target = databaseTarget(config.databaseUrl);
  const startedAt = now;
  const started = process.hrtime.bigint();
  const plainFile = join(tmpdir(), `ledbox-backup-${process.pid}-${Date.now()}.sql`);
  const stamp = fileStamp(now);
  let file = null;
  let bytes = null;
  let uncompressedBytes = null;
  let tables = null;
  let verified = false;
  let error = null;
  let deleted = [];
  let pgDump = null;
  const keepNames = [];

  try {
    await mkdir(config.dir, { recursive: true });
    let dumpBin = config.pgDumpBin;
    pgDump = await pgDumpVersion(dumpBin);
    logger.info(`Respaldando ${target.user}@${target.host}:${target.port}/${target.database} con pg_dump ${pgDump}…`);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await dumpToFile({ bin: dumpBin, env: pgEnv(config.databaseUrl), plainFile, target });
        break;
      } catch (caught) {
        const detail = caught instanceof Error ? caught.message : String(caught);
        // Cliente más viejo que la base en la ventana del deploy: se espera a
        // que el hook termine y se vuelve a resolver el binario (issue #71).
        const waitingForDeployClient =
          !config.pgDumpExplicit && attempt < MISMATCH_ATTEMPTS && /server version mismatch/i.test(detail);
        if (!waitingForDeployClient) throw caught;
        logger.warn(
          `El cliente no coincide con la base (intento ${attempt}/${MISMATCH_ATTEMPTS}): espero ${MISMATCH_RETRY_MS / 1000} s por el cliente que instala el deploy…`,
        );
        await new Promise((resolve) => setTimeout(resolve, MISMATCH_RETRY_MS));
        dumpBin = resolvePgDump(process.env.PG_DUMP_BIN);
      }
    }
    if (dumpBin !== config.pgDumpBin) pgDump = await pgDumpVersion(dumpBin);

    file = await freeBackupName(config.dir, config.prefix, stamp);
    const gzipFile = join(config.dir, file);
    await compressFile(plainFile, `${gzipFile}.tmp`);
    await rename(`${gzipFile}.tmp`, gzipFile);
    bytes = (await stat(gzipFile)).size;

    if (config.verify) {
      try {
        const result = await verifyDump(gzipFile);
        uncompressedBytes = result.bytes;
        tables = result.tables;
        verified = true;
        logger.info(`Verificado: ${tables} tablas, ${uncompressedBytes} bytes descomprimidos.`);
      } catch (caught) {
        // Un dump que no verifica no es un respaldo: se borra para que nadie lo
        // confunda con uno válido y la corrida queda fallida con el motivo real.
        await unlink(gzipFile).catch(() => {});
        file = null;
        throw new Error(
          `${caught instanceof Error ? caught.message : String(caught)} Se borró el archivo incompleto.`,
        );
      }
    } else {
      logger.warn("Verificación desactivada (BACKUP_VERIFY=0): el respaldo no se descomprimió.");
    }

    keepNames.push(file);
    const previousState = await readState(config);
    if (previousState?.lastSuccess?.file) keepNames.push(previousState.lastSuccess.file);
    deleted = await pruneBackups(config, await listBackups(config), keepNames);
    if (deleted.length > 0) logger.info(`Retención: ${deleted.length} respaldo(s) viejo(s) borrado(s).`);
  } catch (caught) {
    error = (caught instanceof Error ? caught.message : String(caught)).slice(0, MAX_ERROR);
    logger.error(error);
  } finally {
    await unlink(plainFile).catch(() => {});
    // Un temporal huérfano (falló la compresión) nunca queda como respaldo.
    if (file) await unlink(join(config.dir, `${file}.tmp`)).catch(() => {});
  }

  const finishedAt = new Date();
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (!error && !file) error = "El respaldo terminó sin archivo.";
  const run = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    status: error ? "failed" : "ok",
    durationMs,
    file,
    bytes,
    uncompressedBytes,
    tables,
    verified,
    error,
  };

  const previous = await readState(config);
  const history = [trimmedRun(run), ...(Array.isArray(previous?.history) ? previous.history : [])]
    .slice(0, config.historyLimit);
  const state = {
    version: STATE_VERSION,
    service: SERVICE,
    updatedAt: finishedAt.toISOString(),
    target,
    config: {
      maxAgeHours: config.maxAgeHours,
      retentionDays: config.retentionDays,
      minKeep: config.minKeep,
      verify: config.verify,
    },
    tool: { pgDump: pgDump ?? config.pgDumpBin, node: process.version },
    lastRun: trimmedRun(run),
    lastSuccess: run.status === "ok" ? trimmedRun(run) : (previous?.lastSuccess ?? null),
    retention: { deleted: deleted.length, deletedFiles: deleted.slice(0, 20) },
    history,
  };
  await writeState(config, state);
  await appendLog(config, runLine(run));

  if (error) {
    logger.error(`Respaldo fallido: ${error}`);
    return { run, state, deleted };
  }
  logger.info(`Respaldo ok: ${file} (${bytes} bytes comprimidos, ${durationMs} ms).`);
  return { run, state, deleted };
}

// ── Chequeo (`--check`) ─────────────────────────────────────────────────────

function hoursBetween(from, to) {
  return (to.getTime() - new Date(from).getTime()) / 3_600_000;
}

/** Evalúa el estado real: sin respaldos, último intento fallido, vencido o archivo ausente. */
async function check(config, now) {
  const state = await readState(config);
  const result = {
    ok: false,
    issue: "missing",
    message: "",
    lastSuccessAt: state?.lastSuccess?.finishedAt ?? null,
    lastRunStatus: state?.lastRun?.status ?? null,
    ageHours: null,
    maxAgeHours: config.maxAgeHours,
    file: state?.lastSuccess?.file ?? null,
  };
  if (!state || !state.lastSuccess) {
    result.message = `Sin respaldos registrados (estado: ${config.stateFile}).`;
    return result;
  }
  const ageHours = hoursBetween(state.lastSuccess.finishedAt, now);
  result.ageHours = Math.round(ageHours * 10) / 10;
  if (state.lastRun?.status === "failed") {
    result.issue = "failed";
    result.message = `El último respaldo falló: ${state.lastRun.error ?? "sin detalle"}`;
    return result;
  }
  const file = state.lastSuccess.file;
  if (!file || !(await exists(join(config.dir, file)))) {
    result.issue = "missing_file";
    result.message = `El archivo del último respaldo no está en ${config.dir}: ${file ?? "(sin nombre)"}`;
    return result;
  }
  if (ageHours > config.maxAgeHours) {
    result.issue = "stale";
    result.message = `El último respaldo tiene ${result.ageHours} h y el umbral es ${config.maxAgeHours} h.`;
    return result;
  }
  result.ok = true;
  result.issue = "ok";
  result.message = `Último respaldo hace ${result.ageHours} h (${file}).`;
  return result;
}

function help() {
  console.log(
    [
      "Respaldo de la base de LedBox (pg_dump + gzip).",
      "",
      "  node scripts/backup.mjs                 respalda, verifica, poda y registra",
      "  node scripts/backup.mjs --check         falla si el respaldo falta o está vencido",
      "  node scripts/backup.mjs --check --json  el mismo chequeo en JSON",
      "  node scripts/backup.mjs --now=<ISO>     instante de referencia (pruebas)",
      "",
      "Variables: BACKUP_DIR, BACKUP_STATE_FILE, BACKUP_LOG, BACKUP_FILE_PREFIX,",
      "BACKUP_MAX_AGE_HOURS, BACKUP_RETENTION_DAYS, BACKUP_MIN_KEEP, BACKUP_HISTORY,",
      "BACKUP_VERIFY=0, PG_DUMP_BIN (default: el más nuevo instalado). Ver docs/OPERACION.md.",
    ].join("\n"),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    help();
    return 0;
  }
  const config = loadConfig();
  const now = options.now ? new Date(options.now) : new Date();

  if (options.check) {
    const result = await check(config, now);
    if (options.json) console.log(JSON.stringify(result));
    else if (result.ok) logger.info(`OK: ${result.message}`);
    else logger.error(`FALLA: ${result.message}`);
    return result.ok ? 0 : 1;
  }

  const { run } = await backup(config, now);
  return run.status === "ok" ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
