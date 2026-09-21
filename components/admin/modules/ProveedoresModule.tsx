"use client";

import { useMemo, useState } from "react";
import { formatNumber, supplierCategoryLabel, whatsappHref } from "@/lib/admin-format";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
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

const EMPTY_FORM = { name: "", company: "", phone: "" };

export function ProveedoresModule() {
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

  const writable = canWriteFinance(role);
  const suppliers = useMemo(() => resources.data?.suppliers ?? [], [resources.data]);

  const rows = useMemo(
    () => suppliers.filter((supplier) => matchesQuery(query, [supplier.name, supplier.company, supplier.category, supplier.phone, supplier.email])),
    [suppliers, query],
  );

  const totals = useMemo(
    () => ({
      active: suppliers.filter((supplier) => supplier.active).length,
      categories: new Set(suppliers.map((supplier) => supplier.category)).size,
      reachable: suppliers.filter((supplier) => whatsappHref(supplier.phone) || supplier.email).length,
    }),
    [suppliers],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend("/api/admin/resources", {
      kind: "supplier",
      name: form.name,
      company: form.company || undefined,
      phone: form.phone || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setNotice(`Proveedor «${form.name}» cargado.`);
    setForm(EMPTY_FORM);
    resources.reload();
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de proveedores">
        <AdminKpi label="Proveedores" value={formatNumber(suppliers.length)} note="en la base" />
        <AdminKpi label="Activos" value={formatNumber(totals.active)} note="disponibles" tone="ok" />
        <AdminKpi label="Categorías" value={formatNumber(totals.categories)} note="rubros distintos" tone="accent" />
        <AdminKpi label="Contactables" value={formatNumber(totals.reachable)} note="con teléfono o correo" />
      </section>

      <AdminToolbar>
        <AdminSearchField value={query} onChange={setQuery} label="Buscar proveedores" placeholder="Buscar por proveedor, empresa o rubro…" />
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
            Nuevo proveedor
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo proveedor"
          submitLabel="Cargar proveedor"
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
              placeholder="Ej.: Carpintería Lima"
            />
          </AdminField>
          <AdminField label="Empresa">
            <input
              maxLength={120}
              value={form.company}
              onChange={(event) => setForm({ ...form, company: event.target.value })}
              placeholder="Ej.: Lima Hnos. S.A."
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
        </AdminFormPanel>
      ) : null}

      <AdminDataState
        loading={resources.loading}
        error={resources.error}
        onRetry={resources.reload}
        empty={suppliers.length === 0}
        emptyTitle="Todavía no hay proveedores"
        emptyHint="Cargá carpintería, gráfica, transporte y otros rubros que trabajan en tus eventos."
      >
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda." />
        ) : (
          <AdminTable
            view="proveedores"
            label="Proveedores"
            columns={[
              { label: "Proveedor" },
              { label: "Empresa" },
              { label: "Rubro" },
              { label: "Teléfono" },
              { label: "Correo" },
              { label: "Condiciones" },
              { label: "Estado" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((supplier) => (
              <AdminRow key={supplier.id}>
                <AdminCell title={supplier.name}>
                  <strong>{supplier.name}</strong>
                </AdminCell>
                <AdminCell title={supplier.company || "Sin empresa"}>
                  <span className="admin-nowrap">{supplier.company || "—"}</span>
                </AdminCell>
                <AdminCell>
                  <AdminBadge tone={supplier.category === "OTHER" ? "neutral" : "info"}>{supplierCategoryLabel(supplier.category)}</AdminBadge>
                </AdminCell>
                <AdminCell title={supplier.phone || "Sin teléfono"}>
                  <span className="admin-nowrap">{supplier.phone || "—"}</span>
                </AdminCell>
                <AdminCell title={supplier.email || "Sin correo"}>{supplier.email || "—"}</AdminCell>
                <AdminCell title={supplier.paymentTerms || "Sin condiciones cargadas"}>{supplier.paymentTerms || "—"}</AdminCell>
                <AdminCell>
                  <AdminBadge tone={supplier.active ? "ok" : "neutral"}>{supplier.active ? "Activo" : "Inactivo"}</AdminBadge>
                </AdminCell>
                <AdminCell end>
                  <span className="admin-actions">
                    <AdminWhatsappLink phone={supplier.phone} name={supplier.name} />
                    {supplier.email ? <AdminIconLink href={`mailto:${supplier.email}`} icon="mail" label={`Enviar correo a ${supplier.name}`} /> : null}
                    {!whatsappHref(supplier.phone) && !supplier.email ? <span className="admin-muted">—</span> : null}
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
