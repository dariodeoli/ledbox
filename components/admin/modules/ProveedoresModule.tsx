"use client";

import { useMemo, useState } from "react";
import {
  dueTone,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  jobStatusLabel,
  statusTone,
  supplierCategoryLabel,
} from "@/lib/admin-format";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
import {
  isSupplierJobOpen,
  supplierJobBalance,
  supplierJobTransitions,
  SUPPLIER_CATEGORIES,
  SUPPLIER_JOB_STATUSES,
  type AdminSupplierJobRow,
  type AdminSupplierRow,
} from "@/lib/admin-types";
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
  AdminPanel,
  AdminRow,
  AdminSearchField,
  AdminSelect,
  AdminTable,
  AdminToolbar,
  AdminWhatsappLink,
} from "../AdminUI";
import { adminSend, useAdminResource } from "../use-admin-data";

/**
 * Flujo de proveedores: directorio con alta y edición, y trabajos por evento con
 * máquina de estados, anticipo, pago final, fechas y comprobante. El saldo por
 * trabajo sale de la base (`total − anticipo`, 0 si está pagado o cancelado).
 */

const METHOD_OPTIONS = ["Transferencia", "Efectivo", "Cheque", "Tarjeta", "Otro"];

const CATEGORY_OPTIONS = SUPPLIER_CATEGORIES.map((value) => ({ value, label: supplierCategoryLabel(value) }));

const JOB_STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "OPEN", label: "Abiertos" },
  ...SUPPLIER_JOB_STATUSES.map((value) => ({ value, label: jobStatusLabel(value) })),
];

type SupplierForm = {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  category: string;
  paymentTerms: string;
  notes: string;
  active: boolean;
};

type JobForm = {
  id: string;
  supplierId: string;
  eventId: string;
  category: string;
  description: string;
  total: string;
  advance: string;
  dueAt: string;
  paymentMethod: string;
  receipt: string;
  notes: string;
  deliveredAt: string;
  paidAt: string;
};

type JobPanel = { mode: "create" } | { mode: "edit"; job: AdminSupplierJobRow } | { mode: "status"; job: AdminSupplierJobRow };

const EMPTY_SUPPLIER: SupplierForm = {
  id: "",
  name: "",
  company: "",
  phone: "",
  email: "",
  category: "OTHER",
  paymentTerms: "",
  notes: "",
  active: true,
};

const EMPTY_JOB: JobForm = {
  id: "",
  supplierId: "",
  eventId: "",
  category: "OTHER",
  description: "",
  total: "",
  advance: "",
  dueAt: "",
  paymentMethod: METHOD_OPTIONS[0],
  receipt: "",
  notes: "",
  deliveredAt: "",
  paidAt: "",
};

/** Valor para `<input type="date">` en hora local (los datos se guardan en UTC). */
function dateInputValue(value: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ProveedoresModule() {
  const { role } = useAdminSession();
  const suppliersResource = useAdminResource("/api/admin/suppliers", (payload) => payload.suppliers ?? []);
  const jobsResource = useAdminResource("/api/admin/suppliers/jobs", (payload) => payload.jobs ?? []);
  const eventsResource = useAdminResource("/api/admin/events", (payload) => payload.events ?? []);

  const [query, setQuery] = useState("");
  const [jobStatus, setJobStatus] = useState("ALL");
  const [supplierForm, setSupplierForm] = useState<SupplierForm | null>(null);
  const [supplierBusy, setSupplierBusy] = useState(false);
  const [supplierError, setSupplierError] = useState("");
  const [jobPanel, setJobPanel] = useState<JobPanel | null>(null);
  const [jobForm, setJobForm] = useState<JobForm>(EMPTY_JOB);
  const [jobBusy, setJobBusy] = useState(false);
  const [jobError, setJobError] = useState("");
  const [notice, setNotice] = useState("");

  const writable = canWriteFinance(role);
  const suppliers = useMemo<AdminSupplierRow[]>(() => suppliersResource.data ?? [], [suppliersResource.data]);
  const jobs = useMemo<AdminSupplierJobRow[]>(() => jobsResource.data ?? [], [jobsResource.data]);
  const events = useMemo(() => eventsResource.data ?? [], [eventsResource.data]);

  const supplierRows = useMemo(
    () => suppliers.filter((supplier) => matchesQuery(query, [supplier.name, supplier.company, supplier.category, supplier.phone, supplier.email])),
    [suppliers, query],
  );

  const jobRows = useMemo(
    () =>
      jobs
        .filter((job) => (jobStatus === "ALL" ? true : jobStatus === "OPEN" ? isSupplierJobOpen(job.status) : job.status === jobStatus))
        .filter((job) =>
          matchesQuery(query, [job.supplier.name, job.event?.name, job.description, jobStatusLabel(job.status), supplierCategoryLabel(job.category)]),
        )
        .sort((a, b) => {
          const openDifference = (isSupplierJobOpen(a.status) ? 0 : 1) - (isSupplierJobOpen(b.status) ? 0 : 1);
          if (openDifference !== 0) return openDifference;
          const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
          const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
          if (aDue !== bDue) return aDue - bDue;
          return a.description.localeCompare(b.description, "es");
        }),
    [jobs, jobStatus, query],
  );

  const totals = useMemo(() => {
    const open = jobs.filter((job) => isSupplierJobOpen(job.status));
    return {
      activeSuppliers: suppliers.filter((supplier) => supplier.active).length,
      open: open.length,
      payable: jobs.reduce((sum, job) => sum + supplierJobBalance(job), 0),
      overdue: open.filter((job) => job.dueAt && new Date(job.dueAt).getTime() < Date.now()).length,
    };
  }, [jobs, suppliers]);

  function openSupplierCreate() {
    setSupplierError("");
    setNotice("");
    setSupplierForm({ ...EMPTY_SUPPLIER });
  }

  function openSupplierEdit(supplier: AdminSupplierRow) {
    setSupplierError("");
    setNotice("");
    setSupplierForm({
      id: supplier.id,
      name: supplier.name,
      company: supplier.company ?? "",
      phone: supplier.phone ?? "",
      email: supplier.email ?? "",
      category: supplier.category,
      paymentTerms: supplier.paymentTerms ?? "",
      notes: supplier.notes ?? "",
      active: supplier.active,
    });
  }

  async function submitSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierForm) return;
    setSupplierBusy(true);
    setSupplierError("");
    setNotice("");
    const payload = {
      name: supplierForm.name,
      company: supplierForm.company,
      phone: supplierForm.phone,
      email: supplierForm.email,
      category: supplierForm.category,
      paymentTerms: supplierForm.paymentTerms,
      notes: supplierForm.notes,
      active: supplierForm.active,
    };
    const result = supplierForm.id
      ? await adminSend("/api/admin/suppliers", { id: supplierForm.id, ...payload }, "PATCH")
      : await adminSend("/api/admin/suppliers", payload);
    setSupplierBusy(false);
    if (!result.ok) {
      setSupplierError(result.error);
      return;
    }
    setNotice(supplierForm.id ? `Proveedor «${supplierForm.name}» actualizado.` : `Proveedor «${supplierForm.name}» cargado.`);
    setSupplierForm(null);
    suppliersResource.reload();
  }

  function openJobCreate() {
    setJobError("");
    setNotice("");
    setJobForm({ ...EMPTY_JOB });
    setJobPanel({ mode: "create" });
  }

  function openJobEdit(job: AdminSupplierJobRow) {
    setJobError("");
    setNotice("");
    setJobForm({
      id: job.id,
      supplierId: job.supplier.id,
      eventId: job.event?.id ?? "",
      category: job.category,
      description: job.description,
      total: String(job.total),
      advance: String(job.advance),
      dueAt: dateInputValue(job.dueAt),
      paymentMethod: job.paymentMethod || METHOD_OPTIONS[0],
      receipt: job.receipt ?? "",
      notes: job.notes ?? "",
      deliveredAt: dateInputValue(job.deliveredAt),
      paidAt: dateInputValue(job.paidAt),
    });
    setJobPanel({ mode: "edit", job });
  }

  function openJobStatus(job: AdminSupplierJobRow) {
    setJobError("");
    setNotice("");
    setJobPanel({ mode: "status", job });
  }

  async function submitJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJobBusy(true);
    setJobError("");
    setNotice("");
    const common = {
      eventId: jobForm.eventId,
      category: jobForm.category,
      description: jobForm.description,
      total: Number(jobForm.total),
      advance: Number(jobForm.advance || 0),
      dueAt: jobForm.dueAt,
      notes: jobForm.notes,
    };
    const result = jobForm.id
      ? await adminSend(
          "/api/admin/suppliers/jobs",
          {
            id: jobForm.id,
            ...common,
            paymentMethod: jobForm.paymentMethod,
            receipt: jobForm.receipt,
            ...(jobForm.deliveredAt ? { deliveredAt: jobForm.deliveredAt } : {}),
            ...(jobForm.paidAt ? { paidAt: jobForm.paidAt } : {}),
          },
          "PATCH",
        )
      : await adminSend("/api/admin/suppliers/jobs", {
          ...common,
          supplierId: jobForm.supplierId,
          ...(Number(jobForm.advance || 0) > 0 ? { paymentMethod: jobForm.paymentMethod, receipt: jobForm.receipt } : {}),
        });
    setJobBusy(false);
    if (!result.ok) {
      setJobError(result.error);
      return;
    }
    setNotice(jobForm.id ? "Trabajo actualizado." : `Trabajo «${jobForm.description}» cargado.`);
    setJobPanel(null);
    jobsResource.reload();
  }

  const editingJob = jobPanel?.mode === "edit" ? jobPanel.job : null;
  const editingClosed = editingJob ? !isSupplierJobOpen(editingJob.status) : false;
  const formAdvance = Number(jobForm.advance || 0);

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de proveedores">
        <AdminKpi label="Proveedores" value={formatNumber(totals.activeSuppliers)} note={`activos de ${formatNumber(suppliers.length)}`} />
        <AdminKpi label="Trabajos abiertos" value={formatNumber(totals.open)} note="sin pagar ni cancelar" tone="accent" />
        <AdminKpi label="Saldo por pagar" value={formatMoney(totals.payable)} note="trabajos abiertos" tone={totals.payable > 0 ? "warn" : "ok"} />
        <AdminKpi
          label="Vencidos"
          value={formatNumber(totals.overdue)}
          note="con fecha prevista pasada"
          tone={totals.overdue > 0 ? "warn" : "ok"}
        />
      </section>

      <AdminToolbar>
        <AdminSearchField value={query} onChange={setQuery} label="Buscar proveedores y trabajos" placeholder="Buscar por proveedor, trabajo, evento o rubro…" />
        <AdminSelect value={jobStatus} onChange={setJobStatus} label="Filtrar trabajos por estado" options={JOB_STATUS_OPTIONS} />
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      <AdminPanel
        title="Trabajos por evento"
        meta={`${formatNumber(jobRows.length)} de ${formatNumber(jobs.length)}`}
        action={
          writable ? (
            <AdminButton variant="primary" icon="plus" onClick={openJobCreate} aria-expanded={jobPanel?.mode === "create"}>
              Nuevo trabajo
            </AdminButton>
          ) : null
        }
      >
        {jobError && jobPanel === null ? <AdminNote tone="error">{jobError}</AdminNote> : null}

        {writable && jobPanel?.mode === "create" ? (
          <AdminFormPanel
            title="Nuevo trabajo de proveedor"
            submitLabel="Cargar trabajo"
            onSubmit={submitJob}
            onCancel={() => setJobPanel(null)}
            busy={jobBusy}
            status={jobError}
          >
            <AdminField label="Proveedor">
              <select
                required
                value={jobForm.supplierId}
                onChange={(event) => {
                  const supplier = suppliers.find((item) => item.id === event.target.value);
                  setJobForm({ ...jobForm, supplierId: event.target.value, category: supplier?.category ?? jobForm.category });
                }}
              >
                <option value="">Elegí un proveedor…</option>
                {suppliers
                  .filter((supplier) => supplier.active || supplier.id === jobForm.supplierId)
                  .map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
              </select>
            </AdminField>
            <AdminField label="Evento" hint="Opcional">
              <select value={jobForm.eventId} onChange={(event) => setJobForm({ ...jobForm, eventId: event.target.value })}>
                <option value="">Sin evento asociado</option>
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Rubro del trabajo">
              <select value={jobForm.category} onChange={(event) => setJobForm({ ...jobForm, category: event.target.value })}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Vence" hint="Fecha prevista de entrega">
              <input type="date" value={jobForm.dueAt} onChange={(event) => setJobForm({ ...jobForm, dueAt: event.target.value })} />
            </AdminField>
            <AdminField label="Trabajo / concepto" wide>
              <input
                required
                maxLength={200}
                value={jobForm.description}
                onChange={(event) => setJobForm({ ...jobForm, description: event.target.value })}
                placeholder="Ej.: Estructura y gráfica de stand"
              />
            </AdminField>
            <AdminField label="Costo total" hint="En guaraníes">
              <input
                type="number"
                min="1"
                step="1"
                required
                value={jobForm.total}
                onChange={(event) => setJobForm({ ...jobForm, total: event.target.value })}
                inputMode="numeric"
              />
            </AdminField>
            <AdminField label="Anticipo" hint="Si lo cargás, queda con anticipo pagado">
              <input
                type="number"
                min="0"
                step="1"
                value={jobForm.advance}
                onChange={(event) => setJobForm({ ...jobForm, advance: event.target.value })}
                inputMode="numeric"
              />
            </AdminField>
            {formAdvance > 0 ? (
              <>
                <AdminField label="Método del anticipo">
                  <select value={jobForm.paymentMethod} onChange={(event) => setJobForm({ ...jobForm, paymentMethod: event.target.value })}>
                    {METHOD_OPTIONS.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </AdminField>
                <AdminField label="Comprobante del anticipo" hint="Nº de recibo o transferencia">
                  <input
                    maxLength={120}
                    value={jobForm.receipt}
                    onChange={(event) => setJobForm({ ...jobForm, receipt: event.target.value })}
                    placeholder="Opcional"
                  />
                </AdminField>
              </>
            ) : null}
          </AdminFormPanel>
        ) : null}

        {writable && jobPanel?.mode === "edit" && editingJob ? (
          <AdminFormPanel
            title={`Editar trabajo: ${editingJob.description}`}
            submitLabel="Guardar cambios"
            onSubmit={submitJob}
            onCancel={() => setJobPanel(null)}
            busy={jobBusy}
            status={jobError}
          >
            {editingClosed ? (
              <div className="admin-field--wide">
                <AdminNote>
                  {editingJob.status === "PAID" ? "Trabajo pagado" : "Trabajo cancelado"}: podés corregir comprobante, notas y descripción,
                  no los montos.
                </AdminNote>
              </div>
            ) : null}
            <AdminField label="Proveedor">
              <input value={editingJob.supplier.name} disabled />
            </AdminField>
            <AdminField label="Evento" hint="Opcional">
              <select value={jobForm.eventId} onChange={(event) => setJobForm({ ...jobForm, eventId: event.target.value })}>
                <option value="">Sin evento asociado</option>
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Rubro del trabajo">
              <select value={jobForm.category} onChange={(event) => setJobForm({ ...jobForm, category: event.target.value })}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Vence" hint="Fecha prevista de entrega">
              <input type="date" value={jobForm.dueAt} onChange={(event) => setJobForm({ ...jobForm, dueAt: event.target.value })} />
            </AdminField>
            <AdminField label="Trabajo / concepto" wide>
              <input
                required
                maxLength={200}
                value={jobForm.description}
                onChange={(event) => setJobForm({ ...jobForm, description: event.target.value })}
              />
            </AdminField>
            <AdminField label="Costo total" hint="En guaraníes">
              <input
                type="number"
                min="1"
                step="1"
                required
                disabled={editingClosed}
                value={jobForm.total}
                onChange={(event) => setJobForm({ ...jobForm, total: event.target.value })}
                inputMode="numeric"
              />
            </AdminField>
            <AdminField label="Anticipo pagado" hint="En guaraníes">
              <input
                type="number"
                min="0"
                step="1"
                disabled={editingClosed}
                value={jobForm.advance}
                onChange={(event) => setJobForm({ ...jobForm, advance: event.target.value })}
                inputMode="numeric"
              />
            </AdminField>
            <AdminField label="Método de pago" hint="Último pago registrado">
              <select value={jobForm.paymentMethod} onChange={(event) => setJobForm({ ...jobForm, paymentMethod: event.target.value })}>
                {METHOD_OPTIONS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Comprobante" hint="Nº de recibo o transferencia">
              <input
                maxLength={120}
                value={jobForm.receipt}
                onChange={(event) => setJobForm({ ...jobForm, receipt: event.target.value })}
                placeholder="Opcional"
              />
            </AdminField>
            {editingJob.deliveredAt ? (
              <AdminField label="Fecha de entrega">
                <input
                  type="date"
                  value={jobForm.deliveredAt}
                  onChange={(event) => setJobForm({ ...jobForm, deliveredAt: event.target.value })}
                />
              </AdminField>
            ) : null}
            {editingJob.paidAt ? (
              <AdminField label="Fecha de pago">
                <input type="date" value={jobForm.paidAt} onChange={(event) => setJobForm({ ...jobForm, paidAt: event.target.value })} />
              </AdminField>
            ) : null}
            <AdminField label="Notas" wide>
              <textarea
                maxLength={1000}
                rows={2}
                value={jobForm.notes}
                onChange={(event) => setJobForm({ ...jobForm, notes: event.target.value })}
                placeholder="Detalles de coordinación, materiales o acuerdos"
              />
            </AdminField>
          </AdminFormPanel>
        ) : null}

        {writable && jobPanel?.mode === "status" ? (
          <JobStatusPanel
            job={jobPanel.job}
            onClose={() => setJobPanel(null)}
            onSaved={(message) => {
              setNotice(message);
              setJobPanel(null);
              jobsResource.reload();
            }}
          />
        ) : null}

        <AdminDataState
          loading={jobsResource.loading}
          error={jobsResource.error}
          onRetry={jobsResource.reload}
          empty={jobs.length === 0}
          emptyTitle="Sin trabajos de proveedor"
          emptyHint="Cargá el trabajo contratado para seguir el anticipo, la entrega y el saldo."
        >
          {jobRows.length === 0 ? (
            <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
          ) : (
            <AdminTable
              view="trabajos"
              label="Trabajos de proveedores"
              columns={[
                { label: "Proveedor" },
                { label: "Trabajo" },
                { label: "Evento" },
                { label: "Vence" },
                { label: "Total", end: true },
                { label: "Anticipo", end: true },
                { label: "Saldo", end: true },
                { label: "Estado" },
                { label: "Acciones", end: true },
              ]}
            >
              {jobRows.map((job) => {
                const balance = supplierJobBalance(job);
                const open = isSupplierJobOpen(job.status);
                const canAdvance = supplierJobTransitions(job.status).length > 0;
                const paymentDetail = [job.paymentMethod, job.receipt ? `Comprobante ${job.receipt}` : null].filter(Boolean).join(" · ");
                return (
                  <AdminRow key={job.id}>
                    <AdminCell title={job.supplier.name}>
                      <strong>{job.supplier.name}</strong>
                    </AdminCell>
                    <AdminCell title={paymentDetail ? `${job.description} · ${paymentDetail}` : job.description}>
                      <strong>{job.description}</strong>
                    </AdminCell>
                    <AdminCell title={job.event?.name || "Sin evento asociado"}>{job.event?.name || "—"}</AdminCell>
                    <AdminCell
                      title={job.dueAt ? `${formatDateTime(job.dueAt)} · ${jobStatusLabel(job.status)}` : "Sin fecha prevista"}
                    >
                      <span className="admin-nowrap" data-tone={open ? dueTone(job.dueAt) : undefined}>
                        {job.dueAt ? formatDateShort(job.dueAt) : "—"}
                      </span>
                    </AdminCell>
                    <AdminCell end title={`Total ${formatMoney(job.total)}`}>
                      {formatMoney(job.total)}
                    </AdminCell>
                    <AdminCell end title={`Anticipo pagado ${formatMoney(job.advance)}`}>
                      {formatMoney(job.advance)}
                    </AdminCell>
                    <AdminCell end title={`Saldo pendiente ${formatMoney(balance)}`}>
                      <strong>{formatMoney(balance)}</strong>
                    </AdminCell>
                    <AdminCell>
                      <AdminBadge tone={statusTone(job.status)} title={jobStatusLabel(job.status)}>
                        {jobStatusLabel(job.status)}
                      </AdminBadge>
                    </AdminCell>
                    <AdminCell end>
                      <span className="admin-actions">
                        {writable && open && canAdvance ? (
                          <AdminButton
                            icon="arrow-right"
                            title={`Avanzar estado: ${job.description}`}
                            aria-label={`Avanzar estado: ${job.description}`}
                            onClick={() => openJobStatus(job)}
                          />
                        ) : null}
                        {writable ? (
                          <AdminButton
                            icon="edit"
                            title={`Editar trabajo: ${job.description}`}
                            aria-label={`Editar trabajo: ${job.description}`}
                            onClick={() => openJobEdit(job)}
                          />
                        ) : null}
                        {!writable ? <span className="admin-muted">—</span> : null}
                      </span>
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
          )}
        </AdminDataState>
        {jobRows.length === 300 ? <AdminNote>Mostrando los primeros 300 trabajos.</AdminNote> : null}
      </AdminPanel>

      <AdminPanel
        title="Proveedores"
        meta={`${formatNumber(supplierRows.length)} de ${formatNumber(suppliers.length)}`}
        action={
          writable ? (
            <AdminButton variant="primary" icon="plus" onClick={openSupplierCreate} aria-expanded={supplierForm !== null && !supplierForm.id}>
              Nuevo proveedor
            </AdminButton>
          ) : null
        }
      >
        {supplierError && supplierForm === null ? <AdminNote tone="error">{supplierError}</AdminNote> : null}

        {writable && supplierForm ? (
          <AdminFormPanel
            title={supplierForm.id ? `Editar proveedor: ${supplierForm.name}` : "Nuevo proveedor"}
            submitLabel={supplierForm.id ? "Guardar cambios" : "Cargar proveedor"}
            onSubmit={submitSupplier}
            onCancel={() => setSupplierForm(null)}
            busy={supplierBusy}
            status={supplierError}
          >
            <AdminField label="Nombre">
              <input
                required
                minLength={2}
                maxLength={120}
                value={supplierForm.name}
                onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })}
                placeholder="Ej.: Carpintería Lima"
              />
            </AdminField>
            <AdminField label="Empresa">
              <input
                maxLength={120}
                value={supplierForm.company}
                onChange={(event) => setSupplierForm({ ...supplierForm, company: event.target.value })}
                placeholder="Ej.: Lima Hnos. S.A."
              />
            </AdminField>
            <AdminField label="Teléfono" hint="Con código de país">
              <input
                type="tel"
                maxLength={30}
                value={supplierForm.phone}
                onChange={(event) => setSupplierForm({ ...supplierForm, phone: event.target.value })}
                placeholder="+595 981 000 000"
                autoComplete="tel"
              />
            </AdminField>
            <AdminField label="Correo">
              <input
                type="email"
                maxLength={200}
                value={supplierForm.email}
                onChange={(event) => setSupplierForm({ ...supplierForm, email: event.target.value })}
                placeholder="proveedor@correo.com"
                autoComplete="email"
              />
            </AdminField>
            <AdminField label="Rubro">
              <select value={supplierForm.category} onChange={(event) => setSupplierForm({ ...supplierForm, category: event.target.value })}>
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </AdminField>
            <AdminField label="Condiciones de pago" hint="Ej.: 50% anticipo, 30 días">
              <input
                maxLength={200}
                value={supplierForm.paymentTerms}
                onChange={(event) => setSupplierForm({ ...supplierForm, paymentTerms: event.target.value })}
                placeholder="Opcional"
              />
            </AdminField>
            <AdminField label="Estado">
              <select value={supplierForm.active ? "active" : "inactive"} onChange={(event) => setSupplierForm({ ...supplierForm, active: event.target.value === "active" })}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </AdminField>
            <AdminField label="Notas" wide>
              <textarea
                maxLength={1000}
                rows={2}
                value={supplierForm.notes}
                onChange={(event) => setSupplierForm({ ...supplierForm, notes: event.target.value })}
                placeholder="Contactos, materiales, acuerdos"
              />
            </AdminField>
          </AdminFormPanel>
        ) : null}

        <AdminDataState
          loading={suppliersResource.loading}
          error={suppliersResource.error}
          onRetry={suppliersResource.reload}
          empty={suppliers.length === 0}
          emptyTitle="Todavía no hay proveedores"
          emptyHint="Cargá carpintería, gráfica, transporte y otros rubros que trabajan en tus eventos."
        >
          {supplierRows.length === 0 ? (
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
              {supplierRows.map((supplier) => {
                const jobCount = supplier._count?.jobs ?? 0;
                return (
                  <AdminRow key={supplier.id}>
                    <AdminCell title={`${supplier.name} · ${formatNumber(jobCount)} trabajos`}>
                      <strong>{supplier.name}</strong>
                      <span className="admin-cell-sub"> · {formatNumber(jobCount)}</span>
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
                        {supplier.email ? (
                          <AdminIconLink href={`mailto:${supplier.email}`} icon="mail" label={`Enviar correo a ${supplier.name}`} />
                        ) : null}
                        {writable ? (
                          <AdminButton
                            icon="edit"
                            title={`Editar proveedor: ${supplier.name}`}
                            aria-label={`Editar proveedor: ${supplier.name}`}
                            onClick={() => openSupplierEdit(supplier)}
                          />
                        ) : null}
                        {!writable && !supplier.email ? <span className="admin-muted">—</span> : null}
                      </span>
                    </AdminCell>
                  </AdminRow>
                );
              })}
            </AdminTable>
          )}
        </AdminDataState>
      </AdminPanel>
    </div>
  );
}

/**
 * Cambio de estado de un trabajo: solo lista las transiciones válidas y pide los datos
 * de cada paso (monto del anticipo, método y comprobante, fecha de entrega o de pago).
 */
function JobStatusPanel({
  job,
  onClose,
  onSaved,
}: {
  job: AdminSupplierJobRow;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const options = supplierJobTransitions(job.status);
  const [status, setStatus] = useState<string>(options[0] ?? "");
  const [advance, setAdvance] = useState(job.advance > 0 ? String(job.advance) : "");
  const [method, setMethod] = useState(job.paymentMethod || METHOD_OPTIONS[0]);
  const [receipt, setReceipt] = useState(job.receipt ?? "");
  const [deliveredAt, setDeliveredAt] = useState(dateInputValue(new Date()));
  const [paidAt, setPaidAt] = useState(dateInputValue(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const asksAdvance = status === "ADVANCE_PENDING" || status === "ADVANCE_PAID";
  const asksPayment = status === "ADVANCE_PAID" || status === "PAID";
  const effectiveAdvance = asksAdvance ? Number(advance) || 0 : job.advance;
  const balance = Math.max(0, job.total - effectiveAdvance);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status) {
      setError("Elegí el estado siguiente.");
      return;
    }
    if (asksAdvance && effectiveAdvance <= 0) {
      setError("El anticipo debe ser mayor a cero.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await adminSend(
      "/api/admin/suppliers/jobs",
      {
        id: job.id,
        status,
        ...(asksAdvance ? { advance: effectiveAdvance } : {}),
        ...(asksPayment ? { paymentMethod: method, receipt } : {}),
        ...(status === "DELIVERED" ? { deliveredAt } : {}),
        ...(status === "PAID" ? { paidAt } : {}),
      },
      "PATCH",
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved(`Trabajo «${job.description}»: ${jobStatusLabel(status)}.`);
  }

  return (
    <AdminFormPanel
      title={`Estado del trabajo: ${job.description}`}
      submitLabel="Confirmar cambio"
      onSubmit={submit}
      onCancel={onClose}
      busy={busy}
      status={error}
    >
      <p className="admin-note admin-field--wide">
        Estado actual: <AdminBadge tone={statusTone(job.status)}>{jobStatusLabel(job.status)}</AdminBadge> · Total {formatMoney(job.total)} ·
        Anticipo {formatMoney(job.advance)}
      </p>
      <AdminField label="Nuevo estado">
        <select required value={status} onChange={(event) => setStatus(event.target.value)}>
          {options.map((value) => (
            <option key={value} value={value}>
              {jobStatusLabel(value)}
            </option>
          ))}
        </select>
      </AdminField>
      {asksAdvance ? (
        <AdminField label="Monto del anticipo" hint="En guaraníes, mayor a cero">
          <input
            type="number"
            min="1"
            step="1"
            required
            value={advance}
            onChange={(event) => setAdvance(event.target.value)}
            inputMode="numeric"
          />
        </AdminField>
      ) : null}
      {asksPayment ? (
        <>
          <AdminField label="Método">
            <select value={method} onChange={(event) => setMethod(event.target.value)}>
              {METHOD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Comprobante" hint="Nº de recibo o transferencia">
            <input maxLength={120} value={receipt} onChange={(event) => setReceipt(event.target.value)} placeholder="Opcional" />
          </AdminField>
        </>
      ) : null}
      {status === "DELIVERED" ? (
        <AdminField label="Fecha de entrega">
          <input type="date" value={deliveredAt} onChange={(event) => setDeliveredAt(event.target.value)} />
        </AdminField>
      ) : null}
      {status === "PAID" ? (
        <AdminField label="Fecha de pago">
          <input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
        </AdminField>
      ) : null}
      {status === "CANCELLED" ? <AdminNote>El trabajo queda cancelado y no se puede reactivar.</AdminNote> : null}
      {status === "BALANCE_PENDING" ? <AdminNote>Saldo que queda pendiente: {formatMoney(balance)}.</AdminNote> : null}
      {status === "PAID" ? <AdminNote>Saldo a liquidar: {formatMoney(balance)}.</AdminNote> : null}
    </AdminFormPanel>
  );
}
