"use client";

import { useId, useMemo, useState } from "react";
import {
  formatCalendarDayShort,
  formatDate,
  formatDateShort,
  formatNumber,
  promoterAvailabilityDetail,
  promoterAvailabilityLabel,
  promoterAvailabilityTone,
  whatsappHref,
} from "@/lib/admin-format";
import { canWriteOperations, matchesQuery } from "@/lib/admin-policy";
import { PROMOTER_AVAILABILITIES, type AdminPromoterRow } from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { AdminAvatar } from "../AdminAvatar";
import { AdminViewSwitch, useAdminModuleView } from "../AdminBoard";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminDialog,
  AdminDialogSection,
  AdminIconLink,
  AdminKpi,
  AdminKpis,
  AdminNote,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  AdminWhatsappLink,
} from "../AdminUI";
import { DateField, EmailField, PhoneField, SearchField, SelectField, TextAreaField, TextField } from "../AdminFields";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import { FIELD_MESSAGES, emailValid, normalizePhone, personNameValid } from "@/lib/field-rules";

const EMPTY_FORM = { name: "", phone: "", email: "", specialties: "" };

/** Estados del enum `PromoterAvailability`: misma etiqueta en toda la app. */
const AVAILABILITY_OPTIONS = PROMOTER_AVAILABILITIES.map((value) => ({
  value,
  label: promoterAvailabilityLabel(value),
}));

const AVAILABILITY_FILTERS = [
  { value: "ALL", label: "Todas las disponibilidades" },
  ...AVAILABILITY_OPTIONS,
];

/** Nota de disponibilidad: mismo criterio que la API (`backend` revalida). */
const MAX_AVAILABILITY_NOTE = 300;

/** Vistas de promotoras (issue #118): lista densa y cuadrícula de tarjetas. */
const PROMOTORAS_VIEWS = ["list", "grid"] as const;

export function PromotorasModule() {
  const { role } = useAdminSession();
  // El catálogo combinado trae proveedores, inventario y promotoras; esta
  // pantalla solo muestra promotoras, así que pide nada más ese slice (issue #62).
  const resources = useAdminResource("/api/admin/resources?only=promoters", (payload) => ({
    promoters: payload.promoters ?? [],
  }));

  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useAdminModuleView("promotoras", PROMOTORAS_VIEWS);

  // Editor de disponibilidad (issue #24): badge en la lista + estado editable.
  const [editing, setEditing] = useState<AdminPromoterRow | null>(null);
  const [availabilityForm, setAvailabilityForm] = useState({ availability: "AVAILABLE", note: "", until: "" });
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const formId = useId();
  const availabilityFormId = useId();
  const createDirty = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM);
  const availabilityDirty =
    editing !== null &&
    JSON.stringify(availabilityForm) !==
      JSON.stringify({
        availability: editing.availability || "AVAILABLE",
        note: editing.availabilityNote ?? "",
        until: editing.unavailableUntil ? editing.unavailableUntil.slice(0, 10) : "",
      });

  const writable = canWriteOperations(role);
  const promoters = useMemo(() => resources.data?.promoters ?? [], [resources.data]);

  const rows = useMemo(
    () =>
      promoters
        .filter((promoter) => (availabilityFilter === "ALL" ? true : promoter.availability === availabilityFilter))
        .filter((promoter) =>
          matchesQuery(query, [promoter.name, promoter.specialties, promoter.phone, promoter.email]),
        ),
    [promoters, query, availabilityFilter],
  );

  const totals = useMemo(
    () => ({
      reachable: promoters.filter((promoter) => whatsappHref(promoter.phone) || promoter.email).length,
      available: promoters.filter((promoter) => promoter.availability === "AVAILABLE").length,
      unavailable: promoters.filter((promoter) => promoter.availability === "UNAVAILABLE").length,
      toDefine: promoters.filter((promoter) => promoter.availability === "TO_DEFINE").length,
    }),
    [promoters],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    // Avisos es-PY del front con las reglas del kit (issue #131); el API revalida.
    if (!personNameValid(form.name)) {
      setFormError(FIELD_MESSAGES.name);
      return;
    }
    if (form.email && !emailValid(form.email)) {
      setFormError(FIELD_MESSAGES.email);
      return;
    }
    setBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend("/api/admin/resources", {
      kind: "promoter",
      name: form.name,
      phone: normalizePhone(form.phone) || undefined,
      email: form.email.trim() || undefined,
      specialties: form.specialties || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice(`Promotora «${form.name}» cargada.`);
    setForm(EMPTY_FORM);
    resources.reload();
  }

  function startAvailabilityEdit(promoter: AdminPromoterRow) {
    setEditing(promoter);
    setAvailabilityError("");
    setNotice("");
    setAvailabilityForm({
      availability: promoter.availability || "AVAILABLE",
      note: promoter.availabilityNote ?? "",
      until: promoter.unavailableUntil ? promoter.unavailableUntil.slice(0, 10) : "",
    });
  }

  async function submitAvailability(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || availabilityBusy) return;
    setAvailabilityBusy(true);
    setAvailabilityError("");
    const result = await adminSend("/api/admin/resources", {
      kind: "promoter-update",
      id: editing.id,
      availability: availabilityForm.availability,
      availabilityNote: availabilityForm.note || undefined,
      unavailableUntil: availabilityForm.availability === "UNAVAILABLE" ? availabilityForm.until || undefined : undefined,
    });
    setAvailabilityBusy(false);
    if (!result.ok) {
      setAvailabilityError(result.error);
      return;
    }
    setNotice(
      `«${editing.name}» quedó como ${promoterAvailabilityLabel(availabilityForm.availability).toLowerCase()}${
        availabilityForm.availability === "UNAVAILABLE" && availabilityForm.until
          ? ` hasta el ${formatCalendarDayShort(availabilityForm.until)}`
          : ""
      }.`,
    );
    setEditing(null);
    resources.reload();
  }

  return (
    <div className="admin-module-page">
      <AdminKpis loading={resources.data == null} label="Indicadores de promotoras">
        <AdminKpi label="Promotoras" icon="promoters" value={formatNumber(promoters.length)} note="activas" />
        <AdminKpi label="Disponibles" icon="check" value={formatNumber(totals.available)} note="pueden tomar tareas" tone="ok" />
        <AdminKpi
          label="No disponibles" icon="alert"
          value={formatNumber(totals.unavailable)}
          note="con motivo y fecha"
          tone={totals.unavailable > 0 ? "danger" : undefined}
        />
        <AdminKpi
          label="A definir" icon="clock"
          value={formatNumber(totals.toDefine)}
          note="sin confirmar"
          tone={totals.toDefine > 0 ? "warn" : undefined}
        />
        <AdminKpi label="Contactables" icon="mail" value={formatNumber(totals.reachable)} note="con teléfono o correo" />
      </AdminKpis>

      <AdminToolbar>
        <SearchField value={query} onChange={setQuery} label="Buscar promotoras" placeholder="Buscar por nombre, especialidad o contacto…" />
        <AdminSelect
          value={availabilityFilter}
          onChange={setAvailabilityFilter}
          label="Filtrar por disponibilidad"
          options={AVAILABILITY_FILTERS}
        />
        <AdminViewSwitch view={view} onChange={setView} label="Vista de promotoras" views={PROMOTORAS_VIEWS} />
        {writable ? (
          <AdminButton
            variant="primary"
            icon="plus"
            onClick={() => {
              setFormError("");
              setShowForm((open) => !open);
            }}
            aria-expanded={showForm}
          >
            Nueva promotora
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      {writable && showForm ? (
        <AdminDialog
          title="Nueva promotora"
          icon="promoters"
          description="Queda en el equipo disponible para asignarla a tareas de eventos."
          dirty={createDirty}
          onClose={() => setShowForm(false)}
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
              <AdminButton type="submit" variant="primary" icon="check" form={formId} busy={busy}>
                Cargar promotora
              </AdminButton>
            </>
          )}
        >
          <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
            <AdminDialogSection title="Datos">
              <TextField
                label="Nombre"
                required
                autoFocus
                maxLength={120}
                value={form.name}
                onChange={(value) => setForm({ ...form, name: value })}
                placeholder="Ej.: Lucía Benítez"
              />
              <PhoneField
                label="Teléfono"
                hint="Con código de país"
                value={form.phone}
                onChange={(value) => setForm({ ...form, phone: value })}
              />
              {/* Correo en el alta (issue #131): el modelo lo tiene y la auditoría lo registra. */}
              <EmailField
                label="Correo"
                hint="Opcional"
                value={form.email}
                onChange={(value) => setForm({ ...form, email: value })}
                placeholder="promotora@correo.com"
                error={form.email && !emailValid(form.email) ? FIELD_MESSAGES.email : null}
              />
              <TextField
                label="Especialidades"
                hint="Separadas por coma"
                maxLength={160}
                value={form.specialties}
                onChange={(value) => setForm({ ...form, specialties: value })}
                placeholder="Ej.: Promoción, degustación"
              />
            </AdminDialogSection>
          </form>
        </AdminDialog>
      ) : null}

      {writable && editing ? (
        <AdminDialog
          title={`Disponibilidad · ${editing.name}`}
          icon="promoters"
          description="Se ve al asignarla a una tarea del evento. No bloquea la asignación."
          dirty={availabilityDirty}
          onClose={() => setEditing(null)}
          footer={({ requestClose }) => (
            <>
              {availabilityError ? (
                <div className="admin-dialog-footer-note">
                  <AdminNote tone="error">{availabilityError}</AdminNote>
                </div>
              ) : null}
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={availabilityBusy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={availabilityFormId} busy={availabilityBusy}>
                Guardar disponibilidad
              </AdminButton>
            </>
          )}
        >
          <form id={availabilityFormId} className="admin-form" onSubmit={(event) => void submitAvailability(event)} aria-busy={availabilityBusy || undefined}>
            <AdminDialogSection title="Disponibilidad">
              <SelectField
                label="Disponibilidad"
                required
                value={availabilityForm.availability}
                onChange={(value) => setAvailabilityForm({ ...availabilityForm, availability: value })}
                options={AVAILABILITY_OPTIONS}
                hint="No bloquea la asignación: el panel avisa al asignarla a una tarea."
              />
              <DateField
                label="No disponible hasta"
                hint="Opcional; solo para «No disponible»"
                disabled={availabilityForm.availability !== "UNAVAILABLE"}
                value={availabilityForm.until}
                onChange={(value) => setAvailabilityForm({ ...availabilityForm, until: value })}
              />
              <TextAreaField
                label="Motivo"
                hint="Se ve al asignarla a una tarea del evento"
                wide
                rows={2}
                maxLength={MAX_AVAILABILITY_NOTE}
                value={availabilityForm.note}
                onChange={(value) => setAvailabilityForm({ ...availabilityForm, note: value })}
                placeholder="Ej.: De viaje hasta fin de mes; confirmar con la agencia."
              />
            </AdminDialogSection>
          </form>
        </AdminDialog>
      ) : null}

      <AdminDataState
        loading={resources.loading}
        error={resources.error}
        onRetry={resources.reload}
        empty={promoters.length === 0}
        emptyTitle="Todavía no hay promotoras" emptyIcon="promoters"
        emptyHint="Cargá el staff de promoción para asignarlo a las tareas de cada evento."
      >
        {rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de disponibilidad." />
        ) : view === "grid" ? (
          <AdminCardGrid label="Promotoras" cards={rows.map((promoter): AdminCardData => {
            const detail = promoterAvailabilityDetail(promoter);
            const unavailable = promoter.availability === "UNAVAILABLE" && Boolean(promoter.unavailableUntil);
            return {
              id: promoter.id,
              title: (
                <>
                  <AdminAvatar name={promoter.name} src={promoter.photoUrl} size={22} />
                  <span className="admin-item-name">{promoter.name}</span>
                </>
              ),
              titleTooltip: detail ? `${promoter.name} · ${detail}` : promoter.name,
              subtitle: promoter.specialties || null,
              badges: [
                {
                  label: promoterAvailabilityLabel(promoter.availability),
                  tone: promoterAvailabilityTone(promoter.availability),
                  title: detail || promoterAvailabilityLabel(promoter.availability),
                },
                {
                  label: promoter.active ? "Activa" : "Inactiva",
                  tone: promoter.active ? "ok" : "neutral",
                  title: promoter.active ? "Puede tomar tareas" : "No puede tomar tareas",
                },
              ],
              fields: [
                { label: "Teléfono", value: promoter.phone || "—", title: promoter.phone || "Sin teléfono" },
                { label: "Correo", value: promoter.email || "—", title: promoter.email || "Sin correo" },
                {
                  label: "Especialidades",
                  value: promoter.specialties || "—",
                  title: promoter.specialties || "Sin especialidades cargadas",
                },
                ...(unavailable
                  ? [{
                      label: "No disponible hasta",
                      value: formatDateShort(promoter.unavailableUntil),
                      title: `No disponible hasta el ${formatDate(promoter.unavailableUntil)}`,
                    }]
                  : []),
                { label: "Alta", value: formatDate(promoter.createdAt), title: formatDate(promoter.createdAt) },
              ],
              footer: (
                <span className="admin-actions">
                  <AdminWhatsappLink phone={promoter.phone} name={promoter.name} />
                  {promoter.email ? <AdminIconLink href={`mailto:${promoter.email}`} icon="mail" label={`Enviar correo a ${promoter.name}`} /> : null}
                  {writable ? (
                    <AdminButton
                      icon="edit"
                      title={`Editar disponibilidad: ${promoter.name}`}
                      aria-label={`Editar disponibilidad: ${promoter.name}`}
                      onClick={() => startAvailabilityEdit(promoter)}
                    />
                  ) : null}
                </span>
              ),
            };
          })} />
        ) : (
          <AdminTable
            view="promotoras"
            label="Promotoras"
            columns={[
              { label: "Promotora" },
              { label: "Teléfono" },
              { label: "Correo" },
              { label: "Especialidades" },
              { label: "Disponibilidad" },
              { label: "Alta" },
              { label: "Estado" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((promoter) => {
              const detail = promoterAvailabilityDetail(promoter);
              const unavailable =
                promoter.availability === "UNAVAILABLE" && Boolean(promoter.unavailableUntil);
              return (
                <AdminRow key={promoter.id}>
                  <AdminCell title={promoter.name}>
                    <span className="admin-identity">
                      <AdminAvatar name={promoter.name} src={promoter.photoUrl} size={22} />
                      <strong>{promoter.name}</strong>
                    </span>
                  </AdminCell>
                  <AdminCell title={promoter.phone || "Sin teléfono"}>
                    <span className="admin-nowrap">{promoter.phone || "—"}</span>
                  </AdminCell>
                  <AdminCell title={promoter.email || "Sin correo"}>{promoter.email || "—"}</AdminCell>
                  <AdminCell title={promoter.specialties || "Sin especialidades cargadas"}>{promoter.specialties || "—"}</AdminCell>
                  <AdminCell title={detail || promoterAvailabilityLabel(promoter.availability)}>
                    <span className="admin-nowrap">
                      <AdminBadge tone={promoterAvailabilityTone(promoter.availability)}>
                        {promoterAvailabilityLabel(promoter.availability)}
                      </AdminBadge>
                      {unavailable ? (
                        <small className="admin-cell-sub"> hasta {formatDateShort(promoter.unavailableUntil)}</small>
                      ) : null}
                    </span>
                  </AdminCell>
                  <AdminCell title={formatDate(promoter.createdAt)}>
                    <span className="admin-nowrap">{formatDate(promoter.createdAt)}</span>
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={promoter.active ? "ok" : "neutral"}>{promoter.active ? "Activa" : "Inactiva"}</AdminBadge>
                  </AdminCell>
                  <AdminCell end>
                    <span className="admin-actions">
                      <AdminWhatsappLink phone={promoter.phone} name={promoter.name} />
                      {promoter.email ? <AdminIconLink href={`mailto:${promoter.email}`} icon="mail" label={`Enviar correo a ${promoter.name}`} /> : null}
                      {writable ? (
                        <AdminButton
                          icon="edit"
                          title={`Editar disponibilidad: ${promoter.name}`}
                          aria-label={`Editar disponibilidad: ${promoter.name}`}
                          onClick={() => startAvailabilityEdit(promoter)}
                        />
                      ) : null}
                      {!writable && !whatsappHref(promoter.phone) && !promoter.email ? <span className="admin-muted">—</span> : null}
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>
    </div>
  );
}
