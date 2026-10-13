"use client";

import { useMemo, useState } from "react";
import { kpiState } from "@/components/admin/kpi-state";
import { useAdminResource } from "@/lib/admin-api";
import { formatDateTime, formatNumber } from "@/lib/admin-format";
import { canManageTrash } from "@/lib/admin-policy";
import {
  TRASH_ENTITIES,
  TRASH_NO_ONE,
  canOfferAnonymize,
  filterTrashItems,
  formatBlockers,
  isTrashEntityType,
  type TrashEntityType,
  type TrashItem,
} from "@/lib/trash-shared";
import { useAdminSession } from "../AdminShell";
import { useAdminNarrowViewport } from "../AdminBoard";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import { AdminIcon } from "../AdminIcons";
import { DayField } from "../AdminFields";
import { AdminBadge, AdminButton, AdminCell, AdminDataState, AdminEmpty, AdminKpi, AdminKpis, AdminLoadingRows, AdminNote, AdminRow, AdminSelect, AdminTable, AdminToolbar } from "../AdminUI";
import { TrashBlockersNote, TrashDialog, runTrashAction, type TrashDialogMode } from "../TrashDialogs";

/**
 * Ajustes → Eliminados (docs/PAPELERA.md §UI): lo que se mandó a la papelera, con quién y
 * cuándo, el motivo y los bloqueos del borrado definitivo. Restaurar vuelve a «archivado».
 * Solo OWNER y ADMIN (`trash.manage`): el servidor responde 403 al resto y acá ni se pide.
 */

type Target = { mode: TrashDialogMode; item: TrashItem; type: TrashEntityType };

export function EliminadosModule() {
  const { role, loading } = useAdminSession();
  if (loading) return <AdminLoadingRows rows={6} />;
  if (!canManageTrash(role)) {
    return <AdminEmpty icon="trash" title="Acceso restringido" hint="Solo propietarios y administradores pueden ver lo eliminado." />;
  }
  return <EliminadosView />;
}

const typeLabel = (type: string) => (isTrashEntityType(type) ? TRASH_ENTITIES[type].typeLabel : type);

function EliminadosView() {
  const compact = useAdminNarrowViewport();
  const trash = useAdminResource("/api/admin/trash", (payload) => (payload as unknown as { items?: TrashItem[] }).items ?? []);
  const [type, setType] = useState("ALL");
  const [by, setBy] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const all = useMemo(() => trash.data ?? [], [trash.data]);
  const rows = useMemo(() => filterTrashItems(all, { type, by, from, to }), [all, type, by, from, to]);
  const filtersActive = type !== "ALL" || by !== "ALL" || Boolean(from) || Boolean(to);

  const typeOptions = useMemo(
    () => [
      { value: "ALL", label: "Todos los tipos" },
      ...Object.entries(TRASH_ENTITIES).map(([value, entity]) => ({ value, label: entity.typeLabel })),
    ],
    [],
  );
  const byOptions = useMemo(() => {
    const people = new Map<string, string>();
    for (const item of all) people.set(item.deletedById ?? TRASH_NO_ONE, item.deletedByName ?? "Sin registrar");
    return [{ value: "ALL", label: "Todas las personas" }, ...Array.from(people, ([value, label]) => ({ value, label }))];
  }, [all]);

  function clearFilters() {
    setType("ALL");
    setBy("ALL");
    setFrom("");
    setTo("");
  }

  async function restore(item: TrashItem) {
    if (!isTrashEntityType(item.type) || busyKey) return;
    setBusyKey(`${item.type}:${item.id}`);
    setMessage(null);
    const result = await runTrashAction(item.type, item.id, "restore");
    setBusyKey("");
    if (!result.ok) {
      setMessage({ tone: "error", text: result.error });
      return;
    }
    setMessage({ tone: "ok", text: `«${item.name}» volvió a archivados.` });
    trash.reload();
  }

  const key = (item: TrashItem) => `${item.type}:${item.id}`;
  const blockersText = (item: TrashItem) => formatBlockers(item.blockers).join(" · ");

  /** Restaurar + la acción definitiva que corresponde (eliminar, anonimizar o ninguna si no se puede). */
  function actions(item: TrashItem) {
    if (!isTrashEntityType(item.type)) return null;
    const entityType = item.type;
    if (item.anonymized) return <span className="admin-muted">Anonimizado</span>;
    const hasBlockers = item.blockers.length > 0;
    const anonymizable = canOfferAnonymize(item.type, item.blockers);
    const busy = busyKey === key(item);
    return (
      <span className="admin-actions">
        <AdminButton
          icon="refresh"
          busy={busy}
          disabled={Boolean(busyKey) && !busy}
          title={`Restaurar ${item.name}: vuelve a archivados`}
          aria-label={`Restaurar ${item.name}`}
          onClick={() => void restore(item)}
        >
          Restaurar
        </AdminButton>
        {hasBlockers && anonymizable ? (
          <AdminButton icon="user" title={`Anonimizar ${item.name}: ${blockersText(item)}`} aria-label={`Anonimizar ${item.name}`} onClick={() => setTarget({ mode: "anonymize", item, type: entityType })}>
            Anonimizar
          </AdminButton>
        ) : (
          <AdminButton
            icon="trash"
            disabled={hasBlockers}
            title={hasBlockers ? `No se puede eliminar definitivamente: ${blockersText(item)}` : `Eliminar definitivamente ${item.name}`}
            aria-label={`Eliminar definitivamente ${item.name}`}
            onClick={() => setTarget({ mode: "purge", item, type: entityType })}
          >
            Eliminar
          </AdminButton>
        )}
      </span>
    );
  }

  const blockersCell = (item: TrashItem) =>
    item.blockers.length === 0 ? (
      <AdminBadge tone="ok">Sin bloqueos</AdminBadge>
    ) : (
      <span title={blockersText(item)}>{blockersText(item)}</span>
    );

  const cards: AdminCardData[] = rows.map((item) => ({
    id: key(item),
    title: item.name,
    subtitle: typeLabel(item.type),
    badges: item.anonymized ? [{ label: "Anonimizado", tone: "neutral" as const }] : [],
    fields: [
      { label: "Eliminado por", value: item.deletedByName ?? "Sin registrar" },
      { label: "Fecha", value: formatDateTime(item.deletedAt) },
      { label: "Motivo", value: item.reason ?? "—" },
      { label: "Bloqueos", value: item.blockers.length ? <TrashBlockersNote blockers={item.blockers} /> : "Sin bloqueos" },
    ],
    footer: actions(item),
  }));

  return (
    <div className="admin-module-page">
      <AdminKpis state={kpiState(trash)} label="Indicadores de la papelera">
        <AdminKpi label="Eliminados" icon="trash" value={formatNumber(all.length)} note={filtersActive ? `${formatNumber(rows.length)} según los filtros` : "en la papelera"} tone="accent" />
        <AdminKpi label="Con bloqueos" icon="alert" value={formatNumber(all.filter((item) => item.blockers.length > 0).length)} note="no se pueden borrar de forma definitiva" />
      </AdminKpis>

      <AdminToolbar>
        <AdminSelect value={type} onChange={setType} label="Filtrar por tipo" options={typeOptions} />
        <AdminSelect value={by} onChange={setBy} label="Filtrar por quién lo eliminó" options={byOptions} />
        <div className="admin-field--filter">
          <DayField label="Desde" max={to || undefined} value={from} onChange={setFrom} />
        </div>
        <div className="admin-field--filter">
          <DayField label="Hasta" min={from || undefined} value={to} onChange={setTo} />
        </div>
        {filtersActive ? (
          <AdminButton icon="close" onClick={clearFilters}>
            Limpiar filtros
          </AdminButton>
        ) : null}
        <AdminButton icon="refresh" onClick={trash.reload} busy={trash.loading}>
          Actualizar
        </AdminButton>
      </AdminToolbar>

      {message ? <AdminNote tone={message.tone}>{message.text}</AdminNote> : null}

      <AdminDataState
        loading={trash.loading}
        error={trash.error}
        onRetry={trash.reload}
        empty={all.length === 0}
        emptyTitle="La papelera está vacía"
        emptyIcon="trash"
        emptyHint="Lo que elimines desde Eventos o Inventario aparece acá, donde se puede restaurar."
        rows={5}
      >
        {rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro filtro o ampliá el rango de fechas." />
        ) : compact ? (
          <AdminCardGrid label="Eliminados" cards={cards} />
        ) : (
          <AdminTable
            view="eliminados"
            label="Eliminados"
            columns={[
              { label: "Tipo" },
              { label: "Nombre" },
              { label: "Eliminado por" },
              { label: "Fecha" },
              { label: "Motivo" },
              { label: "Bloqueos" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((item) => (
              <AdminRow key={key(item)}>
                <AdminCell title={typeLabel(item.type)}>
                  <span className="admin-trash-type">
                    {isTrashEntityType(item.type) ? <AdminIcon name={TRASH_ENTITIES[item.type].icon} size={14} /> : null}
                    {typeLabel(item.type)}
                  </span>
                </AdminCell>
                <AdminCell title={item.name}>
                  <strong>{item.name}</strong>
                </AdminCell>
                <AdminCell title={item.deletedByName ?? "Sin registrar"}>{item.deletedByName ?? "—"}</AdminCell>
                <AdminCell title={formatDateTime(item.deletedAt)}>
                  <span className="admin-nowrap">{formatDateTime(item.deletedAt)}</span>
                </AdminCell>
                <AdminCell title={item.reason ?? "Sin motivo"}>{item.reason ?? "—"}</AdminCell>
                <AdminCell title={blockersText(item)}>{blockersCell(item)}</AdminCell>
                <AdminCell end>{actions(item)}</AdminCell>
              </AdminRow>
            ))}
          </AdminTable>
        )}
      </AdminDataState>

      {target ? (
        <TrashDialog
          mode={target.mode}
          type={target.type}
          id={target.item.id}
          name={target.item.name}
          initialBlockers={target.item.blockers}
          onClose={() => setTarget(null)}
          onDone={(text) => {
            setTarget(null);
            setMessage({ tone: "ok", text });
            trash.reload();
          }}
        />
      ) : null}
    </div>
  );
}
