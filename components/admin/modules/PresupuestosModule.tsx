"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  budgetApprovalLabel,
  budgetApprovalMethodLabel,
  budgetApprovalTone,
  budgetChangeKindLabel,
  budgetChangeStatusLabel,
  budgetChangeStatusTone,
  budgetStatusLabel,
  dueTone,
  formatBytes,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  paymentProofMimeLabel,
  statusTone,
} from "@/lib/admin-format";
import { bankMark } from "@/lib/bank-mark";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
import {
  budgetApprovalState,
  collectedAmount,
  groupProofsByBudget,
  type AdminBudgetPaymentProofRow,
  type AdminBudgetPortalPayload,
  type AdminBudgetRequestRow,
  type AdminBudgetRow,
  type AdminPaymentDetails,
} from "@/lib/admin-types";
import { portalBudgetUrl } from "@/lib/public-config";
import { qrDataUrl } from "@/lib/qr";
import { AdminIcon } from "../AdminIcons";
import { useAdminSession } from "../AdminShell";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
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
} from "../AdminUI";
import { DateField, MoneyField, NumberField, SearchField, SelectField, TextAreaField, TextField } from "../AdminFields";
import { adminApiGet, adminSend, useAdminResource } from "@/lib/admin-api";

const STATUS_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "DRAFT", label: "Borrador" },
  { value: "SENT", label: "Enviado" },
  { value: "NEGOTIATING", label: "En negociación" },
  { value: "APPROVED", label: "Aprobado" },
  { value: "LOST", label: "Perdido" },
  { value: "CANCELLED", label: "Cancelado" },
];

const EMPTY_FORM = { clientId: "", eventId: "", title: "", item: "", quantity: "1", days: "1", unitPrice: "", costPrice: "" };
const MAX_INSTALLMENTS = 12;

type ApprovalDecision = "approve" | "request_revision";
type RequestDecision = "accept" | "reject";

/** Cuota en edición dentro del diálogo del plan de pagos. */
type PlanInstallment = { label: string; amount: string; dueAt: string };

/** Resumen textual del estado del portal, para el `title` de la celda. */
function portalSummary(budget: AdminBudgetRow): string {
  const state = budgetApprovalState(budget);
  const link = budget.publicToken ? "Link activo" : "Sin link público";
  if (state === "APROBADO_DIGITAL" || state === "APROBADO_MANUAL") {
    const via = state === "APROBADO_MANUAL" ? "aprobación manual del panel" : "aprobación digital del cliente";
    const when = budget.approvedAt ? formatDateTime(budget.approvedAt) : "sin fecha";
    const note = budget.approvalNote ? ` · Nota: ${budget.approvalNote}` : "";
    return `${budgetApprovalLabel(state)} (${via}) · ${budget.approvedByName || "—"} · ${when}${note} · ${link}`;
  }
  if (state === "CAMBIOS_SOLICITADOS") {
    const when = budget.revisionRequestedAt ? formatDateTime(budget.revisionRequestedAt) : "sin fecha";
    return `Cambios solicitados el ${when}: ${budget.revisionNote || "sin comentario"} · ${link}`;
  }
  return `Pendiente de aprobación · ${link}`;
}

/** Qué pide una solicitud del portal, en una línea, con el antes → después. */
function requestDelta(request: AdminBudgetRequestRow): string {
  if (request.kind === "items") {
    const items = request.payload.items ?? [];
    if (items.length === 0) return "Propuesta de ítems";
    return items
      .map((row) => {
        const current = request.budget.items.find((item) => item.id === row.id);
        const name = current?.name ?? "Ítem";
        const from = current ? `${formatNumber(current.quantity)} × ${formatNumber(current.days)} d` : "—";
        return `${name}: ${from} → ${formatNumber(row.quantity)} × ${formatNumber(row.days)} d`;
      })
      .join(" · ");
  }
  if (request.kind === "discount" && request.payload.discount) {
    const discount = request.payload.discount;
    const asked = discount.type === "percent" ? `${discount.value} %` : formatMoney(discount.value);
    return `Rebaja: ${asked} → ${formatMoney(discount.amount)} · descuento actual ${formatMoney(request.budget.discount)}`;
  }
  return request.payload.comment || request.note || "Pedido de cambios";
}

/** Resumen del plan de pagos para la columna del presupuesto. */
function planSummary(budget: AdminBudgetRow): string {
  const installments = Array.isArray(budget.installmentsJson) ? budget.installmentsJson : [];
  const parts: string[] = [];
  if (budget.advanceAmount > 0) parts.push(`anticipo ${formatMoney(budget.advanceAmount)}`);
  if (installments.length > 0) parts.push(`${formatNumber(installments.length)} cuota${installments.length === 1 ? "" : "s"}`);
  if (budget.paymentTerms) parts.push(budget.paymentTerms);
  return parts.length > 0 ? parts.join(" · ") : "Sin plan de pagos";
}

/**
 * Diálogo del módulo (issue #12). El panel todavía no tiene un primitivo de
 * diálogo: acá vive el primero, con el contrato mínimo (rol dialog, foco al
 * abrir, cierre con Escape y clic afuera). `wide` lo ensancha para las tablas
 * de solicitudes y el plan de pagos.
 */
function ModuleDialog({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="admin-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={wide ? "admin-dialog admin-dialog--wide" : "admin-dialog"} role="dialog" aria-modal="true" aria-label={title}>
        <header className="admin-dialog-head">
          <h2 className="admin-dialog-title">{title}</h2>
          <button ref={closeRef} type="button" className="admin-iconbtn" onClick={onClose} aria-label="Cerrar" title="Cerrar">
            <AdminIcon name="close" size={15} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

/**
 * Visor de comprobantes de pago (issue #17). Lo comparten Presupuestos (ficha
 * del presupuesto) y Finanzas (cobro pendiente): los metadatos llegan del API y
 * cada archivo se sirve con sesión desde `/api/admin/budgets/proofs/[id]`, en
 * línea (imagen en el visor, PDF embebido) o en una pestaña nueva.
 *
 * Cuando llega `onCollect`, el pie del diálogo ofrece "Marcar cobrado" para el
 * cobro que se está mirando: un clic y el cobro queda cerrado con su auditoría.
 */
export function BudgetProofDialog({
  title,
  subtitle,
  proofs,
  onClose,
  onCollect,
  collectBusy,
  collectLabel,
}: {
  title: string;
  subtitle?: string;
  proofs: AdminBudgetPaymentProofRow[];
  onClose: () => void;
  onCollect?: () => void;
  collectBusy?: boolean;
  collectLabel?: string;
}) {
  return (
    <ModuleDialog title={title} wide onClose={onClose}>
      {subtitle ? <p className="admin-dialog-text">{subtitle}</p> : null}
      {proofs.length === 0 ? (
        <p className="admin-dialog-text">Este presupuesto todavía no tiene comprobantes subidos desde el portal.</p>
      ) : (
        <div className="admin-proof-list">
          {proofs.map((proof) => {
            const url = `/api/admin/budgets/proofs/${proof.id}`;
            const when = formatDateTime(proof.createdAt);
            return (
              <article className="admin-proof" key={proof.id}>
                <header className="admin-proof-head">
                  <AdminBadge tone="info">{paymentProofMimeLabel(proof.mime)}</AdminBadge>
                  <span className="admin-proof-meta">
                    {formatBytes(proof.size)} · {proof.uploadedByName} · {when}
                  </span>
                </header>
                {proof.mime === "application/pdf" ? (
                  <iframe
                    className="admin-proof-pdf"
                    src={url}
                    title={`Comprobante PDF de ${proof.uploadedByName} del ${when}`}
                  />
                ) : (
                  <a
                    className="admin-proof-frame"
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title={`Abrir el comprobante de ${proof.uploadedByName} en una pestaña nueva`}
                  >
                    <img
                      className="admin-proof-image"
                      src={url}
                      alt={`Comprobante subido por ${proof.uploadedByName} el ${when}`}
                    />
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}
      <div className="admin-dialog-foot">
        {onCollect ? (
          <AdminButton variant="primary" icon="check" busy={collectBusy} onClick={onCollect}>
            {collectLabel ?? "Marcar cobrado"}
          </AdminButton>
        ) : null}
        <span className="admin-dialog-spacer" />
        <AdminButton onClick={onClose}>Cerrar</AdminButton>
      </div>
    </ModuleDialog>
  );
}

/**
 * Datos de pago de la empresa (issue #14): solo OWNER/ADMIN. Se cargan al abrir
 * el diálogo y se guardan en `app/api/admin/organization/payment-details`; el
 * portal los muestra recién con el presupuesto aprobado.
 */
function PaymentDetailsDialog({ onClose }: { onClose: () => void }) {
  const [details, setDetails] = useState<AdminPaymentDetails>({ bank: "", holder: "", ruc: "", account: "", alias: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void adminApiGet<{ paymentDetails?: Partial<AdminPaymentDetails> }>("/api/admin/organization/payment-details", {
      fresh: true,
      fallbackError: "No pudimos cargar los datos de pago.",
    })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          if (!result.sessionInvalid) setError(result.error);
          return;
        }
        setDetails({
          bank: result.data.paymentDetails?.bank ?? "",
          holder: result.data.paymentDetails?.holder ?? "",
          ruc: result.data.paymentDetails?.ruc ?? "",
          account: result.data.paymentDetails?.account ?? "",
          alias: result.data.paymentDetails?.alias ?? "",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const mark = bankMark(details.bank);

  async function save() {
    setBusy(true);
    setError("");
    const result = await adminSend<{ paymentDetails?: AdminPaymentDetails }>("/api/admin/organization/payment-details", details);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <ModuleDialog title="Datos de pago de la empresa" wide onClose={onClose}>
      <p className="admin-dialog-text">
        Se muestran en el portal del cliente cuando el presupuesto está aprobado (junto al monto a transferir) y en la hoja
        imprimible. Sin datos cargados, el portal no inventa una cuenta.
      </p>
      {loading ? (
        <p className="admin-dialog-text">Cargando datos de pago…</p>
      ) : (
        <div className="admin-plan-grid">
          <TextField
            label="Banco"
            hint="El logo se dibuja con el monograma mientras no haya asset"
            value={details.bank ?? ""}
            onChange={(value) => setDetails({ ...details, bank: value })}
            maxLength={80}
            placeholder="Ej.: Banco Continental"
          />
          <TextField
            label="Titular"
            value={details.holder ?? ""}
            onChange={(value) => setDetails({ ...details, holder: value })}
            maxLength={120}
            placeholder="LedBox S.A."
          />
          <TextField
            label="RUC"
            value={details.ruc ?? ""}
            onChange={(value) => setDetails({ ...details, ruc: value })}
            maxLength={20}
            inputMode="numeric"
            placeholder="80012345-6"
          />
          <TextField
            label="Cuenta"
            value={details.account ?? ""}
            onChange={(value) => setDetails({ ...details, account: value })}
            maxLength={40}
            placeholder="1234567890"
          />
          <TextField
            label="Alias"
            wide
            value={details.alias ?? ""}
            onChange={(value) => setDetails({ ...details, alias: value })}
            maxLength={60}
            placeholder="ledbox.cta"
          />
          {mark ? (
            <div className="admin-bank-preview">
              {mark.asset ? (
                <img className="admin-bank-asset" src={mark.asset} alt={`Logo de ${mark.label}`} />
              ) : (
                <span className="admin-bank-mark" style={{ background: mark.color }} aria-hidden="true">
                  {mark.initials}
                </span>
              )}
              <span>
                <strong>{mark.label}</strong>
                <small className="admin-cell-sub">{mark.asset ? " · logo oficial" : " · monograma hasta que haya logo versionado"}</small>
              </span>
            </div>
          ) : null}
        </div>
      )}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}
      {saved ? <AdminNote tone="ok">Datos de pago guardados.</AdminNote> : null}
      <div className="admin-dialog-foot">
        <span className="admin-dialog-spacer" />
        <AdminButton onClick={onClose} disabled={busy}>
          Cerrar
        </AdminButton>
        <AdminButton variant="primary" icon="check" busy={busy} onClick={() => void save()} disabled={loading}>
          Guardar datos
        </AdminButton>
      </div>
    </ModuleDialog>
  );
}

export function PresupuestosModule() {
  const { role } = useAdminSession();
  const budgetsResource = useAdminResource("/api/admin/budgets", (payload) => ({
    budgets: payload.budgets ?? [],
    requests: payload.budgetRequests ?? [],
  }));
  const clients = useAdminResource("/api/admin/clients", (payload) => payload.clients ?? []);
  const events = useAdminResource("/api/admin/events", (payload) => payload.events ?? []);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  // Portal del cliente (issue #12): diálogo de link/QR y diálogo de aprobación.
  const [portalBudget, setPortalBudget] = useState<AdminBudgetRow | null>(null);
  const [qr, setQr] = useState("");
  const [approval, setApproval] = useState<{ budget: AdminBudgetRow; decision: ApprovalDecision } | null>(null);
  const [note, setNote] = useState("");
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState("");

  // Autogestión (issue #14): solicitudes, plan de pagos y datos de pago.
  const [resolution, setResolution] = useState<{ request: AdminBudgetRequestRow; decision: RequestDecision } | null>(null);
  const [counterItems, setCounterItems] = useState<Record<string, { quantity: number; days: number }>>({});
  const [counterDiscount, setCounterDiscount] = useState("");
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [plan, setPlan] = useState<{ budget: AdminBudgetRow; advance: string; terms: string; installments: PlanInstallment[] } | null>(null);

  // Comprobantes de pago (issue #17): metadatos por presupuesto y visor.
  const [proofsByBudget, setProofsByBudget] = useState<Record<string, AdminBudgetPaymentProofRow[]>>({});
  const [proofDialog, setProofDialog] = useState<AdminBudgetRow | null>(null);

  const writable = canWriteFinance(role);
  const canManagePayments = role === "OWNER" || role === "ADMIN";
  const clientOptions = useMemo(() => clients.data ?? [], [clients.data]);
  const eventOptions = useMemo(() => events.data ?? [], [events.data]);
  const portalToken = portalBudget?.publicToken ?? null;

  const budgetRows = useMemo(() => budgetsResource.data?.budgets ?? [], [budgetsResource.data]);
  const requestRows = useMemo(() => budgetsResource.data?.requests ?? [], [budgetsResource.data]);
  const pendingRequests = useMemo(() => requestRows.filter((request) => request.status === "pending"), [requestRows]);

  const rows = useMemo(() => {
    return budgetRows
      .filter((budget) => (status === "ALL" ? true : budget.status === status))
      .filter((budget) => matchesQuery(query, [budget.title, budget.client.company, budget.client.name, budget.event?.name]));
  }, [budgetRows, query, status]);

  const totals = useMemo(() => {
    return budgetRows.reduce(
      (accumulator, budget) => {
        // Solo los cobros cobrados descuentan saldo (issue #16): un cobro a plazo
        // pendiente o anulado todavía no es plata cobrada.
        const paid = collectedAmount(budget.payments);
        accumulator.quoted += budget.total;
        accumulator.paid += paid;
        accumulator.receivable += Math.max(0, budget.total - paid);
        accumulator.margin += budget.total - budget.costEstimate;
        return accumulator;
      },
      { quoted: 0, paid: 0, receivable: 0, margin: 0 },
    );
  }, [budgetRows]);

  // Comprobantes del portal (issue #17): una sola consulta de metadatos por
  // carga de presupuestos; el visor los agrupa por presupuesto.
  const proofSignature = useMemo(() => budgetRows.map((budget) => budget.id).join(","), [budgetRows]);
  useEffect(() => {
    if (!proofSignature) {
      setProofsByBudget({});
      return;
    }
    let active = true;
    void adminApiGet<{ proofs?: AdminBudgetPaymentProofRow[] }>("/api/admin/budgets/proofs", {
      fallbackError: "No pudimos cargar los comprobantes.",
    }).then((result) => {
      if (!active || !result.ok) return;
      setProofsByBudget(groupProofsByBudget(result.data.proofs ?? []));
    });
    return () => {
      active = false;
    };
  }, [proofSignature]);

  // El QR se arma en el navegador con la URL pública del presupuesto abierto.
  useEffect(() => {
    let active = true;
    setQr("");
    if (!portalBudget?.publicToken) return;
    qrDataUrl(portalBudgetUrl(portalBudget.publicToken), 240)
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        if (active) setQr("");
      });
    return () => {
      active = false;
    };
  }, [portalBudget]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend("/api/admin/budgets", {
      clientId: form.clientId,
      eventId: form.eventId || undefined,
      title: form.title,
      items: [
        {
          name: form.item,
          quantity: Number(form.quantity) || 1,
          days: Number(form.days) || 1,
          unitPrice: Number(form.unitPrice) || 0,
          costPrice: Number(form.costPrice) || 0,
        },
      ],
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setForm(EMPTY_FORM);
    setNotice(`Presupuesto «${form.title}» creado.`);
    budgetsResource.reload();
  }

  function openPortal(budget: AdminBudgetRow) {
    setDialogError("");
    setPortalBudget(budget);
  }

  function openApproval(budget: AdminBudgetRow, decision: ApprovalDecision) {
    setDialogError("");
    setNote("");
    setApproval({ budget, decision });
  }

  function openResolution(request: AdminBudgetRequestRow, decision: RequestDecision) {
    setDialogError("");
    setNote("");
    setCounterDiscount(
      request.kind === "discount" && request.payload.discount
        ? String(request.payload.discount.amount)
        : "",
    );
    setCounterItems(
      Object.fromEntries((request.payload.items ?? []).map((item) => [item.id, { quantity: item.quantity, days: item.days }])),
    );
    setResolution({ request, decision });
  }

  function openPlan(budget: AdminBudgetRow) {
    setDialogError("");
    setPlan({
      budget,
      advance: budget.advanceAmount > 0 ? String(budget.advanceAmount) : "",
      terms: budget.paymentTerms ?? "",
      installments: (Array.isArray(budget.installmentsJson) ? budget.installmentsJson : []).map((installment) => ({
        label: installment.label,
        amount: String(installment.amount),
        dueAt: installment.dueAt ?? "",
      })),
    });
  }

  async function copyPortalLink(budget: AdminBudgetRow) {
    if (!budget.publicToken) return;
    const url = portalBudgetUrl(budget.publicToken);
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`Link copiado: ${url}`);
    } catch {
      setNotice(`No pudimos copiar automáticamente; el link es ${url}`);
    }
  }

  async function submitPortalAction(action: "generate" | "revoke") {
    if (!portalBudget) return;
    setDialogBusy(true);
    setDialogError("");
    const result = await adminSend<AdminBudgetPortalPayload>("/api/admin/budgets/token", {
      budgetId: portalBudget.id,
      action,
    });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    const updated = result.data.budget;
    if (updated) setPortalBudget({ ...portalBudget, ...updated });
    setNotice(
      action === "generate"
        ? `Link del portal generado para «${portalBudget.title}». El link anterior dejó de funcionar.`
        : `Link del portal revocado para «${portalBudget.title}».`,
    );
    budgetsResource.reload();
  }

  async function submitApproval() {
    if (!approval) return;
    if (approval.decision === "request_revision" && !note.trim()) {
      setDialogError("Indicá qué cambios se piden.");
      return;
    }
    setDialogBusy(true);
    setDialogError("");
    const result = await adminSend<AdminBudgetPortalPayload>("/api/admin/budgets/approval", {
      budgetId: approval.budget.id,
      decision: approval.decision,
      note: note.trim() || undefined,
    });
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    setNotice(
      approval.decision === "approve"
        ? `Aprobación manual registrada para «${approval.budget.title}».`
        : `Pedido de cambios registrado para «${approval.budget.title}».`,
    );
    setApproval(null);
    setNote("");
    budgetsResource.reload();
  }

  /** Acepta o rechaza una solicitud del portal (issue #14). */
  async function submitResolution() {
    if (!resolution) return;
    if (resolution.decision === "reject" && note.trim().length < 3) {
      setDialogError("Indicá la nota del rechazo: el cliente la lee en su portal.");
      return;
    }
    const body: Record<string, unknown> = {
      requestId: resolution.request.id,
      decision: resolution.decision,
      responseNote: note.trim() || undefined,
    };
    if (resolution.decision === "accept") {
      if (resolution.request.kind === "items") {
        body.counter = {
          items: Object.entries(counterItems).map(([id, value]) => ({ id, quantity: value.quantity, days: value.days })),
        };
      }
      if (resolution.request.kind === "discount") {
        const amount = Number(counterDiscount.replace(/\D/g, ""));
        if (!Number.isInteger(amount) || amount <= 0) {
          setDialogError("La contra-oferta debe ser un monto mayor a cero.");
          return;
        }
        body.counter = { discountAmount: amount };
      }
    }
    setDialogBusy(true);
    setDialogError("");
    const result = await adminSend("/api/admin/budgets/requests", body);
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    setNotice(
      resolution.decision === "accept"
        ? `Solicitud de «${resolution.request.budget.client.company || resolution.request.budget.client.name}» aceptada y aplicada al presupuesto.`
        : `Solicitud de «${resolution.request.budget.client.company || resolution.request.budget.client.name}» rechazada con nota.`,
    );
    setResolution(null);
    setNote("");
    budgetsResource.reload();
  }

  /** Guarda el plan de pagos del presupuesto (anticipo, condiciones y cuotas). */
  async function submitPlan() {
    if (!plan) return;
    const advance = plan.advance.trim() ? Number(plan.advance.replace(/\D/g, "")) : 0;
    if (!Number.isInteger(advance) || advance < 0) {
      setDialogError("El anticipo debe ser un monto en guaraníes.");
      return;
    }
    const installments = plan.installments.map((installment) => ({
      label: installment.label.trim(),
      amount: Number(installment.amount.replace(/\D/g, "")),
      dueAt: installment.dueAt,
    }));
    for (const [index, installment] of installments.entries()) {
      if (!installment.label) {
        setDialogError(`La cuota ${index + 1} necesita una etiqueta.`);
        return;
      }
      if (!Number.isInteger(installment.amount) || installment.amount <= 0) {
        setDialogError(`El monto de la cuota ${index + 1} debe ser mayor a cero.`);
        return;
      }
      if (!installment.dueAt) {
        setDialogError(`La cuota ${index + 1} necesita vencimiento.`);
        return;
      }
    }
    setDialogBusy(true);
    setDialogError("");
    const result = await adminSend(
      "/api/admin/budgets",
      {
        budgetId: plan.budget.id,
        advanceAmount: advance,
        paymentTerms: plan.terms.trim() || undefined,
        installmentsJson: installments,
      },
      "PATCH",
    );
    setDialogBusy(false);
    if (!result.ok) {
      setDialogError(result.error);
      return;
    }
    setNotice(`Plan de pagos guardado para «${plan.budget.title}».`);
    setPlan(null);
    budgetsResource.reload();
  }

  const resolutionLabel = resolution
    ? `${resolution.decision === "accept" ? "Aceptar" : "Rechazar"} · ${resolution.request.budget.title}`
    : "";
  const counterSubtotal = resolution
    ? resolution.request.budget.items.reduce((sum, item) => {
        const value = counterItems[item.id] ?? { quantity: item.quantity, days: item.days };
        return sum + item.unitPrice * value.quantity * value.days;
      }, 0)
    : 0;
  const counterDiscountAmount =
    resolution?.request.kind === "discount" ? Number(counterDiscount.replace(/\D/g, "")) || 0 : 0;
  const counterTotal = Math.max(0, counterSubtotal - counterDiscountAmount);

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de presupuestos">
        <AdminKpi label="Total cotizado" value={formatMoney(totals.quoted)} note="presupuestos vigentes" />
        <AdminKpi label="Cobrado" value={formatMoney(totals.paid)} note="pagos registrados" tone="ok" />
        <AdminKpi label="Por cobrar" value={formatMoney(totals.receivable)} note="saldo de clientes" tone="warn" />
        <AdminKpi label="Margen estimado" value={formatMoney(totals.margin)} note="venta menos costos" tone="accent" />
        <AdminKpi
          label="Solicitudes del portal"
          value={formatNumber(pendingRequests.length)}
          note="esperando respuesta"
          tone={pendingRequests.length > 0 ? "warn" : undefined}
        />
      </section>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar presupuestos"
          placeholder="Buscar por título, cliente o evento…"
        />
        <AdminSelect value={status} onChange={setStatus} label="Filtrar por estado" options={STATUS_OPTIONS} />
        {canManagePayments ? (
          <AdminButton
            icon="finance"
            title="Datos de pago de la empresa"
            aria-label="Datos de pago de la empresa"
            onClick={() => setPaymentsOpen(true)}
          >
            Datos de pago
          </AdminButton>
        ) : null}
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
            Nuevo presupuesto
          </AdminButton>
        ) : null}
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}

      {writable && showForm ? (
        <AdminFormPanel
          title="Nuevo presupuesto"
          submitLabel="Crear presupuesto"
          onSubmit={submit}
          onCancel={() => setShowForm(false)}
          busy={busy}
          status={formError}
        >
          <SelectField
            label="Cliente"
            required
            value={form.clientId}
            onChange={(value) => setForm({ ...form, clientId: value })}
            options={[
              { value: "", label: "Elegí un cliente…" },
              ...clientOptions.map((client) => ({ value: client.id, label: client.company || client.name })),
            ]}
          />
          <SelectField
            label="Evento"
            hint="Opcional"
            value={form.eventId}
            onChange={(value) => setForm({ ...form, eventId: value })}
            options={[{ value: "", label: "Sin evento asociado" }, ...eventOptions.map((event) => ({ value: event.id, label: event.name }))]}
          />
          <TextField
            label="Título"
            wide
            required
            maxLength={160}
            value={form.title}
            onChange={(value) => setForm({ ...form, title: value })}
            placeholder="Ej.: Alquiler pantalla LED 6×3"
          />
          <TextField
            label="Producto / servicio"
            wide
            required
            maxLength={160}
            value={form.item}
            onChange={(value) => setForm({ ...form, item: value })}
            placeholder="Ej.: Pantalla LED P3.9 interior"
          />
          <NumberField
            label="Cantidad"
            required
            maxLength={4}
            value={form.quantity}
            onChange={(value) => setForm({ ...form, quantity: value })}
          />
          <NumberField
            label="Días"
            required
            maxLength={4}
            value={form.days}
            onChange={(value) => setForm({ ...form, days: value })}
          />
          <MoneyField
            label="Precio unitario"
            hint="En guaraníes"
            required
            value={form.unitPrice}
            onChange={(value) => setForm({ ...form, unitPrice: value })}
          />
          <MoneyField
            label="Costo unitario"
            hint="Para el margen estimado"
            value={form.costPrice}
            onChange={(value) => setForm({ ...form, costPrice: value })}
          />
        </AdminFormPanel>
      ) : null}

      {requestRows.length > 0 ? (
        <AdminPanel
          title="Solicitudes del portal"
          meta={
            pendingRequests.length > 0
              ? `${formatNumber(pendingRequests.length)} pendiente${pendingRequests.length === 1 ? "" : "s"}`
              : "Sin pendientes"
          }
        >
          <AdminTable
            view="solicitudes"
            label="Solicitudes del portal"
            columns={[
              { label: "Solicitud" },
              { label: "Presupuesto" },
              { label: "Cambio propuesto" },
              { label: "Motivo" },
              { label: "Pedido" },
              { label: "Estado" },
              { label: "Acciones", end: true },
            ]}
          >
            {requestRows.map((request) => {
              const clientLabel = request.budget.client.company || request.budget.client.name;
              const resolved = request.status !== "pending";
              const when = resolved && request.resolvedAt
                ? `Resuelta el ${formatDateTime(request.resolvedAt)}${request.resolvedByName ? ` por ${request.resolvedByName}` : ""} · Pedida el ${formatDateTime(request.createdAt)}`
                : `Pedida el ${formatDateTime(request.createdAt)} por ${request.requestedByName}`;
              return (
                <AdminRow key={request.id}>
                  <AdminCell title={`${budgetChangeKindLabel(request.kind)} · ${clientLabel}`}>
                    <strong>{budgetChangeKindLabel(request.kind)}</strong>
                    <small className="admin-cell-sub"> · {clientLabel}</small>
                  </AdminCell>
                  <AdminCell title={request.budget.title}>{request.budget.title}</AdminCell>
                  <AdminCell title={requestDelta(request)}>{requestDelta(request)}</AdminCell>
                  <AdminCell title={request.note ?? "Sin motivo"}>
                    {request.note || "—"}
                    {request.responseNote ? <small className="admin-cell-sub"> · Respuesta: {request.responseNote}</small> : null}
                  </AdminCell>
                  <AdminCell title={when}>{formatDateTime(request.createdAt)}</AdminCell>
                  <AdminCell title={when}>
                    <AdminBadge tone={budgetChangeStatusTone(request.status)}>{budgetChangeStatusLabel(request.status)}</AdminBadge>
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    <span className="admin-actions">
                      {writable && !resolved ? (
                        <>
                          <AdminButton
                            icon="check"
                            title={`Aceptar la solicitud de ${clientLabel}`}
                            aria-label={`Aceptar la solicitud de ${clientLabel}`}
                            onClick={() => openResolution(request, "accept")}
                          />
                          <AdminButton
                            icon="close"
                            title={`Rechazar la solicitud de ${clientLabel}`}
                            aria-label={`Rechazar la solicitud de ${clientLabel}`}
                            onClick={() => openResolution(request, "reject")}
                          />
                        </>
                      ) : resolved ? (
                        <small className="admin-cell-sub">{request.resolvedByName || "Equipo"}</small>
                      ) : null}
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        </AdminPanel>
      ) : null}

      <AdminDataState
        loading={budgetsResource.loading}
        error={budgetsResource.error}
        onRetry={budgetsResource.reload}
        empty={budgetRows.length === 0}
        emptyTitle="Todavía no hay presupuestos"
        emptyHint="Creá un presupuesto para seguir venta, costos, margen y cobros."
      >
        {rows.length === 0 ? (
          <AdminEmpty title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
        ) : (
          <AdminTable
            view="presupuestos"
            label="Presupuestos"
            columns={[
              { label: "Presupuesto" },
              { label: "Cliente" },
              { label: "Ítems", end: true },
              { label: "Total", end: true },
              { label: "Cobrado", end: true },
              { label: "Saldo", end: true },
              { label: "Margen", end: true },
              { label: "Estado" },
              { label: "Portal" },
              { label: "Vence" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((budget) => {
              const paid = collectedAmount(budget.payments);
              const balance = budget.total - paid;
              const margin = budget.total - budget.costEstimate;
              const approvalState = budgetApprovalState(budget);
              const approved = approvalState === "APROBADO_DIGITAL" || approvalState === "APROBADO_MANUAL";
              const open = budget.status !== "LOST" && budget.status !== "CANCELLED";
              const budgetProofs = proofsByBudget[budget.id] ?? [];
              const proofLabel = `${formatNumber(budgetProofs.length)} comprobante${budgetProofs.length === 1 ? "" : "s"} del portal`;
              return (
                <AdminRow key={budget.id}>
                  <AdminCell title={`${budget.title}${budget.event ? ` · ${budget.event.name}` : ""}`}>
                    <strong>{budget.title}</strong>
                    {budget.event ? <small className="admin-cell-sub"> · {budget.event.name}</small> : null}
                  </AdminCell>
                  <AdminCell title={budget.client.company || budget.client.name}>{budget.client.company || budget.client.name}</AdminCell>
                  <AdminCell end title={`${budget.items.length} ítems`}>
                    {formatNumber(budget.items.length)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(budget.total)}>
                    {formatMoney(budget.total)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(paid)}>
                    {formatMoney(paid)}
                  </AdminCell>
                  <AdminCell end title={formatMoney(balance)}>
                    <strong>{formatMoney(balance)}</strong>
                  </AdminCell>
                  <AdminCell end title={`${formatMoney(budget.total - budget.costEstimate)} de margen estimado`}>
                    {formatMoney(margin)}
                  </AdminCell>
                  <AdminCell>
                    <AdminBadge tone={statusTone(budget.status)}>{budgetStatusLabel(budget.status)}</AdminBadge>
                  </AdminCell>
                  <AdminCell title={portalSummary(budget)}>
                    <AdminBadge tone={budgetApprovalTone(approvalState)}>{budgetApprovalLabel(approvalState)}</AdminBadge>
                    <small className="admin-cell-sub">
                      {" "}· {budget.publicToken ? "Link activo" : "Sin link"}
                      {budgetProofs.length > 0 ? ` · ${proofLabel}` : ""}
                    </small>
                  </AdminCell>
                  <AdminCell title={budget.validUntil ? `Vence el ${formatDateShort(budget.validUntil)}` : "Sin vencimiento"}>
                    <span className="admin-nowrap" data-tone={dueTone(budget.validUntil)}>
                      {budget.validUntil ? formatDateShort(budget.validUntil) : "—"}
                    </span>
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    <span className="admin-actions">
                      <AdminIconLink
                        href={`/imprimir/presupuesto/${budget.id}`}
                        icon="print"
                        label={`Imprimir presupuesto: ${budget.title}`}
                        external
                      />
                      {budget.publicToken ? (
                        <>
                          <AdminIconLink
                            href={portalBudgetUrl(budget.publicToken)}
                            icon="external"
                            label={`Ver el portal del presupuesto: ${budget.title}`}
                            external
                          />
                          <AdminButton
                            icon="download"
                            title={`Copiar el link del portal: ${budget.title}`}
                            aria-label={`Copiar el link del portal: ${budget.title}`}
                            onClick={() => void copyPortalLink(budget)}
                          />
                        </>
                      ) : null}
                      <AdminButton
                        title={`${budget.publicToken ? "QR y link del portal" : "Generar link del portal"}: ${budget.title}`}
                        aria-label={`${budget.publicToken ? "QR y link del portal" : "Generar link del portal"}: ${budget.title}`}
                        onClick={() => openPortal(budget)}
                      >
                        QR
                      </AdminButton>
                      {budgetProofs.length > 0 ? (
                        <AdminButton
                          icon="eye"
                          title={`Ver ${budgetProofs.length === 1 ? "el comprobante" : `los ${proofLabel}`} de ${budget.title}`}
                          aria-label={`Ver ${budgetProofs.length === 1 ? "el comprobante" : `los ${proofLabel}`} de ${budget.title}`}
                          onClick={() => setProofDialog(budget)}
                        />
                      ) : null}
                      {writable ? (
                        <AdminButton
                          icon="clock"
                          title={`Plan de pagos y cuotas: ${budget.title} · ${planSummary(budget)}`}
                          aria-label={`Plan de pagos y cuotas: ${budget.title}`}
                          onClick={() => openPlan(budget)}
                        />
                      ) : null}
                      {writable && open && !approved ? (
                        <>
                          <AdminButton
                            icon="check"
                            title={`Aprobar manualmente: ${budget.title}`}
                            aria-label={`Aprobar manualmente: ${budget.title}`}
                            onClick={() => openApproval(budget, "approve")}
                          />
                          <AdminButton
                            icon="alert"
                            title={`Pedir cambios: ${budget.title}`}
                            aria-label={`Pedir cambios: ${budget.title}`}
                            onClick={() => openApproval(budget, "request_revision")}
                          />
                        </>
                      ) : null}
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>

      {portalBudget ? (
        <ModuleDialog title={`Portal del cliente · ${portalBudget.title}`} onClose={() => setPortalBudget(null)}>
          {portalToken ? (
            <>
              <div className="admin-dialog-qr">
                {qr ? (
                  <img src={qr} alt={`QR del presupuesto ${portalBudget.title} en el portal del cliente`} width={240} height={240} />
                ) : (
                  <span className="admin-spinner" role="status" aria-label="Generando QR" />
                )}
              </div>
              <p className="admin-dialog-code">{portalToken}</p>
              <TextField
                label="Link del portal"
                wide
                readOnly
                value={portalBudgetUrl(portalToken)}
                onChange={() => {}}
                onFocus={(event) => event.target.select()}
              />
              <p className="admin-dialog-text">
                Escaneá el QR o compartí el link: el cliente ve este presupuesto —y solo este—, puede ajustar cantidades y
                días, pedir una rebaja, aprobarlo o pedir cambios.
              </p>
            </>
          ) : (
            <p className="admin-dialog-text">
              Este presupuesto todavía no tiene link público. Generá uno para imprimir el QR y habilitar la aprobación
              online.
            </p>
          )}
          {dialogError ? <AdminNote tone="error">{dialogError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            {portalToken ? (
              <>
                <AdminButton
                  icon="download"
                  title="Copiar el link del portal"
                  aria-label="Copiar el link del portal"
                  onClick={() => void copyPortalLink(portalBudget)}
                />
                <AdminButton
                  icon="external"
                  title="Abrir el portal en una pestaña nueva"
                  aria-label="Abrir el portal en una pestaña nueva"
                  onClick={() => window.open(portalBudgetUrl(portalToken), "_blank", "noopener,noreferrer")}
                />
              </>
            ) : null}
            <span className="admin-dialog-spacer" />
            {portalToken ? (
              <AdminButton icon="power" onClick={() => void submitPortalAction("revoke")} disabled={dialogBusy}>
                Revocar link
              </AdminButton>
            ) : null}
            <AdminButton variant="primary" icon="refresh" busy={dialogBusy} onClick={() => void submitPortalAction("generate")}>
              {portalToken ? "Regenerar link" : "Generar link"}
            </AdminButton>
          </div>
        </ModuleDialog>
      ) : null}

      {approval ? (
        <ModuleDialog
          title={approval.decision === "approve" ? `Aprobar manualmente · ${approval.budget.title}` : `Pedir cambios · ${approval.budget.title}`}
          onClose={() => setApproval(null)}
        >
          <p className="admin-dialog-text">
            {approval.decision === "approve"
              ? `Se registra la aprobación a nombre de ${approval.budget.client.company || approval.budget.client.name}, con tu usuario y la fecha actual. Si ya hay una aprobación registrada, no se pisa.`
              : "El cliente no ve el cambio hasta que le compartas la versión actualizada; queda registrado en el presupuesto."}
          </p>
          <TextAreaField
            label={approval.decision === "approve" ? "Nota (opcional)" : "¿Qué cambios se piden?"}
            wide
            value={note}
            onChange={setNote}
            maxLength={1000}
            rows={4}
            required={approval.decision === "request_revision"}
            placeholder={approval.decision === "approve" ? "Ej.: aprobado por teléfono, coordina con Santiago" : "Ej.: sumar un día más y cambiar el lugar"}
          />
          {dialogError ? <AdminNote tone="error">{dialogError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            <AdminButton onClick={() => setApproval(null)} disabled={dialogBusy}>
              Cancelar
            </AdminButton>
            <AdminButton variant="primary" icon="check" busy={dialogBusy} onClick={() => void submitApproval()}>
              {approval.decision === "approve" ? "Registrar aprobación" : "Registrar pedido"}
            </AdminButton>
          </div>
        </ModuleDialog>
      ) : null}

      {resolution ? (
        <ModuleDialog title={resolutionLabel} wide onClose={() => setResolution(null)}>
          <p className="admin-dialog-text">
            {resolution.request.kind === "items"
              ? "La propuesta del cliente se aplica al presupuesto con los precios unitarios originales. Podés ajustar las cantidades y días como contra-oferta antes de aceptar."
              : resolution.request.kind === "discount"
                ? "Al aceptar, el descuento se aplica al presupuesto y el total se recalcula. Podés contra-ofertar con otro monto."
                : "El pedido de cambios queda resuelto: el cliente lo ve respondido en su portal y el presupuesto deja de mostrarse como «cambios solicitados»."}
          </p>
          <dl className="admin-dialog-facts">
            <div>
              <dt>Cliente</dt>
              <dd>{resolution.request.budget.client.company || resolution.request.budget.client.name}</dd>
            </div>
            <div>
              <dt>Presupuesto</dt>
              <dd>{resolution.request.budget.title}</dd>
            </div>
            <div>
              <dt>Pedido</dt>
              <dd>{requestDelta(resolution.request)}</dd>
            </div>
            <div>
              <dt>Motivo</dt>
              <dd>{resolution.request.note || "—"}</dd>
            </div>
            <div>
              <dt>Total actual</dt>
              <dd>{formatMoney(resolution.request.budget.total)}</dd>
            </div>
          </dl>

          {resolution.decision === "accept" && resolution.request.kind === "items" ? (
            <div className="admin-dialog-table" role="table" aria-label="Contra-oferta de ítems">
              <div className="admin-dialog-table-head" role="row">
                <span role="columnheader">Ítem</span>
                <span role="columnheader">Actual</span>
                <span role="columnheader">Propuesto</span>
                <span role="columnheader" className="admin-dialog-num">
                  Subtotal
                </span>
              </div>
              {resolution.request.budget.items.map((item) => {
                const proposed = counterItems[item.id] ?? { quantity: item.quantity, days: item.days };
                const subtotal = item.unitPrice * proposed.quantity * proposed.days;
                return (
                  <div className="admin-dialog-table-row" role="row" key={item.id}>
                    <span role="cell">{item.name}</span>
                    <span role="cell">
                      {formatNumber(item.quantity)} × {formatNumber(item.days)} d
                    </span>
                    <span role="cell" className="admin-dialog-counter">
                      <NumberField
                        ariaLabel={`Cantidad propuesta de ${item.name}`}
                        maxLength={4}
                        value={String(proposed.quantity)}
                        onChange={(value) =>
                          setCounterItems((current) => ({
                            ...current,
                            [item.id]: { ...proposed, quantity: Math.max(1, Number(value) || 1) },
                          }))
                        }
                      />
                      <span aria-hidden="true">×</span>
                      <NumberField
                        ariaLabel={`Días propuestos de ${item.name}`}
                        maxLength={4}
                        value={String(proposed.days)}
                        onChange={(value) =>
                          setCounterItems((current) => ({
                            ...current,
                            [item.id]: { ...proposed, days: Math.max(1, Number(value) || 1) },
                          }))
                        }
                      />
                      <span aria-hidden="true">d</span>
                    </span>
                    <span role="cell" className="admin-dialog-num">
                      {formatMoney(subtotal)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {resolution.decision === "accept" && resolution.request.kind === "discount" ? (
            <div className="admin-plan-grid">
              <MoneyField
                label="Descuento final (Gs)"
                hint="Podés aceptar el pedido o contra-ofertar con otro monto"
                value={counterDiscount}
                onChange={setCounterDiscount}
              />
            </div>
          ) : null}

          {resolution.decision === "accept" ? (
            <p className="admin-dialog-text">
              {resolution.request.kind === "changes" ? (
                <>Queda auditado a tu nombre y el cliente lo ve en su portal.</>
              ) : (
                <>
                  Nuevo subtotal <strong>{formatMoney(counterSubtotal)}</strong> · nuevo total{" "}
                  <strong>{formatMoney(counterTotal)}</strong>
                  {resolution.request.budget.status === "APPROVED" ? (
                    <>
                      {" "}
                      · Ojo: el presupuesto ya está aprobado, así que el total aprobado queda desactualizado (la decisión se
                      audita igual).
                    </>
                  ) : null}
                </>
              )}
            </p>
          ) : null}

          <TextAreaField
            label={resolution.decision === "accept" ? "Respuesta para el cliente (opcional)" : "Nota del rechazo (obligatoria)"}
            wide
            value={note}
            onChange={setNote}
            maxLength={600}
            rows={3}
            required={resolution.decision === "reject"}
            placeholder={
              resolution.decision === "accept"
                ? "Ej.: confirmamos el ajuste; el equipo pasa a coordinar los equipos"
                : "Ej.: no podemos bajar más el precio con esa cantidad de días"
            }
          />
          {dialogError ? <AdminNote tone="error">{dialogError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            <AdminButton onClick={() => setResolution(null)} disabled={dialogBusy}>
              Cancelar
            </AdminButton>
            <AdminButton
              variant={resolution.decision === "accept" ? "primary" : undefined}
              icon={resolution.decision === "accept" ? "check" : "close"}
              busy={dialogBusy}
              onClick={() => void submitResolution()}
            >
              {resolution.decision === "accept" ? "Aceptar y aplicar" : "Rechazar con nota"}
            </AdminButton>
          </div>
        </ModuleDialog>
      ) : null}

      {plan ? (
        <ModuleDialog title={`Plan de pagos · ${plan.budget.title}`} wide onClose={() => setPlan(null)}>
          <p className="admin-dialog-text">
            El anticipo y las cuotas se muestran en el portal cuando el presupuesto está aprobado: el primero (o la primera
            cuota) aparece como «a transferir ahora». El plan no puede superar el total ({formatMoney(plan.budget.total)}).
          </p>
          <div className="admin-plan-grid">
            <MoneyField
              label="Anticipo (Gs)"
              hint="0 = sin anticipo separado"
              value={plan.advance}
              onChange={(value) => setPlan({ ...plan, advance: value })}
              placeholder="0"
            />
            <TextAreaField
              label="Condiciones"
              wide
              value={plan.terms}
              onChange={(value) => setPlan({ ...plan, terms: value })}
              maxLength={600}
              rows={3}
              placeholder="Ej.: 50 % al confirmar y saldo 7 días antes del evento"
            />
          </div>
          <div className="admin-plan-list">
            {plan.installments.map((installment, index) => (
              <div className="admin-plan-row" key={`installment-${index}`}>
                <TextField
                  label={`Cuota ${index + 1}`}
                  value={installment.label}
                  maxLength={60}
                  placeholder="Ej.: Saldo final"
                  onChange={(value) =>
                    setPlan({
                      ...plan,
                      installments: plan.installments.map((row, position) =>
                        position === index ? { ...row, label: value } : row,
                      ),
                    })
                  }
                />
                <MoneyField
                  label="Monto (Gs)"
                  value={installment.amount}
                  onChange={(value) =>
                    setPlan({
                      ...plan,
                      installments: plan.installments.map((row, position) =>
                        position === index ? { ...row, amount: value } : row,
                      ),
                    })
                  }
                />
                <DateField
                  label="Vencimiento"
                  value={installment.dueAt}
                  onChange={(value) =>
                    setPlan({
                      ...plan,
                      installments: plan.installments.map((row, position) =>
                        position === index ? { ...row, dueAt: value } : row,
                      ),
                    })
                  }
                />
                <AdminButton
                  icon="close"
                  title={`Quitar la cuota ${index + 1}`}
                  aria-label={`Quitar la cuota ${index + 1}`}
                  onClick={() => setPlan({ ...plan, installments: plan.installments.filter((_, position) => position !== index) })}
                />
              </div>
            ))}
            {plan.installments.length < MAX_INSTALLMENTS ? (
              <AdminButton
                icon="plus"
                onClick={() =>
                  setPlan({ ...plan, installments: [...plan.installments, { label: "", amount: "", dueAt: "" }] })
                }
              >
                Agregar cuota
              </AdminButton>
            ) : null}
          </div>
          {dialogError ? <AdminNote tone="error">{dialogError}</AdminNote> : null}
          <div className="admin-dialog-foot">
            <span className="admin-dialog-spacer" />
            <AdminButton onClick={() => setPlan(null)} disabled={dialogBusy}>
              Cancelar
            </AdminButton>
            <AdminButton variant="primary" icon="check" busy={dialogBusy} onClick={() => void submitPlan()}>
              Guardar plan
            </AdminButton>
          </div>
        </ModuleDialog>
      ) : null}

      {paymentsOpen ? <PaymentDetailsDialog onClose={() => setPaymentsOpen(false)} /> : null}

      {proofDialog ? (
        <BudgetProofDialog
          title={`Comprobantes · ${proofDialog.title}`}
          subtitle={`Enviados desde el portal por el cliente (${proofDialog.client.company || proofDialog.client.name}). El archivo se sirve con tu sesión: no es público.`}
          proofs={proofsByBudget[proofDialog.id] ?? []}
          onClose={() => setProofDialog(null)}
        />
      ) : null}
    </div>
  );
}
