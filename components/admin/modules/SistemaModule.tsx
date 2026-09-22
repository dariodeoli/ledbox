"use client";

import { useAdminResource } from "@/lib/admin-api";
import { formatBytes, formatDateTime, formatNumber, formatSince, type AdminTone } from "@/lib/admin-format";
import type { AdminBackupRun, AdminSystemBackupStatus, AdminSystemStatus } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminKpi,
  AdminLoadingRows,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
} from "../AdminUI";

/**
 * Estado del sistema (issue #43): versión, base, migraciones aplicadas y el
 * respaldo real (fecha, tamaño, resultado y último error).
 *
 * Todo sale de datos reales: `GET /api/admin/system` lee `_prisma_migrations`,
 * la base viva, el archivo de estado que escribe `scripts/backup.mjs` y el disco
 * del volumen de respaldos. Sin estado, la pantalla dice que no hay respaldos.
 *
 * Solo OWNER/ADMIN (el API responde 403 al resto y la demo nunca lo expone).
 */

const BACKUP_STATUS: Record<AdminSystemBackupStatus, { label: string; tone: AdminTone }> = {
  ok: { label: "Al día", tone: "ok" },
  stale: { label: "Vencido", tone: "danger" },
  failed: { label: "Falló", tone: "danger" },
  missing: { label: "Falta el archivo", tone: "danger" },
  never: { label: "Sin respaldos", tone: "warn" },
};

export function SistemaModule() {
  const { role, loading } = useAdminSession();
  if (loading) return <AdminLoadingRows rows={6} />;
  if (role !== "OWNER" && role !== "ADMIN") {
    return (
      <AdminEmpty
        icon="database"
        title="Acceso restringido"
        hint="Solo propietarios y administradores pueden ver el estado del sistema."
      />
    );
  }
  return <SistemaView />;
}

/** Duración real de una corrida: milisegundos o segundos con un decimal. */
function durationLabel(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return "—";
  if (durationMs < 1000) return `${formatNumber(Math.round(durationMs))} ms`;
  return `${new Intl.NumberFormat("es-PY", { maximumFractionDigits: 1 }).format(durationMs / 1000)} s`;
}

function runResult(run: AdminBackupRun | null): string {
  if (!run) return "—";
  return run.status === "ok" ? "Ok" : "Falló";
}

function runVerified(run: AdminBackupRun | null): string {
  if (!run) return "—";
  if (!run.verified) return "Sin verificar";
  return run.tables !== null ? `Verificado · ${formatNumber(run.tables)} tablas` : "Verificado";
}

function SistemaView() {
  const resource = useAdminResource<AdminSystemStatus | null>("/api/admin/system", (payload) => {
    const system = payload.system;
    return system && typeof system === "object" ? (system as AdminSystemStatus) : null;
  });
  const status = resource.data;
  const backup = status?.backup ?? null;
  const issue = backup?.issue ?? null;

  return (
    <div className="admin-module-page">
      {issue ? (
        <AdminNote tone="error" variant="alert">
          {issue.detail}
        </AdminNote>
      ) : null}
      {status?.backup.stateError ? (
        <AdminNote tone="error">{status.backup.stateError}</AdminNote>
      ) : null}

      <AdminDataState
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.reload}
        empty={!status}
        emptyTitle="Sin estado del sistema" emptyIcon="database"
        emptyHint="No pudimos leer el estado del respaldo ni de la base."
      >
        {status && backup ? (
          <>
            <section className="admin-kpis" aria-label="Resumen del sistema">
              <AdminKpi label="Versión" icon="info" value={status.version} note="Fuente única: package.json" />
              <AdminKpi
                label="Base de datos" icon="database"
                value={status.database.status === "ok" ? "Responde" : "Sin conexión"}
                tone={status.database.status === "ok" ? "ok" : "danger"}
                note={
                  status.database.latencyMs !== null
                    ? `${formatNumber(status.database.latencyMs)} ms · ${formatBytes(status.database.sizeBytes)}`
                    : "sin respuesta"
                }
              />
              <AdminKpi
                label="Migraciones" icon="database"
                value={status.migrations.applied !== null ? formatNumber(status.migrations.applied) : "—"}
                note={status.migrations.last ? status.migrations.last.name : "sin historial"}
              />
              <AdminKpi
                label="Último respaldo" icon="clock"
                value={backup.lastSuccess ? formatSince(backup.lastSuccess.finishedAt) : "Sin respaldos"}
                tone={BACKUP_STATUS[backup.status].tone}
                note={backup.lastSuccess ? formatDateTime(backup.lastSuccess.finishedAt) : `umbral ${formatNumber(backup.maxAgeHours)} h`}
              />
            </section>

            <AdminPanel
              title="Respaldo de la base" icon="database"
              meta={`${BACKUP_STATUS[backup.status].label} · umbral ${formatNumber(backup.maxAgeHours)} h`}
              action={
                <AdminButton icon="refresh" busy={resource.loading} onClick={resource.reload} title="Volver a leer el estado real">
                  Actualizar
                </AdminButton>
              }
            >
              <div className="admin-settings">
                <div className="admin-settings-grid">
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Resultado</span>
                    <p className="admin-detail-value">
                      <AdminBadge tone={BACKUP_STATUS[backup.status].tone}>{BACKUP_STATUS[backup.status].label}</AdminBadge>
                    </p>
                    <span className="admin-field-hint">El estado surge del archivo real que escribe el respaldo.</span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Último respaldo ok</span>
                    <p className="admin-detail-value">
                      {backup.lastSuccess ? formatDateTime(backup.lastSuccess.finishedAt) : "Sin respaldos"}
                    </p>
                    <span className="admin-field-hint">
                      {backup.lastSuccess && backup.ageHours !== null
                        ? `Hace ${formatNumber(backup.ageHours)} h`
                        : "Todavía no hay una corrida con resultado ok."}
                    </span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Último intento</span>
                    <p className="admin-detail-value">
                      {backup.lastRun ? `${formatDateTime(backup.lastRun.finishedAt)} · ${runResult(backup.lastRun)}` : "—"}
                    </p>
                    <span className="admin-field-hint">Incluye los intentos fallidos.</span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Tamaño</span>
                    <p className="admin-detail-value">
                      <span className="admin-nowrap">{formatBytes(backup.lastSuccess?.bytes)}</span>
                    </p>
                    <span className="admin-field-hint">{runVerified(backup.lastSuccess)}</span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Archivo</span>
                    <p className="admin-detail-value">
                      <span className="admin-nowrap">{backup.lastSuccess?.file ?? "—"}</span>
                    </p>
                    <span className="admin-field-hint">
                      {backup.fileExists === false
                        ? "El archivo ya no está en el directorio de respaldos."
                        : "El respaldo se guarda en el directorio configurado del servidor."}
                    </span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Respaldos guardados</span>
                    <p className="admin-detail-value">
                      {formatNumber(backup.files.count)} · {formatBytes(backup.files.bytes)}
                    </p>
                    <span className="admin-field-hint">
                      {backup.retention
                        ? `Retención de ${formatNumber(backup.retention.days)} días, mínimo ${formatNumber(backup.retention.minKeep)} archivos.`
                        : "La retención la define el cron del respaldo."}
                    </span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Disco del volumen</span>
                    <p className="admin-detail-value">
                      {status.disk.freeBytes !== null ? `${formatBytes(status.disk.freeBytes)} libres` : "—"}
                    </p>
                    <span className="admin-field-hint">
                      {status.disk.totalBytes !== null ? `de ${formatBytes(status.disk.totalBytes)}` : "sin datos del volumen"}
                    </span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Último error</span>
                    <p className="admin-detail-value">
                      {status.lastError ? <span className="admin-reminder-error">{status.lastError.message}</span> : "Sin errores"}
                    </p>
                    <span className="admin-field-hint">
                      {status.lastError ? formatDateTime(status.lastError.at) : "Ninguna corrida falló."}
                    </span>
                  </div>
                </div>
              </div>
            </AdminPanel>

            <AdminPanel title="Historial de respaldos" icon="clock" meta={`Últimas ${formatNumber(backup.history.length)} corridas`}>
              <AdminDataState
                loading={false}
                empty={backup.history.length === 0}
                emptyTitle="Todavía no hay corridas registradas" emptyIcon="database"
                emptyHint="Cuando el cron corra `node scripts/backup.mjs` vas a ver acá cada intento con su resultado real."
              >
                <AdminTable
                  view="respaldos"
                  label="Historial de respaldos de la base"
                  columns={[
                    { label: "Fecha" },
                    { label: "Resultado" },
                    { label: "Tamaño" },
                    { label: "Tablas" },
                    { label: "Duración" },
                    { label: "Archivo" },
                    { label: "Error" },
                  ]}
                >
                  {backup.history.map((run) => (
                    <AdminRow key={`${run.finishedAt}-${run.file ?? "sin-archivo"}`} tone={run.status === "failed" ? "danger" : undefined}>
                      <AdminCell title={formatDateTime(run.finishedAt)}>
                        <span className="admin-nowrap">{formatDateTime(run.finishedAt)}</span>
                      </AdminCell>
                      <AdminCell>
                        <AdminBadge tone={run.status === "ok" ? "ok" : "danger"}>{runResult(run)}</AdminBadge>
                      </AdminCell>
                      <AdminCell title={formatBytes(run.bytes)}>
                        <span className="admin-nowrap">{formatBytes(run.bytes)}</span>
                      </AdminCell>
                      <AdminCell title={runVerified(run)}>
                        <span className="admin-nowrap">{run.tables !== null ? formatNumber(run.tables) : "—"}</span>
                      </AdminCell>
                      <AdminCell title="Duración de la corrida">
                        <span className="admin-nowrap">{durationLabel(run.durationMs)}</span>
                      </AdminCell>
                      <AdminCell title={run.file ?? "Sin archivo"}>
                        <span className="admin-nowrap">{run.file ?? "—"}</span>
                      </AdminCell>
                      <AdminCell title={run.error ?? "Sin errores"}>
                        {run.error ? <span className="admin-reminder-error">{run.error}</span> : "—"}
                      </AdminCell>
                    </AdminRow>
                  ))}
                </AdminTable>
              </AdminDataState>
            </AdminPanel>

            <AdminPanel title="Base de datos y migraciones" icon="database" meta="PostgreSQL · Prisma">
              <div className="admin-settings">
                <div className="admin-settings-grid">
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Estado</span>
                    <p className="admin-detail-value">
                      <AdminBadge tone={status.database.status === "ok" ? "ok" : "danger"}>
                        {status.database.status === "ok" ? "Responde" : "Sin conexión"}
                      </AdminBadge>
                    </p>
                    <span className="admin-field-hint">
                      {status.database.error ?? "La base acepta consultas del panel."}
                    </span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Tamaño de la base</span>
                    <p className="admin-detail-value">
                      <span className="admin-nowrap">{formatBytes(status.database.sizeBytes)}</span>
                    </p>
                    <span className="admin-field-hint">
                      {status.database.latencyMs !== null ? `Consulta inicial en ${formatNumber(status.database.latencyMs)} ms` : "sin medición"}
                    </span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Migraciones aplicadas</span>
                    <p className="admin-detail-value">
                      {status.migrations.applied !== null ? formatNumber(status.migrations.applied) : "—"}
                    </p>
                    <span className="admin-field-hint">
                      {status.migrations.last
                        ? `Última: ${status.migrations.last.name} · ${formatDateTime(status.migrations.last.finishedAt)}`
                        : "Sin historial de migraciones."}
                    </span>
                  </div>
                  <div className="admin-settings-readonly">
                    <span className="admin-field-label">Versión del panel</span>
                    <p className="admin-detail-value">{status.version}</p>
                    <span className="admin-field-hint">Leída del estado al {formatDateTime(status.checkedAt)}.</span>
                  </div>
                </div>
              </div>
            </AdminPanel>

            <AdminNote>
              El respaldo lo corre el cron del servidor (node scripts/backup.mjs) y deja el estado que lee esta pantalla.
              Cuando falta, está vencido o falló, el panel avisa por correo a propietarios y administradores una vez por día
              y lo registra en Auditoría. El procedimiento y la restauración están en docs/OPERACION.md.
            </AdminNote>
          </>
        ) : null}
      </AdminDataState>
    </div>
  );
}
