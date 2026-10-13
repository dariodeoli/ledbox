"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  clientTypeLabel,
  formatDate,
  formatDateShort,
  formatMoney,
  formatNumber,
  instagramHref,
  instagramLabel,
  websiteHref,
  whatsappHref,
} from "@/lib/admin-format";
import { canWriteClients, matchesQuery } from "@/lib/admin-policy";
import { clientDisplayName, clientLegalName } from "@/lib/client-identity";
import { clientLogoUrl } from "@/lib/admin-types";
import type { AdminClientRow } from "@/lib/admin-types";
import type { PreparedIdentityImage } from "@/lib/identity-image";
import { AdminIcon } from "../AdminIcons";
import { useAdminSession } from "../AdminShell";
import { AdminAvatar } from "../AdminAvatar";
import {
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
  AdminWhatsappTemplateButton,
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

const TYPE_OPTIONS = [
  { value: "ALL", label: "Todos los tipos" },
  { value: "FINAL", label: "Cliente final" },
  { value: "RESELLER", label: "Mayorista / revendedor" },
];

// La cartera se filtra por hechos reales (issue #34): deuda vencida (cobros
// pendientes con vencimiento pasado) y clientes que todavía no cerraron ningún
// contrato (ningún presupuesto aprobado).
const FILTER_OPTIONS = [
  { value: "ALL", label: "Toda la cartera" },
  { value: "NO_RESPONSIBLE", label: "Sin responsable cargado" },
  { value: "OVERDUE", label: "Con deuda vencida" },
  { value: "NO_PURCHASES", label: "Sin compras" },
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
 * Links directos del cliente (issue #36): WhatsApp con el mensaje prellenado,
 * Instagram y sitio web. Cada link sale de su propio dato —cuando falta, no se
 * dibuja ni se reemplaza por otro— y el WhatsApp usa el número propio si
 * difiere del teléfono general.
 */
export function ClientLinks({
  client,
  name,
  message,
  compact = false,
  skipWhatsapp = false,
}: {
  client: Pick<AdminClientRow, "phone" | "whatsapp" | "website" | "instagram">;
  name: string;
  message?: string | null;
  compact?: boolean;
  /** Con envío por plantilla disponible, el link simple no se dibuja. */
  skipWhatsapp?: boolean;
}) {
  const instagram = instagramHref(client.instagram);
  const instagramHandle = instagramLabel(client.instagram);
  const web = websiteHref(client.website);
  return (
    <>
      {skipWhatsapp ? null : <AdminWhatsappLink phone={client.whatsapp || client.phone} name={name} message={compact ? null : message} />}
      {instagram ? (
        <AdminIconLink
          href={instagram}
          icon="instagram"
          label={`Ver el Instagram de ${name} (${instagramHandle})`}
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
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? []);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
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

  const rows = useMemo(() => {
    const list = (clients.data ?? [])
      .filter((client) => (type === "ALL" ? true : client.type === type))
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
        ]),
      );
    return sortClients(list, order);
  }, [clients.data, query, type, filter, order]);

  /**
   * Tarjetas del cliente (issues #57 y #139): las comparten la cuadrícula y la
   * lista en ancho compacto —cliente, contacto principal, deuda, última
   * actividad y estado— con las mismas acciones que la fila.
   */
  const clientCards: AdminCardData[] = rows.map((client): AdminCardData => {
    const name = clientDisplayName(client);
    const metrics = client.metrics;
    const contact = [client.contactPhone || client.phone, client.contactEmail || client.email].filter(Boolean).join(" · ");
    const lastActivity = metrics.lastActivityAt ? formatDateShort(metrics.lastActivityAt) : null;
    // Contacto principal (issues #57 y #139): el encargado manda sobre el
    // teléfono general; el resto de los datos sigue en la ficha.
    const primaryContact = client.contactName
      ? [client.contactName, client.contactPhone || client.phone].filter(Boolean).join(" · ")
      : contact;
    return {
      id: client.id,
      title: (
        <>
          <ClientLogo client={client} size={22} />
          <strong>{name}</strong>
        </>
      ),
      titleTooltip: `${client.name}${client.company ? ` · ${client.company}` : ""}${client.ruc ? ` · RUC ${client.ruc}` : ""}`,
      subtitle: [client.company && client.company !== name ? client.company : null, primaryContact].filter(Boolean).join(" · ") || null,
      badges: [
        { label: clientTypeLabel(client.type), tone: client.type === "RESELLER" ? "accent" : "neutral" },
        { label: client.active ? "Activo" : "Inactivo", tone: client.active ? "ok" : "neutral" },
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
        {
          label: "Contratado",
          value: metrics.contracts > 0 ? formatMoney(metrics.contracted) : "—",
          title:
            metrics.contracts > 0
              ? `${formatNumber(metrics.contracts)} contrato${metrics.contracts === 1 ? "" : "s"} · ticket promedio ${formatMoney(metrics.averageTicket)}`
              : "Sin contratos aprobados",
        },
        { label: "Eventos", value: formatNumber(client._count.events), title: `${client._count.events} eventos` },
        { label: "Presupuestos", value: formatNumber(client._count.budgets), title: `${client._count.budgets} presupuestos` },
        {
          label: "Deuda vencida",
          value: metrics.overdue > 0 ? formatMoney(metrics.overdue) : "—",
          title:
            metrics.overdue > 0
              ? `${formatMoney(metrics.overdue)} en ${formatNumber(metrics.overdueCount)} cobro${metrics.overdueCount === 1 ? "" : "s"} vencido${metrics.overdueCount === 1 ? "" : "s"}`
              : "Sin cobros vencidos",
        },
        {
          label: "Última actividad",
          value: lastActivity ?? "—",
          title: metrics.lastActivityAt
            ? `Última actividad comercial: ${formatDate(metrics.lastActivityAt)}`
            : "Sin actividad comercial registrada",
        },
      ],
      footer: (
        <span className="admin-actions">
          <AdminIconLink href={`/clientes/${client.id}`} icon="eye" label={`Ver la ficha de ${name}`} />
          <ClientLinks client={client} name={name} compact skipWhatsapp={writable} />
          {writable && whatsappHref(client.whatsapp || client.phone) ? (
            <AdminWhatsappTemplateButton
              title={`Enviar por WhatsApp con plantilla a ${name}`}
              onClick={() =>
                setTemplateTarget({
                  kind: "client",
                  id: client.id,
                  label: name,
                  phone: client.whatsapp || client.phone,
                })
              }
            />
          ) : null}
          {client.contactEmail || client.email ? (
            <AdminIconLink
              href={`mailto:${client.contactEmail || client.email}`}
              icon="mail"
              label={`Enviar correo a ${name}`}
            />
          ) : null}
        </span>
      ),
    };
  });

  const totals = useMemo(() => {
    const list = clients.data ?? [];
    return {
      total: list.length,
      active: list.filter((client) => client.active).length,
      resellers: list.filter((client) => client.type === "RESELLER").length,
      overdue: list.filter((client) => client.metrics.overdue > 0).length,
      overdueAmount: list.reduce((sum, client) => sum + client.metrics.overdue, 0),
      overdueCount: list.reduce((sum, client) => sum + client.metrics.overdueCount, 0),
    };
  }, [clients.data]);

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
        hint="Cartera, responsables y actividad comercial en una vista operativa."
        meta={`${formatNumber(rows.length)} visibles`}
      />
      <AdminKpis loading={clients.data == null} label="Indicadores de clientes">
        <AdminKpi label="Clientes" icon="clients" value={formatNumber(totals.total)} note="en cartera" />
        <AdminKpi label="Activos" icon="check" value={formatNumber(totals.active)} note="habilitados" tone="ok" />
        <AdminKpi
          label="Con deuda vencida" icon="alert"
          value={formatNumber(totals.overdue)}
          note={`${formatNumber(totals.overdueCount)} cobro${totals.overdueCount === 1 ? "" : "s"} vencido${totals.overdueCount === 1 ? "" : "s"}`}
          tone={totals.overdue > 0 ? "danger" : undefined}
        />
        <AdminKpi
          label="Deuda vencida" icon="alert"
          value={formatMoney(totals.overdueAmount)}
          note="cobros pendientes con vencimiento pasado"
          tone={totals.overdueAmount > 0 ? "danger" : undefined}
        />
        <AdminKpi label="Revendedores" icon="clients" value={formatNumber(totals.resellers)} note="mayoristas" tone="accent" />
      </AdminKpis>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar clientes"
          placeholder="Buscar por nombre, empresa, RUC o contacto…"
        />
        <AdminSelect value={type} onChange={setType} label="Filtrar por tipo" options={TYPE_OPTIONS} />
        <AdminSelect value={filter} onChange={setFilter} label="Filtrar la cartera" options={FILTER_OPTIONS} />
        <AdminSelect value={order} onChange={setOrder} label="Ordenar clientes por" options={ORDER_OPTIONS} />
        {/* En ancho compacto lista y cuadrícula se ven igual (tarjetas): el
            conmutador no aporta y se retira de la barra (issue #139). */}
        {narrow ? null : (
          <AdminViewSwitch view={view} onChange={setView} label="Vista de clientes" views={CLIENTES_VIEWS} />
        )}
        {writable ? (
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
        ) : null}
      </AdminToolbar>

      {status ? <AdminNote tone="ok">{status}</AdminNote> : null}

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
          onClose={closeForm}
          footer={({ requestClose }) => (
            <>
              {formError ? (
                <div className="admin-dialog-footer-note">
                  <AdminNote tone="error">{formError}</AdminNote>
                </div>
              ) : null}
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={clientFormId} busy={busy}>
                {editingId ? "Guardar cambios" : "Registrar cliente"}
              </AdminButton>
            </>
          )}
        >
          <form id={clientFormId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
            {/* Alta rápida (issue #106): Nombre con foco + teléfono/correo; el
                resto vive en «Más datos» y no se pierde al plegarlo. */}
            <AdminDialogSection>
              <ClientQuickFields
                key={editingId ?? "nuevo"}
                values={form}
                onChange={(patch) => setForm({ ...form, ...patch })}
                errors={fieldErrors}
                autoFocus={!editingId}
                moreOpen={Boolean(editingId)}
              >
                <div className="admin-form-group admin-form-group--wide">
                  <span className="admin-form-group-title">Notas</span>
                  <TextAreaField
                    label="Notas internas"
                    maxLength={FIELD_LIMITS.notes}
                    rows={3}
                    wide
                    value={form.notes}
                    onChange={(value) => setForm({ ...form, notes: value })}
                    placeholder="Acuerdos, condiciones de facturación, contactos alternos…"
                  />
                </div>

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
              </ClientQuickFields>
            </AdminDialogSection>
          </form>
        </AdminDialog>
      ) : null}

      <AdminDataState
        loading={clients.loading}
        error={clients.error}
        onRetry={clients.reload}
        empty={(clients.data ?? []).length === 0}
        emptyTitle="Todavía no hay clientes" emptyIcon="clients"
        emptyHint="Registrá el primer cliente para asociarle eventos y presupuestos."
        emptyAction={writable ? <button type="button" className="admin-empty-link" onClick={openCreate}>Registrar cliente →</button> : undefined}
      >
        {rows.length === 0 ? (
          <AdminEmpty
            icon="search"
            title="Sin resultados"
            hint="Probá con otro término de búsqueda o cambiá el filtro."
            action={query ? <button type="button" className="admin-empty-link" onClick={() => setQuery("")}>Limpiar búsqueda →</button> : undefined}
          />
        ) : cardView ? (
          <AdminCardGrid label="Clientes" cards={clientCards} />
        ) : (
          <AdminTable
            view="clientes"
            label="Clientes"
            columns={[
              { label: "Cliente" },
              { label: "Contacto" },
              { label: "Tipo" },
              { label: "Contratado", end: true },
              { label: "Eventos", end: true },
              { label: "Presup.", end: true },
              { label: "Deuda vencida", end: true },
              { label: "Última actividad", end: true },
              { label: "Estado" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((client) => {
              const name = clientDisplayName(client);
              const metrics = client.metrics;
              // Contacto principal de la fila (issue #139): el teléfono. El
              // correo, Instagram, la web y WhatsApp salen de la grilla —el
              // ancho de la tabla era el problema— y quedan en la ficha.
              const contact = client.contactPhone || client.phone;
              const contactTitle =
                [client.contactName, contact, client.contactEmail || client.email].filter(Boolean).join(" · ") ||
                "Sin contacto cargado";
              return (
                <AdminRow key={client.id}>
                  <AdminCell title={`${client.name}${client.company ? ` · ${client.company}` : ""}${client.ruc ? ` · RUC ${client.ruc}` : ""}`}>
                    <span className="admin-identity">
                      <ClientLogo client={client} size={22} />
                      <strong>{name}</strong>
                      {clientLegalName(client) ? <small className="admin-cell-sub"> · {clientLegalName(client)}</small> : null}
                    </span>
                  </AdminCell>
                  <AdminCell title={contactTitle}>
                    {/* Señal compacta del dato que falta para el portal: sin
                        responsable cargado, la aprobación del presupuesto no
                        tiene a quién prellenarle el nombre. El chip va primero
                        para que el ancho fijo de la columna no lo recorte. */}
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
                  <AdminCell>
                    <AdminBadge tone={client.type === "RESELLER" ? "accent" : "neutral"}>{clientTypeLabel(client.type)}</AdminBadge>
                  </AdminCell>
                  <AdminCell
                    end
                    title={
                      metrics.contracts > 0
                        ? `${formatNumber(metrics.contracts)} contrato${metrics.contracts === 1 ? "" : "s"} · ticket promedio ${formatMoney(metrics.averageTicket)}`
                        : "Sin contratos aprobados"
                    }
                  >
                    {metrics.contracts > 0 ? <span className="admin-nowrap">{formatMoney(metrics.contracted)}</span> : <span className="admin-muted">—</span>}
                  </AdminCell>
                  <AdminCell end title={`${client._count.events} eventos`}>
                    {formatNumber(client._count.events)}
                  </AdminCell>
                  <AdminCell end title={`${client._count.budgets} presupuestos`}>
                    {formatNumber(client._count.budgets)}
                  </AdminCell>
                  <AdminCell
                    end
                    title={
                      metrics.overdue > 0
                        ? `${formatMoney(metrics.overdue)} en ${formatNumber(metrics.overdueCount)} cobro${metrics.overdueCount === 1 ? "" : "s"} vencido${metrics.overdueCount === 1 ? "" : "s"}`
                        : "Sin cobros vencidos"
                    }
                  >
                    {metrics.overdue > 0 ? (
                      <span className="admin-nowrap" data-tone="danger">
                        {formatMoney(metrics.overdue)}
                      </span>
                    ) : (
                      <span className="admin-muted">—</span>
                    )}
                  </AdminCell>
                  <AdminCell
                    end
                    title={
                      metrics.lastActivityAt
                        ? `Última actividad comercial: ${formatDate(metrics.lastActivityAt)}`
                        : "Sin actividad comercial registrada"
                    }
                  >
                    {metrics.lastActivityAt ? formatDateShort(metrics.lastActivityAt) : <span className="admin-muted">—</span>}
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={client.active ? "ok" : "neutral"}>{client.active ? "Activo" : "Inactivo"}</AdminBadge>
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    {/* La fila se queda con la ficha (issue #139): los links de
                        contacto salen de la grilla y viven en el detalle. */}
                    <span className="admin-actions">
                      <AdminIconLink href={`/clientes/${client.id}`} icon="eye" label={`Ver la ficha de ${name}`} />
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>


      {templateTarget ? (
        <MessageTemplateSendDialog target={templateTarget} onClose={() => setTemplateTarget(null)} />

      ) : null}
    </div>
  );
}
