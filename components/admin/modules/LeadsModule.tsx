"use client";

import { useMemo, useState } from "react";
import {
  billingUnitLabel,
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
import { canWrite, matchesQuery } from "@/lib/admin-policy";
import { useAdminSession } from "../AdminShell";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminIconLink,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  AdminWhatsappLink,
} from "../AdminUI";
import { SearchField, SelectField, TextAreaField } from "../AdminFields";
import { adminSend, useAdminResource } from "@/lib/admin-api";

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
  const [converting, setConverting] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");

  const writable = canWrite(role);
  const list = useMemo(() => leads.data ?? [], [leads.data]);

  const rows = useMemo(
    () =>
      list
        .filter((lead) => (status === "ALL" ? true : lead.status === status))
        .filter((lead) =>
          matchesQuery(query, [lead.name, lead.company, lead.email, lead.phone, lead.ruc, lead.reason, lead.location, lead.message]),
        ),
    [list, query, status],
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

  function closeDetail() {
    setSelectedId("");
    setDetailError("");
  }

  async function saveDetail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setDetailError("");
    setNotice("");
    const result = await adminSend<LeadMutation>("/api/leads", { id: selected.id, status: draftStatus, internalNotes: draftNotes }, "PATCH");
    setSaving(false);
    if (!result.ok) {
      setDetailError(result.error);
      return;
    }
    setNotice(`Lead de ${selected.name} actualizado.`);
    leads.reload();
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

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de leads">
        <AdminKpi label="Leads" value={formatNumber(totals.total)} note="últimos 100 ingresos" />
        <AdminKpi label="Nuevos" value={formatNumber(totals.new)} note="por contactar" tone={totals.new > 0 ? "accent" : undefined} />
        <AdminKpi label="Cotizados" value={formatNumber(totals.quoted)} note="en pipeline" tone={totals.quoted > 0 ? "warn" : undefined} />
        <AdminKpi label="Ganados" value={formatNumber(totals.won)} note="convertidos en cliente" tone={totals.won > 0 ? "ok" : undefined} />
      </section>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar leads"
          placeholder="Buscar por nombre, empresa, contacto o motivo…"
        />
        <AdminSelect value={status} onChange={setStatus} label="Filtrar por estado" options={STATUS_FILTER_OPTIONS} />
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      <AdminDataState
        loading={leads.loading}
        error={leads.error}
        onRetry={leads.reload}
        empty={list.length === 0}
        emptyTitle="Todavía no hay leads"
        emptyHint="Cuando alguien pida una cotización desde el sitio, el lead entra acá con su pedido y datos de contacto."
      >
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
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
                  <AdminCell title={eventLabel || "El lead no cargó fecha ni lugar del evento"}>{eventLabel || "—"}</AdminCell>
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
          title={`Lead · ${selected.name}`}
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
                <dd className="admin-detail-value">{selected.eventDate ? formatDate(selected.eventDate) : "Sin fecha"}</dd>
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
              <p className="admin-detail-section-title">Mensaje del lead</p>
              {selected.message ? <p className="admin-detail-text">{selected.message}</p> : <p className="admin-muted">El lead no dejó un mensaje.</p>}
            </div>

            <div className="admin-detail-section">
              <p className="admin-detail-section-title">Productos de interés</p>
              {selected.quoteRequests.length === 0 ? (
                <AdminEmpty title="Sin pedido del sitio" hint="El lead consultó sin productos cargados en el cotizador." />
              ) : (
                selected.quoteRequests.map((quote) => (
                  <div className="admin-detail-quote" key={quote.id}>
                    <p className="admin-detail-quote-meta">
                      Pedido del {formatDate(quote.createdAt)} · {leadSourceLabel(quote.source)} · {formatNumber(quote.items.length)} ítems
                    </p>
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

            {writable ? (
              <form className="admin-detail-form" onSubmit={saveDetail} aria-busy={saving || converting || undefined}>
                <p className="admin-detail-section-title">Seguimiento comercial</p>
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
                {detailError ? <AdminNote tone="error">{detailError}</AdminNote> : null}
                <div className="admin-detail-actions">
                  <AdminButton type="button" icon="check" onClick={convertToClient} busy={converting} disabled={saving}>
                    Convertir en cliente
                  </AdminButton>
                  <AdminButton type="submit" variant="primary" icon="check" busy={saving} disabled={converting}>
                    Guardar cambios
                  </AdminButton>
                </div>
              </form>
            ) : (
              <div className="admin-detail-section">
                <p className="admin-detail-section-title">Notas internas</p>
                {selected.internalNotes ? <p className="admin-detail-text">{selected.internalNotes}</p> : <p className="admin-muted">Sin notas registradas.</p>}
                <AdminNote>Tu rol es de solo lectura: no podés cambiar el estado ni convertir el lead.</AdminNote>
              </div>
            )}
          </div>
        </AdminPanel>
      ) : null}
    </div>
  );
}
