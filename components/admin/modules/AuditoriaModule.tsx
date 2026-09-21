"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  auditActionLabel,
  auditActionTone,
  auditDetailLines,
  auditDetailText,
  auditEntityLabel,
  formatDate,
  formatNumber,
  formatTime,
} from "@/lib/admin-format";
import { AUDIT_ENTITIES } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { AdminIcon } from "../AdminIcons";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminKpi,
  AdminLoadingRows,
  AdminRow,
  AdminSearchField,
  AdminSelect,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { useAdminResource } from "../use-admin-data";

/**
 * Historial de cambios: quién hizo qué y con qué valores, con filtros por
 * entidad, actor, rango de fechas y búsqueda libre. El detalle se despliega
 * debajo de la fila (antes → después de los campos que cambiaron).
 *
 * Solo OWNER y ADMIN: el API responde 403 al resto (mismo criterio que
 * Usuarios) y acá directamente no se monta la vista ni se pide el historial.
 */

const ENTITY_OPTIONS = [
  { value: "ALL", label: "Todas las entidades" },
  ...AUDIT_ENTITIES.map((entity) => ({ value: entity, label: auditEntityLabel(entity) })),
];

const PAGE_SIZE_OPTIONS = [25, 50, 100].map((size) => ({ value: String(size), label: `${size} por página` }));

export function AuditoriaModule() {
  const { role, loading } = useAdminSession();
  if (loading) return <AdminLoadingRows rows={6} />;
  if (role !== "OWNER" && role !== "ADMIN") {
    return <AdminEmpty icon="audit" title="Acceso restringido" hint="Solo propietarios y administradores pueden ver el historial de cambios." />;
  }
  return <AuditoriaView />;
}

function AuditoriaView() {
  const [entityFilter, setEntityFilter] = useState("ALL");
  const [actorFilter, setActorFilter] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState("25");
  const [openId, setOpenId] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (entityFilter !== "ALL") params.set("entity", entityFilter);
    if (actorFilter !== "ALL") params.set("actor", actorFilter);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (debouncedQuery) params.set("q", debouncedQuery);
    params.set("page", String(page));
    params.set("pageSize", pageSize);
    return `/api/admin/audit?${params.toString()}`;
  }, [actorFilter, debouncedQuery, entityFilter, from, page, pageSize, to]);

  const audit = useAdminResource(path, (payload) => ({
    logs: payload.auditLogs ?? [],
    actors: payload.auditActors ?? [],
    total: payload.auditTotal ?? 0,
    page: payload.auditPage ?? 1,
    pageSize: payload.auditPageSize ?? 25,
  }));

  const logs = audit.data?.logs ?? [];
  const actors = useMemo(() => audit.data?.actors ?? [], [audit.data]);
  const total = audit.data?.total ?? 0;
  const currentPage = audit.data?.page ?? 1;
  const currentPageSize = audit.data?.pageSize ?? 25;
  const pageCount = Math.max(1, Math.ceil(total / currentPageSize));

  const actorOptions = useMemo(
    () => [
      { value: "ALL", label: "Todos los actores" },
      ...actors.map((actor) => ({ value: actor.id, label: `${actor.name} · ${actor.email}` })),
    ],
    [actors],
  );

  const filtersActive = entityFilter !== "ALL" || actorFilter !== "ALL" || Boolean(from) || Boolean(to) || Boolean(debouncedQuery);
  const newest = logs[0]?.createdAt;

  function updateFilter(apply: () => void) {
    apply();
    setPage(1);
    setOpenId("");
  }

  function clearFilters() {
    updateFilter(() => {
      setEntityFilter("ALL");
      setActorFilter("ALL");
      setFrom("");
      setTo("");
      setQuery("");
      setDebouncedQuery("");
    });
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de auditoría">
        <AdminKpi label="Registros" value={formatNumber(total)} note={filtersActive ? "según los filtros" : "histórico completo"} tone="accent" />
        <AdminKpi label="Página" value={`${formatNumber(currentPage)} / ${formatNumber(pageCount)}`} note={`${formatNumber(currentPageSize)} por página`} />
        <AdminKpi label="Actores" value={formatNumber(actors.length)} note="con actividad registrada" tone="ok" />
        <AdminKpi
          label="Última actividad"
          value={newest ? formatDate(newest) : "—"}
          note={newest ? `${formatTime(newest)} · página actual` : "sin movimientos"}
        />
      </section>

      <AdminToolbar>
        <AdminSearchField
          value={query}
          onChange={setQuery}
          label="Buscar en el historial"
          placeholder="Buscar por resumen, actor o id del registro…"
        />
        <AdminSelect
          value={entityFilter}
          onChange={(value) => updateFilter(() => setEntityFilter(value))}
          label="Filtrar por entidad"
          options={ENTITY_OPTIONS}
        />
        <AdminSelect
          value={actorFilter}
          onChange={(value) => updateFilter(() => setActorFilter(value))}
          label="Filtrar por actor"
          options={actorOptions}
        />
        <label className="admin-field admin-field--filter">
          <span className="admin-field-label">Desde</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(event) => updateFilter(() => setFrom(event.target.value))}
          />
        </label>
        <label className="admin-field admin-field--filter">
          <span className="admin-field-label">Hasta</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(event) => updateFilter(() => setTo(event.target.value))}
          />
        </label>
        <AdminSelect
          value={pageSize}
          onChange={(value) => updateFilter(() => setPageSize(value))}
          label="Registros por página"
          options={PAGE_SIZE_OPTIONS}
        />
        {filtersActive ? (
          <AdminButton icon="close" onClick={clearFilters}>
            Limpiar filtros
          </AdminButton>
        ) : null}
        <AdminButton icon="refresh" onClick={audit.reload} busy={audit.loading}>
          Actualizar
        </AdminButton>
      </AdminToolbar>

      <AdminDataState
        loading={audit.loading}
        error={audit.error}
        onRetry={audit.reload}
        empty={total === 0}
        emptyTitle={filtersActive ? "Sin resultados" : "Todavía no hay movimientos"}
        emptyHint={
          filtersActive
            ? "Probá con otro filtro o ampliá el rango de fechas."
            : "Cada alta, edición, cambio de estado o baja del panel queda registrada acá con su actor y fecha."
        }
        rows={6}
      >
        <AdminTable
          view="auditoria"
          label="Historial de cambios"
          columns={[
            { label: "Fecha y hora" },
            { label: "Actor" },
            { label: "Acción" },
            { label: "Entidad" },
            { label: "Resumen" },
            { label: "Detalle", end: true },
          ]}
        >
          {logs.map((log) => {
            const lines = auditDetailLines(log.entity, log.detail);
            const detailText = auditDetailText(log.entity, log.detail);
            const open = openId === log.id;
            return (
              <Fragment key={log.id}>
                <AdminRow>
                  <AdminCell title={`${formatDate(log.createdAt)} · ${formatTime(log.createdAt)}`}>
                    <span className="admin-nowrap">
                      {formatDate(log.createdAt)} · {formatTime(log.createdAt)}
                    </span>
                  </AdminCell>
                  <AdminCell title={`${log.actorName} · ${log.actorEmail}`}>
                    <strong>{log.actorName}</strong> <span className="admin-cell-sub">{log.actorEmail}</span>
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={auditActionTone(log.action)}>{auditActionLabel(log.action)}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={`${auditEntityLabel(log.entity)} · ${log.entityId}`}>
                    {auditEntityLabel(log.entity)} <span className="admin-code">#{log.entityId.slice(0, 8)}</span>
                  </AdminCell>
                  <AdminCell title={detailText ? `${log.summary} — ${detailText}` : log.summary}>{log.summary}</AdminCell>
                  <AdminCell end>
                    <button
                      type="button"
                      className="admin-iconbtn"
                      onClick={() => setOpenId(open ? "" : log.id)}
                      aria-expanded={open}
                      aria-controls={`audit-detail-${log.id}`}
                      title={open ? "Ocultar el detalle del cambio" : "Ver el detalle del cambio"}
                      aria-label={open ? "Ocultar el detalle del cambio" : "Ver el detalle del cambio"}
                    >
                      <AdminIcon name={open ? "close" : "info"} size={15} />
                    </button>
                  </AdminCell>
                </AdminRow>
                {open ? (
                  <div className="admin-audit-detail" id={`audit-detail-${log.id}`}>
                    {lines.length > 0 ? (
                      <dl className="admin-audit-lines">
                        {lines.map((line, index) => (
                          <div className="admin-audit-line" key={`${index}-${line.label}`}>
                            <dt>{line.label}</dt>
                            <dd>
                              {line.from !== undefined || line.to !== undefined ? (
                                <>
                                  <span className="admin-audit-from">{line.from}</span>
                                  <span className="admin-audit-arrow"> → </span>
                                  <span className="admin-audit-to">{line.to}</span>
                                </>
                              ) : (
                                <span className="admin-audit-to">{line.value}</span>
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="admin-muted">El cambio no registró campos con valores anteriores o nuevos.</p>
                    )}
                    <p className="admin-audit-meta">
                      Registro: <span className="admin-code">{log.entityId}</span> · {formatDate(log.createdAt)} ·{" "}
                      {formatTime(log.createdAt)}
                    </p>
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </AdminTable>

        <div className="admin-audit-pager">
          <AdminButton disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} title="Página anterior" aria-label="Página anterior">
            Anterior
          </AdminButton>
          <span className="admin-audit-pager-info">
            Página {formatNumber(currentPage)} de {formatNumber(pageCount)} · {formatNumber(total)} registro{total === 1 ? "" : "s"}
          </span>
          <AdminButton
            icon="arrow-right"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
            title="Página siguiente"
            aria-label="Página siguiente"
          >
            Siguiente
          </AdminButton>
        </div>
      </AdminDataState>
    </div>
  );
}
