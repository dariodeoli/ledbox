"use client";

import { eventStatusLabel, formatDateTime, formatNumber, formatTime, statusTone, type AdminTone } from "@/lib/admin-format";
import { clientDisplayName } from "@/lib/client-identity";
import type { AdminEventPanelRow } from "@/lib/admin-types";
import type { EventReadiness } from "@/lib/event-readiness";
import { AdminBadge, AdminButton, AdminCountdown } from "../AdminUI";
import { AdminIcon } from "../AdminIcons";

/** Evento del panel con su preparación ya calculada (una sola vez por render). */
export type EventItem = { event: AdminEventPanelRow; readiness: EventReadiness };

/** Tono de la fila/tarjeta: lo más grave que le falta al evento. */
export function itemTone(item: EventItem): AdminTone | undefined {
  if (item.readiness.gaps.some((gap) => gap.tone === "danger")) return "danger";
  if (item.readiness.gaps.length > 0) return "warn";
  return undefined;
}

/**
 * Indicadores compactos de preparación: checklist, equipos despachados, seña y
 * promotoras. Cada chip trae el texto completo en su nombre accesible; nada se
 * dibuja si no hay dato (un `—` honesto, nunca un cero inventado).
 */
export function PrepChips({ item }: { item: EventItem }) {
  const { event, readiness } = item;
  const { tasks, equipment, promoters, deposit, phase } = readiness;
  const hasDanger = (key: string) => readiness.gaps.some((gap) => gap.key === key && gap.tone === "danger");
  const hasGap = (key: string) => readiness.gaps.some((gap) => gap.key === key);

  const checklistTone: AdminTone = tasks.total === 0 ? "neutral" : tasks.pending === 0 ? "ok" : hasDanger("checklist") ? "danger" : phase === "upcoming" ? "neutral" : "warn";
  const checklistText = tasks.total === 0 ? "Sin tareas cargadas" : `Checklist: ${tasks.done} de ${tasks.total} tareas cumplidas${tasks.overdue > 0 ? `, ${tasks.overdue} vencidas` : ""}`;

  const equipmentTone: AdminTone =
    equipment.units === 0
      ? "neutral"
      : hasDanger("return") || hasDanger("dispatch")
        ? "danger"
        : hasGap("dispatch")
          ? "warn"
          : equipment.dispatched === equipment.units && equipment.pendingReturn === 0
            ? "ok"
            : "neutral";
  const equipmentText =
    equipment.units === 0
      ? equipment.combos > 0
        ? "Solo combos: se mueven por componentes"
        : "Sin equipos asignados"
      : `Equipos despachados: ${equipment.dispatched} de ${equipment.units}${equipment.pendingReturn > 0 ? `, ${equipment.pendingReturn} por devolver` : ""}`;

  const depositTone: AdminTone = deposit === "paid" ? "ok" : deposit === "pending" ? "warn" : "neutral";
  const depositText =
    deposit === "paid"
      ? "Seña cobrada"
      : deposit === "pending"
        ? "Seña pendiente de cobro"
        : deposit === "none"
          ? "Sin seña pactada (sin presupuesto vinculado o sin anticipo)"
          : "Seña: no pudimos leer el presupuesto";

  const promoterTone: AdminTone = promoters.unavailable.length > 0 ? "warn" : promoters.count > 0 ? "info" : "neutral";
  const promoterText =
    promoters.count === 0
      ? "Sin promotoras asignadas"
      : `${promoters.count} promotora${promoters.count === 1 ? "" : "s"} asignada${promoters.count === 1 ? "" : "s"}${promoters.unavailable.length > 0 ? `; sin disponibilidad: ${promoters.unavailable.join(", ")}` : ""}`;

  return (
    <span className="admin-prep" data-event={event.id}>
      <AdminBadge tone={checklistTone} title={checklistText} label={checklistText}>
        <AdminIcon name="audit" size={12} />
        <span aria-hidden="true">{tasks.total === 0 ? "—" : `${tasks.done}/${tasks.total}`}</span>
      </AdminBadge>
      <AdminBadge tone={equipmentTone} title={equipmentText} label={equipmentText}>
        <AdminIcon name="inventory" size={12} />
        <span aria-hidden="true">{equipment.units === 0 ? "—" : `${equipment.dispatched}/${equipment.units}`}</span>
      </AdminBadge>
      <AdminBadge tone={depositTone} title={depositText} label={depositText}>
        <AdminIcon name="finance" size={12} />
        <span aria-hidden="true">{deposit === "paid" ? "✓" : deposit === "pending" ? "!" : "—"}</span>
      </AdminBadge>
      <AdminBadge tone={promoterTone} title={promoterText} label={promoterText}>
        <AdminIcon name="promoters" size={12} />
        <span aria-hidden="true">{promoters.count === 0 ? "—" : formatNumber(promoters.count)}</span>
      </AdminBadge>
    </span>
  );
}

/** Estado del evento más el aviso de «por cerrar» cuando ya pasó y sigue abierto. */
export function EventStateBadges({ item }: { item: EventItem }) {
  const { event, readiness } = item;
  return (
    <span className="admin-event-states">
      <AdminBadge tone={statusTone(event.status)}>{eventStatusLabel(event.status)}</AdminBadge>
      {readiness.phase === "ended" ? (
        <AdminBadge tone="warn" title="El evento ya pasó y todavía no se finalizó">Por cerrar</AdminBadge>
      ) : null}
    </span>
  );
}

function dateParts(value: string | null): { day: string; month: string } | null {
  if (!value) return null;
  const short = new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "short" }).formatToParts(new Date(value));
  const day = short.find((part) => part.type === "day")?.value;
  const month = short.find((part) => part.type === "month")?.value.replace(".", "");
  return day && month ? { day, month } : null;
}

/**
 * Tarjetas del evento (lista en celular y vista Tarjetas): la fecha destacada,
 * el nombre, el estado, la preparación y la siguiente acción. El detalle se abre
 * desde el cuerpo de la tarjeta; el pie lleva solo la acción lógica y «•••».
 */
export function EventCards({
  items,
  onOpen,
  renderActions,
}: {
  items: EventItem[];
  onOpen: (item: EventItem) => void;
  renderActions: (item: EventItem) => React.ReactNode;
}) {
  return (
    <ul className="admin-events-cards" aria-label="Eventos">
      {items.map((item) => {
        const { event, readiness } = item;
        const parts = dateParts(event.startsAt);
        const where = [event.location, event.city].filter(Boolean).join(" · ");
        const gap = readiness.gaps[0];
        const tone = itemTone(item);
        return (
          <li key={event.id} className="admin-events-card" data-tone={tone}>
            <button
              type="button"
              className="admin-events-card-main"
              onClick={() => onOpen(item)}
              aria-haspopup="dialog"
              aria-label={`Abrir el evento ${event.name}`}
            >
              <span className="admin-events-card-date" title={event.startsAt ? formatDateTime(event.startsAt) : "Fecha a confirmar"}>
                {parts ? (
                  <>
                    <strong>{parts.day}</strong>
                    <span>{parts.month}</span>
                    <small>{formatTime(event.startsAt)}</small>
                  </>
                ) : (
                  <small>A confirmar</small>
                )}
              </span>
              <span className="admin-events-card-body">
                <strong className="admin-events-card-name">{event.name}</strong>
                <span className="admin-events-card-sub">{clientDisplayName(event.client)}</span>
                <span className="admin-events-card-sub">{where || "Sin lugar definido"}</span>
              </span>
            </button>
            <div className="admin-events-card-meta">
              <EventStateBadges item={item} />
              {event.status === "IN_PROGRESS" || readiness.phase === "closed" || !event.startsAt ? null : (
                readiness.phase === "ended" ? null : <AdminCountdown value={event.startsAt} short title={`Cuánto falta para el inicio: ${event.name}`} />
              )}
            </div>
            <PrepChips item={item} />
            {gap ? (
              <p className="admin-events-card-gap" data-tone={gap.tone}>
                <AdminIcon name="alert" size={13} />
                <span>
                  {gap.label}
                  {readiness.gaps.length > 1 ? ` · +${readiness.gaps.length - 1} más` : ""}
                </span>
              </p>
            ) : null}
            <div className="admin-events-card-foot">{renderActions(item)}</div>
          </li>
        );
      })}
    </ul>
  );
}

/** Botón de la siguiente acción lógica; nada cuando no hay permiso o no hay paso pendiente. */
export function NextActionButton({
  item,
  onRun,
  busy,
}: {
  item: EventItem;
  onRun: (item: EventItem) => void;
  busy?: boolean;
}) {
  const next = item.readiness.next;
  if (!next) return null;
  return (
    <AdminButton
      className="admin-btn--next"
      icon={next.key === "finalize" ? "check" : next.key === "return" ? "checkin" : next.key === "dispatch" ? "arrow-right" : "audit"}
      busy={busy}
      title={`${next.label}: ${item.event.name}`}
      aria-label={`${next.label}: ${item.event.name}`}
      onClick={() => onRun(item)}
    >
      {next.label}
    </AdminButton>
  );
}
