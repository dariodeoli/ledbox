"use client";

import { useState } from "react";
import { formatDate, formatDateShort, formatSince, isDueSoon, statusTone, taskTypeLabel } from "@/lib/admin-format";
import type { AdminEventTask } from "@/lib/admin-types";
import { AdminIcon } from "../AdminIcons";
import { AdminBadge, AdminCell, AdminEmpty, AdminRow, AdminTable } from "../AdminUI";
import { useOfflineQueue } from "../AdminOffline";
import { queuedActionForTask } from "@/lib/offline-queue";

export type ChecklistEntry = { task: AdminEventTask; eventName: string };

/** Checklist operativo: una tabla para Resumen y Eventos (mismo contrato de `/api/admin/event-ops`). */
export function ChecklistTable({
  entries,
  canToggle,
  onChanged,
  onError,
  emptyHint,
  compact,
}: {
  entries: ChecklistEntry[];
  canToggle: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
  emptyHint: string;
  /** Resumen del dashboard: sin la columna de tipo para entrar en un panel a media pantalla. */
  compact?: boolean;
}) {
  if (entries.length === 0) return <AdminEmpty icon="check" title="Sin tareas" hint={emptyHint} />;
  return (
    <AdminTable
      view={compact ? "checklist-resumen" : "checklist"}
      label="Checklist operativo"
      columns={
        compact
          ? [{ label: "Estado" }, { label: "Tarea" }, { label: "Evento" }, { label: "Vence", end: true }]
          : [{ label: "Estado" }, { label: "Tarea" }, { label: "Evento" }, { label: "Tipo" }, { label: "Vence", end: true }]
      }
    >
      {entries.map(({ task, eventName }) => (
        <AdminRow key={task.id}>
          <AdminCell>
            <ChecklistToggle task={task} eventName={eventName} canToggle={canToggle} onChanged={onChanged} onError={onError} />
          </AdminCell>
          <AdminCell title={task.title}>
            <strong>{task.title}</strong>
          </AdminCell>
          <AdminCell title={eventName}>{eventName}</AdminCell>
          {compact ? null : (
            <AdminCell>
              <AdminBadge tone={statusTone(task.type)}>{taskTypeLabel(task.type)}</AdminBadge>
            </AdminCell>
          )}
          <AdminCell end title={task.dueAt ? formatDate(task.dueAt) : "Sin fecha de vencimiento"}>
            {task.dueAt ? formatDateShort(task.dueAt) : "—"}
          </AdminCell>
        </AdminRow>
      ))}
    </AdminTable>
  );
}

/**
 * Marca una tarea en el servidor; sin conexión la deja en la cola local
 * (issue #23) y el estado visible pasa a "Sin subir" hasta la confirmación real.
 */
function ChecklistToggle({
  task,
  eventName,
  canToggle,
  onChanged,
  onError,
}: {
  task: AdminEventTask;
  eventName: string;
  canToggle: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const { actions, fieldAction } = useOfflineQueue();
  const [busy, setBusy] = useState(false);
  const queued = queuedActionForTask(actions, task.id);
  const done = queued ? queued.body.completed === true : Boolean(task.completedAt);

  if (!canToggle) {
    return <AdminBadge tone={done ? "ok" : "neutral"}>{done ? "Listo" : "Pendiente"}</AdminBadge>;
  }

  async function toggle() {
    if (busy) return;
    const next = !done;
    setBusy(true);
    const result = await fieldAction({
      kind: "event-task-toggle",
      path: "/api/admin/event-ops",
      body: { kind: "toggle", id: task.id, completed: next },
      summary: `${next ? "Marcar cumplida" : "Volver a pendiente"}: «${task.title}»`,
      detail: `Evento: ${eventName}`,
    });
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    if (!result.queued) onChanged();
  }

  const queuedFailed = queued?.status === "failed";
  const title = queued
    ? queuedFailed
      ? `No se pudo subir: ${queued.error ?? "sin motivo informado"}. Reintentá desde el indicador de sincronización.`
      : `Guardada en este equipo ${formatSince(queued.createdAt)}: se sube al volver la señal.`
    : `${done ? "Volver a pendiente" : "Marcar como cumplida"}: ${task.title}${task.dueAt ? ` · vence ${formatDate(task.dueAt)}` : ""}`;

  return (
    <label
      className="admin-check"
      data-done={done ? "true" : undefined}
      data-queue={queued ? (queuedFailed ? "failed" : "queued") : undefined}
      title={title}
    >
      <input
        type="checkbox"
        checked={done}
        disabled={busy}
        onChange={() => void toggle()}
        aria-label={`${done ? "Marcar pendiente" : "Marcar cumplida"}: ${task.title}`}
      />
      <span className="admin-check-box" aria-hidden="true">
        <AdminIcon name="check" size={11} />
      </span>
      <span className="admin-check-text">
        {queued ? (queuedFailed ? "Falló" : "Sin subir") : done ? "Listo" : isDueSoon(task.dueAt, 3) ? "Vence pronto" : "Pendiente"}
      </span>
    </label>
  );
}
