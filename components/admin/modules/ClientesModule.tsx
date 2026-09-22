"use client";

import { useMemo, useState } from "react";
import {
  budgetStatusLabel,
  checklistProgress,
  clientTypeLabel,
  clientWhatsappMessage,
  CLIENT_LINK_MESSAGES,
  contactPhoneValid,
  eventStatusLabel,
  formatCountdown,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatMonths,
  formatNumber,
  formatTime,
  instagramHref,
  instagramLabel,
  instagramValid,
  isOverdue,
  isUpcomingWithin,
  paymentStatusLabel,
  paymentStatusTone,
  statusTone,
  websiteHref,
  websiteValid,
  whatsappHref,
} from "@/lib/admin-format";
import { canWrite, matchesQuery } from "@/lib/admin-policy";
import { clientLogoUrl } from "@/lib/admin-types";
import type {
  AdminClientBudgetRow,
  AdminClientDetail,
  AdminClientEventRow,
  AdminClientPaymentRow,
  AdminClientRow,
} from "@/lib/admin-types";
import type { PreparedIdentityImage } from "@/lib/identity-image";
import { AdminIcon } from "../AdminIcons";
import { useAdminSession } from "../AdminShell";
import { AdminAvatar } from "../AdminAvatar";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminDialog,
  AdminEmpty,
  AdminFormPanel,
  AdminIconLink,
  AdminImageUpload,
  AdminKpi,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  AdminWhatsappLink,
  AdminWhatsappTemplateButton,
} from "../AdminUI";
import { MessageTemplateSendDialog, type MessageTemplateTarget } from "../AdminMessageTemplateDialog";
import { EmailField, PhoneField, SearchField, SelectField, TextAreaField, TextField } from "../AdminFields";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { FIELD_LIMITS, FIELD_MESSAGES, emailValid } from "@/lib/field-rules";

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

function clientLabel(client: Pick<AdminClientRow, "name" | "company">): string {
  return client.company?.trim() || client.name;
}

function activityTime(client: Pick<AdminClientRow, "metrics">): number {
  return client.metrics.lastActivityAt ? new Date(client.metrics.lastActivityAt).getTime() : 0;
}

function compareByName(a: AdminClientRow, b: AdminClientRow): number {
  return clientLabel(a).localeCompare(clientLabel(b), "es");
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
    return {
      label: "Vencido",
      tone: "danger",
      title: `Cobro pendiente con vencimiento el ${formatDate(payment.dueAt)}`,
    };
  }
  return {
    label: paymentStatusLabel(payment.status),
    tone: paymentStatusTone(payment.status),
    title: payment.status === "PENDING" && payment.dueAt ? `Vence el ${formatDate(payment.dueAt)}` : "Estado real del cobro",
  };
}

/**
 * Identidad del cliente (issue #36): logo subido servido con sesión o el
 * monograma de iniciales del avatar único del panel. Nunca un `<img>` a mano.
 */
function ClientLogo({
  client,
  size = 22,
  title,
}: {
  client: Pick<AdminClientRow, "id" | "name" | "company" | "logoUpdatedAt">;
  size?: 22 | 40 | 64;
  title?: string;
}) {
  const name = clientLabel(client);
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
function ClientLinks({
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
  const [detail, setDetail] = useState<AdminClientRow | null>(null);
  /** Envío por WhatsApp con plantilla (issue #35) para el cliente elegido. */
  const [templateTarget, setTemplateTarget] = useState<MessageTemplateTarget | null>(null);

  const writable = canWrite(role);

  const rows = useMemo(() => {
    const list = (clients.data ?? [])
      .filter((client) => (type === "ALL" ? true : client.type === type))
      .filter((client) => {
        if (filter === "OVERDUE") return client.metrics.overdue > 0;
        if (filter === "NO_PURCHASES") return client.metrics.contracts === 0;
        return true;
      })
      .filter((client) =>
        matchesQuery(query, [
          client.name,
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

  // Ayuda del front con el mismo mensaje que revalida el API (regla única).
  const fieldErrors = {
    phone: form.phone && !contactPhoneValid(form.phone) ? FIELD_MESSAGES.phone : null,
    email: form.email && !emailValid(form.email) ? FIELD_MESSAGES.email : null,
    contactPhone: form.contactPhone && !contactPhoneValid(form.contactPhone) ? FIELD_MESSAGES.phone : null,
    contactEmail: form.contactEmail && !emailValid(form.contactEmail) ? FIELD_MESSAGES.email : null,
    website: form.website && !websiteValid(form.website) ? CLIENT_LINK_MESSAGES.website : null,
    instagram: form.instagram && !instagramValid(form.instagram) ? CLIENT_LINK_MESSAGES.instagram : null,
    whatsapp: form.whatsapp && !contactPhoneValid(form.whatsapp) ? FIELD_MESSAGES.phone : null,
  };
  const firstFieldError = Object.values(fieldErrors).find(Boolean) ?? "";

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
    setDetail(null);
    setShowForm(true);
  }

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
    if (firstFieldError) {
      setFormError(firstFieldError);
      return;
    }
    setBusy(true);
    setFormError("");
    setStatus("");
    const isEditing = Boolean(editingId);
    const payload = {
      name: form.name,
      company: form.company || null,
      type: form.type,
      ruc: form.ruc || null,
      phone: form.phone || null,
      email: form.email || null,
      contactName: form.contactName || null,
      contactRole: form.contactRole || null,
      contactPhone: form.contactPhone || null,
      contactEmail: form.contactEmail || null,
      website: form.website || null,
      instagram: form.instagram || null,
      whatsapp: form.whatsapp || null,
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
    setStatus(isEditing ? `Actualizamos «${form.name}».` : `Cliente «${form.name}» registrado.`);
    closeForm();
    clients.reload();
  }

  const previewName = form.company || form.name || "Cliente";

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de clientes">
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
      </section>

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
        <AdminFormPanel
          title={editingId ? `Editar cliente · ${form.name || "sin nombre"}` : "Nuevo cliente"}
          submitLabel={editingId ? "Guardar cambios" : "Registrar cliente"}
          onSubmit={submit}
          onCancel={closeForm}
          busy={busy}
          status={formError}
        >
          <div className="admin-form-group">
            <span className="admin-form-group-title">Cliente</span>
            <TextField
              label="Nombre"
              required
              maxLength={FIELD_LIMITS.name}
              value={form.name}
              onChange={(value) => setForm({ ...form, name: value })}
              placeholder="Ej.: Samsung Paraguay"
              hint="Como figura en la cartera; si es una persona, su nombre."
            />
            <TextField
              label="Empresa"
              maxLength={FIELD_LIMITS.company}
              value={form.company}
              onChange={(value) => setForm({ ...form, company: value })}
              placeholder="Ej.: Samsung Paraguay"
            />
            <SelectField
              label="Tipo"
              value={form.type}
              onChange={(value) => setForm({ ...form, type: value })}
              options={[
                { value: "FINAL", label: "Cliente final" },
                { value: "RESELLER", label: "Mayorista / revendedor" },
              ]}
            />
            <TextField
              label="RUC / CI"
              maxLength={30}
              value={form.ruc}
              onChange={(value) => setForm({ ...form, ruc: value })}
              placeholder="80012345-6"
              inputMode="numeric"
            />
          </div>

          <div className="admin-form-group">
            <span className="admin-form-group-title">Contacto general</span>
            <PhoneField
              label="Teléfono"
              hint="Con código de país"
              value={form.phone}
              onChange={(value) => setForm({ ...form, phone: value })}
              error={fieldErrors.phone}
            />
            <EmailField
              label="Correo"
              value={form.email}
              onChange={(value) => setForm({ ...form, email: value })}
              placeholder="contacto@empresa.com"
              error={fieldErrors.email}
            />
          </div>

          <div className="admin-form-group">
            <span className="admin-form-group-title">Persona encargada</span>
            <TextField
              label="Nombre del encargado"
              maxLength={FIELD_LIMITS.name}
              value={form.contactName}
              onChange={(value) => setForm({ ...form, contactName: value })}
              placeholder="Ej.: María González"
            />
            <TextField
              label="Cargo"
              maxLength={FIELD_LIMITS.name}
              value={form.contactRole}
              onChange={(value) => setForm({ ...form, contactRole: value })}
              placeholder="Ej.: Gerenta de marketing"
            />
            <PhoneField
              label="Teléfono directo"
              value={form.contactPhone}
              onChange={(value) => setForm({ ...form, contactPhone: value })}
              error={fieldErrors.contactPhone}
            />
            <EmailField
              label="Correo directo"
              value={form.contactEmail}
              onChange={(value) => setForm({ ...form, contactEmail: value })}
              error={fieldErrors.contactEmail}
            />
          </div>

          <div className="admin-form-group">
            <span className="admin-form-group-title">Links directos</span>
            <TextField
              label="Sitio web"
              maxLength={200}
              value={form.website}
              onChange={(value) => setForm({ ...form, website: value })}
              placeholder="empresa.com.py"
              inputMode="url"
              error={fieldErrors.website}
              hint="Sin «https://» también funciona."
            />
            <TextField
              label="Instagram"
              maxLength={64}
              value={form.instagram}
              onChange={(value) => setForm({ ...form, instagram: value })}
              placeholder="@empresa"
              error={fieldErrors.instagram}
              hint="El usuario con arroba o el link del perfil."
            />
            <PhoneField
              label="WhatsApp"
              hint="Solo si difiere del teléfono general"
              value={form.whatsapp}
              onChange={(value) => setForm({ ...form, whatsapp: value })}
              error={fieldErrors.whatsapp}
            />
          </div>

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

          <div className="admin-form-group admin-form-group--image">
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
        </AdminFormPanel>
      ) : null}

      <AdminDataState
        loading={clients.loading}
        error={clients.error}
        onRetry={clients.reload}
        empty={(clients.data ?? []).length === 0}
        emptyTitle="Todavía no hay clientes" emptyIcon="clients"
        emptyHint="Registrá el primer cliente para asociarle eventos y presupuestos."
      >
        {rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro." />
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
              const name = clientLabel(client);
              const metrics = client.metrics;
              const contact = [client.contactPhone || client.phone, client.contactEmail || client.email].filter(Boolean).join(" · ");
              return (
                <AdminRow key={client.id}>
                  <AdminCell title={`${client.name}${client.company ? ` · ${client.company}` : ""}${client.ruc ? ` · RUC ${client.ruc}` : ""}`}>
                    <span className="admin-identity">
                      <ClientLogo client={client} size={22} />
                      <strong>{name}</strong>
                      {client.company && client.name !== client.company ? <small className="admin-cell-sub"> · {client.name}</small> : null}
                    </span>
                  </AdminCell>
                  <AdminCell title={[client.phone, client.email].filter(Boolean).join(" · ") || "Sin contacto cargado"}>
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
                    <span className="admin-actions">
                      <AdminButton
                        icon="eye"
                        title={`Ver la ficha de ${name}`}
                        aria-label={`Ver la ficha de ${name}`}
                        onClick={() => setDetail(client)}
                      />
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
                      {!whatsappHref(client.whatsapp || client.phone) && !client.contactEmail && !client.email && !instagramLabel(client.instagram) && !websiteHref(client.website) ? (
                        <span className="admin-muted">—</span>
                      ) : null}
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>

      {detail ? (
        <ClientDetailDialog
          client={detail}
          writable={writable}
          onEdit={openEdit}
          onClose={() => setDetail(null)}
        />
      ) : null}

      {templateTarget ? (
        <MessageTemplateSendDialog target={templateTarget} onClose={() => setTemplateTarget(null)} />

      ) : null}
    </div>
  );
}

/**
 * Ficha 360 del cliente (issue #34): métricas reales, presupuestos, eventos y
 * cobros del cliente abierto. Es solo lectura (VIEWER incluido): el API resuelve
 * la empresa activa y los datos salen tal cual de la base. La identidad, la
 * persona encargada y los links directos llegan del issue #36.
 *
 * La cronología del issue #33 se enchufa en el bloque «Historial», junto a las
 * listas, cuando el integrador una `lib/server/timeline.ts`.
 */
function ClientDetailDialog({
  client,
  writable,
  onEdit,
  onClose,
}: {
  client: AdminClientRow;
  writable: boolean;
  onEdit: (client: AdminClientRow) => void;
  onClose: () => void;
}) {
  const name = clientLabel(client);
  const detail = useAdminResource(`/api/admin/clients/${client.id}`, (payload) => payload.clientDetail ?? null);

  return (
    <AdminDialog title={`Ficha del cliente · ${name}`} size="ficha" icon="clients" onClose={onClose}>
      <AdminDataState
        loading={detail.loading}
        error={detail.error}
        onRetry={detail.reload}
        rows={6}
        empty={!detail.data}
        emptyTitle="Sin datos del cliente" emptyIcon="clients"
        emptyHint="No pudimos leer la ficha de este cliente."
      >
        {detail.data ? <ClientDetailBody detail={detail.data} writable={writable} onEdit={onEdit} /> : null}
      </AdminDataState>
    </AdminDialog>
  );
}

function ClientDetailBody({
  detail,
  writable,
  onEdit,
}: {
  detail: AdminClientDetail;
  writable: boolean;
  onEdit: (client: AdminClientRow) => void;
}) {
  const { client, metrics } = detail;
  const name = clientLabel(client);
  const budgets = detail.budgets;
  const events = useMemo(() => sortClientEvents(detail.events), [detail.events]);
  const payments = detail.payments;
  const contact = client.contactName || client.contactRole || client.contactPhone || client.contactEmail;

  return (
    <>
      <header className="admin-client-head">
        <div className="admin-client-id">
          <ClientLogo client={client} size={64} />
          <div className="admin-client-id-text">
            <div className="admin-client-title">
              <strong className="admin-client-name">{name}</strong>
              <AdminBadge tone={client.type === "RESELLER" ? "accent" : "neutral"}>{clientTypeLabel(client.type)}</AdminBadge>
              <AdminBadge tone={client.active ? "ok" : "neutral"}>{client.active ? "Activo" : "Inactivo"}</AdminBadge>
            </div>
            {/* Sin encargado cargado se mantiene el responsable del alta (mismo
                objeto de identidad, sin reordenar ni inventar otro dato). */}
            {client.company && client.name !== client.company && !client.contactName ? (
              <span className="admin-client-person">{client.name}</span>
            ) : null}
          </div>
          <span className="admin-actions admin-client-links">
            {writable ? (
              <AdminButton
                icon="edit"
                title={`Editar ${name}`}
                aria-label={`Editar ${name}`}
                onClick={() => onEdit(detail.client)}
              />
            ) : null}
            <ClientLinks client={client} name={name} message={clientWhatsappMessage(client.contactName || name)} />
          </span>
        </div>

        {contact ? (
          <div className="admin-client-person-card">
            <span className="admin-client-contact-label">Encargado</span>
            {client.contactName ? <strong>{client.contactName}</strong> : null}
            {client.contactRole ? <span className="admin-cell-sub">{client.contactRole}</span> : null}
            {client.contactPhone ? <span className="admin-nowrap">{client.contactPhone}</span> : null}
            {client.contactEmail ? (
              <AdminIconLink href={`mailto:${client.contactEmail}`} icon="mail" label={`Enviar correo a ${client.contactName ?? name}`} />
            ) : null}
          </div>
        ) : null}

        <p className="admin-client-contact">
          <span className="admin-nowrap">
            RUC <span className="admin-code">{client.ruc || "—"}</span>
          </span>
          <span className="admin-nowrap">{client.phone || "Sin teléfono"}</span>
          <span>{client.email || "Sin correo"}</span>
          <span className="admin-actions">
            {client.email ? <AdminIconLink href={`mailto:${client.email}`} icon="mail" label={`Enviar correo general a ${name}`} /> : null}
          </span>
        </p>
        {client.notes ? <p className="admin-dialog-text">{client.notes}</p> : null}
      </header>

      <section className="admin-kpis" aria-label={`Métricas de ${name}`}>
        <AdminKpi label="Contratos" icon="budgets" value={formatNumber(metrics.contracts)} note="presupuestos aprobados" tone={metrics.contracts > 0 ? "ok" : undefined} />
        <AdminKpi label="Total contratado" icon="budgets" value={formatMoney(metrics.contracted)} note="Σ contratos aprobados" />
        <AdminKpi label="Total cobrado" icon="finance" value={formatMoney(metrics.collected)} note="cobros recibidos" tone={metrics.collected > 0 ? "ok" : undefined} />
        <AdminKpi
          label="Saldo pendiente" icon="finance"
          value={formatMoney(metrics.balance)}
          // Honestidad del dato: si lo cobrado supera lo contratado (por ejemplo,
          // una seña sobre una cotización todavía sin aprobar), no se dibuja un
          // saldo negativo: se avisa que el cobro superó lo contratado.
          note={metrics.collected > metrics.contracted ? "cobrado supera lo contratado" : "contratado − cobrado"}
          tone={metrics.balance > 0 ? "warn" : undefined}
        />
        <AdminKpi
          label="Mora" icon="alert"
          value={formatMoney(metrics.overdue)}
          note={
            metrics.overdueCount > 0
              ? `${formatNumber(metrics.overdueCount)} cobro${metrics.overdueCount === 1 ? "" : "s"} vencido${metrics.overdueCount === 1 ? "" : "s"}`
              : "sin cobros vencidos"
          }
          tone={metrics.overdue > 0 ? "danger" : undefined}
        />
        <AdminKpi
          label="Frecuencia" icon="calendar"
          value={formatMonths(metrics.averageMonths)}
          note={
            metrics.frequencySamples > 0
              ? `${formatNumber(metrics.frequencySamples)} intervalo${metrics.frequencySamples === 1 ? "" : "s"} entre contratos`
              : "necesita 2 contratos"
          }
        />
        <AdminKpi
          label="Última contratación" icon="clock"
          value={formatDate(metrics.lastContractAt)}
          note={metrics.lastContractAt ? formatCountdown(metrics.lastContractAt, "short") : "sin contratos"}
        />
        <AdminKpi
          label="Ticket promedio" icon="finance"
          value={metrics.averageTicket === null ? "—" : formatMoney(metrics.averageTicket)}
          note="por contrato"
        />
        <AdminKpi
          label="Próxima actividad" icon="calendar"
          value={metrics.nextEventAt ? formatDate(metrics.nextEventAt) : "—"}
          note={metrics.nextEventName ?? "sin eventos por venir"}
          tone={metrics.nextEventAt ? "accent" : undefined}
        />
        <AdminKpi label="Eventos" icon="events" value={formatNumber(metrics.events)} note={`${formatNumber(metrics.upcomingEvents)} en agenda`} />
        <AdminKpi
          label="Presupuestos" icon="budgets"
          value={formatNumber(metrics.budgets)}
          note={`${formatNumber(metrics.contracts)} aprobado${metrics.contracts === 1 ? "" : "s"} · ${formatNumber(metrics.lost)} perdido${metrics.lost === 1 ? "" : "s"}`}
        />
      </section>

      {/* Historial del cliente: los hechos reales que explican las métricas. La
          cronología (issue #33) se suma acá, sin otro estado que la ficha. */}
      <section className="admin-client-history" aria-label={`Historial de ${name}`}>
        <h3 className="admin-panel-title">
          <span className="admin-panel-icon" aria-hidden="true">
            <AdminIcon name="clock" size={13} />
          </span>
          Historial
        </h3>

        <AdminPanel
          title="Presupuestos" icon="budgets"
          meta={`${formatNumber(budgets.length)} · ${formatNumber(metrics.contracts)} aprobado${metrics.contracts === 1 ? "" : "s"}`}
        >
          {budgets.length === 0 ? (
            <AdminEmpty icon="budgets" title="Sin presupuestos" hint="Este cliente todavía no tiene presupuestos cargados." />
          ) : (
            <AdminTable
              view="cliente-presupuestos"
              label={`Presupuestos de ${name}`}
              columns={[
                { label: "Fecha" },
                { label: "Presupuesto" },
                { label: "Estado" },
                { label: "Total", end: true },
                { label: "Cobrado", end: true },
              ]}
            >
              {budgets.map((budget) => (
                <AdminRow key={budget.id}>
                  <BudgetDateCell budget={budget} />
                  <AdminCell title={budget.event ? `${budget.title} · ${budget.event.name}` : budget.title}>
                    <strong>{budget.title}</strong>
                  </AdminCell>
                  <BudgetStatusCell budget={budget} />
                  <AdminCell end title={`Total del presupuesto: ${formatMoney(budget.total)}`}>
                    {formatMoney(budget.total)}
                  </AdminCell>
                  <AdminCell
                    end
                    title={
                      budget.collected > 0 || budget.overdue > 0
                        ? `Cobrado ${formatMoney(budget.collected)}${budget.overdue > 0 ? ` · vencido ${formatMoney(budget.overdue)}` : ""}`
                        : "Sin cobros imputados"
                    }
                  >
                    {budget.collected > 0 ? (
                      <span className="admin-nowrap">{formatMoney(budget.collected)}</span>
                    ) : (
                      <span className="admin-muted">—</span>
                    )}
                  </AdminCell>
                </AdminRow>
              ))}
            </AdminTable>
          )}
        </AdminPanel>

        <AdminPanel title="Eventos" icon="events" meta={`${formatNumber(events.length)} · ${formatNumber(metrics.upcomingEvents)} en agenda`}>
          {events.length === 0 ? (
            <AdminEmpty icon="events" title="Sin eventos" hint="Este cliente todavía no tiene eventos cargados." />
          ) : (
            <AdminTable
              view="cliente-eventos"
              label={`Eventos de ${name}`}
              columns={[
                { label: "Fecha" },
                { label: "Evento" },
                { label: "Estado" },
                { label: "Checklist", end: true },
              ]}
            >
              {events.map((event) => {
                const progress = checklistProgress(event.tasks, { risk: isUpcomingWithin(event.startsAt) });
                return (
                  <AdminRow key={event.id}>
                    <AdminCell title={event.startsAt ? formatDateTime(event.startsAt) : "Fecha a confirmar"}>
                      {event.startsAt ? `${formatDateShort(event.startsAt)} · ${formatTime(event.startsAt)}` : "A confirmar"}
                    </AdminCell>
                    <AdminCell title={event.location || "Sin lugar definido"}>
                      <strong>{event.name}</strong>
                    </AdminCell>
                    <AdminCell>
                      <AdminBadge tone={statusTone(event.status)}>{eventStatusLabel(event.status)}</AdminBadge>
                    </AdminCell>
                    <AdminCell end title={progress.title}>
                      {event.tasks.length === 0 ? (
                        <span className="admin-muted">—</span>
                      ) : (
                        <AdminBadge tone={progress.tone}>{progress.label}</AdminBadge>
                      )}
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
          )}
        </AdminPanel>

        <AdminPanel
          title="Cobros" icon="finance"
          meta={`${formatNumber(payments.length)} · ${formatMoney(metrics.collected)} cobrado${metrics.overdue > 0 ? ` · ${formatMoney(metrics.overdue)} vencido` : ""}`}
        >
          {payments.length === 0 ? (
            <AdminEmpty icon="finance" title="Sin cobros" hint="Este cliente todavía no tiene cobros registrados." />
          ) : (
            <AdminTable
              view="cliente-pagos"
              label={`Cobros de ${name}`}
              columns={[
                { label: "Fecha" },
                { label: "Concepto" },
                { label: "Método" },
                { label: "Monto", end: true },
                { label: "Estado" },
              ]}
            >
              {payments.map((payment) => {
                const when = paymentWhen(payment);
                const concept = paymentConcept(payment);
                const fact = paymentFact(payment);
                return (
                  <AdminRow key={payment.id}>
                    <AdminCell title={when.title}>
                      {when.overdue ? (
                        <span className="admin-nowrap" data-tone="danger">
                          {when.label}
                        </span>
                      ) : (
                        when.label
                      )}
                    </AdminCell>
                    <AdminCell title={concept.title}>
                      {payment.budget ? <strong>{concept.label}</strong> : concept.label}
                    </AdminCell>
                    <AdminCell title={payment.chequeDate ? `Cheque del ${formatDate(payment.chequeDate)}` : payment.method || "Sin método"}>
                      {payment.method || "—"}
                    </AdminCell>
                    <AdminCell end title={formatMoney(payment.amount)}>
                      <strong>{formatMoney(payment.amount)}</strong>
                    </AdminCell>
                    <AdminCell>
                      <AdminBadge tone={fact.tone} title={fact.title}>
                        {fact.label}
                      </AdminBadge>
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
          )}
        </AdminPanel>
      </section>
    </>
  );
}

function BudgetDateCell({ budget }: { budget: AdminClientBudgetRow }) {
  return (
    <AdminCell title={`Alta del presupuesto: ${formatDate(budget.createdAt)}`}>
      {formatDateShort(budget.createdAt)}
    </AdminCell>
  );
}

function BudgetStatusCell({ budget }: { budget: AdminClientBudgetRow }) {
  const approval = budget.approvedAt
    ? `Aprobado el ${formatDateTime(budget.approvedAt)} · ${budget.approvalMethod === "manual" ? "panel" : "portal del cliente"}`
    : budget.validUntil
      ? `Válido hasta el ${formatDate(budget.validUntil)}`
      : "Sin aprobación ni vencimiento cargado";
  return (
    <AdminCell title={approval}>
      <AdminBadge tone={statusTone(budget.status)}>{budgetStatusLabel(budget.status)}</AdminBadge>
    </AdminCell>
  );
}
