"use client";

import { kpiState } from "@/components/admin/kpi-state";
import { useCallback, useId, useMemo, useState } from "react";
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
  PAYMENT_METHODS,
  supplierJobBalance,
  supplierJobNextStatuses,
  supplierJobTransitions,
  SUPPLIER_CATEGORIES,
  SUPPLIER_JOB_STATUSES,
  type AdminEventOption,
  type AdminSupplierJobPanelRow,
  type AdminSupplierRow,
} from "@/lib/admin-types";
import { useTrashFlow } from "../TrashDialogs";
import { useBulkTrash, BulkTrashControls, BulkRowCheck } from "../TrashBulk";
import { loadBulkTrashRows } from "@/lib/admin-bulk-trash";
import { filterSupplierSelection, supplierBulkRow } from "@/lib/admin-crm-selection";
import { useAdminSession } from "../AdminShell";
import { AdminBoard, AdminViewSwitch, useAdminBoardMove, useAdminModuleView, useAdminNarrowViewport, type AdminBoardCardData, type AdminBoardColumn } from "../AdminBoard";
import { AdminCardGrid, type AdminCardData } from "../AdminCards";

/** Fila del panel de trabajos (issue #68): referencias mínimas de proveedor y evento. */
type JobRow = AdminSupplierJobPanelRow;
import {
  AdminActionsMenu,
  AdminSelect,
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminEmpty,
  AdminDialog,
  AdminDialogSection,
  AdminIconLink,
  AdminKpi,
  AdminKpis,
  AdminNote,
  AdminPanel,
  AdminRow,
  AdminTable,
  AdminToolbar,
  AdminWhatsappLink,
  type AdminMenuItem,
  AdminTabs,
} from "../AdminUI";
import {
  Combobox,
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
import { FIELD_LIMITS, FIELD_MESSAGES, emailValid, personNameValid } from "@/lib/field-rules";

/**
 * Flujo de proveedores: directorio con alta y edición, y trabajos por evento con
 * máquina de estados, anticipo, pago final, fechas y comprobante. El saldo por
 * trabajo sale de la base (`total − anticipo`, 0 si está pagado o cancelado).
 */

/** Los métodos son la lista única del panel (issue #135), sin variantes. */
const METHOD_OPTIONS = [...PAYMENT_METHODS];

/**
 * Condiciones de pago del proveedor (issue #131): select con las opciones
 * acordadas (Contado, 15/30/60) en vez de texto libre. Lo guardado antes como
 * texto libre se conserva como opción extra al editar, así no se pierde nada.
 */
const PAYMENT_TERM_OPTIONS = [
  { value: "", label: "Sin definir" },
  { value: "Contado", label: "Contado" },
  { value: "15 días", label: "15 días" },
  { value: "30 días", label: "30 días" },
  { value: "60 días", label: "60 días" },
];

function paymentTermChoices(current: string) {
  const value = current.trim();
  if (!value || PAYMENT_TERM_OPTIONS.some((option) => option.value === value)) return PAYMENT_TERM_OPTIONS;
  return [...PAYMENT_TERM_OPTIONS, { value, label: `${value} (cargado)` }];
}

const CATEGORY_OPTIONS = SUPPLIER_CATEGORIES.map((value) => ({ value, label: supplierCategoryLabel(value) }));

/** Tablero kanban de trabajos: una columna por estado real de la máquina del API. */
const JOB_BOARD_COLUMNS: AdminBoardColumn[] = SUPPLIER_JOB_STATUSES.map((value) => ({ value, label: jobStatusLabel(value) }));

/** Vistas del directorio de proveedores (issue #57): lista densa y cuadrícula de contactos. */
const PROVEEDORES_VIEWS = ["list", "grid"] as const;

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

type JobPanel = { mode: "create" } | { mode: "edit"; job: JobRow } | { mode: "status"; job: JobRow };

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

function supplierFormFromRow(supplier: AdminSupplierRow): SupplierForm {
  return {
    id: supplier.id,
    name: supplier.name,
    company: supplier.company ?? "",
    phone: supplier.phone ?? "",
    email: supplier.email ?? "",
    category: supplier.category,
    paymentTerms: supplier.paymentTerms ?? "",
    notes: supplier.notes ?? "",
    active: supplier.active,
  };
}

function jobFormFromRow(job: JobRow): JobForm {
  return {
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
  };
}

export function ProveedoresModule() {
  const { role, organization } = useAdminSession();
  const suppliersResource = useAdminResource("/api/admin/suppliers", (payload) => payload.suppliers ?? []);
  const jobsResource = useAdminResource(
    "/api/admin/suppliers/jobs?fields=panel",
    (payload) => (payload as { jobs?: AdminSupplierJobPanelRow[] }).jobs ?? [],
  );
  const eventsResource = useAdminResource(
    "/api/admin/events?fields=selector",
    (payload) => (payload as { events?: AdminEventOption[] }).events ?? [],
  );

  const [query, setQuery] = useState("");
  const [jobStatus, setJobStatus] = useState("ALL");
  const [jobsView, setJobsView] = useAdminModuleView("trabajos");
  const [suppliersView, setSuppliersView] = useAdminModuleView("proveedores", PROVEEDORES_VIEWS);
  /** Ancho compacto (issue #151): pestañas de estado y tarjetas, sin tablero. */
  const narrow = useAdminNarrowViewport();
  const [supplierForm, setSupplierForm] = useState<SupplierForm | null>(null);
  const [supplierBusy, setSupplierBusy] = useState(false);
  const [supplierError, setSupplierError] = useState("");
  const [jobPanel, setJobPanel] = useState<JobPanel | null>(null);
  const [jobForm, setJobForm] = useState<JobForm>(EMPTY_JOB);
  const [jobBusy, setJobBusy] = useState(false);
  const [jobError, setJobError] = useState("");
  const [boardError, setBoardError] = useState("");
  const [notice, setNotice] = useState("");
  const supplierFormId = useId();
  const jobFormId = useId();
  const supplierBaseline = supplierForm?.id
    ? (() => {
        const row = (suppliersResource.data ?? []).find((item) => item.id === supplierForm.id);
        return row ? supplierFormFromRow(row) : EMPTY_SUPPLIER;
      })()
    : EMPTY_SUPPLIER;
  const supplierDirty = supplierForm !== null && JSON.stringify(supplierForm) !== JSON.stringify(supplierBaseline);
  const jobBaseline = jobPanel?.mode === "edit" ? jobFormFromRow(jobPanel.job) : EMPTY_JOB;
  const jobDirty = jobPanel !== null && jobPanel.mode !== "status" && JSON.stringify(jobForm) !== JSON.stringify(jobBaseline);

  const writable = canWriteFinance(role);
  const suppliers = useMemo<AdminSupplierRow[]>(() => suppliersResource.data ?? [], [suppliersResource.data]);
  const jobs = useMemo<JobRow[]>(() => jobsResource.data ?? [], [jobsResource.data]);
  const events = useMemo(() => eventsResource.data ?? [], [eventsResource.data]);

  // Lo archivado (papelera) sale del directorio activo y de los indicadores; se ve con «Archivados».
  const [supplierScope, setSupplierScope] = useState("ACTIVE");
  const trash = useTrashFlow("Supplier", { onChanged: suppliersResource.reload });
  const liveSuppliers = useMemo(() => suppliers.filter((supplier) => !supplier.archivedAt), [suppliers]);
  const supplierRows = useMemo(
    () => filterSupplierSelection(suppliers, { query, supplierScope }),
    [suppliers, supplierScope, query],
  );

  const bulk = useBulkTrash({
    type: "Supplier", organizationId: organization?.id ?? "", enabled: writable,
    scopeKey: JSON.stringify({ query, supplierScope }),
    visibleRows: supplierRows.map(supplierBulkRow),
    loadAllRows: async () => filterSupplierSelection(await loadBulkTrashRows<AdminSupplierRow>("/api/admin/suppliers", "suppliers"), { query, supplierScope }).map(supplierBulkRow),
    onChanged: suppliersResource.reload,
  });

  /** Búsqueda compartida por lista, tarjetas y tablero. */
  const searchedJobs = useMemo(
    () =>
      jobs.filter((job) =>
        matchesQuery(query, [job.supplier.name, job.event?.name, job.description, jobStatusLabel(job.status), supplierCategoryLabel(job.category)]),
      ),
    [jobs, query],
  );

  /**
   * Filtro de estado compartido por las pestañas, la lista, las tarjetas y el
   * tablero (issue #151): «Abiertos» agrupa los estados vivos de la máquina.
   */
  const filteredJobs = useMemo(
    () =>
      searchedJobs.filter((job) =>
        jobStatus === "ALL" ? true : jobStatus === "OPEN" ? isSupplierJobOpen(job.status) : job.status === jobStatus,
      ),
    [searchedJobs, jobStatus],
  );

  const jobRows = useMemo(
    () =>
      [...filteredJobs].sort((a, b) => {
        const openDifference = (isSupplierJobOpen(a.status) ? 0 : 1) - (isSupplierJobOpen(b.status) ? 0 : 1);
        if (openDifference !== 0) return openDifference;
        const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
        const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
        if (aDue !== bDue) return aDue - bDue;
        return a.description.localeCompare(b.description, "es");
      }),
    [filteredJobs],
  );

  /** Conteo por estado para las pestañas (issue #151): total y abiertos. */
  const jobStatusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const job of jobs) counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
    return counts;
  }, [jobs]);
  const openJobsCount = useMemo(() => jobs.filter((job) => isSupplierJobOpen(job.status)).length, [jobs]);

  // Tablero de trabajos: respeta la máquina de estados del API (`supplierJobNextStatuses`);
  // el drag/menú solo ofrece transiciones reales y el API revalida.
  const moveJob = useCallback(async (job: JobRow, nextStatus: string) => {
    setBoardError("");
    const result = await adminSend("/api/admin/suppliers/jobs", { id: job.id, status: nextStatus }, "PATCH", { idempotencyKey: true });
    return result.ok ? { ok: true as const } : { ok: false as const, error: result.error };
  }, []);
  const board = useAdminBoardMove({ rows: filteredJobs, move: moveJob, onError: setBoardError });

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

  /**
   * Tarjetas de trabajos del ancho compacto (issue #151): proveedor, vencimiento
   * y montos, con las mismas acciones de la fila dentro del menú «⋯».
   */
  const jobCards = useMemo<AdminCardData[]>(
    () =>
      jobRows.map((job) => {
        const balance = supplierJobBalance(job);
        const open = isSupplierJobOpen(job.status);
        const canAdvance = supplierJobTransitions(job.status).length > 0;
        const paymentDetail = [job.paymentMethod, job.receipt ? `comprobante ${job.receipt}` : null].filter(Boolean).join(" · ");
        const menuItems: AdminMenuItem[] = writable
          ? [{ label: "Editar trabajo", icon: "edit", onClick: () => openJobEdit(job), title: `Editar trabajo: ${job.description}` }]
          : [];
        return {
          id: job.id,
          title: job.description,
          titleTooltip: paymentDetail ? `${job.description} · ${paymentDetail}` : job.description,
          subtitle: [job.supplier.name, job.event?.name ?? null].filter(Boolean).join(" · "),
          badges: [{ label: jobStatusLabel(job.status), tone: statusTone(job.status) }],
          fields: [
            {
              label: "Vence",
              value: job.dueAt ? (
                <>
                  <span className="admin-nowrap">{formatDateShort(job.dueAt)}</span>{" "}
                  {open ? (
                    <AdminCountdown
                      value={job.dueAt}
                      className="admin-countdown--inline"
                      title={`Cuánto falta para el vencimiento: ${job.description}`}
                    />
                  ) : null}
                </>
              ) : (
                "—"
              ),
              title: job.dueAt ? `${formatDateTime(job.dueAt)} · ${jobStatusLabel(job.status)}` : "Sin fecha prevista",
            },
            { label: "Total", value: formatMoney(job.total), title: `Total ${formatMoney(job.total)}` },
            { label: "Anticipo", value: formatMoney(job.advance), title: `Anticipo pagado ${formatMoney(job.advance)}` },
            { label: "Saldo", value: <strong>{formatMoney(balance)}</strong>, title: `Saldo pendiente ${formatMoney(balance)}` },
          ],
          footer:
            writable && open && canAdvance ? (
              <span className="admin-actions">
                <AdminButton
                  icon="arrow-right"
                  title={`Avanzar estado: ${job.description}`}
                  aria-label={`Avanzar estado: ${job.description}`}
                  onClick={() => openJobStatus(job)}
                />
                {menuItems.length > 0 ? (
                  <AdminActionsMenu label={`Acciones del trabajo ${job.description}`} items={menuItems} />
                ) : null}
              </span>
            ) : menuItems.length > 0 ? (
              <span className="admin-actions">
                <AdminActionsMenu label={`Acciones del trabajo ${job.description}`} items={menuItems} />
              </span>
            ) : undefined,
        };
      }),
    [jobRows, writable],
  );

  /**
   * Tarjetas del directorio (issues #57 y #151): las comparten la cuadrícula y
   * el ancho compacto; las acciones secundarias viven en el menú «⋯».
   */
  const supplierCards = useMemo<AdminCardData[]>(
    () =>
      supplierRows.map((supplier): AdminCardData => {
        const jobCount = supplier._count?.jobs ?? 0;
        const menuItems: AdminMenuItem[] = [
          ...(supplier.email
            ? [{ label: "Enviar correo", icon: "mail" as const, href: `mailto:${supplier.email}`, title: `Enviar correo a ${supplier.name}` }]
            : []),
          ...(writable
            ? [{ label: "Editar proveedor", icon: "edit" as const, onClick: () => openSupplierEdit(supplier), title: `Editar proveedor: ${supplier.name}` }]
            : []),
          ...trash.menu({ id: supplier.id, name: supplier.name, archived: Boolean(supplier.archivedAt), canWrite: writable }),
        ];
        return {
          id: supplier.id,
          title: <>{writable ? <BulkRowCheck bulk={bulk} row={supplierBulkRow(supplier)} /> : null}{supplier.name}</>,
          titleTooltip: `${supplier.name} · ${formatNumber(jobCount)} trabajos`,
          subtitle: supplier.company || null,
          badges: [
            {
              label: supplierCategoryLabel(supplier.category),
              tone: supplier.category === "OTHER" ? "neutral" : "info",
            },
            supplier.archivedAt ? { label: "Archivado", tone: "neutral" } : { label: supplier.active ? "Activo" : "Inactivo", tone: supplier.active ? "ok" : "neutral" },
          ],
          fields: [
            { label: "Trabajos", value: formatNumber(jobCount), title: `${formatNumber(jobCount)} trabajos` },
            { label: "Teléfono", value: supplier.phone || "—", title: supplier.phone || "Sin teléfono" },
            { label: "Correo", value: supplier.email || "—", title: supplier.email || "Sin correo" },
            {
              label: "Condiciones",
              value: supplier.paymentTerms || "—",
              title: supplier.paymentTerms || "Sin condiciones cargadas",
            },
          ],
          footer: (
            <span className="admin-actions">
              <AdminWhatsappLink phone={supplier.phone} name={supplier.name} />
              {menuItems.length > 0 ? <AdminActionsMenu label={`Acciones de ${supplier.name}`} items={menuItems} /> : null}
            </span>
          ),
        };
      }),
    [supplierRows, writable, trash, bulk],
  );

  const totals = useMemo(() => {
    const open = jobs.filter((job) => isSupplierJobOpen(job.status));
    return {
      activeSuppliers: liveSuppliers.filter((supplier) => supplier.active).length,
      open: open.length,
      payable: jobs.reduce((sum, job) => sum + supplierJobBalance(job), 0),
      overdue: open.filter((job) => job.dueAt && new Date(job.dueAt).getTime() < Date.now()).length,
    };
  }, [jobs, liveSuppliers]);

  function openSupplierCreate() {
    setSupplierError("");
    setNotice("");
    setSupplierForm({ ...EMPTY_SUPPLIER });
  }

  function openSupplierEdit(supplier: AdminSupplierRow) {
    setSupplierError("");
    setNotice("");
    setSupplierForm(supplierFormFromRow(supplier));
  }

  async function submitSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supplierForm || supplierBusy) return;
    // Avisos es-PY del front con las reglas del kit (issue #131); el API revalida.
    if (!personNameValid(supplierForm.name)) {
      setSupplierError(FIELD_MESSAGES.name);
      return;
    }
    if (supplierForm.email && !emailValid(supplierForm.email)) {
      setSupplierError(FIELD_MESSAGES.email);
      return;
    }
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

  function openJobEdit(job: JobRow) {
    setJobError("");
    setNotice("");
    setJobForm(jobFormFromRow(job));
    setJobPanel({ mode: "edit", job });
  }

  function openJobStatus(job: JobRow) {
    setJobError("");
    setNotice("");
    setJobPanel({ mode: "status", job });
  }

  async function submitJob(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (jobBusy) return;
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
      <AdminKpis label="Indicadores de proveedores">
        <AdminKpi state={kpiState(suppliersResource)} label="Proveedores" icon="suppliers" value={formatNumber(totals.activeSuppliers)} note={`activos de ${formatNumber(liveSuppliers.length)}`} />
        <AdminKpi state={kpiState(jobsResource)} label="Trabajos abiertos" icon="suppliers" value={formatNumber(totals.open)} note="sin pagar ni cancelar" tone="accent" />
        <AdminKpi state={kpiState(jobsResource)} label="Saldo por pagar" icon="finance" value={formatMoney(totals.payable)} note="trabajos abiertos" tone={totals.payable > 0 ? "warn" : "ok"} />
        <AdminKpi
          state={kpiState(jobsResource)}
          label="Vencidos" icon="alert"
          value={formatNumber(totals.overdue)}
          note="con fecha prevista pasada"
          tone={totals.overdue > 0 ? "warn" : "ok"}
        />
      </AdminKpis>

      <AdminToolbar>
        <SearchField value={query} onChange={setQuery} label="Buscar proveedores y trabajos" placeholder="Buscar por proveedor, trabajo, evento o rubro…" />
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {boardError ? <AdminNote tone="error">{boardError}</AdminNote> : null}

      <AdminPanel
        title="Trabajos por evento" icon="suppliers"
        meta={`${formatNumber(jobRows.length)} de ${formatNumber(jobs.length)}`}
        action={
          <span className="admin-panel-actions">
            {narrow ? null : <AdminViewSwitch view={jobsView} onChange={setJobsView} label="Vista de trabajos" />}
            {writable ? (
              <AdminButton variant="primary" icon="plus" onClick={openJobCreate} aria-expanded={jobPanel?.mode === "create"}>
                Nuevo trabajo
              </AdminButton>
            ) : null}
          </span>
        }
      >
        {jobError && jobPanel === null ? <AdminNote tone="error">{jobError}</AdminNote> : null}
        <AdminNote>
          Este registro sigue el trabajo y sus pagos; por sí solo no confirma cantidades ni fechas de suministro, ni reserva equipos para el evento.
        </AdminNote>

        {writable && jobPanel?.mode === "create" ? (
          <AdminDialog
            title="Nuevo trabajo de proveedor"
            size="lg"
            icon="suppliers"
            description="Registra el trabajo con su costo y vencimiento; el anticipo, si lo cargás, queda como pagado."
            dirty={jobDirty}
            onClose={() => setJobPanel(null)}
            error={jobError || null}
            footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={jobBusy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={jobFormId} busy={jobBusy} busyLabel="Guardando…">
                Cargar trabajo
              </AdminButton>
            </>
          )}
          >
            <form id={jobFormId} className="admin-form" onSubmit={(event) => void submitJob(event)} aria-busy={jobBusy || undefined}>
              <AdminDialogSection title="Trabajo">
            <Combobox
              label="Proveedor"
              required
              value={jobForm.supplierId}
              onChange={(value) => {
                const supplier = suppliers.find((item) => item.id === value);
                setJobForm({ ...jobForm, supplierId: value, category: supplier?.category ?? jobForm.category });
              }}
              placeholder="Buscá por nombre o rubro…"
              emptyLabel={suppliers.length > 0 ? "Sin coincidencias." : "No hay proveedores cargados."}
              options={suppliers
                .filter((supplier) => supplier.active || supplier.id === jobForm.supplierId)
                .map((supplier) => ({
                  value: supplier.id,
                  label: supplier.name,
                  description: supplier.company?.trim() || undefined,
                }))}
            />
            <Combobox
              label="Evento"
              hint="Opcional"
              value={jobForm.eventId}
              onChange={(value) => setJobForm({ ...jobForm, eventId: value })}
              placeholder="Buscá el evento…"
              emptyLabel={events.length > 0 ? "Sin coincidencias." : "No hay eventos cargados."}
              options={[...events.map((item) => ({ value: item.id, label: item.name }))]}
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
              required
              maxLength={200}
              value={jobForm.description}
              onChange={(value) => setJobForm({ ...jobForm, description: value })}
              placeholder="Ej.: Estructura y gráfica de stand"
            />
              </AdminDialogSection>
              <AdminDialogSection title="Costo y anticipo">
            <MoneyField
              limit={FIELD_LIMITS.amountStorage}
              label="Costo total"
              hint="En guaraníes"
              required
              value={jobForm.total}
              onChange={(value) => setJobForm({ ...jobForm, total: value })}
            />
            <MoneyField
              limit={FIELD_LIMITS.amountStorage}
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
              </AdminDialogSection>
            </form>
          </AdminDialog>
        ) : null}

        {writable && jobPanel?.mode === "edit" && editingJob ? (
          <AdminDialog
            title={`Editar trabajo: ${editingJob.description}`}
            icon="suppliers"
            size="lg"
            description="Concepto, costo, pagos y fechas del trabajo."
            dirty={jobDirty}
            onClose={() => setJobPanel(null)}
            error={jobError || null}
            footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={jobBusy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={jobFormId} busy={jobBusy} busyLabel="Guardando…">
                Guardar cambios
              </AdminButton>
            </>
          )}
          >
            <form id={jobFormId} className="admin-form" onSubmit={(event) => void submitJob(event)} aria-busy={jobBusy || undefined}>
              <AdminDialogSection title="Trabajo">
            {editingClosed ? (
              <div className="admin-field--wide">
                <AdminNote>
                  {editingJob.status === "PAID" ? "Trabajo pagado" : "Trabajo cancelado"}: podés corregir comprobante, notas y descripción,
                  no los montos.
                </AdminNote>
              </div>
            ) : null}
            <TextField label="Proveedor" disabled value={editingJob.supplier.name} onChange={() => {}} />
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
              required
              maxLength={200}
              value={jobForm.description}
              onChange={(value) => setJobForm({ ...jobForm, description: value })}
            />
              </AdminDialogSection>
              <AdminDialogSection title="Costo y pagos">
            <MoneyField
              limit={FIELD_LIMITS.amountStorage}
              label="Costo total"
              hint="En guaraníes"
              required
              disabled={editingClosed}
              value={jobForm.total}
              onChange={(value) => setJobForm({ ...jobForm, total: value })}
            />
            <MoneyField
              limit={FIELD_LIMITS.amountStorage}
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
              </AdminDialogSection>
              <AdminDialogSection title="Más opciones" collapsible defaultOpen={Boolean(jobForm.notes)} hint="evento, rubro y notas">            <Combobox
              label="Evento"
              hint="Opcional"
              value={jobForm.eventId}
              onChange={(value) => setJobForm({ ...jobForm, eventId: value })}
              placeholder="Buscá el evento…"
              emptyLabel={events.length > 0 ? "Sin coincidencias." : "No hay eventos cargados."}
              options={events.map((item) => ({ value: item.id, label: item.name }))}
            />
            <SelectField
              label="Rubro del trabajo"
              value={jobForm.category}
              onChange={(value) => setJobForm({ ...jobForm, category: value })}
              options={CATEGORY_OPTIONS}
            />

            <TextAreaField
              label="Notas"
              wide
              maxLength={1000}
              rows={2}
              value={jobForm.notes}
              onChange={(value) => setJobForm({ ...jobForm, notes: value })}
              placeholder="Detalles de coordinación, materiales o acuerdos"
            />
              </AdminDialogSection>
            </form>
          </AdminDialog>
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

        {/* Pestañas de estado (issue #151): encima de la lista y del tablero; en
            ancho compacto reemplazan al Kanban, que quedaba cortado en 390. */}
        <AdminTabs
          filters
          label="Filtrar trabajos por estado"
          value={jobStatus}
          onChange={setJobStatus}
          items={[
            { key: "ALL", label: "Todos", count: jobs.length },
            { key: "OPEN", label: "Abiertos", count: openJobsCount },
            ...SUPPLIER_JOB_STATUSES.map((value) => ({ key: value as string, label: jobStatusLabel(value), count: jobStatusCounts.get(value) ?? 0 })),
          ]}
        />

        <AdminDataState
          loading={jobsResource.loading}
          error={jobsResource.error}
          onRetry={jobsResource.reload}
          empty={jobs.length === 0}
          emptyTitle="Sin trabajos de proveedor" emptyIcon="suppliers"
          emptyHint="Cargá el trabajo contratado para seguir el anticipo, la entrega y el saldo."
        >
        {narrow ? (
          jobRows.length === 0 ? (
            <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá la pestaña de estado." />
          ) : (
            <AdminCardGrid label="Trabajos de proveedores" cards={jobCards} />
          )
        ) : jobsView === "board" ? (
          filteredJobs.length === 0 ? (
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
        meta={`${formatNumber(supplierRows.length)} de ${formatNumber(supplierScope === "ARCHIVED" ? suppliers.length - liveSuppliers.length : liveSuppliers.length)}`}
        action={
          <span className="admin-panel-actions">
            <AdminSelect
              value={supplierScope}
              onChange={setSupplierScope}
              label="Ver proveedores"
              options={[
                { value: "ACTIVE", label: "Activos" },
                { value: "ARCHIVED", label: "Archivados" },
              ]}
            />
            {narrow ? null : (
              <AdminViewSwitch view={suppliersView} onChange={setSuppliersView} label="Vista de proveedores" views={PROVEEDORES_VIEWS} />
            )}
            {writable ? (
              <AdminButton variant="primary" icon="plus" onClick={openSupplierCreate} aria-expanded={supplierForm !== null && !supplierForm.id}>
                Nuevo proveedor
              </AdminButton>
            ) : null}
          </span>
        }
      >
        {supplierError && supplierForm === null ? <AdminNote tone="error">{supplierError}</AdminNote> : null}
        {trash.note}
        {writable ? <BulkTrashControls bulk={bulk} /> : null}
        {writable ? trash.dialog : null}

        {writable && supplierForm ? (
          <AdminDialog
            title={supplierForm.id ? `Editar proveedor: ${supplierForm.name}` : "Nuevo proveedor"}
            icon="suppliers"
            size="lg"
            description="Contacto, rubro y condiciones de pago del proveedor."
            dirty={supplierDirty}
            onClose={() => setSupplierForm(null)}
            error={supplierError || null}
            footer={({ requestClose }) => (
            <>
              <AdminButton icon="close" type="button" onClick={requestClose} disabled={supplierBusy}>
                Cancelar
              </AdminButton>
              <AdminButton type="submit" variant="primary" icon="check" form={supplierFormId} busy={supplierBusy} busyLabel="Guardando…">
                {supplierForm.id ? "Guardar cambios" : "Cargar proveedor"}
              </AdminButton>
            </>
          )}
          >
            <form id={supplierFormId} className="admin-form" onSubmit={(event) => void submitSupplier(event)} aria-busy={supplierBusy || undefined}>
              <AdminDialogSection title="Datos">
            <TextField
              label="Nombre"
              required
              autoFocus
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
            <SelectField
              label="Rubro"
              value={supplierForm.category}
              onChange={(value) => setSupplierForm({ ...supplierForm, category: value })}
              options={CATEGORY_OPTIONS}
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
              error={supplierForm.email && !emailValid(supplierForm.email) ? FIELD_MESSAGES.email : null}
            />
              </AdminDialogSection>
              <AdminDialogSection title="Más opciones" collapsible defaultOpen={Boolean(supplierForm.id)} hint="condiciones de pago, estado y notas">            <SelectField
              label="Condiciones de pago"
              hint="Contado o a plazo"
              value={supplierForm.paymentTerms}
              onChange={(value) => setSupplierForm({ ...supplierForm, paymentTerms: value })}
              options={paymentTermChoices(supplierForm.paymentTerms)}
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
              </AdminDialogSection>
            </form>
          </AdminDialog>
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
          ) : narrow || suppliersView === "grid" ? (
            <AdminCardGrid label="Proveedores" cards={supplierCards} />
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
                      {writable ? <BulkRowCheck bulk={bulk} row={supplierBulkRow(supplier)} /> : null}
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
                      <AdminBadge tone={supplier.active && !supplier.archivedAt ? "ok" : "neutral"}>{supplier.archivedAt ? "Archivado" : supplier.active ? "Activo" : "Inactivo"}</AdminBadge>
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
                        {writable ? (
                          <AdminActionsMenu
                            label={`Más acciones de ${supplier.name}`}
                            items={trash.menu({ id: supplier.id, name: supplier.name, archived: Boolean(supplier.archivedAt), canWrite: writable })}
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
  job: JobRow;
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
  const formId = useId();
  const [initial] = useState(() => ({
    status: options[0] ?? "",
    advance: job.advance > 0 ? String(job.advance) : "",
    method: job.paymentMethod || METHOD_OPTIONS[0],
    receipt: job.receipt ?? "",
    deliveredAt,
    paidAt,
  }));
  const dirty =
    status !== initial.status ||
    advance !== initial.advance ||
    method !== initial.method ||
    receipt !== initial.receipt ||
    deliveredAt !== initial.deliveredAt ||
    paidAt !== initial.paidAt;

  const asksAdvance = status === "ADVANCE_PENDING" || status === "ADVANCE_PAID";
  const asksPayment = status === "ADVANCE_PAID" || status === "PAID";
  const effectiveAdvance = asksAdvance ? Number(advance) || 0 : job.advance;
  const balance = Math.max(0, job.total - effectiveAdvance);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
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
    <AdminDialog
      title={`Estado del trabajo: ${job.description}`}
      icon="suppliers"
      size="sm"
      description="Solo se muestran los pasos válidos desde el estado actual."
      dirty={dirty}
      onClose={onClose}
      error={error || null}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose} disabled={busy}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" variant="primary" icon="check" form={formId} busy={busy} busyLabel="Guardando…">
            Confirmar cambio
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={(event) => void submit(event)} aria-busy={busy || undefined}>
        <AdminDialogSection>
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
              limit={FIELD_LIMITS.amountStorage}
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
        </AdminDialogSection>
      </form>
    </AdminDialog>
  );
}
