"use client";

import { kpiState } from "@/components/admin/kpi-state";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  clientTypeLabel,
  formatDate,
  formatDateShort,
  formatMoney,
  clientWhatsappMessage,
  formatNumber,
  instagramHref,
  instagramLabel,
  websiteHref,
  whatsappHref,
} from "@/lib/admin-format";
import { canWriteBudgets, canWriteClients, matchesQuery } from "@/lib/admin-policy";
import { CLIENT_SEGMENTS, matchesKpi, portfolioKpis, type ClientKpiKey, type ClientSegment } from "@/lib/client-portfolio";
import { clientDisplayName, clientLegalName } from "@/lib/client-identity";
import { clientLogoUrl } from "@/lib/admin-types";
import type { AdminClientRow } from "@/lib/admin-types";
import type { PreparedIdentityImage } from "@/lib/identity-image";
import { useTrashFlow } from "../TrashDialogs";
import { useAdminSession } from "../AdminShell";
import { AdminAvatar } from "../AdminAvatar";
import { AdminIcon } from "../AdminIcons";
import { AdminButtonLink,
  AdminActionsMenu,
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminDialog,
  AdminDialogSection,
  AdminIconLink,
  AdminImageUpload,
  AdminKpi,
  AdminKpis,
  AdminModuleContext,
  AdminNote,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  AdminWhatsappLink,
  type AdminMenuItem,
  AdminTabs,
} from "../AdminUI";
import { MessageTemplateSendDialog, type MessageTemplateTarget } from "../AdminMessageTemplateDialog";
import { SearchField, TextAreaField } from "../AdminFields";
import { ClientQuickFields, EMPTY_CLIENT_QUICK, clientQuickPayload, clientQuickErrors, clientQuickFirstError } from "./ClientQuickForm";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { FIELD_LIMITS } from "@/lib/field-rules";
import { AdminViewSwitch, useAdminModuleView, useAdminNarrowViewport } from "../AdminBoard";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";

/** Vistas de la cartera (issue #57): lista densa y cuadrícula de fichas. */
const CLIENTES_VIEWS = ["list", "grid"] as const;

// Filtros por hechos reales (issue #34): deuda vencida (cobros pendientes con
// vencimiento pasado), clientes sin responsable cargado y los que todavía no
// cerraron ningún contrato. Los KPI y los segmentos por tipo filtran aparte.
const FILTER_OPTIONS = [
  { value: "ALL", label: "Toda la cartera" },
  { value: "OVERDUE", label: "Con deuda vencida" },
  { value: "NO_RESPONSIBLE", label: "Sin responsable cargado" },
  { value: "NO_PURCHASES", label: "Sin compras" },
  { value: "ARCHIVED", label: "Archivados" },
];

const ORDER_OPTIONS = [
  { value: "ACTIVITY", label: "Última actividad" },
  { value: "CONTRACTED", label: "Monto contratado" },
  { value: "NAME", label: "Nombre (A-Z)" },
  { value: "RECENT", label: "Alta reciente" },
];

/**
 * Formulario único del alta y la edición (issue #36): los mismos campos del
 * cliente, su persona encargada y los links directos. El logo se sube después
 * de guardar, porque necesita el id del cliente.
 */
const EMPTY_FORM = {
  ...EMPTY_CLIENT_QUICK,
  name: "",
  company: "",
  type: "FINAL",
  ruc: "",
  phone: "",
  email: "",
  contactName: "",
  contactRole: "",
  contactPhone: "",
  contactEmail: "",
  website: "",
  instagram: "",
  whatsapp: "",
  notes: "",
};

type ClientForm = typeof EMPTY_FORM;

function formFromClient(client: AdminClientRow): ClientForm {
  return {
    tradeName: client.tradeName ?? "",
    legalName: client.legalName ?? "",
    billingEmail: client.billingEmail ?? "",
    city: client.city ?? "",
    department: client.department ?? "",
    address: client.address ?? "",
    addressReference: client.addressReference ?? "",
    locationUrl: client.locationUrl ?? "",
    contacts: client.contacts ?? [],
    rucSnapshot: client.rucSnapshot ?? null,
    rucConfirmationToken: "",
    name: client.name,
    company: client.company ?? "",
    type: client.type === "RESELLER" ? "RESELLER" : "FINAL",
    ruc: client.ruc ?? "",
    phone: client.phone ?? "",
    email: client.email ?? "",
    contactName: client.contactName ?? "",
    contactRole: client.contactRole ?? "",
    contactPhone: client.contactPhone ?? "",
    contactEmail: client.contactEmail ?? "",
    website: client.website ?? "",
    instagram: client.instagram ?? "",
    whatsapp: client.whatsapp ?? "",
    notes: client.notes ?? "",
  };
}

function activityTime(client: Pick<AdminClientRow, "metrics">): number {
  return client.metrics.lastActivityAt ? new Date(client.metrics.lastActivityAt).getTime() : 0;
}

function compareByName(a: AdminClientRow, b: AdminClientRow): number {
  return clientDisplayName(a).localeCompare(clientDisplayName(b), "es");
}

function sortClients(list: AdminClientRow[], order: string): AdminClientRow[] {
  const rows = [...list];
  if (order === "CONTRACTED") {
    return rows.sort((a, b) => b.metrics.contracted - a.metrics.contracted || compareByName(a, b));
  }
  if (order === "NAME") return rows.sort(compareByName);
  if (order === "RECENT") return rows; // el API ya devuelve alta reciente primero.
  return rows.sort((a, b) => activityTime(b) - activityTime(a) || compareByName(a, b));
}

/** Contacto principal: el encargado manda sobre el teléfono general. */
function clientContactLine(client: AdminClientRow): string {
  const phone = client.contactPhone || client.phone;
  const email = client.contactEmail || client.email;
  return (client.contactName ? [client.contactName, phone] : [phone ?? email]).filter(Boolean).join(" · ");
}

function contractedTitle(client: AdminClientRow): string {
  const metrics = client.metrics;
  return metrics.contracts > 0
    ? `${formatNumber(metrics.contracts)} contrato${metrics.contracts === 1 ? "" : "s"} · ticket promedio ${formatMoney(metrics.averageTicket)}`
    : "Sin contratos aprobados";
}

function balanceText(client: AdminClientRow): string {
  return client.metrics.balance > 0 ? formatMoney(client.metrics.balance) : "—";
}

function balanceTitle(client: AdminClientRow): string {
  const { balance, overdue, overdueCount } = client.metrics;
  if (overdue > 0) {
    return `Saldo ${formatMoney(Math.max(0, balance))} · ${formatMoney(overdue)} vencido en ${formatNumber(overdueCount)} cobro${overdueCount === 1 ? "" : "s"}`;
  }
  return balance > 0 ? `Saldo pendiente de ${formatMoney(balance)}` : "Sin saldo pendiente";
}

function activityTitle(client: AdminClientRow): string {
  return client.metrics.lastActivityAt
    ? `Última actividad comercial: ${formatDate(client.metrics.lastActivityAt)}`
    : "Sin actividad comercial registrada";
}

/**
 * Identidad del cliente (issue #36): logo subido servido con sesión o el
 * monograma de iniciales del avatar único del panel. Nunca un `<img>` a mano.
 */
export function ClientLogo({
  client,
  size = 22,
  title,
}: {
  client: Pick<AdminClientRow, "id" | "name" | "company" | "tradeName" | "logoUpdatedAt">;
  size?: 22 | 40 | 64;
  title?: string;
}) {
  const name = clientDisplayName(client);
  const src = client.logoUpdatedAt ? clientLogoUrl(client.id, client.logoUpdatedAt) : null;
  return (
    <AdminAvatar
      name={name}
      src={src}
      size={size}
      title={title ?? (src ? `Logo de ${name}` : `Monograma de ${name} (sin logo subido)`)}
    />
  );
}

/**
 * Links directos del cliente (issue #36): Instagram y sitio web. Cada link sale
 * de su propio dato —cuando falta, no se dibuja ni se reemplaza por otro—. El
 * WhatsApp y el correo viven en la acción principal y en el menú de cada vista.
 */
export function ClientLinks({ client, name }: { client: Pick<AdminClientRow, "website" | "instagram">; name: string }) {
  const instagram = instagramHref(client.instagram);
  const web = websiteHref(client.website);
  return (
    <>
      {instagram ? (
        <AdminIconLink
          href={instagram}
          icon="instagram"
          label={`Ver el Instagram de ${name} (${instagramLabel(client.instagram)})`}
          external
        />
      ) : null}
      {web ? <AdminIconLink href={web} icon="globe" label={`Abrir el sitio web de ${name}`} external /> : null}
    </>
  );
}

export function ClientesModule() {
  const { role } = useAdminSession();
  // La lista trae las métricas reales de cada cliente (issue #34): deuda
  // vencida, monto contratado y última actividad salen del mismo payload, sin
  // una segunda llamada a finanzas.
  const [query, setQuery] = useState("");
  const [serverQuery, setServerQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setServerQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  const clientsResource = useAdminResource(`/api/admin/clients?q=${encodeURIComponent(serverQuery)}`, (payload) => ({
    list: payload.clients ?? [],
    truncated: payload.truncated === true,
  }));
  // Lo archivado (papelera) sale de la cartera y de los indicadores; se ve con el filtro «Archivados».
  const allClients = clientsResource.data?.list ?? null;
  const activeClients = useMemo(() => (allClients ? allClients.filter((client) => !client.archivedAt) : null), [allClients]);
  const clients = { ...clientsResource, data: activeClients };
  const archivedClients = useMemo(() => (allClients ?? []).filter((client) => Boolean(client.archivedAt)), [allClients]);
  const truncated = clientsResource.data?.truncated === true;
  const [segment, setSegment] = useState<ClientSegment>("ALL");
  const [kpi, setKpi] = useState<ClientKpiKey | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [order, setOrder] = useState("ACTIVITY");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLogoVersion, setEditingLogoVersion] = useState<string | null>(null);
  const [pendingLogo, setPendingLogo] = useState<PreparedIdentityImage | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("");
  const clientFormId = useId();
  const [view, setView] = useAdminModuleView("clientes", CLIENTES_VIEWS);
  // En ancho compacto la lista también se lee como tarjetas (issue #139): la
  // tabla no entra en 390 sin cortar contacto, deuda y última actividad.
  const narrow = useAdminNarrowViewport();
  const cardView = narrow || view === "grid";
  /** Envío por WhatsApp con plantilla (issue #35) para el cliente elegido. */
  const [templateTarget, setTemplateTarget] = useState<MessageTemplateTarget | null>(null);

  const writable = canWriteClients(role);
  const canQuote = canWriteBudgets(role);
  const trash = useTrashFlow("Client", { onChanged: clientsResource.reload });

  const rows = useMemo(() => {
    // La plata no se archiva: con saldo o deuda vencida también se listan los archivados.
    const owing = kpi === "BALANCE" || filter === "OVERDUE";
    const list = (filter === "ARCHIVED" ? archivedClients : owing ? allClients ?? [] : clients.data ?? [])
      .filter((client) => (segment === "ALL" ? true : client.type === segment))
      .filter((client) => (kpi ? matchesKpi(client, kpi) : true))
      .filter((client) => {
        if (filter === "NO_RESPONSIBLE") return !client.contactName;
        if (filter === "OVERDUE") return client.metrics.overdue > 0;
        if (filter === "NO_PURCHASES") return client.metrics.contracts === 0;
        return true;
      })
      .filter((client) =>
        matchesQuery(query, [
          client.name,
          clientDisplayName(client),
          clientLegalName(client),
          client.company,
          client.ruc,
          client.email,
          client.phone,
          client.contactName,
          client.contactEmail,
          client.contactPhone,
          client.billingEmail,
          client.whatsapp,
        ]),
      );
    return sortClients(list, order);
  }, [clients.data, allClients, archivedClients, query, segment, kpi, filter, order]);

  /**
   * Acciones de la fila y de la tarjeta (rediseño): una sola visible —cobrar
   * por WhatsApp si debe y hay número; si no, armar un presupuesto (con permiso);
   * si no, WhatsApp— y todo lo demás en «•••». Nada se pierde respecto de antes:
   * ficha, WhatsApp (simple y con plantilla), Instagram, sitio web y correo salen
   * del menú, y «Editar» se suma acá además de la ficha.
   */
  function rowActions(client: AdminClientRow) {
    const name = clientDisplayName(client);
    const phone = client.whatsapp || client.phone;
    const waHref = whatsappHref(phone);
    const email = client.contactEmail || client.email;
    const instagram = instagramHref(client.instagram);
    const web = websiteHref(client.website);
    const quoteHref = `/presupuestos?nuevo=1&cliente=${encodeURIComponent(client.id)}`;
    const items: AdminMenuItem[] = [
      { label: "Ver ficha", icon: "eye", href: `/clientes/${client.id}`, title: `Ver la ficha de ${name}` },
    ];
    if (canQuote) items.push({ label: "Nuevo presupuesto", icon: "plus", href: quoteHref, title: `Armar un presupuesto para ${name}` });
    if (waHref) {
      if (writable) {
        items.push({
          label: "WhatsApp con plantilla",
          icon: "pen",
          title: `Enviar por WhatsApp con plantilla a ${name}`,
          onClick: () => setTemplateTarget({ kind: "client", id: client.id, label: name, phone }),
        });
      }
      items.push({ label: "Abrir WhatsApp", icon: "external", href: waHref, external: true, title: `Escribir por WhatsApp a ${name}` });
    }
    if (email) items.push({ label: "Enviar correo", icon: "mail", href: `mailto:${email}`, external: true, title: `Enviar correo a ${name}` });
    if (instagram) items.push({ label: "Ver Instagram", icon: "instagram", href: instagram, external: true, title: `Ver el Instagram de ${name} (${instagramLabel(client.instagram)})` });
    if (web) items.push({ label: "Abrir sitio web", icon: "globe", href: web, external: true, title: `Abrir el sitio web de ${name}` });
    if (writable) items.push({ label: "Editar", icon: "edit", onClick: () => openEdit(client), title: `Editar ${name}` });
    items.push(...trash.menu({ id: client.id, name, archived: Boolean(client.archivedAt), canWrite: writable }));

    return (
      <span className="admin-actions">
        {client.metrics.overdue > 0 && waHref ? (
          <AdminWhatsappLink phone={phone} name={name} message={`Hola ${client.contactName || name}: te escribimos de LedBox por un saldo pendiente.`} />
        ) : canQuote ? (
          <AdminButtonLink size="sm" href={quoteHref} title={`Armar un presupuesto para ${name}`} aria-label={`Nuevo presupuesto para ${name}`}>
            Nuevo presupuesto
          </AdminButtonLink>
        ) : (
          <AdminWhatsappLink phone={phone} name={name} message={clientWhatsappMessage(client.contactName || name)} />
        )}
        <AdminActionsMenu label={`Más acciones de ${name}`} items={items} />
      </span>
    );
  }

  /** Mismos datos que la fila, para ancho compacto: tarjeta que abre la ficha. */
  const clientCards: AdminCardData[] = rows.map((client): AdminCardData => {
    const name = clientDisplayName(client);
    const metrics = client.metrics;
    const primaryContact = clientContactLine(client);
    return {
      id: client.id,
      title: (
        <>
          <ClientLogo client={client} size={22} />
          <Link className="admin-row-link" href={`/clientes/${client.id}`} title={`Abrir la ficha de ${name}`}>
            <strong>{name}</strong>
          </Link>
        </>
      ),
      titleTooltip: `${client.name}${client.company ? ` · ${client.company}` : ""}${client.ruc ? ` · RUC ${client.ruc}` : ""}`,
      subtitle: [clientLegalName(client), primaryContact].filter(Boolean).join(" · ") || null,
      badges: [
        { label: clientTypeLabel(client.type), tone: client.type === "RESELLER" ? "accent" : "neutral" },
        ...(client.archivedAt ? [{ label: "Archivado", tone: "neutral" as const }] : client.active ? [] : [{ label: "Inactivo", tone: "neutral" as const }]),
        ...(client.contactName
          ? []
          : [
              {
                label: "Sin responsable",
                tone: "warn" as const,
                title: `Sin responsable cargado: el portal no puede prellenar quién autoriza el presupuesto de ${name}`,
              },
            ]),
      ],
      fields: [
        { label: "Eventos", value: formatNumber(client._count.events), title: `${client._count.events} eventos` },
        {
          label: "Contratado",
          value: metrics.contracts > 0 ? formatMoney(metrics.contracted) : "—",
          title: contractedTitle(client),
        },
        { label: "Saldo", value: balanceText(client), title: balanceTitle(client) },
        {
          label: "Última actividad",
          value: metrics.lastActivityAt ? formatDateShort(metrics.lastActivityAt) : "—",
          title: activityTitle(client),
        },
      ],
      footer: rowActions(client),
    };
  });

  const totals = useMemo(() => {
    const active = portfolioKpis(clients.data ?? []);
    // Saldos sobre toda la cartera: un cliente archivado que debe sigue contando.
    const all = portfolioKpis(allClients ?? []);
    return { ...active, withBalance: all.withBalance, balanceAmount: all.balanceAmount };
  }, [clients.data, allClients]);
  const segmentCounts = useMemo(() => {
    const list = clients.data ?? [];
    return { ALL: list.length, FINAL: list.filter((c) => c.type === "FINAL").length, RESELLER: list.filter((c) => c.type === "RESELLER").length };
  }, [clients.data]);
  const toggleKpi = (key: ClientKpiKey) => setKpi((current) => (current === key ? null : key));
  const filtering = Boolean(query || kpi || segment !== "ALL" || filter !== "ALL");
  function clearFilters() {
    setQuery("");
    setKpi(null);
    setSegment("ALL");
    setFilter("ALL");
  }

  // Ayuda del front con el mismo mensaje que revalida el API (regla única); la
  // comparten el alta de Clientes y el «+ Nuevo cliente» del evento (#106).
  const fieldErrors = clientQuickErrors(form);
  const firstFieldError = clientQuickFirstError(fieldErrors);

  const savedLogo = editingId && !logoRemoved ? editingLogoVersion : null;
  const previewLogoSrc = pendingLogo?.dataUrl ?? (editingId && savedLogo ? clientLogoUrl(editingId, savedLogo) : null);
  const hasLogo = Boolean(pendingLogo) || Boolean(savedLogo);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setEditingLogoVersion(null);
    setPendingLogo(null);
    setLogoRemoved(false);
    setFormError("");
    setStatus("");
    setShowForm(true);
  }

  function openEdit(client: AdminClientRow) {
    setForm(formFromClient(client));
    setEditingId(client.id);
    setEditingLogoVersion(client.logoUpdatedAt ?? null);
    setPendingLogo(null);
    setLogoRemoved(false);
    setFormError("");
    setStatus("");
    setShowForm(true);
  }

  // «Editar» desde la ficha (/clientes/[id]) vuelve acá con `?editar=<id>`: se
  // abre el mismo formulario de edición, una sola vez por cliente.
  const searchParams = useSearchParams();
  const router = useRouter();
  const editParam = searchParams.get("editar")?.trim() ?? "";
  useEffect(() => {
    if (!editParam || !writable || !clients.data) return;
    const target = clients.data.find((client) => client.id === editParam);
    if (target) openEdit(target);
    router.replace("/clientes");
    // openEdit solo escribe estado local: basta reevaluar cuando llegan los clientes.
  }, [editParam, writable, clients.data]);

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setEditingLogoVersion(null);
    setPendingLogo(null);
    setLogoRemoved(false);
    setFormError("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (firstFieldError) {
      setFormError(firstFieldError);
      return;
    }
    setBusy(true);
    setFormError("");
    setStatus("");
    const isEditing = Boolean(editingId);
    const payload = {
      ...clientQuickPayload(form),
      notes: form.notes || null,
    };

    let clientId = editingId;
    if (editingId) {
      const result = await adminSend(`/api/admin/clients/${editingId}`, payload, "PATCH");
      if (!result.ok) {
        setBusy(false);
        setFormError(result.error);
        return;
      }
    } else {
      const result = await adminSend<{ client?: { id?: string } }>("/api/admin/clients", payload);
      if (!result.ok) {
        setBusy(false);
        setFormError(result.error);
        return;
      }
      clientId = result.data.client?.id ?? null;
    }

    // El logo necesita el id del cliente: recién guardados los datos se sube (o
    // se quita). Si falla, los datos ya quedaron guardados y se avisa tal cual.
    if (clientId && (pendingLogo || (logoRemoved && editingLogoVersion))) {
      const logoResult = pendingLogo
        ? await adminSend(`/api/admin/clients/${clientId}/logo`, {
            data: pendingLogo.base64,
            mime: pendingLogo.mime,
            width: pendingLogo.width,
            height: pendingLogo.height,
          })
        : await adminSend(`/api/admin/clients/${clientId}/logo`, undefined, "DELETE");
      if (!logoResult.ok) {
        setBusy(false);
        setEditingId(clientId);
        setEditingLogoVersion(null);
        setFormError(`Guardamos los datos del cliente, pero el logo no: ${logoResult.error}`);
        clients.reload();
        return;
      }
    }

    setBusy(false);
    setStatus(isEditing ? `Actualizamos «${clientDisplayName(form)}».` : `Cliente «${clientDisplayName(form)}» registrado.`);
    closeForm();
    clients.reload();
  }

  const previewName = clientDisplayName(form) || "Cliente";
  const baselineForm = useMemo(() => {
    const row = editingId ? (clients.data ?? []).find((client) => client.id === editingId) : null;
    return row ? formFromClient(row) : EMPTY_FORM;
  }, [editingId, clients.data]);
  const formDirty = JSON.stringify(form) !== JSON.stringify(baselineForm) || Boolean(pendingLogo) || logoRemoved;

  return (
    <div className="admin-module-page">
      <AdminModuleContext
        breadcrumb="Clientes"
        hint="A quién le vendés, cuánto te deben y quién se está enfriando."
        meta={`${formatNumber(rows.length)} visibles`}
        action={
          writable ? (
            <AdminButton
              variant="primary"
              icon="plus"
              onClick={() => {
                setFormError("");
                if (showForm && !editingId) setShowForm(false);
                else openCreate();
              }}
              aria-expanded={showForm}
            >
              Nuevo cliente
            </AdminButton>
          ) : undefined
        }
      />
      <AdminKpis className="admin-kpis--stages" state={kpiState(clients)} label="Indicadores de clientes (tocá uno para filtrar la lista)">
        <AdminKpi
          label="Activos" icon="check"
          value={formatNumber(totals.active)}
          note={`de ${formatNumber(totals.total)} en cartera`}
          tone="ok"
          onSelect={() => toggleKpi("ACTIVE")}
          active={kpi === "ACTIVE"}
        />
        <AdminKpi
          label="Con saldo pendiente" icon="alert"
          value={formatNumber(totals.withBalance)}
          note={formatMoney(totals.balanceAmount)}
          tone={totals.withBalance > 0 ? "warn" : undefined}
          onSelect={() => toggleKpi("BALANCE")}
          active={kpi === "BALANCE"}
        />
        <AdminKpi
          label="Mayoristas con link" icon="globe"
          value={formatNumber(totals.wholesaleLink)}
          note={`de ${formatNumber(totals.resellers)} mayorista${totals.resellers === 1 ? "" : "s"}`}
          tone="accent"
          onSelect={() => toggleKpi("WHOLESALE_LINK")}
          active={kpi === "WHOLESALE_LINK"}
        />
        <AdminKpi
          label="Nuevos del mes" icon="plus"
          value={formatNumber(totals.newThisMonth)}
          note="altas este mes"
          onSelect={() => toggleKpi("NEW_MONTH")}
          active={kpi === "NEW_MONTH"}
        />
        <AdminKpi
          label="Sin actividad" icon="clock"
          value={formatNumber(totals.dormant)}
          note="hace más de 6 meses"
          tone={totals.dormant > 0 ? "warn" : undefined}
          onSelect={() => toggleKpi("DORMANT")}
          active={kpi === "DORMANT"}
        />
      </AdminKpis>
      {truncated ? (
        <AdminNote tone="warn">
          Mostrando hasta 200 coincidencias: los indicadores corresponden a estos resultados. La búsqueda consulta toda la cartera.
        </AdminNote>
      ) : null}

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar clientes"
          placeholder="Buscar por nombre, RUC, teléfono o correo…"
        />
        <AdminTabs
          filters
          className="admin-segments"
          label="Tipo de cliente"
          value={segment}
          onChange={(key) => setSegment(key as ClientSegment)}
          items={CLIENT_SEGMENTS.map((item) => ({ key: item.key, label: item.label, count: segmentCounts[item.key] }))}
        />
        <AdminSelect value={filter} onChange={setFilter} label="Filtrar la cartera" options={FILTER_OPTIONS} />
        <AdminSelect value={order} onChange={setOrder} label="Ordenar clientes por" options={ORDER_OPTIONS} />
        {/* En ancho compacto lista y cuadrícula se ven igual (tarjetas): el
            conmutador no aporta y se retira de la barra (issue #139). */}
        {narrow ? null : (
          <AdminViewSwitch view={view} onChange={setView} label="Vista de clientes" views={CLIENTES_VIEWS} />
        )}
      </AdminToolbar>

      {status ? <AdminNote tone="ok">{status}</AdminNote> : null}
      {trash.note}
      {writable ? trash.dialog : null}

      {writable && showForm ? (
        <AdminDialog
          title={editingId ? `Editar cliente · ${clientDisplayName(form) || "sin nombre"}` : "Nuevo cliente"}
          icon="clients"
          size="wide"
          description={
            editingId
              ? "Datos de contacto, fiscales, notas y logo del cliente."
              : "Alta rápida: alcanza con el nombre. El resto se puede completar después."
          }
          dirty={formDirty}
          error={formError}
          onClose={closeForm}
          footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={clientFormId} busy={busy} busyLabel="Guardando…">
                {editingId ? "Guardar cambios" : "Registrar cliente"}
              </AdminButton>
            </>
          )}
        >
          <form id={clientFormId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
            {/* Alta rápida (issue #106): Datos y Contacto a la vista con foco en el
                nombre; fiscal, ubicación y lo avanzado plegados (abiertos al editar,
                y no se pierde lo cargado al plegar). */}
            <ClientQuickFields
              key={editingId ?? "nuevo"}
              layout="sections"
              values={form}
              onChange={(patch) => setForm({ ...form, ...patch })}
              errors={fieldErrors}
              autoFocus={!editingId}
              moreOpen={Boolean(editingId)}
            />
            <AdminDialogSection title="Notas y logo" collapsible defaultOpen={Boolean(editingId)} hint="notas internas y logo del cliente">
              <TextAreaField
                label="Notas internas"
                maxLength={FIELD_LIMITS.notes}
                rows={3}
                wide
                value={form.notes}
                onChange={(value) => setForm({ ...form, notes: value })}
                placeholder="Acuerdos, condiciones de facturación, contactos alternos…"
              />
              <div className="admin-form-group admin-form-group--image admin-client-logo">
                <span className="admin-form-group-title">Logo</span>
                <AdminImageUpload
                  label="Logo del cliente"
                  mode="logo"
                  hint="JPG, PNG o WebP hasta 1 MB; se recorta y comprime en el navegador. Sin logo queda el monograma de iniciales."
                  preview={<AdminAvatar name={previewName} src={previewLogoSrc} size={64} title={`Logo de ${previewName}`} />}
                  busy={busy}
                  onPrepared={(image) => {
                    setPendingLogo(image);
                    setLogoRemoved(false);
                  }}
                  onRemove={
                    hasLogo
                      ? () => {
                          setPendingLogo(null);
                          setLogoRemoved(true);
                        }
                      : undefined
                  }
                  removeLabel="Quitar logo"
                />
              </div>
            </AdminDialogSection>
          </form>
        </AdminDialog>
      ) : null}

      <AdminDataState
        loading={clients.loading}
        error={clients.error}
        onRetry={clients.reload}
        empty={(allClients ?? []).length === 0}
        emptyTitle="Todavía no hay clientes" emptyIcon="clients"
        emptyHint="Registrá el primer cliente para asociarle eventos y presupuestos."
        emptyAction={writable ? <AdminButton type="button" variant="link" onClick={openCreate}>Registrar cliente →</AdminButton> : undefined}
      >
        {rows.length === 0 ? (
          <AdminEmpty
            icon="search"
            title="Sin resultados"
            hint="Probá con otro término de búsqueda o cambiá los filtros."
            action={filtering ? <AdminButton type="button" variant="link" onClick={clearFilters}>Quitar filtros →</AdminButton> : undefined}
          />
        ) : cardView ? (
          <AdminCardGrid label="Clientes" cards={clientCards} />
        ) : (
          <AdminTable
            view="clientes"
            label="Clientes"
            columns={[
              { label: "Cliente" },
              { label: "Tipo" },
              { label: "Contacto" },
              { label: "Eventos", end: true },
              { label: "Contratado", end: true },
              { label: "Saldo", end: true },
              { label: "Actividad", end: true },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((client) => {
              const name = clientDisplayName(client);
              const metrics = client.metrics;
              const contact = clientContactLine(client);
              const contactTitle =
                [client.contactName, client.contactPhone || client.phone, client.contactEmail || client.email].filter(Boolean).join(" · ") ||
                "Sin contacto cargado";
              return (
                <AdminRow key={client.id}>
                  <AdminCell title={`${client.name}${client.company ? ` · ${client.company}` : ""}${client.ruc ? ` · RUC ${client.ruc}` : ""}`}>
                    <span className="admin-identity">
                      <ClientLogo client={client} size={22} />
                      {/* Enlace extendido: toda la fila abre la ficha (teclado y clic
                          derecho incluidos); las acciones quedan por encima. */}
                      <Link className="admin-row-link" href={`/clientes/${client.id}`} title={`Abrir la ficha de ${name}`}>
                        <strong>{name}</strong>
                      </Link>
                      {clientLegalName(client) ? <small className="admin-cell-sub"> · {clientLegalName(client)}</small> : null}
                      {client.archivedAt ? <AdminBadge tone="neutral">Archivado</AdminBadge> : client.active ? null : <AdminBadge tone="neutral">Inactivo</AdminBadge>}
                    </span>
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={client.type === "RESELLER" ? "accent" : "neutral"}>{clientTypeLabel(client.type)}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={contactTitle}>
                    {/* Sin responsable cargado, la aprobación del presupuesto no
                        tiene a quién prellenarle el nombre. */}
                    {client.contactName ? null : (
                      <AdminBadge
                        tone="warn"
                        label={`Sin responsable cargado: el portal no puede prellenar quién autoriza el presupuesto de ${name}`}
                        title={`Sin responsable cargado: el portal no puede prellenar quién autoriza el presupuesto de ${name}`}
                      >
                        <AdminIcon name="alert" size={11} />
                      </AdminBadge>
                    )}{" "}
                    {contact || "—"}
                  </AdminCell>
                  <AdminCell end title={`${client._count.events} eventos`}>
                    {formatNumber(client._count.events)}
                  </AdminCell>
                  <AdminCell end title={contractedTitle(client)}>
                    {metrics.contracts > 0 ? <span className="admin-nowrap">{formatMoney(metrics.contracted)}</span> : <span className="admin-muted">—</span>}
                  </AdminCell>
                  <AdminCell end title={balanceTitle(client)}>
                    {metrics.balance > 0 ? (
                      <span className="admin-nowrap" data-tone={metrics.overdue > 0 ? "danger" : undefined}>
                        {formatMoney(metrics.balance)}
                      </span>
                    ) : (
                      <span className="admin-muted">—</span>
                    )}
                  </AdminCell>
                  <AdminCell end title={activityTitle(client)}>
                    {metrics.lastActivityAt ? formatDateShort(metrics.lastActivityAt) : <span className="admin-muted">—</span>}
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    {rowActions(client)}
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>

      {templateTarget ? <MessageTemplateSendDialog target={templateTarget} onClose={() => setTemplateTarget(null)} /> : null}
    </div>
  );
}
