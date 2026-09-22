"use client";

import { useCallback, useMemo, useState } from "react";
import {
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
  supplierJobNextStatuses,
  supplierJobTransitions,
  SUPPLIER_CATEGORIES,
  SUPPLIER_JOB_STATUSES,
  type AdminSupplierJobRow,
  type AdminSupplierRow,
} from "@/lib/admin-types";
import { useAdminSession } from "../AdminShell";
import { AdminBoard, AdminViewSwitch, useAdminBoardMove, useAdminModuleView, type AdminBoardCardData, type AdminBoardColumn } from "../AdminBoard";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminEmpty,
  AdminFormPanel,
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
import {
  DateField,
  EmailField,
  MoneyField,
  PhoneField,
  SearchField,
  SelectField,
  TextAreaField,
  TextField,
} from "../AdminFields";
import { adminSend, useAdminResource } from "@/lib/admin-api";

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

/** Tablero kanban de trabajos: una columna por estado real de la máquina del API. */
const JOB_BOARD_COLUMNS: AdminBoardColumn[] = SUPPLIER_JOB_STATUSES.map((value) => ({ value, label: jobStatusLabel(value) }));

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
  const [jobsView, setJobsView] = useAdminModuleView("trabajos");
  const [supplierForm, setSupplierForm] = useState<SupplierForm | null>(null);
  const [supplierBusy, setSupplierBusy] = useState(false);
  const [supplierError, setSupplierError] = useState("");
  const [jobPanel, setJobPanel] = useState<JobPanel | null>(null);
  const [jobForm, setJobForm] = useState<JobForm>(EMPTY_JOB);
  const [jobBusy, setJobBusy] = useState(false);
  const [jobError, setJobError] = useState("");
  const [boardError, setBoardError] = useState("");
  const [notice, setNotice] = useState("");

  const writable = canWriteFinance(role);
  const suppliers = useMemo<AdminSupplierRow[]>(() => suppliersResource.data ?? [], [suppliersResource.data]);
  const jobs = useMemo<AdminSupplierJobRow[]>(() => jobsResource.data ?? [], [jobsResource.data]);
  const events = useMemo(() => eventsResource.data ?? [], [eventsResource.data]);

  const supplierRows = useMemo(
    () => suppliers.filter((supplier) => matchesQuery(query, [supplier.name, supplier.company, supplier.category, supplier.phone, supplier.email])),
    [suppliers, query],
  );

  /** Búsqueda compartida por lista y tablero: el filtro de estado es de la lista. */
  const searchedJobs = useMemo(
    () =>
      jobs.filter((job) =>
        matchesQuery(query, [job.supplier.name, job.event?.name, job.description, jobStatusLabel(job.status), supplierCategoryLabel(job.category)]),
      ),
    [jobs, query],
  );

  const jobRows = useMemo(
    () =>
      searchedJobs
        .filter((job) => (jobStatus === "ALL" ? true : jobStatus === "OPEN" ? isSupplierJobOpen(job.status) : job.status === jobStatus))
        .sort((a, b) => {
          const openDifference = (isSupplierJobOpen(a.status) ? 0 : 1) - (isSupplierJobOpen(b.status) ? 0 : 1);
          if (openDifference !== 0) return openDifference;
          const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
          const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
          if (aDue !== bDue) return aDue - bDue;
          return a.description.localeCompare(b.description, "es");
        }),
    [searchedJobs, jobStatus],
  );

  // Tablero de trabajos: respeta la máquina de estados del API (`supplierJobNextStatuses`);
  // el drag/menú solo ofrece transiciones reales y el API revalida.
  const moveJob = useCallback(async (job: AdminSupplierJobRow, nextStatus: string) => {
    setBoardError("");
    const result = await adminSend("/api/admin/suppliers/jobs", { id: job.id, status: nextStatus }, "PATCH", { idempotencyKey: true });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }, []);
  const board = useAdminBoardMove({ rows: jobs, move: moveJob, onError: setBoardError });

  const boardCards = useMemo<AdminBoardCardData[]>(
    () =>
      board.rows.map((job) => {
        const balance = supplierJobBalance(job);
        const open = isSupplierJobOpen(job.status);
        const paymentDetail = [job.paymentMethod, job.receipt ? `comprobante ${job.receipt}` : null].filter(Boolean).join(" · ");
        return {
          id: job.id,
          status: job.status,
          title: job.description,
          subtitle: [job.supplier.name, job.event?.name ?? null].filter(Boolean).join(" · "),
          amount: balance,
          amountNote: `de ${formatMoney(job.total)}`,
          date: open ? job.dueAt : null,
          dateTitle: `Cuánto falta para el vencimiento: ${job.description}`,
          detail: open
            ? [paymentDetail || null, `anticipo ${formatMoney(job.advance)}`].filter(Boolean).join(" · ")
            : "Trabajo cerrado: no admite más cambios",
          targets: supplierJobNextStatuses(job),
          actions: (
            <>
              {writable && open && supplierJobTransitions(job.status).length > 0 ? (
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
            </>
          ),
        };
      }),
    [board.rows, writable],
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
          { idempotencyKey: true },
        )
      : await adminSend("/api/admin/suppliers/jobs", {
          ...common,
          supplierId: jobForm.supplierId,
          ...(Number(jobForm.advance || 0) > 0 ? { paymentMethod: jobForm.paymentMethod, receipt: jobForm.receipt } : {}),
        }, "POST", { idempotencyKey: true });
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
        <AdminKpi label="Proveedores" icon="suppliers" value={formatNumber(totals.activeSuppliers)} note={`activos de ${formatNumber(suppliers.length)}`} />
        <AdminKpi label="Trabajos abiertos" icon="suppliers" value={formatNumber(totals.open)} note="sin pagar ni cancelar" tone="accent" />
        <AdminKpi label="Saldo por pagar" icon="finance" value={formatMoney(totals.payable)} note="trabajos abiertos" tone={totals.payable > 0 ? "warn" : "ok"} />
        <AdminKpi
          label="Vencidos" icon="alert"
          value={formatNumber(totals.overdue)}
          note="con fecha prevista pasada"
          tone={totals.overdue > 0 ? "warn" : "ok"}
        />
      </section>

      <AdminToolbar>
        <SearchField value={query} onChange={setQuery} label="Buscar proveedores y trabajos" placeholder="Buscar por proveedor, trabajo, evento o rubro…" />
        {jobsView === "list" ? (
          <AdminSelect value={jobStatus} onChange={setJobStatus} label="Filtrar trabajos por estado" options={JOB_STATUS_OPTIONS} />
        ) : null}
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {boardError ? <AdminNote tone="error">{boardError}</AdminNote> : null}

      <AdminPanel
        title="Trabajos por evento" icon="suppliers"
        meta={`${formatNumber(jobRows.length)} de ${formatNumber(jobs.length)}`}
        action={
          <span className="admin-panel-actions">
            <AdminViewSwitch view={jobsView} onChange={setJobsView} label="Vista de trabajos" />
            {writable ? (
              <AdminButton variant="primary" icon="plus" onClick={openJobCreate} aria-expanded={jobPanel?.mode === "create"}>
                Nuevo trabajo
              </AdminButton>
            ) : null}
          </span>
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
            <SelectField
              label="Proveedor"
              required
              value={jobForm.supplierId}
              onChange={(value) => {
                const supplier = suppliers.find((item) => item.id === value);
                setJobForm({ ...jobForm, supplierId: value, category: supplier?.category ?? jobForm.category });
              }}
              options={[
                { value: "", label: "Elegí un proveedor…" },
                ...suppliers
                  .filter((supplier) => supplier.active || supplier.id === jobForm.supplierId)
                  .map((supplier) => ({ value: supplier.id, label: supplier.name })),
              ]}
            />
            <SelectField
              label="Evento"
              hint="Opcional"
              value={jobForm.eventId}
              onChange={(value) => setJobForm({ ...jobForm, eventId: value })}
              options={[{ value: "", label: "Sin evento asociado" }, ...events.map((item) => ({ value: item.id, label: item.name }))]}
            />
            <SelectField
              label="Rubro del trabajo"
              value={jobForm.category}
              onChange={(value) => setJobForm({ ...jobForm, category: value })}
              options={CATEGORY_OPTIONS}
            />
            <div className="admin-countdown-field">
              <DateField
                label="Vence"
                hint="Fecha prevista de entrega"
                value={jobForm.dueAt}
                onChange={(value) => setJobForm({ ...jobForm, dueAt: value })}
              />
              <AdminCountdown value={jobForm.dueAt} title="Cuánto falta para el vencimiento del trabajo" />
            </div>
            <TextField
              label="Trabajo / concepto"
              wide
              required
              maxLength={200}
              value={jobForm.description}
              onChange={(value) => setJobForm({ ...jobForm, description: value })}
              placeholder="Ej.: Estructura y gráfica de stand"
            />
            <MoneyField
              label="Costo total"
              hint="En guaraníes"
              required
              value={jobForm.total}
              onChange={(value) => setJobForm({ ...jobForm, total: value })}
            />
            <MoneyField
              label="Anticipo"
              hint="Si lo cargás, queda con anticipo pagado"
              value={jobForm.advance}
              onChange={(value) => setJobForm({ ...jobForm, advance: value })}
            />
            {formAdvance > 0 ? (
              <>
                <SelectField
                  label="Método del anticipo"
                  value={jobForm.paymentMethod}
                  onChange={(value) => setJobForm({ ...jobForm, paymentMethod: value })}
                  options={METHOD_OPTIONS.map((method) => ({ value: method, label: method }))}
                />
                <TextField
                  label="Comprobante del anticipo"
                  hint="Nº de recibo o transferencia"
                  maxLength={120}
                  value={jobForm.receipt}
                  onChange={(value) => setJobForm({ ...jobForm, receipt: value })}
                  placeholder="Opcional"
                />
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
            <TextField label="Proveedor" disabled value={editingJob.supplier.name} onChange={() => {}} />
            <SelectField
              label="Evento"
              hint="Opcional"
              value={jobForm.eventId}
              onChange={(value) => setJobForm({ ...jobForm, eventId: value })}
              options={[{ value: "", label: "Sin evento asociado" }, ...events.map((item) => ({ value: item.id, label: item.name }))]}
            />
            <SelectField
              label="Rubro del trabajo"
              value={jobForm.category}
              onChange={(value) => setJobForm({ ...jobForm, category: value })}
              options={CATEGORY_OPTIONS}
            />
            <div className="admin-countdown-field">
              <DateField
                label="Vence"
                hint="Fecha prevista de entrega"
                value={jobForm.dueAt}
                onChange={(value) => setJobForm({ ...jobForm, dueAt: value })}
              />
              <AdminCountdown value={jobForm.dueAt} title="Cuánto falta para el vencimiento del trabajo" />
            </div>
            <TextField
              label="Trabajo / concepto"
              wide
              required
              maxLength={200}
              value={jobForm.description}
              onChange={(value) => setJobForm({ ...jobForm, description: value })}
            />
            <MoneyField
              label="Costo total"
              hint="En guaraníes"
              required
              disabled={editingClosed}
              value={jobForm.total}
              onChange={(value) => setJobForm({ ...jobForm, total: value })}
            />
            <MoneyField
              label="Anticipo pagado"
              hint="En guaraníes"
              disabled={editingClosed}
              value={jobForm.advance}
              onChange={(value) => setJobForm({ ...jobForm, advance: value })}
            />
            <SelectField
              label="Método de pago"
              hint="Último pago registrado"
              value={jobForm.paymentMethod}
              onChange={(value) => setJobForm({ ...jobForm, paymentMethod: value })}
              options={METHOD_OPTIONS.map((method) => ({ value: method, label: method }))}
            />
            <TextField
              label="Comprobante"
              hint="Nº de recibo o transferencia"
              maxLength={120}
              value={jobForm.receipt}
              onChange={(value) => setJobForm({ ...jobForm, receipt: value })}
              placeholder="Opcional"
            />
            {editingJob.deliveredAt ? (
              <div className="admin-countdown-field">
                <DateField
                  label="Fecha de entrega"
                  value={jobForm.deliveredAt}
                  onChange={(value) => setJobForm({ ...jobForm, deliveredAt: value })}
                />
                <AdminCountdown value={jobForm.deliveredAt} title="Entrega del proveedor" />
              </div>
            ) : null}
            {editingJob.paidAt ? (
              <DateField
                label="Fecha de pago"
                value={jobForm.paidAt}
                onChange={(value) => setJobForm({ ...jobForm, paidAt: value })}
              />
            ) : null}
            <TextAreaField
              label="Notas"
              wide
              maxLength={1000}
              rows={2}
              value={jobForm.notes}
              onChange={(value) => setJobForm({ ...jobForm, notes: value })}
              placeholder="Detalles de coordinación, materiales o acuerdos"
            />
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
          emptyTitle="Sin trabajos de proveedor" emptyIcon="suppliers"
          emptyHint="Cargá el trabajo contratado para seguir el anticipo, la entrega y el saldo."
        >
        {jobsView === "board" ? (
          searchedJobs.length === 0 ? (
            <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda." />
          ) : (
            <AdminBoard
              label="Trabajos de proveedores"
              columns={JOB_BOARD_COLUMNS}
              cards={boardCards}
              canMove={writable}
              movingIds={board.movingIds}
              onMove={writable ? board.moveTo : undefined}
            />
          )
        ) : jobRows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
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
                      <span className="admin-nowrap">{job.dueAt ? formatDateShort(job.dueAt) : "—"}</span>
                      {open ? (
                        <AdminCountdown
                          value={job.dueAt}
                          className="admin-countdown--inline"
                          title={`Cuánto falta para el vencimiento: ${job.description}`}
                        />
                      ) : null}
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
        title="Proveedores" icon="suppliers"
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
            <TextField
              label="Nombre"
              required
              minLength={2}
              maxLength={120}
              value={supplierForm.name}
              onChange={(value) => setSupplierForm({ ...supplierForm, name: value })}
              placeholder="Ej.: Carpintería Lima"
            />
            <TextField
              label="Empresa"
              maxLength={120}
              value={supplierForm.company}
              onChange={(value) => setSupplierForm({ ...supplierForm, company: value })}
              placeholder="Ej.: Lima Hnos. S.A."
            />
            <PhoneField
              label="Teléfono"
              hint="Con código de país"
              value={supplierForm.phone}
              onChange={(value) => setSupplierForm({ ...supplierForm, phone: value })}
            />
            <EmailField
              label="Correo"
              value={supplierForm.email}
              onChange={(value) => setSupplierForm({ ...supplierForm, email: value })}
              placeholder="proveedor@correo.com"
            />
            <SelectField
              label="Rubro"
              value={supplierForm.category}
              onChange={(value) => setSupplierForm({ ...supplierForm, category: value })}
              options={CATEGORY_OPTIONS}
            />
            <TextField
              label="Condiciones de pago"
              hint="Ej.: 50% anticipo, 30 días"
              maxLength={200}
              value={supplierForm.paymentTerms}
              onChange={(value) => setSupplierForm({ ...supplierForm, paymentTerms: value })}
              placeholder="Opcional"
            />
            <SelectField
              label="Estado"
              value={supplierForm.active ? "active" : "inactive"}
              onChange={(value) => setSupplierForm({ ...supplierForm, active: value === "active" })}
              options={[
                { value: "active", label: "Activo" },
                { value: "inactive", label: "Inactivo" },
              ]}
            />
            <TextAreaField
              label="Notas"
              wide
              maxLength={1000}
              rows={2}
              value={supplierForm.notes}
              onChange={(value) => setSupplierForm({ ...supplierForm, notes: value })}
              placeholder="Contactos, materiales, acuerdos"
            />
          </AdminFormPanel>
        ) : null}

        <AdminDataState
          loading={suppliersResource.loading}
          error={suppliersResource.error}
          onRetry={suppliersResource.reload}
          empty={suppliers.length === 0}
          emptyTitle="Todavía no hay proveedores" emptyIcon="suppliers"
          emptyHint="Cargá carpintería, gráfica, transporte y otros rubros que trabajan en tus eventos."
        >
          {supplierRows.length === 0 ? (
            <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda." />
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
      { idempotencyKey: true },
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
      <div className="admin-field--wide">
        <AdminNote>
          Estado actual: <AdminBadge tone={statusTone(job.status)}>{jobStatusLabel(job.status)}</AdminBadge> · Total {formatMoney(job.total)} ·
          Anticipo {formatMoney(job.advance)}
        </AdminNote>
      </div>
      <SelectField
        label="Nuevo estado"
        required
        value={status}
        onChange={setStatus}
        options={options.map((value) => ({ value, label: jobStatusLabel(value) }))}
      />
      {asksAdvance ? (
        <MoneyField
          label="Monto del anticipo"
          hint="En guaraníes, mayor a cero"
          required
          value={advance}
          onChange={setAdvance}
        />
      ) : null}
      {asksPayment ? (
        <>
          <SelectField
            label="Método"
            value={method}
            onChange={setMethod}
            options={METHOD_OPTIONS.map((option) => ({ value: option, label: option }))}
          />
          <TextField
            label="Comprobante"
            hint="Nº de recibo o transferencia"
            maxLength={120}
            value={receipt}
            onChange={setReceipt}
            placeholder="Opcional"
          />
        </>
      ) : null}
      {status === "DELIVERED" ? (
        <div className="admin-countdown-field">
          <DateField label="Fecha de entrega" value={deliveredAt} onChange={setDeliveredAt} />
          <AdminCountdown value={deliveredAt} title="Entrega del proveedor" />
        </div>
      ) : null}
      {status === "PAID" ? <DateField label="Fecha de pago" value={paidAt} onChange={setPaidAt} /> : null}
      {status === "CANCELLED" ? <AdminNote>El trabajo queda cancelado y no se puede reactivar.</AdminNote> : null}
      {status === "BALANCE_PENDING" ? <AdminNote>Saldo que queda pendiente: {formatMoney(balance)}.</AdminNote> : null}
      {status === "PAID" ? <AdminNote>Saldo a liquidar: {formatMoney(balance)}.</AdminNote> : null}
    </AdminFormPanel>
  );
}
