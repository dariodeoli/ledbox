"use client";

import { useMemo, useState } from "react";
import { promoterAvailabilityDetail, promoterAvailabilityLabel, promoterAvailabilityTone, formatNumber } from "@/lib/admin-format";
import { promoterIsAvailable, type AdminEventPanelRow } from "@/lib/admin-types";
import { pendingTaskEntries, taskInScope, TASK_SCOPE_LABEL, type TaskScope } from "@/lib/event-readiness";
import { AdminBadge, AdminDataState, AdminNote, AdminSelect } from "../AdminUI";
import { ChecklistTable } from "./Checklist";

const SCOPES: readonly TaskScope[] = ["pending", "overdue", "week"];
const NO_PROMOTER = "__none__";

/**
 * Vista transversal de tareas: todo lo pendiente de todos los eventos abiertos,
 * en un solo lugar. Reutiliza el checklist de siempre (mismo contrato, misma cola
 * sin conexión); marcar como hecha solo existe con permiso de operación.
 */
export function EventosTareas({
  events,
  loading,
  error,
  onRetry,
  writable,
  scope,
  onScope,
  onOpenEvent,
}: {
  events: AdminEventPanelRow[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  writable: boolean;
  scope: TaskScope;
  onScope: (scope: TaskScope) => void;
  onOpenEvent: (eventId: string) => void;
}) {
  const [promoterId, setPromoterId] = useState("ALL");
  const [taskError, setTaskError] = useState("");
  const all = useMemo(() => pendingTaskEntries(events), [events]);
  const counts = useMemo(
    () => ({
      pending: all.length,
      overdue: all.filter(({ task }) => taskInScope(task, "overdue")).length,
      week: all.filter(({ task }) => taskInScope(task, "week")).length,
    }),
    [all],
  );
  const promoterOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const { task } of all) if (task.promoter) seen.set(task.promoter.id, task.promoter.name);
    return [
      { value: "ALL", label: "Todas las promotoras" },
      { value: NO_PROMOTER, label: "Sin promotora" },
      ...[...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], "es")).map(([value, label]) => ({ value, label })),
    ];
  }, [all]);
  // Si la promotora elegida ya no tiene tareas, el filtro vuelve a «todas» en vez de dejar la lista vacía sin explicación.
  const effectivePromoter = promoterOptions.some((option) => option.value === promoterId) ? promoterId : "ALL";
  const entries = useMemo(
    () =>
      all
        .filter(({ task }) => taskInScope(task, scope))
        .filter(({ task }) => (effectivePromoter === "ALL" ? true : effectivePromoter === NO_PROMOTER ? !task.promoter : task.promoter?.id === effectivePromoter)),
    [all, scope, effectivePromoter],
  );
  const conflicts = useMemo(() => all.filter(({ task }) => task.promoter && !promoterIsAvailable(task.promoter)), [all]);

  return (
    <section className="admin-eventos-tareas" aria-label="Tareas de todos los eventos">
      <div className="admin-eventos-tareas-bar">
        <nav className="admin-subtabs" aria-label="Filtrar tareas">
          {SCOPES.map((key) => (
            <button
              key={key}
              type="button"
              className="admin-subtab"
              data-active={scope === key ? "true" : undefined}
              aria-pressed={scope === key}
              onClick={() => onScope(key)}
            >
              {TASK_SCOPE_LABEL[key]}
              <span className="admin-subtab-count">{formatNumber(counts[key])}</span>
            </button>
          ))}
        </nav>
        <AdminSelect value={effectivePromoter} onChange={setPromoterId} label="Filtrar por promotora" options={promoterOptions} />
      </div>

      {conflicts.slice(0, 3).map(({ task, eventName }) => (
        <AdminNote key={task.id}>
          <AdminBadge tone={promoterAvailabilityTone(task.promoter?.availability)}>{promoterAvailabilityLabel(task.promoter?.availability)}</AdminBadge>
          <span>
            <strong>{task.promoter?.name}</strong> está asignada a «{task.title}» ({eventName}) — {(promoterAvailabilityDetail(task.promoter) || "sin detalle cargado").replace(/\.+$/, "")}. Revisá la asignación o cubrila con otra persona.
          </span>
        </AdminNote>
      ))}
      {conflicts.length > 3 ? (
        <AdminNote>
          Hay {formatNumber(conflicts.length - 3)} asignación{conflicts.length - 3 === 1 ? "" : "es"} más con la promotora no disponible.
        </AdminNote>
      ) : null}
      {taskError ? <AdminNote tone="error">{taskError}</AdminNote> : null}

      <AdminDataState
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={all.length === 0}
        emptyTitle="Sin tareas pendientes"
        emptyIcon="check"
        emptyHint="Ningún evento abierto tiene tareas por hacer."
      >
        <ChecklistTable
          entries={entries}
          canToggle={writable}
          onChanged={onRetry}
          onError={setTaskError}
          onOpenEvent={onOpenEvent}
          emptyHint={scope === "overdue" ? "No hay tareas vencidas." : scope === "week" ? "No hay tareas que venzan esta semana." : "No hay tareas con esos filtros."}
        />
      </AdminDataState>
    </section>
  );
}
