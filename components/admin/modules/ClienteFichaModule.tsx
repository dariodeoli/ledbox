"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  budgetStatusLabel,
  checklistProgress,
  clientTypeLabel,
  clientWhatsappMessage,
  eventStatusLabel,
  formatCountdown,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatTime,
  isOverdue,
  isUpcomingWithin,
  leadStatusLabel,
  paymentStatusLabel,
  paymentStatusTone,
  statusTone,
} from "@/lib/admin-format";
import { canWriteBudgets, canWriteClients, canWriteFinance } from "@/lib/admin-policy";
import { clientPrimaryAction, lastClientEvent } from "@/lib/client-portfolio";
import { useAdminResource } from "@/lib/admin-api";
import { clientHistory } from "@/lib/client-history";
import { clientDisplayName, clientLegalName } from "@/lib/client-identity";
import type { AdminClientDetail, AdminClientEventRow, AdminClientPaymentRow } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { AdminIcon } from "../AdminIcons";
import {
  AdminBadge,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminIconLink,
  AdminKpi,
  AdminKpis,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
  AdminTimeline,
  AdminWhatsappLink,
} from "../AdminUI";
import { ClientCatalogAccess } from "./ClientCatalogAccess";
import { ClientFiscalSnapshot } from "./ClientFiscalFields";
import { ClientLinks, ClientLogo } from "./ClientesModule";
import { locationLinkValid } from "./OperationQuickRules";

const TABS = [
  { key: "presupuestos", label: "Presupuestos" },
  { key: "eventos", label: "Eventos" },
  { key: "cobros", label: "Cobros" },
  { key: "leads", label: "Leads" },
  { key: "historial", label: "Historial" },
  { key: "datos", label: "Datos" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Fecha y estado real de un cobro para la ficha: cobrado, pendiente o vencido. */
function paymentWhen(payment: AdminClientPaymentRow): { label: string; title: string; overdue: boolean } {
  if (payment.status === "RECEIVED") {
    const at = payment.collectedAt ?? payment.paidAt;
    return {
      label: at ? formatDateShort(at) : "—",
      title: at ? `Cobrado el ${formatDate(at)}` : "Cobro sin fecha de cobro",
      overdue: false,
    };
  }
  if (payment.status === "PENDING") {
    return payment.dueAt
      ? {
          label: formatDateShort(payment.dueAt),
          title: `Vence el ${formatDate(payment.dueAt)} · ${formatCountdown(payment.dueAt)}`,
          overdue: isOverdue(payment.dueAt),
        }
      : { label: "Sin fecha", title: "Cobro pendiente sin vencimiento cargado", overdue: false };
  }
  return { label: formatDateShort(payment.createdAt), title: `Anulado · registrado el ${formatDate(payment.createdAt)}`, overdue: false };
}

/** A qué se imputa un cobro: presupuesto, factura, referencia o nada. */
function paymentConcept(payment: AdminClientPaymentRow): { label: string; title: string } {
  const detail = [payment.invoiceNumber ? `Factura ${payment.invoiceNumber}` : null, payment.reference].filter(Boolean).join(" · ");
  if (payment.budget) return { label: payment.budget.title, title: detail || payment.budget.title };
  if (payment.invoiceNumber) return { label: `Factura ${payment.invoiceNumber}`, title: detail };
  if (payment.reference) return { label: payment.reference, title: "Cobro sin presupuesto asociado" };
  return { label: "Sin presupuesto", title: "Cobro sin presupuesto asociado" };
}

/** Agenda primero (arranca antes) y después el historial, del más nuevo al más viejo. */
function sortClientEvents(events: AdminClientEventRow[]): AdminClientEventRow[] {
  const now = Date.now();
  return [...events].sort((a, b) => {
    const aTime = a.startsAt ? new Date(a.startsAt).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.startsAt ? new Date(b.startsAt).getTime() : Number.POSITIVE_INFINITY;
    const aUpcoming = aTime >= now;
    const bUpcoming = bTime >= now;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    return aUpcoming ? aTime - bTime : bTime - aTime;
  });
}

/** Estado del cobro en la ficha: el vencido se muestra como tal, sin inventar estados. */
function paymentFact(payment: AdminClientPaymentRow): { label: string; tone: ReturnType<typeof paymentStatusTone>; title: string } {
  if (paymentWhen(payment).overdue) {
    return { label: "Vencido", tone: "danger", title: `Cobro pendiente con vencimiento el ${formatDate(payment.dueAt)}` };
  }
  return {
    label: paymentStatusLabel(payment.status),
    tone: paymentStatusTone(payment.status),
    title: payment.status === "PENDING" && payment.dueAt ? `Vence el ${formatDate(payment.dueAt)}` : "Estado real del cobro",
  };
}

/**
 * Ficha 360 del cliente como página propia (issue #34, antes una ventana).
 * Métricas reales, presupuestos, eventos, cobros y leads del cliente. Es lectura
 * para cualquier rol: las acciones que escriben (Editar, Nuevo presupuesto) solo
 * se dibujan con el permiso del rol; el API revalida siempre.
 */
export function ClienteFichaModule({ clientId }: { clientId: string }) {
  const detail = useAdminResource(`/api/admin/clients/${clientId}`, (payload) => payload.clientDetail ?? null);
  return (
    <div className="admin-ficha">
      <Link className="admin-ficha-back" href="/clientes">
        <AdminIcon name="arrow-left" size={13} />
        Clientes
      </Link>
      <AdminDataState
        loading={detail.loading}
        error={detail.error}
        onRetry={detail.reload}
        rows={6}
        empty={!detail.data}
        emptyTitle="Sin datos del cliente"
        emptyIcon="clients"
        emptyHint="No pudimos leer la ficha de este cliente."
      >
        {detail.data ? <ClientFicha detail={detail.data} /> : null}
      </AdminDataState>
    </div>
  );
}

function ClientFicha({ detail }: { detail: AdminClientDetail }) {
  const { role } = useAdminSession();
  const [tab, setTab] = useState<TabKey>("presupuestos");
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  const { client, metrics } = detail;
  const name = clientDisplayName(client);
  const events = useMemo(() => sortClientEvents(detail.events), [detail.events]);
  const history = useMemo(() => clientHistory(detail), [detail]);
  const lastEvent = useMemo(() => lastClientEvent(detail.events), [detail.events]);
  const canEdit = canWriteClients(role);
  const canQuote = canWriteBudgets(role);
  const primary = clientPrimaryAction(detail, { collect: canWriteFinance(role), quote: canQuote });
  const where = [client.city, client.department].filter(Boolean).join(", ");
  const contactPhone = client.whatsapp || client.contactPhone || client.phone;
  const counts: Record<TabKey, number | null> = {
    presupuestos: detail.budgets.length,
    eventos: events.length,
    cobros: detail.payments.length,
    leads: detail.leads.length,
    historial: history.length,
    datos: null,
  };
  const primaryHref =
    primary?.kind === "collect"
      ? "/finanzas/por-cobrar"
      : primary?.kind === "follow"
        ? `/presupuestos?detalle=${encodeURIComponent(primary.budgetId)}`
        : `/presupuestos?nuevo=1&cliente=${encodeURIComponent(client.id)}`;
  const primaryTitle =
    primary?.kind === "collect"
      ? `${formatMoney(metrics.overdue)} vencido: cobrarlo desde Por cobrar`
      : primary?.kind === "follow"
        ? `Abrir el presupuesto enviado a ${name}`
        : `Armar un presupuesto para ${name}`;

  /** Flechas, Inicio y Fin mueven entre pestañas (patrón de tablist). */
  function onTabKey(event: React.KeyboardEvent, index: number) {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = TABS[(keys[event.key] + TABS.length) % TABS.length].key;
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <header className="admin-ficha-head">
        <ClientLogo client={client} size={64} />
        <div className="admin-ficha-id">
          <div className="admin-client-title">
            <h1 className="admin-ficha-name">{name}</h1>
            <AdminBadge tone={client.type === "RESELLER" ? "accent" : "neutral"}>{clientTypeLabel(client.type)}</AdminBadge>
            <AdminBadge tone={client.active ? "ok" : "neutral"}>{client.active ? "Activo" : "Inactivo"}</AdminBadge>
          </div>
          <p className="admin-ficha-sub">
            {clientLegalName(client) ? <span>{clientLegalName(client)}</span> : null}
            <span className="admin-nowrap">RUC <span className="admin-code">{client.ruc || "—"}</span></span>
            {where ? <span>{where}</span> : null}
            <span className="admin-nowrap">Cliente desde {formatDate(client.createdAt)}</span>
          </p>
        </div>
        <div className="admin-ficha-actions">
          {primary ? (
            <Link className="admin-btn admin-btn--primary" href={primaryHref} title={primaryTitle}>
              <AdminIcon name={primary.kind === "collect" ? "finance" : primary.kind === "follow" ? "budgets" : "plus"} />
              <span>{primary.label}</span>
            </Link>
          ) : null}
          <AdminWhatsappLink phone={contactPhone} name={name} message={clientWhatsappMessage(client.contactName || name)} />
          {canEdit ? (
            <Link className="admin-btn" href={`/clientes?editar=${encodeURIComponent(client.id)}`} title={`Editar ${name}`}>
              <AdminIcon name="edit" />
              <span>Editar</span>
            </Link>
          ) : null}
        </div>
      </header>

      <AdminKpis className="admin-kpis--ficha" label={`Indicadores de ${name}`}>
        <AdminKpi label="Contratado" icon="receipt" value={formatMoney(metrics.contracted)} note={`${formatNumber(metrics.contracts)} contrato${metrics.contracts === 1 ? "" : "s"}`} />
        <AdminKpi label="Cobrado" icon="wallet" value={formatMoney(metrics.collected)} tone={metrics.collected > 0 ? "ok" : undefined} note="cobros recibidos" />
        <AdminKpi
          label="Saldo" icon="alert"
          value={formatMoney(Math.max(0, metrics.balance))}
          tone={metrics.overdue > 0 ? "danger" : metrics.balance > 0 ? "warn" : undefined}
          note={metrics.overdue > 0 ? `${formatMoney(metrics.overdue)} vencido` : metrics.balance > 0 ? "por cobrar" : "al día"}
        />
        <AdminKpi
          label="Eventos" icon="events"
          value={formatNumber(metrics.events)}
          note={metrics.upcomingEvents > 0 ? `${formatNumber(metrics.upcomingEvents)} por venir` : "ninguno por venir"}
        />
        <AdminKpi
          label="Último evento" icon="calendar"
          value={lastEvent?.startsAt ? formatDateShort(lastEvent.startsAt) : "—"}
          note={lastEvent ? lastEvent.name : "todavía sin eventos realizados"}
        />
      </AdminKpis>
      {metrics.collected > metrics.contracted ? (
        <AdminNote tone="warn">Lo cobrado supera lo contratado: hay cobros sobre presupuestos sin aprobar.</AdminNote>
      ) : null}

      <div className="admin-ficha-grid">
        <div className="admin-ficha-main">
          <nav className="admin-subtabs" role="tablist" aria-label={`Secciones de la ficha de ${name}`}>
            {TABS.map((item, index) => (
              <button
                key={item.key}
                ref={(node) => { tabRefs.current[item.key] = node; }}
                type="button"
                role="tab"
                id={`ficha-tab-${item.key}`}
                aria-selected={tab === item.key}
                aria-controls="ficha-panel"
                tabIndex={tab === item.key ? 0 : -1}
                className="admin-subtab"
                data-active={tab === item.key ? "true" : undefined}
                onClick={() => setTab(item.key)}
                onKeyDown={(event) => onTabKey(event, index)}
              >
                {item.label}
                {counts[item.key] === null ? null : <span className="admin-subtab-count">{formatNumber(counts[item.key] ?? 0)}</span>}
              </button>
            ))}
          </nav>
          <div id="ficha-panel" role="tabpanel" aria-labelledby={`ficha-tab-${tab}`} className="admin-ficha-panel">
            {tab === "presupuestos" ? <BudgetsTab detail={detail} name={name} /> : null}
            {tab === "eventos" ? <EventsTab events={events} name={name} /> : null}
            {tab === "cobros" ? <PaymentsTab detail={detail} name={name} /> : null}
            {tab === "leads" ? <LeadsTab detail={detail} name={name} /> : null}
            {tab === "historial" ? (
              <AdminTimeline entries={history} emptyTitle="Sin historial todavía" emptyHint="Aparece solo cuando hay leads, presupuestos, eventos o cobros del cliente." />
            ) : null}
            {tab === "datos" ? <DataTab detail={detail} name={name} /> : null}
          </div>
        </div>

        <aside className="admin-ficha-side" aria-label={`Resumen de ${name}`}>
          <AdminPanel title="Contacto" icon="clients">
            <dl className="admin-ficha-contact">
              {client.contactName ? <div><dt>Encargado</dt><dd>{client.contactName}{client.contactRole ? ` · ${client.contactRole}` : ""}</dd></div> : null}
              <div><dt>Teléfono</dt><dd className="admin-nowrap">{client.contactPhone || client.phone || "—"}</dd></div>
              <div><dt>Correo</dt><dd>{client.contactEmail || client.email || "—"}</dd></div>
            </dl>
            <span className="admin-actions">
              <ClientLinks client={client} name={name} />
              {client.contactEmail || client.email ? (
                <AdminIconLink href={`mailto:${client.contactEmail || client.email}`} icon="mail" label={`Enviar correo a ${name}`} />
              ) : null}
            </span>
          </AdminPanel>

          {client.type === "RESELLER" ? (
            <ClientCatalogAccess clientId={client.id} clientName={name} phone={contactPhone} canEdit={canEdit} />
          ) : (
            <AdminPanel title="Catálogo mayorista" icon="inventory">
              <p className="admin-note">El link del catálogo mayorista es solo para clientes mayoristas. Si {name} compra por mayor, cambiá su tipo desde «Editar».</p>
            </AdminPanel>
          )}

          <AdminPanel title="Últimos movimientos" icon="clock">
            {history.length === 0 ? (
              <p className="admin-note">Sin movimientos registrados.</p>
            ) : (
              <ul className="admin-ficha-moves">
                {history.slice(0, 5).map((entry) => (
                  <li key={entry.id}>
                    <span className="admin-ficha-move-when admin-nowrap">{formatDateShort(entry.at)}</span>
                    <span title={entry.detail ?? entry.title}>{entry.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </AdminPanel>
        </aside>
      </div>
    </>
  );
}

function BudgetsTab({ detail, name }: { detail: AdminClientDetail; name: string }) {
  if (detail.budgets.length === 0) {
    return <AdminEmpty icon="budgets" title="Sin presupuestos" hint="Este cliente todavía no tiene presupuestos cargados." />;
  }
  return (
    <AdminTable
      view="cliente-presupuestos"
      label={`Presupuestos de ${name}`}
      columns={[{ label: "Fecha" }, { label: "Presupuesto" }, { label: "Estado" }, { label: "Total", end: true }, { label: "Cobrado", end: true }]}
    >
      {detail.budgets.map((budget) => {
        const approval = budget.approvedAt
          ? `Aprobado el ${formatDateTime(budget.approvedAt)} · ${budget.approvalMethod === "manual" ? "panel" : "portal del cliente"}`
          : budget.validUntil
            ? `Válido hasta el ${formatDate(budget.validUntil)}`
            : "Sin aprobación ni vencimiento cargado";
        return (
          <AdminRow key={budget.id}>
            <AdminCell title={`Alta del presupuesto: ${formatDate(budget.createdAt)}`}>{formatDateShort(budget.createdAt)}</AdminCell>
            <AdminCell title={budget.event ? `${budget.title} · ${budget.event.name}` : budget.title}>
              <Link href={`/presupuestos?detalle=${encodeURIComponent(budget.id)}`}><strong>{budget.title}</strong></Link>
              {budget.event ? (
                <small className="admin-cell-sub"> · <Link href={`/eventos?evento=${encodeURIComponent(budget.event.id)}`}>{budget.event.name}</Link></small>
              ) : null}
            </AdminCell>
            <AdminCell title={approval}>
              <AdminBadge tone={statusTone(budget.status)}>{budgetStatusLabel(budget.status)}</AdminBadge>
              {budget.status === "APPROVED" && !budget.event ? <AdminBadge tone="warn" title="Falta crear el evento desde Presupuestos">Sin evento</AdminBadge> : null}
            </AdminCell>
            <AdminCell end title={`Total del presupuesto: ${formatMoney(budget.total)}`}>{formatMoney(budget.total)}</AdminCell>
            <AdminCell
              end
              title={
                budget.collected > 0 || budget.overdue > 0
                  ? `Cobrado ${formatMoney(budget.collected)}${budget.overdue > 0 ? ` · vencido ${formatMoney(budget.overdue)}` : ""}`
                  : "Sin cobros imputados"
              }
            >
              {budget.collected > 0 ? <span className="admin-nowrap">{formatMoney(budget.collected)}</span> : <span className="admin-muted">—</span>}
            </AdminCell>
          </AdminRow>
        );
      })}
    </AdminTable>
  );
}

function EventsTab({ events, name }: { events: AdminClientEventRow[]; name: string }) {
  if (events.length === 0) {
    return <AdminEmpty icon="events" title="Sin eventos" hint="Este cliente todavía no tiene eventos cargados." />;
  }
  return (
    <AdminTable
      view="cliente-eventos"
      label={`Eventos de ${name}`}
      columns={[{ label: "Fecha" }, { label: "Evento" }, { label: "Estado" }, { label: "Checklist", end: true }]}
    >
      {events.map((event) => {
        const progress = checklistProgress(event.tasks, { risk: isUpcomingWithin(event.startsAt) });
        return (
          <AdminRow key={event.id}>
            <AdminCell title={event.startsAt ? formatDateTime(event.startsAt) : "Fecha a confirmar"}>
              {event.startsAt ? `${formatDateShort(event.startsAt)} · ${formatTime(event.startsAt)}` : "A confirmar"}
            </AdminCell>
            <AdminCell title={event.location || "Sin lugar definido"}>
              <Link href={`/eventos?evento=${encodeURIComponent(event.id)}`}><strong>{event.name}</strong></Link>
            </AdminCell>
            <AdminCell><AdminBadge tone={statusTone(event.status)}>{eventStatusLabel(event.status)}</AdminBadge></AdminCell>
            <AdminCell end title={progress.title}>
              {event.tasks.length === 0 ? <span className="admin-muted">—</span> : <AdminBadge tone={progress.tone}>{progress.label}</AdminBadge>}
            </AdminCell>
          </AdminRow>
        );
      })}
    </AdminTable>
  );
}

function PaymentsTab({ detail, name }: { detail: AdminClientDetail; name: string }) {
  if (detail.payments.length === 0) {
    return <AdminEmpty icon="finance" title="Sin cobros" hint="Este cliente todavía no tiene cobros registrados." />;
  }
  return (
    <AdminTable
      view="cliente-pagos"
      label={`Cobros de ${name}`}
      columns={[{ label: "Fecha" }, { label: "Concepto" }, { label: "Método" }, { label: "Monto", end: true }, { label: "Estado" }]}
    >
      {detail.payments.map((payment) => {
        const when = paymentWhen(payment);
        const concept = paymentConcept(payment);
        const fact = paymentFact(payment);
        return (
          <AdminRow key={payment.id}>
            <AdminCell title={when.title}>
              {when.overdue ? <span className="admin-nowrap" data-tone="danger">{when.label}</span> : when.label}
            </AdminCell>
            <AdminCell title={concept.title}>{payment.budget ? <strong>{concept.label}</strong> : concept.label}</AdminCell>
            <AdminCell title={payment.chequeDate ? `Cheque del ${formatDate(payment.chequeDate)}` : payment.method || "Sin método"}>{payment.method || "—"}</AdminCell>
            <AdminCell end title={formatMoney(payment.amount)}><strong>{formatMoney(payment.amount)}</strong></AdminCell>
            <AdminCell><AdminBadge tone={fact.tone} title={fact.title}>{fact.label}</AdminBadge></AdminCell>
          </AdminRow>
        );
      })}
    </AdminTable>
  );
}

function LeadsTab({ detail, name }: { detail: AdminClientDetail; name: string }) {
  if (detail.leads.length === 0) {
    return <AdminEmpty icon="clients" title="Sin leads" hint="No hay consultas del sitio que coincidan por correo o teléfono con este cliente, ni que hayan originado sus presupuestos." />;
  }
  return (
    <AdminTable
      view="cliente-leads"
      label={`Leads de ${name}`}
      columns={[{ label: "Fecha" }, { label: "Consulta" }, { label: "Origen" }, { label: "Estado" }]}
    >
      {detail.leads.map((lead) => (
        <AdminRow key={lead.id}>
          <AdminCell title={`Recibido el ${formatDateTime(lead.createdAt)}`}>{formatDateShort(lead.createdAt)}</AdminCell>
          <AdminCell title={[lead.reason, lead.eventDate ? `Evento: ${formatDate(lead.eventDate)}` : null].filter(Boolean).join(" · ") || lead.name}>
            <Link href={`/leads?lead=${encodeURIComponent(lead.id)}`}><strong>{lead.reason || lead.name}</strong></Link>
          </AdminCell>
          <AdminCell title={lead.source}>{lead.source}</AdminCell>
          <AdminCell><AdminBadge tone={statusTone(lead.status)}>{leadStatusLabel(lead.status)}</AdminBadge></AdminCell>
        </AdminRow>
      ))}
    </AdminTable>
  );
}

function DataTab({ detail, name }: { detail: AdminClientDetail; name: string }) {
  const { client } = detail;
  return (
    <>
      <dl className="admin-dialog-facts" aria-label={`Identidad y ubicación de ${name}`}>
        <div><dt>Nombre histórico</dt><dd>{client.name}</dd></div>
        {clientLegalName(client) ? <div><dt>Razón social</dt><dd>{clientLegalName(client)}</dd></div> : null}
        {client.company ? <div><dt>Empresa histórica</dt><dd>{client.company}</dd></div> : null}
        {client.billingEmail ? <div><dt>Correo de facturación</dt><dd>{client.billingEmail}</dd></div> : null}
        {client.city || client.department ? <div><dt>Localidad</dt><dd>{[client.city, client.department].filter(Boolean).join(" · ")}</dd></div> : null}
        {client.address ? <div><dt>Dirección</dt><dd>{client.address}</dd></div> : null}
        {client.addressReference ? <div><dt>Referencia</dt><dd>{client.addressReference}</dd></div> : null}
        {client.locationUrl && locationLinkValid(client.locationUrl) ? (
          <div><dt>Ubicación</dt><dd><AdminIconLink href={client.locationUrl} icon="globe" label="Abrir ubicación del cliente" external /></dd></div>
        ) : null}
        {client.notes ? <div><dt>Notas</dt><dd>{client.notes}</dd></div> : null}
      </dl>
      <ClientFiscalSnapshot snapshot={client.rucSnapshot ?? null} />
      {client.contacts?.length ? (
        <AdminPanel title="Contactos por función" icon="clients">
          <dl className="admin-dialog-facts">
            {client.contacts.map((person, index) => (
              <div key={index}>
                <dt>{person.role || "Contacto"}</dt>
                <dd>{person.name}{person.phone ? ` · ${person.phone}` : ""}{person.email ? ` · ${person.email}` : ""}</dd>
              </div>
            ))}
          </dl>
        </AdminPanel>
      ) : null}
    </>
  );
}
