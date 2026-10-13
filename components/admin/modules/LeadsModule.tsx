"use client";

import { kpiState } from "@/components/admin/kpi-state";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  billingUnitLabel,
  budgetReference,
  budgetStatusLabel,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  leadSourceLabel,
  leadStatusLabel,
  statusTone,
} from "@/lib/admin-format";
import type { AdminLeadItem, AdminLeadRow } from "@/lib/admin-types";
import { canWriteBudgets, canWriteClients, canWriteOperations, matchesQuery } from "@/lib/admin-policy";
import { CONVERTIBLE_STATUSES, isQuoteRequestStatus, quoteRequestStatusLabel } from "@/lib/catalog-public";
import { useAdminSession } from "../AdminShell";
import { AdminBoard, AdminViewSwitch, useAdminBoardMove, useAdminModuleView, useAdminNarrowViewport, type AdminBoardCardData, type AdminBoardColumn } from "../AdminBoard";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import {
  AdminActionsMenu,
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDialog,
  AdminDialogSection,
  AdminDataState,
  AdminEmpty,
  AdminIconLink,
  AdminKpi,
  AdminKpis,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
  AdminToolbar,
  AdminWhatsappLink,
  type AdminMenuItem,
} from "../AdminUI";
import { CheckboxField, SearchField, SelectField, TextAreaField } from "../AdminFields";
import { LeadQuickDialog } from "./LeadQuickForm";
import { AdminIcon } from "../AdminIcons";
import { adminSend, requestAdminRefresh, useAdminResource } from "@/lib/admin-api";

const STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "NEW", label: "Nuevos" },
  { value: "CONTACTED", label: "Contactados" },
  { value: "QUOTED", label: "Cotizados" },
  { value: "WON", label: "Ganados" },
  { value: "LOST", label: "Perdidos" },
];

const STATUS_OPTIONS = [
  { value: "NEW", label: "Nuevo" },
  { value: "CONTACTED", label: "Contactado" },
  { value: "QUOTED", label: "Cotizado" },
  { value: "WON", label: "Ganado" },
  { value: "LOST", label: "Perdido" },
];

/** Tablero kanban: una columna por estado del pipeline (sin máquina de estados). */
const BOARD_COLUMNS: AdminBoardColumn[] = STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

/** Total de un ítem: subtotal del sitio o precio unitario por cantidad y días. */
function itemTotal(item: AdminLeadItem): number | null {
  if (item.subtotal !== null) return item.subtotal;
  if (item.unitPrice !== null) return item.unitPrice * item.quantity * (item.duration ?? 1);
  return null;
}

/** Suma estimada de los pedidos del lead; `null` si ningún pedido trae importes. */
function leadEstimatedTotal(lead: AdminLeadRow): number | null {
  let total = 0;
  let hasAmount = false;
  for (const quote of lead.quoteRequests) {
    const itemsTotal = quote.items.reduce((sum, item) => sum + (itemTotal(item) ?? 0), 0);
    if (itemsTotal > 0) {
      total += itemsTotal;
      hasAmount = true;
      continue;
    }
    if (quote.referenceTotal !== null) {
      total += quote.referenceTotal;
      hasAmount = true;
    }
  }
  return hasAmount ? total : null;
}

function leadItemCount(lead: AdminLeadRow): number {
  return lead.quoteRequests.reduce((sum, quote) => sum + quote.items.length, 0);
}

const QUOTE_TONE: Record<string, "neutral" | "accent" | "ok" | "warn" | "danger" | "info"> = {
  NEW: "accent",
  REVIEWING: "info",
  QUOTED: "warn",
  CONVERTED: "ok",
  DECLINED: "danger",
  EXPIRED: "neutral",
};

type ConvertResult = {
  budget: { id: string; title: string; total: number };
  deposit: { percent: number | null; amount: number };
  unpricedLines: number;
  hold: { ok: true; held: number; hours: number } | { ok: false; error: string } | null;
};

type LeadMutation = { lead: AdminLeadRow; client: { id: string; name: string; company: string | null } | null; clientCreated: boolean };

export function LeadsModule() {
  const { role } = useAdminSession();
  const leads = useAdminResource("/api/leads", (payload) => payload.leads ?? []);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selectedId, setSelectedId] = useState("");
  const [draftStatus, setDraftStatus] = useState("NEW");
  const [draftNotes, setDraftNotes] = useState("");
  const [saving, setSaving] = useState(false);
  /** Ventana «Editar seguimiento» (estado y notas); el detalle queda como vista de lectura. */
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpError, setFollowUpError] = useState("");
  const followUpFormId = useId();
  const [converting, setConverting] = useState(false);
  /** Pedido del catálogo que se está convirtiendo o al que se le retiene stock. */
  const [quoteBusy, setQuoteBusy] = useState("");
  const [holdOnConvert, setHoldOnConvert] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const [boardError, setBoardError] = useState("");
  const [view, setView] = useAdminModuleView("leads");
  /** Ancho compacto (issue #151): pestañas de estado y tarjetas, sin tablero. */
  const narrow = useAdminNarrowViewport();

  const writable = canWriteClients(role);
  const budgetWritable = canWriteBudgets(role);
  const holdWritable = canWriteOperations(role);
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadParam = searchParams.get("lead")?.trim() ?? "";
  // Enlaces del Resumen y del menú: `?estado=NEW` abre la lista filtrada y
  // `?nuevo=1` abre el alta manual.
  const estadoParam = (searchParams.get("estado") ?? "").trim().toUpperCase();
  const newRequested = searchParams.get("nuevo") === "1";
  const [newOpen, setNewOpen] = useState(false);
  useEffect(() => {
    if (STATUS_OPTIONS.some((option) => option.value === estadoParam)) setStatus(estadoParam);
  }, [estadoParam]);
  useEffect(() => {
    if (newRequested && writable) setNewOpen(true);
  }, [newRequested, writable]);
  const closeNew = useCallback(() => {
    setNewOpen(false);
    if (newRequested) router.replace("/leads");
  }, [newRequested, router]);
  const list = useMemo(() => leads.data ?? [], [leads.data]);

  const searched = useMemo(
    () =>
      list.filter((lead) =>
        matchesQuery(query, [lead.name, lead.company, lead.email, lead.phone, lead.ruc, lead.reason, lead.location, lead.message]),
      ),
    [list, query],
  );

  const rows = useMemo(
    () => searched.filter((lead) => (status === "ALL" ? true : lead.status === status)),
    [searched, status],
  );

  /** Conteo por estado para las pestañas (issue #151). */
  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of list) counts.set(lead.status, (counts.get(lead.status) ?? 0) + 1);
    return counts;
  }, [list]);

  // Movimiento del tablero: PATCH real, optimista con revert si el API rechaza.
  // El tablero respeta la búsqueda y la pestaña de estado (issue #151).
  const moveLead = useCallback(async (lead: AdminLeadRow, nextStatus: string) => {
    setBoardError("");
    const result = await adminSend<LeadMutation>("/api/leads", { id: lead.id, status: nextStatus }, "PATCH");
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }, []);
  const board = useAdminBoardMove({ rows, move: moveLead, onError: setBoardError });

  const boardCards = useMemo<AdminBoardCardData[]>(
    () =>
      board.rows.map((lead) => {
        const name = lead.company || lead.name;
        const items = leadItemCount(lead);
        const estimated = leadEstimatedTotal(lead);
        const eventLabel = [lead.eventDate ? formatDateShort(lead.eventDate) : null, lead.location || null].filter(Boolean).join(" · ");
        return {
          id: lead.id,
          status: lead.status,
          title: name,
          subtitle: [lead.company ? lead.name : null, lead.phone].filter(Boolean).join(" · ") || lead.email,
          amount: estimated,
          amountNote: estimated === null ? null : "estimado",
          date: lead.eventDate,
          dateTitle: `Evento de ${lead.name}: cuánto falta`,
          detail:
            [items === 0 ? "Sin pedido del sitio" : `${formatNumber(items)} ítems pedidos`, lead.reason || null, eventLabel || null]
              .filter(Boolean)
              .join(" · "),
          actions: (
            <>
              <AdminButton
                icon="info"
                onClick={() => openDetail(lead)}
                aria-label={`Ver detalle del lead: ${lead.name}`}
                title={`Ver detalle del lead: ${lead.name}`}
              />
              <AdminWhatsappLink phone={lead.phone} name={lead.name} />
            </>
          ),
        };
      }),
    [board.rows],
  );

  /**
   * Tarjetas del ancho compacto (issue #151): entidad, estado, fecha del evento
   * y monto estimado, con el detalle y el correo en el menú «⋯».
   */
  const leadCards = useMemo<AdminCardData[]>(
    () =>
      rows.map((lead) => {
        const name = lead.company || lead.name;
        const items = leadItemCount(lead);
        const estimated = leadEstimatedTotal(lead);
        const eventLabel = [lead.eventDate ? formatDateShort(lead.eventDate) : null, lead.location || null].filter(Boolean).join(" · ");
        const menuItems: AdminMenuItem[] = [
          { label: "Ver detalle", icon: "info", onClick: () => openDetail(lead), title: `Ver detalle del lead: ${lead.name}` },
          ...(lead.email
            ? [{ label: "Enviar correo", icon: "mail" as const, href: `mailto:${lead.email}`, title: `Enviar correo a ${lead.name}` }]
            : []),
        ];
        return {
          id: lead.id,
          title: name,
          titleTooltip: `${lead.name}${lead.company ? ` · ${lead.company}` : ""}`,
          subtitle: [lead.company ? lead.name : null, lead.phone].filter(Boolean).join(" · ") || lead.email,
          badges: [
            { label: leadStatusLabel(lead.status), tone: statusTone(lead.status) },
            { label: leadSourceLabel(lead.source), tone: "neutral" },
          ],
          fields: [
            {
              label: "Ingreso",
              value: <span className="admin-nowrap">{formatDateShort(lead.createdAt)}</span>,
              title: `Ingresó el ${formatDateTime(lead.createdAt)}`,
            },
            {
              label: "Evento",
              value: eventLabel || "—",
              title: eventLabel || "El lead no cargó fecha ni lugar del evento",
            },
            ...(lead.eventDate
              ? [
                  {
                    label: "Falta",
                    value: (
                      <AdminCountdown
                        value={lead.eventDate}
                        short
                        className="admin-countdown--inline"
                        title={`Evento de ${name}: cuánto falta`}
                      />
                    ),
                    title: `Evento de ${name}: ${formatDate(lead.eventDate)}`,
                  },
                ]
              : []),
            {
              label: "Cotización",
              value:
                items === 0 ? (
                  "Sin pedido"
                ) : estimated === null ? (
                  `${formatNumber(items)} ítems`
                ) : (
                  <strong>{formatMoney(estimated)}</strong>
                ),
              title:
                items === 0
                  ? "El lead no dejó un pedido de productos"
                  : estimated === null
                    ? `${items} ítems pedidos, sin precios en el sitio`
                    : `${items} ítems pedidos por un total estimado de ${formatMoney(estimated)}`,
            },
          ],
          footer: (
            <span className="admin-actions">
              <AdminWhatsappLink phone={lead.phone} name={lead.name} />
              <AdminActionsMenu label={`Acciones del lead ${lead.name}`} items={menuItems} />
            </span>
          ),
        };
      }),
    [rows],
  );

  const selected = useMemo(() => list.find((lead) => lead.id === selectedId) ?? null, [list, selectedId]);

  const totals = useMemo(
    () => ({
      total: list.length,
      new: list.filter((lead) => lead.status === "NEW").length,
      quoted: list.filter((lead) => lead.status === "QUOTED").length,
      won: list.filter((lead) => lead.status === "WON").length,
    }),
    [list],
  );

  function openDetail(lead: AdminLeadRow) {
    setSelectedId(lead.id);
    setDraftStatus(lead.status);
    setDraftNotes(lead.internalNotes ?? "");
    setDetailError("");
    setNotice("");
  }

  // Enlace desde un presupuesto (`/leads?lead=<id>`): abre el detalle una vez cargada la lista.
  useEffect(() => {
    if (!leadParam || selectedId === leadParam) return;
    const target = (leads.data ?? []).find((lead) => lead.id === leadParam);
    if (target) openDetail(target);
    // openDetail solo escribe estado local; depender de la lista alcanza.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadParam, leads.data]);

  function closeDetail() {
    setSelectedId("");
    setDetailError("");
    setFollowUpOpen(false);
  }

  function openFollowUp() {
    if (!selected) return;
    setDraftStatus(selected.status);
    setDraftNotes(selected.internalNotes ?? "");
    setFollowUpError("");
    setFollowUpOpen(true);
  }

  async function saveDetail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    if (saving) return;
    setSaving(true);
    setFollowUpError("");
    setNotice("");
    const result = await adminSend<LeadMutation>("/api/leads", { id: selected.id, status: draftStatus, internalNotes: draftNotes }, "PATCH");
    setSaving(false);
    if (!result.ok) {
      setFollowUpError(result.error);
      return;
    }
    setFollowUpOpen(false);
    setNotice(`Lead de ${selected.name} actualizado.`);
    requestAdminRefresh();
  }

  async function convertToClient() {
    if (!selected) return;
    setConverting(true);
    setDetailError("");
    setNotice("");
    const result = await adminSend<LeadMutation>("/api/leads", { id: selected.id, convertToClient: true }, "PATCH");
    setConverting(false);
    if (!result.ok) {
      setDetailError(result.error);
      return;
    }
    const client = result.data.client;
    const label = client ? client.company || client.name : selected.name;
    setNotice(
      result.data.clientCreated
        ? `Cliente «${label}» creado desde el lead; quedó en estado Ganado.`
        : `El cliente «${label}» ya existía: se reutilizó sin duplicar y el lead quedó Ganado.`,
    );
    leads.reload();
  }

  async function convertQuote(quoteId: string) {
    setQuoteBusy(quoteId);
    setDetailError("");
    setNotice("");
    const result = await adminSend<ConvertResult>(`/api/admin/quote-requests/${encodeURIComponent(quoteId)}/convert`, { hold: holdOnConvert && holdWritable }, "POST");
    setQuoteBusy("");
    if (!result.ok) {
      setDetailError(result.error);
      leads.reload();
      return;
    }
    const { budget, deposit, hold, unpricedLines } = result.data;
    const parts = [
      `Creamos el presupuesto «${budget.title}» (${formatMoney(budget.total)}) en borrador.`,
      deposit.percent ? `Seña del ${deposit.percent} %: ${formatMoney(deposit.amount)}.` : "La empresa no tiene política de seña: sin seña.",
      unpricedLines > 0 ? `${unpricedLines} ${unpricedLines === 1 ? "línea quedó" : "líneas quedaron"} sin precio: completalas antes de enviar.` : "",
      hold ? (hold.ok ? `Retuvimos el stock por ${hold.hours} h.` : `No pudimos retener el stock: ${hold.error}`) : "",
    ];
    setNotice(parts.filter(Boolean).join(" "));
    leads.reload();
  }

  async function holdQuote(quoteId: string) {
    setQuoteBusy(quoteId);
    setDetailError("");
    setNotice("");
    const result = await adminSend<{ held: number; hours: number }>(`/api/admin/quote-requests/${encodeURIComponent(quoteId)}/hold`, {}, "POST");
    setQuoteBusy("");
    if (!result.ok) {
      setDetailError(result.error);
      return;
    }
    setNotice(`Retuvimos el stock por ${result.data.hours} h (${result.data.held} artículos). Si no se confirma, se libera solo.`);
    leads.reload();
  }

  async function setQuoteStatus(quoteId: string, next: string) {
    setQuoteBusy(quoteId);
    setDetailError("");
    const result = await adminSend<{ quoteRequest: { id: string; status: string } }>(`/api/admin/quote-requests/${encodeURIComponent(quoteId)}`, { status: next }, "PATCH");
    setQuoteBusy("");
    if (!result.ok) {
      setDetailError(result.error);
      return;
    }
    leads.reload();
  }

  return (
    <div className="admin-module-page">
      <AdminKpis state={kpiState(leads)} label="Indicadores de leads">
        <AdminKpi label="Leads" icon="leads" value={formatNumber(totals.total)} note="últimos 100 ingresos" />
        <AdminKpi label="Nuevos" icon="plus" value={formatNumber(totals.new)} note="por contactar" tone={totals.new > 0 ? "accent" : undefined} />
        <AdminKpi label="Cotizados" icon="budgets" value={formatNumber(totals.quoted)} note="en pipeline" tone={totals.quoted > 0 ? "warn" : undefined} />
        <AdminKpi label="Ganados" icon="check" value={formatNumber(totals.won)} note="convertidos en cliente" tone={totals.won > 0 ? "ok" : undefined} />
      </AdminKpis>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar leads"
          placeholder="Buscar por nombre, empresa, contacto o motivo…"
        />
        {narrow ? null : <AdminViewSwitch view={view} onChange={setView} label="Vista de leads" />}
        {writable ? (
          <AdminButton variant="primary" icon="plus" type="button" onClick={() => setNewOpen(true)}>
            Nuevo lead
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {newOpen ? (
        <LeadQuickDialog
          onClose={closeNew}
          onCreated={(name) => {
            closeNew();
            setNotice(`Lead de ${name} cargado: quedó como Nuevo para contactar.`);
            leads.reload();
          }}
        />
      ) : null}

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {boardError ? <AdminNote tone="error">{boardError}</AdminNote> : null}

      {/* Pestañas de estado (issue #151): encima de la lista y del tablero; en
          ancho compacto reemplazan al Kanban, que quedaba cortado en 390. */}
      <nav className="admin-subtabs" aria-label="Filtrar leads por estado">
        <button
          type="button"
          className="admin-subtab"
          data-active={status === "ALL" ? "true" : undefined}
          aria-pressed={status === "ALL"}
          onClick={() => setStatus("ALL")}
        >
          Todos
          <span className="admin-subtab-count">{formatNumber(list.length)}</span>
        </button>
        {STATUS_FILTER_OPTIONS.slice(1).map((option) => (
          <button
            key={option.value}
            type="button"
            className="admin-subtab"
            data-active={status === option.value ? "true" : undefined}
            aria-pressed={status === option.value}
            onClick={() => setStatus(option.value)}
          >
            {option.label}
            <span className="admin-subtab-count">{formatNumber(statusCounts.get(option.value) ?? 0)}</span>
          </button>
        ))}
      </nav>

      <AdminDataState
        loading={leads.loading}
        error={leads.error}
        onRetry={leads.reload}
        empty={list.length === 0}
        emptyTitle="Todavía no hay leads" emptyIcon="leads"
        emptyHint="Cuando alguien pida una cotización desde el sitio, el lead entra acá con su pedido y datos de contacto."
      >
        {narrow ? (
          rows.length === 0 ? (
            <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá la pestaña de estado." />
          ) : (
            <AdminCardGrid label="Leads" cards={leadCards} />
          )
        ) : view === "board" ? (
          rows.length === 0 ? (
            <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá la pestaña de estado." />
          ) : (
            <AdminBoard
              label="Leads"
              columns={BOARD_COLUMNS}
              cards={boardCards}
              canMove={writable}
              movingIds={board.movingIds}
              onMove={writable ? board.moveTo : undefined}
            />
          )
        ) : rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
        ) : (
          <AdminTable
            view="leads"
            label="Leads"
            columns={[
              { label: "Ingreso" },
              { label: "Lead" },
              { label: "Contacto" },
              { label: "Origen" },
              { label: "Evento" },
              { label: "Motivo" },
              { label: "Cotización", end: true },
              { label: "Estado" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((lead) => {
              const name = lead.company || lead.name;
              const items = leadItemCount(lead);
              const estimated = leadEstimatedTotal(lead);
              const eventLabel = [
                lead.eventDate ? formatDateShort(lead.eventDate) : null,
                lead.location || null,
              ]
                .filter(Boolean)
                .join(" · ");
              return (
                <AdminRow key={lead.id}>
                  <AdminCell title={`Ingresó el ${formatDateTime(lead.createdAt)}`}>
                    <span className="admin-nowrap">{formatDateShort(lead.createdAt)}</span>
                  </AdminCell>
                  <AdminCell title={`${lead.name}${lead.company ? ` · ${lead.company}` : ""}`}>
                    <strong>{name}</strong>
                    {lead.company ? <small className="admin-cell-sub"> · {lead.name}</small> : null}
                  </AdminCell>
                  <AdminCell title={[lead.phone, lead.email].filter(Boolean).join(" · ")}>
                    {[lead.phone, lead.email].filter(Boolean).join(" · ")}
                  </AdminCell>
                  <AdminCell title={`Origen: ${leadSourceLabel(lead.source)}`}>{leadSourceLabel(lead.source)}</AdminCell>
                  <AdminCell title={eventLabel || "El lead no cargó fecha ni lugar del evento"}>
                    {eventLabel || "—"}
                    <AdminCountdown
                      value={lead.eventDate}
                      short
                      className="admin-countdown--inline"
                      title={`Evento de ${name}: cuánto falta`}
                    />
                  </AdminCell>
                  <AdminCell title={lead.reason || "Sin motivo indicado"}>{lead.reason || "—"}</AdminCell>
                  <AdminCell
                    end
                    title={
                      items === 0
                        ? "El lead no dejó un pedido de productos"
                        : estimated === null
                          ? `${items} ítems pedidos, sin precios en el sitio`
                          : `${items} ítems pedidos por un total estimado de ${formatMoney(estimated)}`
                    }
                  >
                    {items === 0 ? (
                      <span className="admin-muted">Sin pedido</span>
                    ) : estimated === null ? (
                      <span className="admin-muted">{formatNumber(items)} ítems</span>
                    ) : (
                      <strong>{formatMoney(estimated)}</strong>
                    )}
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={statusTone(lead.status)}>{leadStatusLabel(lead.status)}</AdminBadge>
                  </AdminCell>
                  <AdminCell end>
                    <span className="admin-actions">
                      <AdminButton
                        icon="info"
                        onClick={() => openDetail(lead)}
                        aria-label={`Ver detalle del lead: ${lead.name}`}
                        title={`Ver detalle del lead: ${lead.name}`}
                      />
                      <AdminWhatsappLink phone={lead.phone} name={lead.name} />
                      {lead.email ? <AdminIconLink href={`mailto:${lead.email}`} icon="mail" label={`Enviar correo a ${lead.name}`} /> : null}
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>

      {selected ? (
        <AdminPanel
          title={`Lead · ${selected.name}`} icon="leads"
          meta={`Ingresó el ${formatDateTime(selected.createdAt)} · ${leadSourceLabel(selected.source)}`}
          action={
            <AdminButton icon="close" onClick={closeDetail} aria-label="Cerrar el detalle del lead" title="Cerrar el detalle del lead" />
          }
        >
          <div className="admin-detail">
            <dl className="admin-detail-grid">
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Contacto</dt>
                <dd className="admin-detail-value">
                  {selected.phone}
                  {selected.email ? <span className="admin-cell-sub"> · {selected.email}</span> : null}
                </dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Empresa</dt>
                <dd className="admin-detail-value">{selected.company || "—"}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">RUC / CI</dt>
                <dd className="admin-detail-value">{selected.ruc || "—"}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Motivo</dt>
                <dd className="admin-detail-value">{selected.reason || "—"}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Fecha del evento</dt>
                <dd className="admin-detail-value">
                  {selected.eventDate ? formatDate(selected.eventDate) : "Sin fecha"}
                  <AdminCountdown
                    value={selected.eventDate}
                    className="admin-countdown--inline"
                    title={`Evento de ${selected.name}: cuánto falta`}
                  />
                </dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Ubicación</dt>
                <dd className="admin-detail-value">{selected.location || "—"}</dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Estado</dt>
                <dd className="admin-detail-value">
                  <AdminBadge tone={statusTone(selected.status)}>{leadStatusLabel(selected.status)}</AdminBadge>
                  <span className="admin-cell-sub"> · actualizado el {formatDateTime(selected.updatedAt)}</span>
                </dd>
              </div>
              <div className="admin-detail-item">
                <dt className="admin-detail-label">Consentimiento</dt>
                <dd className="admin-detail-value">{formatDateTime(selected.consentAt)}</dd>
              </div>
            </dl>

            <div className="admin-detail-section">
              <p className="admin-detail-section-title">
                <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                  <AdminIcon name="mail" size={11} />
                </span>
                Mensaje del lead
              </p>
              {selected.message ? <p className="admin-detail-text">{selected.message}</p> : <p className="admin-muted">El lead no dejó un mensaje.</p>}
            </div>

            <div className="admin-detail-section">
              <p className="admin-detail-section-title">
                <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                  <AdminIcon name="inventory" size={11} />
                </span>
                Productos de interés
              </p>
              {selected.quoteRequests.length === 0 ? (
                <AdminEmpty icon="leads" title="Sin pedido del sitio" hint="El lead consultó sin productos cargados en el cotizador." />
              ) : (
                selected.quoteRequests.map((quote) => (
                  <div className="admin-detail-quote" key={quote.id}>
                    <p className="admin-detail-quote-meta">
                      Pedido del {formatDate(quote.createdAt)} · {leadSourceLabel(quote.source)} · {formatNumber(quote.items.length)} ítems
                    </p>
                    {quote.source === "catalogo" ? (
                      <div className="admin-detail-quote-status" data-testid="catalog-order">
                        <p>
                          <AdminBadge tone={QUOTE_TONE[quote.status ?? "NEW"] ?? "neutral"}>{quoteRequestStatusLabel(quote.status)}</AdminBadge>
                          {quote.priceList === "WHOLESALE" ? <AdminBadge tone="accent" title="Pedido del catálogo mayorista: vinculado al cliente del link y con precios mayoristas">Mayorista</AdminBadge> : null}
                          {quote.startsAt && quote.endsAt ? (
                            <span className="admin-cell-sub"> · del {formatDate(quote.startsAt)} al {formatDate(quote.endsAt)}</span>
                          ) : null}
                          {quote.respondBy && (quote.status === "NEW" || quote.status === "REVIEWING") ? (
                            <span className="admin-cell-sub"> · responder antes del {formatDateTime(quote.respondBy)}</span>
                          ) : null}
                        </p>
                        <p className="admin-muted">Es una preorden: no reserva stock hasta que se convierta y se retenga o apruebe.</p>
                        {quote.budget ? (
                          <p>
                            <Link href="/presupuestos" title="Abrir Presupuestos">Presupuesto {budgetReference(quote.budget.id)}</Link> creado desde este pedido.
                          </p>
                        ) : null}
                        {budgetWritable && !quote.budget && isQuoteRequestStatus(quote.status) && CONVERTIBLE_STATUSES.includes(quote.status) ? (
                          <div className="admin-detail-actions">
                            {holdWritable ? (
                              <CheckboxField checked={holdOnConvert} onChange={setHoldOnConvert} text="Retener el stock mientras se cotiza (según la vigencia de Ajustes > Alquileres)" />
                            ) : null}
                            <AdminButton type="button" variant="primary" icon="budgets" busy={quoteBusy === quote.id} disabled={Boolean(quoteBusy)} onClick={() => void convertQuote(quote.id)}>
                              Convertir en presupuesto
                            </AdminButton>
                            {writable && quote.status === "NEW" ? (
                              <AdminButton type="button" disabled={Boolean(quoteBusy)} onClick={() => void setQuoteStatus(quote.id, "REVIEWING")}>Marcar en revisión</AdminButton>
                            ) : null}
                            {writable && quote.status !== "DECLINED" ? (
                              <AdminButton type="button" disabled={Boolean(quoteBusy)} onClick={() => void setQuoteStatus(quote.id, "DECLINED")}>Declinar</AdminButton>
                            ) : null}
                          </div>
                        ) : null}
                        {quote.budget && holdWritable ? (
                          <div className="admin-detail-actions">
                            <AdminButton type="button" icon="calendar" busy={quoteBusy === quote.id} disabled={Boolean(quoteBusy)} onClick={() => void holdQuote(quote.id)}>
                              Retener stock
                            </AdminButton>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {quote.items.length === 0 ? (
                      <p className="admin-muted">El pedido no incluye productos.</p>
                    ) : (
                      <AdminTable
                        view="leads-productos"
                        label={`Productos pedidos el ${formatDate(quote.createdAt)}`}
                        columns={[
                          { label: "Producto" },
                          { label: "Cantidad", end: true },
                          { label: "Duración" },
                          { label: "Precio unitario", end: true },
                          { label: "Subtotal", end: true },
                        ]}
                      >
                        {quote.items.map((item) => {
                          const total = itemTotal(item);
                          return (
                            <AdminRow key={item.id}>
                              <AdminCell title={`${item.productName} · ${item.productSlug}`}>
                                <strong>{item.productName}</strong>
                              </AdminCell>
                              <AdminCell end title={`${formatNumber(item.quantity)} unidades`}>
                                {formatNumber(item.quantity)}
                              </AdminCell>
                              <AdminCell title={item.duration ? `${item.duration} días · ${billingUnitLabel(item.billingUnit)}` : billingUnitLabel(item.billingUnit)}>
                                {item.duration ? `${formatNumber(item.duration)} días` : billingUnitLabel(item.billingUnit)}
                              </AdminCell>
                              <AdminCell end title={item.unitPrice === null ? "El sitio no cargó precio unitario" : formatMoney(item.unitPrice)}>
                                {item.unitPrice === null ? <span className="admin-muted">—</span> : formatMoney(item.unitPrice)}
                              </AdminCell>
                              <AdminCell end title={total === null ? "Sin importe" : formatMoney(total)}>
                                {total === null ? <span className="admin-muted">A cotizar</span> : formatMoney(total)}
                              </AdminCell>
                            </AdminRow>
                          );
                        })}
                      </AdminTable>
                    )}
                  </div>
                ))
              )}
            </div>

            {(selected.budgets?.length ?? 0) > 0 ? (
              <div className="admin-detail-section">
                <p className="admin-detail-section-title">
                  <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                    <AdminIcon name="budgets" size={11} />
                  </span>
                  Presupuestos del lead
                </p>
                <ul className="admin-detail-list">
                  {selected.budgets?.map((budget) => (
                    <li key={budget.id}>
                      <Link href="/presupuestos" title={`Abrir Presupuestos: ${budget.title}`}>
                        Presupuesto {budgetReference(budget.id)}
                      </Link>{" "}
                      · {budgetStatusLabel(budget.status)} · {budget.title}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {budgetWritable ? (
              <div className="admin-detail-actions">
                <AdminButton
                  type="button"
                  variant="primary"
                  icon="budgets"
                  onClick={() => router.push(`/presupuestos?nuevo=1&lead=${encodeURIComponent(selected.id)}`)}
                  title="Abre Presupuestos con el cliente, el título y las notas de este lead ya cargados"
                >
                  Armar presupuesto
                </AdminButton>
              </div>
            ) : null}

            {writable ? (
              <div className="admin-detail-section">
                <p className="admin-detail-section-title">
                  <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                    <AdminIcon name="overview" size={11} />
                  </span>
                  Seguimiento comercial
                </p>
                {selected.internalNotes ? <p className="admin-detail-text">{selected.internalNotes}</p> : <p className="admin-muted">Sin notas registradas.</p>}
                {detailError ? <AdminNote tone="error">{detailError}</AdminNote> : null}
                <div className="admin-detail-actions" aria-busy={converting || undefined}>
                  <AdminButton type="button" icon="edit" onClick={openFollowUp} disabled={converting}>
                    Editar seguimiento
                  </AdminButton>
                  <AdminButton type="button" icon="check" onClick={convertToClient} busy={converting}>
                    Convertir en cliente
                  </AdminButton>
                </div>
              </div>
            ) : (
              <div className="admin-detail-section">
                <p className="admin-detail-section-title">
                  <span className="admin-panel-icon admin-panel-icon--sm" aria-hidden="true">
                    <AdminIcon name="edit" size={11} />
                  </span>
                  Notas internas
                </p>
                {selected.internalNotes ? <p className="admin-detail-text">{selected.internalNotes}</p> : <p className="admin-muted">Sin notas registradas.</p>}
                <AdminNote>Tu rol es de solo lectura: no podés cambiar el estado ni convertir el lead.</AdminNote>
              </div>
            )}
          </div>
        </AdminPanel>
      ) : null}

      {writable && selected && followUpOpen ? (
        <AdminDialog
          title={`Seguimiento · ${selected.name}`}
          icon="leads"
          description="Estado del lead y notas internas. El cliente no ve las notas."
          dirty={draftStatus !== selected.status || draftNotes !== (selected.internalNotes ?? "")}
          onClose={() => setFollowUpOpen(false)}
          footer={({ requestClose }) => (
            <>
              {followUpError ? (
                <div className="admin-dialog-footer-note">
                  <AdminNote tone="error">{followUpError}</AdminNote>
                </div>
              ) : null}
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={saving}>
                Cancelar
              </AdminButton>
              <AdminButton variant="primary" icon="check" type="submit" form={followUpFormId} busy={saving}>
                Guardar cambios
              </AdminButton>
            </>
          )}
        >
          <form id={followUpFormId} className="admin-form" onSubmit={(event) => void saveDetail(event)} aria-busy={saving || undefined}>
            <AdminDialogSection title="Seguimiento comercial">
              <SelectField
                label="Estado del lead"
                value={draftStatus}
                onChange={setDraftStatus}
                options={STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              />
              <TextAreaField
                label="Notas internas"
                hint="No las ve el cliente; máximo 2000 caracteres."
                rows={4}
                maxLength={2000}
                wide
                value={draftNotes}
                onChange={setDraftNotes}
                placeholder="Ej.: pidió presupuesto para el 12/10, coordinar visita al predio."
              />
            </AdminDialogSection>
          </form>
        </AdminDialog>
      ) : null}
    </div>
  );
}
