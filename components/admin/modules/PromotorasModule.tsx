"use client";

import { useMemo, useState } from "react";
import { formatDate, formatNumber, whatsappHref } from "@/lib/admin-format";
import { canWrite, matchesQuery } from "@/lib/admin-policy";
import { useAdminSession } from "../AdminShell";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminDataState,
  AdminEmpty,
  AdminField,
  AdminFormPanel,
  AdminIconLink,
  AdminKpi,
  AdminNote,
  AdminRow,
  AdminSearchField,
  AdminTable,
  AdminToolbar,
  AdminWhatsappLink,
} from "../AdminUI";
import { adminSend, useAdminResource } from "../use-admin-data";

const EMPTY_FORM = { name: "", phone: "", specialties: "" };

export function PromotorasModule() {
  const { role } = useAdminSession();
  const resources = useAdminResource("/api/admin/resources", (payload) => ({
    suppliers: payload.suppliers ?? [],
    inventory: payload.inventory ?? [],
    promoters: payload.promoters ?? [],
  }));

  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const writable = canWrite(role);
  const promoters = useMemo(() => resources.data?.promoters ?? [], [resources.data]);

  const rows = useMemo(
    () => promoters.filter((promoter) => matchesQuery(query, [promoter.name, promoter.specialties, promoter.phone, promoter.email])),
    [promoters, query],
  );

  const totals = useMemo(
    () => ({
      reachable: promoters.filter((promoter) => whatsappHref(promoter.phone) || promoter.email).length,
      specialized: promoters.filter((promoter) => Boolean(promoter.specialties)).length,
      recent: promoters.filter((promoter) => Date.now() - new Date(promoter.createdAt).getTime() <= 90 * 86_400_000).length,
    }),
    [promoters],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend("/api/admin/resources", {
      kind: "promoter",
      name: form.name,
      phone: form.phone || undefined,
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

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de promotoras">
        <AdminKpi label="Promotoras" value={formatNumber(promoters.length)} note="activas" tone="ok" />
        <AdminKpi label="Con especialidad" value={formatNumber(totals.specialized)} note="perfil cargado" tone="accent" />
        <AdminKpi label="Contactables" value={formatNumber(totals.reachable)} note="con teléfono o correo" />
        <AdminKpi label="Nuevas" value={formatNumber(totals.recent)} note="últimos 90 días" />
      </section>

      <AdminToolbar>
        <AdminSearchField value={query} onChange={setQuery} label="Buscar promotoras" placeholder="Buscar por nombre, especialidad o contacto…" />
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
        <AdminFormPanel
          title="Nueva promotora"
          submitLabel="Cargar promotora"
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          busy={busy}
          status={formError}
        >
          <AdminField label="Nombre">
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Ej.: Lucía Benítez"
            />
          </AdminField>
          <AdminField label="Teléfono" hint="Con código de país">
            <input
              type="tel"
              maxLength={30}
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              placeholder="+595 981 000 000"
              autoComplete="tel"
            />
          </AdminField>
          <AdminField label="Especialidades" hint="Separadas por coma">
            <input
              maxLength={160}
              value={form.specialties}
              onChange={(event) => setForm({ ...form, specialties: event.target.value })}
              placeholder="Ej.: Promoción, degustación"
            />
          </AdminField>
        </AdminFormPanel>
      ) : null}

      <AdminDataState
        loading={resources.loading}
        error={resources.error}
        onRetry={resources.reload}
        empty={promoters.length === 0}
        emptyTitle="Todavía no hay promotoras"
        emptyHint="Cargá el staff de promoción para asignarlo a las tareas de cada evento."
      >
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda." />
        ) : (
          <AdminTable
            view="promotoras"
            label="Promotoras"
            columns={[
              { label: "Promotora" },
              { label: "Teléfono" },
              { label: "Correo" },
              { label: "Especialidades" },
              { label: "Alta" },
              { label: "Estado" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((promoter) => (
              <AdminRow key={promoter.id}>
                <AdminCell title={promoter.name}>
                  <strong>{promoter.name}</strong>
                </AdminCell>
                <AdminCell title={promoter.phone || "Sin teléfono"}>
                  <span className="admin-nowrap">{promoter.phone || "—"}</span>
                </AdminCell>
                <AdminCell title={promoter.email || "Sin correo"}>{promoter.email || "—"}</AdminCell>
                <AdminCell title={promoter.specialties || "Sin especialidades cargadas"}>{promoter.specialties || "—"}</AdminCell>
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
                    {!whatsappHref(promoter.phone) && !promoter.email ? <span className="admin-muted">—</span> : null}
                  </span>
                </AdminCell>
              </AdminRow>
            ))}
          </AdminTable>
        )}
      </AdminDataState>
    </div>
  );
}
