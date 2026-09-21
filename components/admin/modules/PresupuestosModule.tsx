"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  budgetApprovalLabel,
  budgetApprovalMethodLabel,
  budgetApprovalTone,
  budgetStatusLabel,
  dueTone,
  formatDateShort,
  formatDateTime,
  formatMoney,
  formatNumber,
  statusTone,
} from "@/lib/admin-format";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
import { budgetApprovalState, collectedAmount, type AdminBudgetPortalPayload, type AdminBudgetRow } from "@/lib/admin-types";
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
  AdminField,
  AdminFormPanel,
  AdminIconLink,
  AdminKpi,
  AdminNote,
  AdminRow,
  AdminSearchField,
  AdminSelect,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { adminSend, useAdminResource } from "../use-admin-data";

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

type ApprovalDecision = "approve" | "request_revision";

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

/**
 * Diálogo del módulo (issue #12). El panel todavía no tiene un primitivo de
 * diálogo: acá vive el primero, con el contrato mínimo (rol dialog, foco al
 * abrir, cierre con Escape y clic afuera).
 */
function ModuleDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
      <section className="admin-dialog" role="dialog" aria-modal="true" aria-label={title}>
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

export function PresupuestosModule() {
  const { role } = useAdminSession();
  const budgets = useAdminResource("/api/admin/budgets", (payload) => payload.budgets ?? []);
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

  const writable = canWriteFinance(role);
  const clientOptions = useMemo(() => clients.data ?? [], [clients.data]);
  const eventOptions = useMemo(() => events.data ?? [], [events.data]);
  const portalToken = portalBudget?.publicToken ?? null;

  const rows = useMemo(() => {
    const list = budgets.data ?? [];
    return list
      .filter((budget) => (status === "ALL" ? true : budget.status === status))
      .filter((budget) => matchesQuery(query, [budget.title, budget.client.company, budget.client.name, budget.event?.name]));
  }, [budgets.data, query, status]);

  const totals = useMemo(() => {
    const list = budgets.data ?? [];
    return list.reduce(
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
  }, [budgets.data]);

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
    budgets.reload();
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
    budgets.reload();
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
    budgets.reload();
  }

  return (
    <div className="admin-module-page">
      <section className="admin-kpis" aria-label="Indicadores de presupuestos">
        <AdminKpi label="Total cotizado" value={formatMoney(totals.quoted)} note="presupuestos vigentes" />
        <AdminKpi label="Cobrado" value={formatMoney(totals.paid)} note="pagos registrados" tone="ok" />
        <AdminKpi label="Por cobrar" value={formatMoney(totals.receivable)} note="saldo de clientes" tone="warn" />
        <AdminKpi label="Margen estimado" value={formatMoney(totals.margin)} note="venta menos costos" tone="accent" />
      </section>

      <AdminToolbar>
        <AdminSearchField
          value={query}
          onChange={setQuery}
          label="Buscar presupuestos"
          placeholder="Buscar por título, cliente o evento…"
        />
        <AdminSelect value={status} onChange={setStatus} label="Filtrar por estado" options={STATUS_OPTIONS} />
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
          <AdminField label="Cliente">
            <select required value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}>
              <option value="">Elegí un cliente…</option>
              {clientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.company || client.name}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Evento" hint="Opcional">
            <select value={form.eventId} onChange={(event) => setForm({ ...form, eventId: event.target.value })}>
              <option value="">Sin evento asociado</option>
              {eventOptions.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </AdminField>
          <AdminField label="Título" wide>
            <input
              required
              maxLength={160}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Ej.: Alquiler pantalla LED 6×3"
            />
          </AdminField>
          <AdminField label="Producto / servicio" wide>
            <input
              required
              maxLength={160}
              value={form.item}
              onChange={(event) => setForm({ ...form, item: event.target.value })}
              placeholder="Ej.: Pantalla LED P3.9 interior"
            />
          </AdminField>
          <AdminField label="Cantidad">
            <input
              type="number"
              min="1"
              step="1"
              required
              value={form.quantity}
              onChange={(event) => setForm({ ...form, quantity: event.target.value })}
            />
          </AdminField>
          <AdminField label="Días">
            <input type="number" min="1" step="1" required value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} />
          </AdminField>
          <AdminField label="Precio unitario" hint="En guaraníes">
            <input
              type="number"
              min="0"
              step="1"
              required
              value={form.unitPrice}
              onChange={(event) => setForm({ ...form, unitPrice: event.target.value })}
              inputMode="numeric"
            />
          </AdminField>
          <AdminField label="Costo unitario" hint="Para el margen estimado">
            <input
              type="number"
              min="0"
              step="1"
              value={form.costPrice}
              onChange={(event) => setForm({ ...form, costPrice: event.target.value })}
              inputMode="numeric"
            />
          </AdminField>
        </AdminFormPanel>
      ) : null}

      <AdminDataState
        loading={budgets.loading}
        error={budgets.error}
        onRetry={budgets.reload}
        empty={(budgets.data ?? []).length === 0}
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
                    <small className="admin-cell-sub"> · {budget.publicToken ? "Link activo" : "Sin link"}</small>
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
              <AdminField label="Link del portal" wide>
                <input readOnly value={portalBudgetUrl(portalToken)} onFocus={(event) => event.target.select()} />
              </AdminField>
              <p className="admin-dialog-text">
                Escaneá el QR o compartí el link: el cliente ve este presupuesto —y solo este— y puede aprobarlo o pedir
                cambios.
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
          <AdminField label={approval.decision === "approve" ? "Nota (opcional)" : "¿Qué cambios se piden?"} wide>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              rows={4}
              required={approval.decision === "request_revision"}
              placeholder={approval.decision === "approve" ? "Ej.: aprobado por teléfono, coordina con Santiago" : "Ej.: sumar un día más y cambiar el lugar"}
            />
          </AdminField>
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
    </div>
  );
}
