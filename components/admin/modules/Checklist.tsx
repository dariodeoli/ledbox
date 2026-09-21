"use client";

import { useState } from "react";
import { formatDate, formatDateShort, isDueSoon, statusTone, taskTypeLabel } from "@/lib/admin-format";
import type { AdminEventTask } from "@/lib/admin-types";
import { AdminIcon } from "../AdminIcons";
import { AdminBadge, AdminCell, AdminEmpty, AdminRow, AdminTable } from "../AdminUI";
import { adminSend } from "../use-admin-data";

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
            <ChecklistToggle task={task} canToggle={canToggle} onChanged={onChanged} onError={onError} />
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

function ChecklistToggle({
  task,
  canToggle,
  onChanged,
  onError,
}: {
  task: AdminEventTask;
  canToggle: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const done = Boolean(task.completedAt);

  if (!canToggle) {
    return <AdminBadge tone={done ? "ok" : "neutral"}>{done ? "Listo" : "Pendiente"}</AdminBadge>;
  }

  async function toggle() {
    setBusy(true);
    const result = await adminSend("/api/admin/event-ops", { kind: "toggle", id: task.id, completed: !done });
    setBusy(false);
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onChanged();
  }

  return (
    <label
      className="admin-check"
      data-done={done ? "true" : undefined}
      title={`${done ? "Volver a pendiente" : "Marcar como cumplida"}: ${task.title}${task.dueAt ? ` · vence ${formatDate(task.dueAt)}` : ""}`}
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
      <span className="admin-check-text">{done ? "Listo" : isDueSoon(task.dueAt, 3) ? "Vence pronto" : "Pendiente"}</span>
    </label>
  );
}
