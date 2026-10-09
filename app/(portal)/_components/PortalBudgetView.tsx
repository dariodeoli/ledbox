"use client";
import { clientDisplayName } from "@/lib/client-identity";
import { resolveBudgetPaymentPlan } from "@/lib/budget-payment-plan";

import { PortalQuoteResources } from "./PortalQuoteResources";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AdminIcon } from "@/components/admin/AdminIcons";
import {
  budgetApprovalLabel,
  budgetApprovalMethodLabel,
  budgetApprovalTone,
  budgetChangeKindLabel,
  budgetChangeStatusLabel,
  budgetChangeStatusTone,
  budgetStatusLabel,
  countdownTone,
  formatBytes,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  invoiceTaxTypeLabel,
  paymentProofMimeLabel,
  statusTone,
} from "@/lib/admin-format";
import { bankMark } from "@/lib/bank-mark";
import {
  applyPortalDemoState,
  emptyPortalDemoState,
  readPortalDemoState,
  reducePortalDemo,
  writePortalDemoState,
  type PortalDemoState,
} from "@/lib/portal-demo";
import { PAYMENT_PROOF_MIMES, paymentProofExtension } from "@/lib/admin-types";
import {
  amountInput,
  caretAfterDigits,
  moneyInputDisplay,
  moneyInputMaxLength,
  percentInput,
} from "@/lib/field-rules";
import type { PortalBudget, PortalBudgetProof, PortalBudgetRequest, PortalExpectedPayment } from "@/lib/server/budget-portal";
import { privacyPolicyUrl } from "@/lib/public-config";
import { PortalCardTitle } from "./PortalCardTitle";
import { PortalPending, type PortalPendingItem } from "./PortalPending";

/**
 * Vista pública del presupuesto (issue #12) rediseñada: el cliente la lee de
 * arriba abajo —encabezado, estado, ítems ajustables, totales, una **acción
 * principal única**, plan de pagos, datos para transferir, comprobante,
 * pedidos, cronología y ayuda— con un resumen pegajoso en escritorio.
 *
 * La acción principal resuelve según lo que hizo el cliente (issue #14):
 *
 * - **Autorizar**: confirma lo enviado o sus propios ajustes de cantidades y
 *   días. Con cambios envía `propose` (kind `items`) para revisión, siempre
 *   con el nombre del responsable y `consent: true`; sin cambios aprueba
 *   directo. Los ajustes quedan como solicitud pendiente para el panel, que es
 *   el único que aplica precios y totales.
 * - **Enviar petición**: pide una rebaja (`propose` kind `discount`) o un cambio
 *   que no se resuelve con cantidades (`revision`) y espera la respuesta del
 *   equipo por el mismo link.
 *
 * Autorizado el presupuesto desaparecen los editores y los pedidos: la página
 * queda en solo lectura (estado, plan, datos de pago, comprobante, cronología y
 * la impresión del navegador). Lo mismo vale para una petición ya enviada.
 *
 * El nombre de quien autoriza viene **prellenado con el responsable cargado en
 * la empresa del cliente** (`Client.contactName`/`contactRole`, issue #36) y
 * queda editable por si autoriza otra persona; sin responsable cargado el campo
 * va vacío con la ayuda correspondiente, nunca con un dato inventado.
 *
 * El comprobante de pago (issue #17) sigue igual: la foto se comprime en el
 * navegador, el archivo se valida por magic bytes y el binario nunca se sirve
 * en el portal.
 *
 * Con `demo` (issue #29, issue #52) la vista muestra arriba el aviso de datos
 * simulados y **no escribe nada**: las acciones del cliente se resuelven en el
 * navegador (`lib/portal-demo.ts`) y se guardan por sesión, así sobreviven la
 * navegación de esa visita sin tocar el presupuesto de ejemplo. Los links reales
 * no llevan el modo y funcionan exactamente igual que siempre.
 */

type DraftItem = { quantity: number; days: number; excluded?: boolean };

/** Qué va a hacer el cliente con el botón único de la acción principal. */
type ActionMode = "authorize" | "discount" | "change";

const MAX_QUANTITY = 999;
const MAX_DAYS = 365;
const MAX_NOTE = 600;
/** Estado del comprobante en el portal, con su tono de cápsula. */
const PROOF_STATUS: Record<PortalBudgetProof["status"], { label: string; tone: string }> = {
  received: { label: "Recibido", tone: "info" },
  collected: { label: "Cobrado", tone: "ok" },
  cancelled: { label: "Cobro anulado", tone: "danger" },
};

/**
 * Estado visible de cada concepto del plan (issue #28), en voz del cliente:
 * esperando la transferencia → comprobante en revisión → confirmado por LedBox.
 */
const EXPECTED_STATUS: Record<PortalExpectedPayment["status"], { label: string; tone: string }> = {
  AWAITING: { label: "Esperando tu transferencia", tone: "warn" },
  PROOF: { label: "Comprobante recibido, en revisión", tone: "info" },
  // Seña cobrada con saldo pendiente (issue #129).
  PARTIAL: { label: "Seña recibida · saldo pendiente", tone: "accent" },
  CONFIRMED: { label: "Confirmado por LedBox", tone: "ok" },
  CANCELLED: { label: "Cancelado", tone: "neutral" },
};

/** Etiqueta del botón único según lo que va a pasar. */
const ACTION_BUTTON: Record<ActionMode, string> = {
  authorize: "Autorizar el presupuesto",
  discount: "Enviar petición de rebaja",
  change: "Enviar pedido de cambio",
};

/** Nota del listado: explica el circuito o por qué el formulario no está disponible. */
function proofUploadHint(budget: PortalBudget): string | null {
  return budget.proofUpload.allowed
    ? "El equipo de LedBox revisa cada comprobante y marca el cobro; el estado de arriba es el real."
    : budget.proofUpload.reason;
}

function clampInt(value: string, max: number): number {
  const digits = value.replace(/\D/g, "");
  if (!digits) return 1;
  return Math.min(max, Math.max(1, Number(digits)));
}

/** Fecha corta de una clave `YYYY-MM-DD` o de un ISO, sin corrimiento de zona. */
function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "Sin fecha";
  return formatDate(/^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? `${dueAt}T12:00:00.000Z` : dueAt);
}

/** Resumen legible de lo que pidió el cliente en una solicitud (sin repetir el motivo). */
function requestSummary(request: PortalBudgetRequest): string | null {
  if (request.kind === "items") {
    if (request.items.length === 0) return "Propuesta de ítems";
    return request.items
      .map((item) =>
        Boolean(item.excluded) === Boolean(item.previousExcluded) && item.quantity === item.previousQuantity && item.days === item.previousDays
          ? `${item.name} sin cambios`
          : item.excluded ? `${item.name}: Retirado / no incluido` : `${item.name}: ${formatNumber(item.previousQuantity)} × ${formatNumber(item.previousDays)} d → ${formatNumber(item.quantity)} × ${formatNumber(item.days)} d`,
      )
      .join(" · ");
  }
  if (request.kind === "discount" && request.discount) {
    const asked = request.discount.type === "percent" ? `${request.discount.value} %` : formatMoney(request.discount.value);
    return `Rebaja pedida: ${asked} (${formatMoney(request.discount.amount)}) · descuento actual ${formatMoney(request.discount.previousAmount)}`;
  }
  // El pedido de cambios libre ya se lee en el motivo: no se repite como resumen.
  return null;
}

/** Frase corta de lo pedido, para el estado y la confirmación. */
function requestIntent(request: PortalBudgetRequest): string {
  if (request.kind === "items") return "el ajuste de cantidades y días";
  if (request.kind === "discount") return "la rebaja";
  return "el cambio";
}

/** Ítems con diferencias contra el presupuesto real (cantidad o días). */
function changedItems(budget: PortalBudget, draft: Record<string, DraftItem>): Array<{ id: string; quantity: number; days: number; excluded?: boolean }> {
  return budget.items.flatMap((item) => {
    const current = draft[item.id];
    if (!current || (current.quantity === item.quantity && current.days === item.days && Boolean(current.excluded) === Boolean(item.excluded))) return [];
    return [{ id: item.id, quantity: current.quantity, days: current.days, excluded: Boolean(current.excluded) }];
  });
}

/**
 * Motivo que acompaña la propuesta cuando el cliente autoriza con ajustes: el
 * API del portal exige una nota y esta explica, en palabras del cliente, qué
 * cambió antes de autorizar.
 */
function changeNote(budget: PortalBudget, draft: Record<string, DraftItem>): string {
  const rows = budget.items.flatMap((item) => {
    const current = draft[item.id];
    if (!current || (current.quantity === item.quantity && current.days === item.days && Boolean(current.excluded) === Boolean(item.excluded))) return [];
    return [
      `${item.name}: ${current.excluded ? "Retirado / no incluido" : `Incluido: ${formatNumber(current.quantity)} × ${formatNumber(current.days)} d`}`,
    ];
  });
  return rows.length > 0 ? `Ajusté el presupuesto desde el portal y lo autoricé con estos valores: ${rows.join("; ")}.` : "";
}

/**
 * Selector segmentado del portal (único objeto del tipo): se usa para la
 * intención de la acción principal y para el tipo de descuento pedido.
 */
function PortalSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
  wide = false,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
  wide?: boolean;
}) {
  return (
    <div className={`portal-segmented${wide ? " portal-segmented--wide" : ""}`} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="portal-segment"
          data-active={value === option.value ? "true" : undefined}
          aria-pressed={value === option.value}
          title={option.title}
          aria-label={option.title}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PortalDecisionOptions({
  value,
  options,
  onChange,
}: {
  value: ActionMode;
  options: Array<{ value: ActionMode; label: string; title: string; helper: string }>;
  onChange: (value: ActionMode) => void;
}) {
  return (
    <fieldset className="portal-decision-options">
      <legend className="portal-field-label">Qué querés hacer</legend>
      <div className="portal-decision-options-list">
        {options.map((option) => {
          const active = value === option.value;
          const helperId = `portal-decision-${option.value}-help`;
          return (
            <label className="portal-decision-option" data-active={active ? "true" : undefined} key={option.value}>
              <input
                type="radio"
                name="portal-action-mode"
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
                aria-describedby={helperId}
              />
              <span className="portal-decision-option-copy">
                <span className="portal-decision-option-title">{option.label}</span>
                <span className="portal-decision-option-helper" id={helperId}>
                  {option.helper}
                </span>
              </span>
              <span className="portal-decision-option-mark" aria-hidden="true" />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Stepper({
  value,
  max,
  label,
  onStep,
  onType,
}: {
  value: number;
  max: number;
  label: string;
  /** Suma o resta uno (el valor final lo decide quien guarda el borrador). */
  onStep: (delta: number) => void;
  /** Texto tipeado a mano: se normaliza al rango 1..max. */
  onType: (text: string) => void;
}) {
  return (
    <span className="portal-stepper">
      <button
        type="button"
        className="portal-step"
        onClick={() => onStep(-1)}
        disabled={value <= 1}
        aria-label={`Restar uno a ${label}`}
        title={`Restar uno a ${label}`}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={String(value)}
        onChange={(event) => onType(event.target.value)}
        aria-label={`${label} (1 a ${max})`}
      />
      <button
        type="button"
        className="portal-step"
        onClick={() => onStep(1)}
        disabled={value >= max}
        aria-label={`Sumar uno a ${label}`}
        title={`Sumar uno a ${label}`}
      >
        +
      </button>
    </span>
  );
}

/**
 * Miniatura del ítem en el portal (issue #107): la imagen del producto
 * vinculado, con la misma caja uniforme del inventario (criterio #98) —caja
 * fija, cuadrada, foto entera con `contain`— y fallback al ícono del módulo si
 * no hay imagen o la URL no carga (nunca un cuadro roto).
 */
function PortalItemThumb({ imageUrl }: { imageUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);
  return (
    <span className="portal-item-thumb" aria-hidden="true">
      {imageUrl && !failed ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <AdminIcon name="inventory" size={16} />
      )}
    </span>
  );
}

export function PortalBudgetView({
  budget: canonicalBudget,
  token,
  demo = false,
  demoBanner,
  headTitle,
  headFacts,
  timeline,
}: {
  budget: PortalBudget;
  token: string;
  demo?: boolean;
  /** Aviso de datos simulados, ya dibujado en el servidor (issue #63). */
  demoBanner?: ReactNode;
  /** Encabezado del documento (servidor): referencia, título y metadatos. */
  headTitle?: ReactNode;
  /** Datos del encabezado (servidor): emisión, validez y evento. */
  headFacts?: ReactNode;
  /** Cronología del cliente (servidor): solo lectura, sin hidratación. */
  timeline?: ReactNode;
}) {
  const router = useRouter();

  // Simulación de la visita en modo demo (issue #52): el servidor no la conoce,
  // se lee de la sesión al montar y se escribe con cada acción simulada.
  const [demoState, setDemoState] = useState<PortalDemoState | null>(null);
  useEffect(() => {
    if (demo) setDemoState(readPortalDemoState(token));
  }, [demo, token]);
  /** Vista visible: la canónica, con lo simulado encima cuando es la demo. */
  const budget = useMemo(
    () => (demo && demoState ? applyPortalDemoState(canonicalBudget, demoState) : canonicalBudget),
    [canonicalBudget, demo, demoState],
  );

  // Identidad del cliente: el responsable cargado en la empresa (issue #36) es
  // el valor inicial de quien autoriza y de quien sube el comprobante.
  const clientLabel = clientDisplayName(budget.client);
  const contactName = budget.client.contactName?.trim() ?? "";
  const contactRole = budget.client.contactRole?.trim() ?? "";

  const [mode, setMode] = useState<ActionMode>("authorize");
  const [name, setName] = useState(contactName);
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState("");
  const [sending, setSending] = useState(false);
  const [justApproved, setJustApproved] = useState<null | { already: boolean }>(null);
  const [justRequested, setJustRequested] = useState<null | { kind: "discount" | "change" | "items"; at: string; note: string }>(null);

  // Autogestión (issue #14): borrador de ítems y rebaja pedida.
  const [draft, setDraft] = useState<Record<string, DraftItem>>(() =>
    Object.fromEntries(budget.items.map((item) => { const pending = budget.requests.find((request) => request.kind === "items" && request.status === "pending")?.items.find((row) => row.id === item.id); return [item.id, pending ? { quantity: pending.quantity, days: pending.days, excluded: Boolean(pending.excluded) } : { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) }]; })),
  );
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [copied, setCopied] = useState(false);

  // Comprobante de pago (issue #17) vinculado al concepto del plan (issue #28).
  const [proofName, setProofName] = useState(contactName);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofExpectedId, setProofExpectedId] = useState("");
  const [proofError, setProofError] = useState("");
  const [proofBusy, setProofBusy] = useState(false);
  const [proofSent, setProofSent] = useState(false);

  const approvedRef = useRef<HTMLElement | null>(null);
  const revisionRef = useRef<HTMLElement | null>(null);
  const actionRef = useRef<HTMLElement | null>(null);
  const proofRef = useRef<HTMLElement | null>(null);
  /** Bloque de pago post-aprobación (issue #107): destino del scroll al confirmar. */
  const payFirstRef = useRef<HTMLDivElement | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const discountInputRef = useRef<HTMLInputElement | null>(null);
  const [actionBelowViewport, setActionBelowViewport] = useState(false);
  const [footerVisible, setFooterVisible] = useState(false);

  const approved = Boolean(budget.approval.approvedAt) || Boolean(justApproved);
  const revisionPending = !approved && (Boolean(budget.approval.revisionRequestedAt) || justRequested?.kind === "change");
  const pendingRequests = budget.requests.filter((request) => request.status === "pending");
  /** Pedido ya enviado y esperando respuesta (rebaja o ajuste de ítems). */
  const waitingRequest = !approved && !revisionPending && (pendingRequests.length > 0 || Boolean(justRequested));
  /** El cliente todavía no envió nada: puede ajustar, autorizar o pedir. */
  const canEdit = !approved && !revisionPending && !pendingRequests.some((request) => request.kind !== "items") && (!justRequested || justRequested.kind === "items");

  useEffect(() => {
    if (!canEdit) {
      setActionBelowViewport(false);
      setFooterVisible(false);
      return;
    }
    const action = actionRef.current;
    if (!action) return;
    const footer = document.querySelector<HTMLElement>(".app-footer--portal");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const rect = entry.boundingClientRect;
          const visible = rect.bottom > 0 && rect.top < window.innerHeight;
          if (entry.target === action) {
            setActionBelowViewport(!visible && rect.top >= window.innerHeight);
          }
          if (entry.target === footer) setFooterVisible(visible);
        }
      },
      { threshold: 0 },
    );
    observer.observe(action);
    if (footer) observer.observe(footer);
    return () => observer.disconnect();
  }, [canEdit]);

  // El foco acompaña el cambio de estado para que un lector de pantalla anuncie
  // el resultado de la acción (el bloque nuevo entra al tabulado). Al autorizar,
  // además, la vista queda en el bloque de pago (issue #107): datos para
  // transferir y plan acordado, que es lo que el cliente necesita para pagar.
  useEffect(() => {
    if (!justApproved) return;
    approvedRef.current?.focus();
    if (!justApproved.already) payFirstRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [justApproved]);
  useEffect(() => {
    if (justRequested) revisionRef.current?.focus();
  }, [justRequested]);
  useEffect(() => {
    if (proofSent) proofRef.current?.focus();
  }, [proofSent]);

  // El borrador sigue los ítems reales: cuando el equipo aplica la propuesta,
  // el portal se refresca y los valores de partida son los nuevos.
  const itemsSignature = budget.items.map((item) => `${item.id}:${item.quantity}:${item.days}:${item.excluded}:${JSON.stringify(budget.requests.find((request) => request.kind === "items" && request.status === "pending")?.items ?? [])}`).join("|");
  useEffect(() => {
    setDraft(Object.fromEntries(budget.items.map((item) => { const pending = budget.requests.find((request) => request.kind === "items" && request.status === "pending")?.items.find((row) => row.id === item.id); return [item.id, pending ? { quantity: pending.quantity, days: pending.days, excluded: Boolean(pending.excluded) } : { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) }]; })));
  }, [itemsSignature]); // eslint-disable-line react-hooks/exhaustive-deps -- el borrador solo depende de la firma de los ítems

  // Conceptos del plan abiertos (issue #28): esperando transferencia, con
  // comprobante en revisión o con una seña cobrada y saldo (issue #129).
  const openExpected = budget.expectedPayments.filter(
    (expected) => expected.status === "AWAITING" || expected.status === "PROOF" || expected.status === "PARTIAL",
  );
  /** Concepto que corresponde transferir ahora: el primero sin nada cobrado; si no, una seña con saldo. */
  const dueNowExpected =
    openExpected.find((expected) => expected.status === "AWAITING") ??
    openExpected.find((expected) => expected.status === "PARTIAL") ??
    null;
  const persistedPaymentPlan = budget.paymentPlan;
  /**
   * Qué se transfiere ahora: con pagos esperados manda el primer concepto abierto
   * (el que el plan muestra como «a transferir ahora»); sin ellos, lo dice el plan.
   * Si ya no queda nada abierto, no hay monto a transferir.
   */
  const transferNow = budget.expectedPayments.length > 0
    ? dueNowExpected
      ? {
          label: dueNowExpected.label,
          // De una seña se transfiere el saldo, no el total del concepto (#129).
          amount: dueNowExpected.status === "PARTIAL" ? dueNowExpected.remaining : dueNowExpected.amount,
        }
      : null
    : persistedPaymentPlan.dueNow;

  // El concepto elegido sigue a los pagos abiertos: si hay uno solo, se
  // preselecciona; cuando se confirma o desaparece, la selección se limpia.
  const openExpectedSignature = openExpected.map((expected) => expected.id).join("|");
  useEffect(() => {
    setProofExpectedId((current) => {
      if (current && openExpected.some((expected) => expected.id === current)) return current;
      return openExpected.length === 1 ? openExpected[0]?.id ?? "" : "";
    });
  }, [openExpectedSignature]); // eslint-disable-line react-hooks/exhaustive-deps -- la selección solo depende de los conceptos abiertos

  const approvedAt = budget.approval.approvedAt ?? (justApproved ? new Date().toISOString() : null);
  const approvedByName = budget.approval.approvedByName ?? (justApproved ? name.trim() : null);
  const approvalMethod = budget.approval.method ?? (justApproved ? "digital" : null);
  const revisionAt = budget.approval.revisionRequestedAt ?? (justRequested?.kind === "change" ? justRequested.at : null);
  const revisionText = justRequested?.kind === "change" ? justRequested.note : budget.approval.revisionNote;
  const approvalState = approved
    ? approvalMethod === "manual"
      ? "APROBADO_MANUAL"
      : "APROBADO_DIGITAL"
    : revisionPending
      ? "CAMBIOS_SOLICITADOS"
      : "PENDIENTE";

  const draftChanges = useMemo(() => changedItems(budget, draft), [budget, draft]);
  /** Solo el cliente que todavía decide ajusta cantidades: aprobado o en revisión se lee. */
  const itemsChanged = !approved && draftChanges.length > 0;

  const proposedSubtotal = useMemo(
    () =>
      budget.items.reduce((sum, item) => {
        const current = draft[item.id] ?? { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) };
        return sum + (current.excluded ? 0 : item.unitPrice * current.quantity * current.days);
      }, 0),
    [budget.items, draft],
  );
  const proposedTotal = Math.max(0, proposedSubtotal - budget.discount);
  /** Total que se firma con el botón: el propuesto si hubo ajustes, el vigente si no. */
  const actionTotal = itemsChanged ? proposedTotal : budget.total;
  const summaryTotal = itemsChanged ? proposedTotal : budget.total;
  // Projection only: the same evaluator used by commercial writes, without
  // persisting a proposal or changing recorded payments/accepted conditions.
  const provisionalPlan = useMemo(() => itemsChanged
    ? resolveBudgetPaymentPlan(persistedPaymentPlan.installments, proposedTotal, persistedPaymentPlan.advanceAmount)
    : null, [itemsChanged, persistedPaymentPlan.installments, persistedPaymentPlan.advanceAmount, proposedTotal]);
  const paymentPlan = provisionalPlan?.ok
    ? { ...persistedPaymentPlan, installments: provisionalPlan.rows, pending: provisionalPlan.remaining }
    : persistedPaymentPlan;
  const provisionalPlanError = provisionalPlan && !provisionalPlan.ok ? provisionalPlan.error : null;

  // Rebaja pedida: monto resultante y total que quedaría si el equipo la acepta.
  // Rebaja (issues #76 y #77): el valor vive limpio (dígitos en monto, coma en
  // porcentaje) y el campo lo dibuja con separadores. La validación es en vivo:
  // el monto no puede superar el subtotal y el porcentaje va de 0 a 100; el
  // mensaje explica el tope en vez de mostrar un total calculado en 0.
  const discountRaw = discountType === "percent" ? discountValue.replace(",", ".").trim() : discountValue.replace(/\D/g, "");
  const discountNumber = Number(discountRaw);
  const discountError = !Number.isFinite(discountNumber) || discountNumber <= 0
    ? null
    : discountType === "percent" && discountNumber > 100
      ? "El porcentaje va de 0 a 100."
      : discountType === "amount" && discountNumber > budget.subtotal
        ? `La rebaja no puede superar el subtotal del presupuesto (${formatMoney(budget.subtotal)}).`
        : null;
  const discountAmount = !Number.isFinite(discountNumber) || discountNumber <= 0
    ? 0
    : discountType === "percent"
      ? Math.round((budget.subtotal * Math.min(100, discountNumber)) / 100)
      : Math.round(discountNumber);
  const discountTotal = Math.max(0, budget.total - discountAmount);
  const mark = bankMark(budget.paymentDetails?.bank);
  const lastRequest = pendingRequests[0] ?? null;

  /**
   * Pendientes del cliente (25-09-2026): lo que falta hacer sale del estado
   * real —decisión, pedido en revisión, transferencia, comprobante y vigencia—,
   * nunca de un dato inventado. Vacío = no hay nada pendiente.
   */
  const pendingItems: PortalPendingItem[] = [];
  if (!approved && canEdit) {
    pendingItems.push({
      id: "decide",
      icon: "check",
      tone: "accent",
      title: "Falta tu decisión",
      detail: `Autorizá el presupuesto por ${formatMoney(actionTotal)} o pedí una rebaja o un cambio.`,
      href: "#portal-action",
      action: "Decidir",
    });
  }
  if (waitingRequest || revisionPending) {
    pendingItems.push({
      id: "review",
      icon: "clock",
      tone: "info",
      title: "Tu pedido está en revisión",
      detail: "El equipo de LedBox te responde por este mismo link; mientras tanto podés autorizar el presupuesto tal como está.",
      href: budget.requests.length > 0 ? "#portal-requests" : undefined,
      action: budget.requests.length > 0 ? "Ver pedido" : undefined,
    });
  }
  if (!approved && budget.validUntil) {
    const tone = countdownTone(budget.validUntil);
    pendingItems.push({
      id: "validity",
      icon: "calendar",
      tone: tone === "danger" ? "danger" : tone === "warn" ? "warn" : "neutral",
      title: "La oferta tiene fecha de vencimiento",
      detail: `Válida hasta ${formatDate(budget.validUntil)} · ${formatCountdown(budget.validUntil, "client")}.`,
    });
  }
  if (approved) {
    const inReview = budget.expectedPayments.filter((expected) => expected.status === "PROOF");
    if (transferNow) {
      pendingItems.push({
        id: "transfer",
        icon: "bank",
        tone: "accent",
        title: `Transferí ${transferNow.label}`,
        detail: `${formatMoney(transferNow.amount)} · los datos bancarios están en esta misma página.`,
        href: "#portal-payment-data",
        action: "Ver datos",
      });
    }
    if (inReview.length > 0) {
      pendingItems.push({
        id: "proof-review",
        icon: "clock",
        tone: "info",
        title:
          inReview.length === 1
            ? `Comprobante en revisión: ${inReview[0]?.label ?? "pago"}`
            : `${formatNumber(inReview.length)} comprobantes en revisión`,
        detail: "El equipo de LedBox confirma el cobro; no hace falta hacer nada más.",
      });
    }
    if (budget.proofUpload.allowed && openExpected.length > 0) {
      pendingItems.push({
        id: "proof",
        icon: "upload",
        tone: "accent",
        title: "Enviá el comprobante de tu transferencia",
        detail: "JPG, PNG, WebP o PDF de hasta 2 MB; queda vinculado al pago que elijas.",
        href: "#portal-proof",
        action: "Subir",
      });
    }
  }

  /** Avance real del plan de cobros: confirmados sobre el total vigente. */
  const paymentProgress = (() => {
    if (!approved) return null;
    const active = budget.expectedPayments.filter((expected) => expected.status !== "CANCELLED");
    if (active.length === 0) return null;
    const confirmed = active.filter((expected) => expected.status === "CONFIRMED");
    return {
      confirmed: confirmed.length,
      total: active.length,
      confirmedAmount: formatMoney(confirmed.reduce((sum, expected) => sum + expected.amount, 0)),
      totalAmount: formatMoney(active.reduce((sum, expected) => sum + expected.amount, 0)),
    };
  })();

  /** POST del portal con el token del link; devuelve el error real del API. */
  async function postPortal(path: string, body: unknown): Promise<{ error?: string; alreadyApproved?: boolean }> {
    const response = await fetch(`/api/portal/budget/${encodeURIComponent(token)}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; alreadyApproved?: boolean } | null;
    if (!response.ok) throw new Error(payload?.error || "No pudimos registrar tu pedido. Probá de nuevo.");
    return payload ?? {};
  }

  /**
   * Guarda la simulación de la visita (solo demo): `sessionStorage` por token,
   * así el estado sobrevive la navegación y otro visitante ve el canónico.
   */
  function commitDemo(next: PortalDemoState) {
    setDemoState(next);
    writePortalDemoState(token, next);
  }

  /** Estado simulado vigente (la demo siempre montó con el suyo). */
  const demoBase = demoState ?? emptyPortalDemoState();

  /**
   * Acción principal única. Con ajustes envía `propose` para revisión;
   * sin ajustes autoriza con `approve`, o envía la petición según la intención
   * elegida, siempre con el nombre del responsable.
   *
   * En modo demo la misma acción se resuelve en el navegador (issue #52): no hay
   * POST ni escritura, y el resultado queda en la sesión de la visita.
   */
  async function runAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 3) {
      setActionError("Ingresá el nombre y apellido de quien autoriza o pide el cambio.");
      return;
    }

    setSending(true);
    setActionError("");
    try {
      if (actionMode === "authorize") {
        if (!consent) {
          setActionError("Marcá el consentimiento para registrar la autorización.");
          return;
        }
        const changes = canEdit ? (changedItems(budget, draft).length ? changedItems(budget, draft) : pendingRequests.some((request) => request.kind === "items") ? budget.items.map((item) => ({ id: item.id, ...(draft[item.id] ?? { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) }) })) : []) : [];
        if (!budget.items.some((item) => !(draft[item.id]?.excluded ?? item.excluded))) {
          setActionError("Restaurá al menos un producto o servicio antes de continuar.");
          return;
        }
        const at = new Date().toISOString();
        const noteText = note.trim();
        if (demo && changes.length > 0) {
          commitDemo(reducePortalDemo(demoBase, budget, { type: "items", at, name: name.trim(), note: noteText || changeNote(budget, draft), items: changes }));
          setJustRequested({ kind: "items", at, note: "Selección enviada para revisión (simulación)." });
          return;
        }
        if (demo) {
          commitDemo(
            reducePortalDemo(demoBase, budget, {
              type: "approve",
              at,
              name: name.trim(),
              note: noteText || null,
              items: changes,
              itemsNote: noteText || changeNote(budget, draft) || null,
            }),
          );
          setJustApproved({ already: false });
          return;
        }
        if (changes.length > 0) {
          // El ajuste se registra como propuesta para que el panel lo aplique;
          // la autorización viaja en la misma acción, con los montos a la vista.
          await postPortal("propose", {
            kind: "items",
            name: name.trim(),
            note: note.trim() || changeNote(budget, draft) || "Restaurar la selección original de ítems.",
            items: changes,
          });
          setJustRequested({ kind: "items", at, note: "Selección de ítems enviada. El equipo debe revisarla antes de aprobar." });
          router.refresh();
          return;
        }
        const payload = await postPortal("approve", {
          name: name.trim(),
          consent: true,
          note: note.trim() || undefined,
        });
        setJustApproved({ already: Boolean(payload.alreadyApproved) });
        router.refresh();
        return;
      }

      if (actionMode === "discount") {
        if (!note.trim()) {
          setActionError("Contanos por qué pedís la rebaja.");
          return;
        }
        if (!Number.isFinite(discountNumber) || discountNumber <= 0) {
          setActionError(discountType === "percent" ? "Ingresá un porcentaje mayor a cero." : "Ingresá un monto mayor a cero.");
          return;
        }
        if (discountType === "percent" && discountNumber > 100) {
          setActionError("El porcentaje no puede superar el 100 %.");
          return;
        }
        if (discountAmount > budget.subtotal) {
          setActionError("El monto pedido no puede superar el subtotal del presupuesto.");
          return;
        }
        const at = new Date().toISOString();
        if (demo) {
          commitDemo(
            reducePortalDemo(demoBase, budget, {
              type: "discount",
              at,
              name: name.trim(),
              note: note.trim(),
              discount: { type: discountType, value: discountType === "percent" ? discountNumber : discountAmount, amount: discountAmount },
            }),
          );
          setJustRequested({ kind: "discount", at, note: note.trim() });
          setNote("");
          return;
        }
        await postPortal("propose", {
          kind: "discount",
          name: name.trim(),
          note: note.trim(),
          discount: { type: discountType, value: discountType === "percent" ? discountNumber : discountAmount },
        });
        setJustRequested({ kind: "discount", at: new Date().toISOString(), note: note.trim() });
        setNote("");
        router.refresh();
        return;
      }

      if (!note.trim()) {
        setActionError("Contanos qué cambio necesitás.");
        return;
      }
      const revisionAt = new Date().toISOString();
      if (demo) {
        commitDemo(reducePortalDemo(demoBase, budget, { type: "revision", at: revisionAt, name: name.trim(), note: note.trim() }));
        setJustRequested({ kind: "change", at: revisionAt, note: note.trim() });
        setNote("");
        return;
      }
      await postPortal("revision", { name: name.trim(), note: note.trim() });
      setJustRequested({ kind: "change", at: new Date().toISOString(), note: note.trim() });
      setNote("");
      router.refresh();
    } catch (error) {
      setActionError(error instanceof Error && error.message ? error.message : "No pudimos conectar con el portal. Revisá tu conexión y probá de nuevo.");
    } finally {
      setSending(false);
    }
  }

  function updateDraft(id: string, field: "quantity" | "days", next: number) {
    setDraft((current) => {
      const item = budget.items.find((row) => row.id === id);
      if (!item) return current;
      const base = current[id] ?? { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) };
      const max = field === "quantity" ? MAX_QUANTITY : MAX_DAYS;
      return { ...current, [id]: { ...base, [field]: Math.min(max, Math.max(1, Math.round(next))) } };
    });
  }

  /** Botones +/−: el delta se aplica sobre el borrador vigente (sin pisar clics seguidos). */
  function stepDraft(id: string, field: "quantity" | "days", delta: number) {
    setDraft((current) => {
      const item = budget.items.find((row) => row.id === id);
      if (!item) return current;
      const base = current[id] ?? { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) };
      const max = field === "quantity" ? MAX_QUANTITY : MAX_DAYS;
      const next = Math.min(max, Math.max(1, base[field] + delta));
      return { ...current, [id]: { ...base, [field]: next } };
    });
  }

  /** Texto tipeado: se limpia a dígitos y se acota al rango del campo. */
  function setDraftField(id: string, field: "quantity" | "days", text: string) {
    updateDraft(id, field, clampInt(text, field === "quantity" ? MAX_QUANTITY : MAX_DAYS));
  }

  function resetDraft() {
    setDraft(Object.fromEntries(budget.items.map((item) => { const pending = budget.requests.find((request) => request.kind === "items" && request.status === "pending")?.items.find((row) => row.id === item.id); return [item.id, pending ? { quantity: pending.quantity, days: pending.days, excluded: Boolean(pending.excluded) } : { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) }]; })));
  }

  async function copyPaymentDetails() {
    if (!budget.paymentDetails) return;
    const details = budget.paymentDetails;
    const lines = [
      `Banco: ${details.bank ?? "—"}`,
      details.holder ? `Titular: ${details.holder}` : null,
      details.ruc ? `RUC: ${details.ruc}` : null,
      details.account ? `Cuenta: ${details.account}` : null,
      details.alias ? `Alias: ${details.alias}` : null,
      transferNow ? `Monto a transferir ahora: ${formatMoney(transferNow.amount)}` : null,
      `Presupuesto Nº ${budget.reference}`,
    ].filter((line): line is string => Boolean(line));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  /**
   * Sube el comprobante (foto comprimida o PDF) y refresca la vista del
   * presupuesto. En modo demo no hay subida: se guarda el metadato en la sesión
   * de la visita, igual que los demás comprobantes del portal (issue #52).
   */
  async function submitProof(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (proofName.trim().length < 3) {
      setProofError("Ingresá tu nombre y apellido.");
      return;
    }
    if (!proofFile) {
      setProofError("Adjuntá el comprobante de la transferencia.");
      return;
    }
    setProofBusy(true);
    setProofError("");
    try {
      // El pipeline de imagen (canvas + magic bytes) se carga recién acá: no hace
      // falta para leer ni para decidir el presupuesto (issue #63).
      const { prepareProofFile } = await import("./portal-proof-image");
      const prepared = await prepareProofFile(proofFile);
      if ("error" in prepared) {
        setProofError(prepared.error);
        return;
      }
      if (demo) {
        commitDemo(
          reducePortalDemo(demoBase, budget, {
            type: "proof",
            at: new Date().toISOString(),
            proof: {
              uploadedByName: proofName.trim(),
              mime: prepared.mime,
              size: prepared.blob.size,
              expectedPaymentId: proofExpectedId || null,
            },
          }),
        );
        setProofSent(true);
        setProofFile(null);
        if (proofInputRef.current) proofInputRef.current.value = "";
        return;
      }
      const form = new FormData();
      form.append("name", proofName.trim());
      if (proofExpectedId) form.append("expectedPaymentId", proofExpectedId);
      form.append(
        "file",
        new File([prepared.blob], `comprobante.${paymentProofExtension(prepared.mime)}`, {
          type: prepared.blob.type || prepared.mime,
        }),
      );
      const response = await fetch(`/api/portal/budget/${encodeURIComponent(token)}/proof`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setProofError(payload?.error || "No pudimos subir el comprobante. Probá de nuevo.");
        return;
      }
      setProofSent(true);
      setProofFile(null);
      if (proofInputRef.current) proofInputRef.current.value = "";
      router.refresh();
    } catch {
      setProofError("No pudimos conectar con el portal. Revisá tu conexión y probá de nuevo.");
    } finally {
      setProofBusy(false);
    }
  }

  /** Leyenda del nombre: de quién es el responsable cargado y que se puede cambiar. */
  const nameHint = contactName
    ? `Autorizás como responsable de ${clientLabel}${contactRole ? ` · ${contactRole}` : ""}. Si autoriza otra persona, cambiá el nombre.`
    : `No tenemos un responsable cargado de ${clientLabel}: escribí el nombre y apellido de quien autoriza.`;

  /** Modo efectivo: con un pedido en revisión la única acción posible es autorizar. */
  const actionMode: ActionMode = canEdit ? mode : "authorize";

  const modeOptions: Array<{ value: ActionMode; label: string; title: string }> = [
    { value: "authorize", label: "Autorizar", title: "Autorizar el presupuesto (con o sin ajustes)" },
    { value: "discount", label: "Rebaja", title: "Pedir una rebaja" },
    { value: "change", label: "Otro cambio", title: "Pedir un cambio que no se resuelve con cantidades" },
  ];
  const decisionOptions = modeOptions.map((option) => ({
    ...option,
    helper:
      option.value === "authorize"
        ? "Podés retirar o restaurar ítems. Los ajustes requieren revisión del equipo antes de aprobar."
        : option.value === "discount"
          ? "Pedí una rebaja indicando el monto y el motivo."
          : "Contanos qué necesitás modificar para preparar una nueva versión.",
  }));

  /**
   * Bloques del pago (issue #107): con el presupuesto aprobado van primero
   * —datos para transferir, plan real y comprobante—, para que el cliente sepa
   * cómo pagar sin buscarlo. Sin aprobar, cada bloque conserva su lugar en el
   * recorrido de la decisión.
   */
  const paymentsCard = (
    <section className="portal-card quote-document-section--payments" aria-labelledby="portal-payments" data-plan-preview={itemsChanged ? "provisional" : "current"}>
      <div className="portal-card-head">
        <PortalCardTitle id="portal-payments" icon="wallet">
          {approved ? "Plan de pagos" : "Plan de pagos propuesto"}
        </PortalCardTitle>
        <p className="portal-card-lead">
          {itemsChanged ? "Vista previa provisional de tu selección. No está aceptada: la oferta y los cobros registrados no cambian hasta que el equipo resuelva la solicitud." : budget.expectedPayments.length > 0
            ? "Cada concepto del plan con su estado real; el equipo confirma el cobro cuando llega la transferencia."
            : "Cada cuota con su vencimiento; los datos para transferir se muestran cuando el presupuesto esté autorizado."}
        </p>
      </div>

      {provisionalPlanError ? <p className="portal-error" role="alert">La selección requiere revisar las condiciones de pago: {provisionalPlanError} La oferta vigente no se modificó.</p> : !itemsChanged && budget.expectedPayments.length > 0 ? (
        <div className="portal-table-wrap">
          <table className="portal-table portal-table--plan portal-table--expected">
            <caption className="portal-table-caption">Tus pagos</caption>
            <thead>
              <tr>
                <th scope="col">Concepto</th>
                <th scope="col" className="portal-num">
                  Monto
                </th>
                <th scope="col">Vencimiento</th>
                <th scope="col">Estado</th>
                <th scope="col">Cuenta destino</th>
              </tr>
            </thead>
            <tbody>
              {budget.expectedPayments.map((expected) => {
                const state = EXPECTED_STATUS[expected.status];
                const isDueNow = dueNowExpected?.id === expected.id;
                return (
                  <tr key={expected.id} data-status={expected.status}>
                    <td className="portal-item-cell">
                      <strong className="portal-item-name">{expected.label}</strong>
                      {isDueNow ? <small className="portal-item-note">A transferir ahora</small> : null}
                      {expected.status === "PARTIAL" ? (
                        <small className="portal-expected-note">
                          Pagaste {formatMoney(expected.paidAmount)} · saldo {formatMoney(expected.remaining)}
                        </small>
                      ) : null}
                      {(expected.status === "AWAITING" || expected.status === "PARTIAL") && expected.reviewNote ? (
                        <small className="portal-expected-note">Observación: {expected.reviewNote}</small>
                      ) : null}
                    </td>
                    <td
                      className="portal-num"
                      data-label="Monto"
                      title={expected.status === "PARTIAL" ? `Total del concepto: ${formatMoney(expected.amount)} · pagado ${formatMoney(expected.paidAmount)}` : undefined}
                    >
                      {expected.status === "PARTIAL" ? formatMoney(expected.remaining) : formatMoney(expected.amount)}
                    </td>
                    <td data-label="Vencimiento">
                      {dueLabel(expected.dueAt)}
                      {expected.dueAt && expected.status !== "CONFIRMED" ? (
                        <span className="portal-countdown" data-tone={countdownTone(expected.dueAt)}>
                          {formatCountdown(expected.dueAt, "client")}
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Estado">
                      <span className="portal-chip" data-tone={state.tone}>
                        {state.label}
                      </span>
                      {expected.status === "CONFIRMED" && expected.confirmedAt ? (
                        <small className="portal-expected-note">
                          el {formatDateTime(expected.confirmedAt)}
                          {expected.confirmedByName ? ` · por ${expected.confirmedByName}` : ""}
                        </small>
                      ) : null}
                      {expected.status === "PROOF" ? (
                        <small className="portal-expected-note">El equipo de LedBox lo revisa: no hace falta hacer nada más.</small>
                      ) : null}
                      {expected.status === "CANCELLED" ? (
                        <small className="portal-expected-note">Ya no forma parte del plan de pagos.</small>
                      ) : null}
                    </td>
                    <td data-label="Cuenta destino">{expected.accountName ?? "Te la confirmamos al transferir"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : paymentPlan.installments.length > 0 ? (
        <div className="portal-table-wrap">
          <table className="portal-table portal-table--plan">
            <caption className="portal-table-caption">{itemsChanged ? "Cuotas provisionales · pendientes de revisión" : "Cuotas del plan"}</caption>
            <thead>
              <tr>
                <th scope="col">Cuota</th>
                <th scope="col" className="portal-num">
                  Monto
                </th>
                <th scope="col">Vencimiento</th>
              </tr>
            </thead>
            <tbody>
              {paymentPlan.advanceAmount > 0 ? (
                <tr>
                  <td>Anticipo{approved ? " (a transferir ahora)" : " (con la autorización)"}</td>
                  <td className="portal-num" data-label="Monto">{formatMoney(paymentPlan.advanceAmount)}</td>
                  <td data-label="Vencimiento">Con la autorización</td>
                </tr>
              ) : null}
              {paymentPlan.installments.map((installment, index) => (
                <tr key={`${installment.label}-${index}`}>
                  <td>
                    {installment.label}
                    {!itemsChanged && paymentPlan.advanceAmount === 0 && index === 0 ? " (a transferir ahora)" : ""}
                  </td>
                  <td className="portal-num" data-label="Monto">{formatMoney(installment.amount)}</td>
                  <td data-label="Vencimiento">
                    {installment.dueAt ? dueLabel(installment.dueAt) : installment.moment || "A coordinar"}
                    {installment.dueAt ? (
                      <span className="portal-countdown" data-tone={countdownTone(installment.dueAt)}>
                        {formatCountdown(installment.dueAt, "client")}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="portal-empty">{itemsChanged ? "Pago único provisional" : "El presupuesto se paga en un solo pago"}: {formatMoney(actionTotal)}.</p>
      )}

      {!provisionalPlanError && paymentPlan.pending > 0 ? (
        <p className="portal-help">
          Saldo sin cuota agendada: <span className="portal-num">{formatMoney(paymentPlan.pending)}</span>
        </p>
      ) : null}
      {paymentPlan.terms ? <div><h3 className="quote-document-subtitle">Condiciones de pago</h3><p className="quote-document-copy">{paymentPlan.terms}</p></div> : null}
      {!approved ? (
        <p className="portal-help">
          Los datos bancarios de {budget.organization} se muestran cuando autorices el presupuesto.
        </p>
      ) : null}
    </section>
  );

  const payCard = approved ? (
    <section className="portal-card portal-card--pay" aria-labelledby="portal-payment-data">
      <div className="portal-card-head">
        <PortalCardTitle id="portal-payment-data" icon="bank">
          Datos para transferir
        </PortalCardTitle>
      </div>
      {transferNow ? (
        <div className="portal-pay-now">
          <div>
            <span className="portal-pay-label">{transferNow.label}</span>
            <strong className="portal-pay-amount portal-num">{formatMoney(transferNow.amount)}</strong>
          </div>
          <span className="portal-pay-total portal-num">Total del presupuesto: {formatMoney(budget.total)}</span>
        </div>
      ) : budget.expectedPayments.length > 0 ? (
        <p className="portal-help">Ya confirmamos todos los pagos de este presupuesto: no queda nada por transferir.</p>
      ) : null}

      {budget.paymentDetails ? (
        <div className="portal-pay-grid">
          <div className="portal-bank" title={`Banco: ${budget.paymentDetails.bank ?? "—"}`}>
            {mark?.asset ? (
              <img className="portal-bank-asset" src={mark.asset} alt={`Logo de ${mark.label}`} />
            ) : (
              <span className="portal-bank-mark" style={{ background: mark?.color ?? "#0E5A8A" }} aria-hidden="true">
                {mark?.initials ?? "B"}
              </span>
            )}
            <span className="portal-bank-name">{mark?.label ?? "Datos de pago"}</span>
          </div>
          <dl className="portal-facts portal-facts--pay">
            <div>
              <dt>Titular</dt>
              <dd>{budget.paymentDetails.holder || "—"}</dd>
            </div>
            <div>
              <dt>RUC</dt>
              <dd>{budget.paymentDetails.ruc || "—"}</dd>
            </div>
            <div>
              <dt>Cuenta</dt>
              <dd>{budget.paymentDetails.account || "—"}</dd>
            </div>
            <div>
              <dt>Alias</dt>
              <dd>{budget.paymentDetails.alias || "—"}</dd>
            </div>
          </dl>
          <div className="portal-form-actions portal-print-hide">
            <button type="button" className="portal-btn portal-btn--ghost" onClick={() => void copyPaymentDetails()}>
              {copied ? "Datos copiados" : "Copiar datos de pago"}
            </button>
          </div>
          <p className="portal-help" aria-live="polite">
            {copied
              ? "Los datos quedaron en el portapapeles para pegarlos donde los necesites."
              : "Transferí el monto indicado y enviá el comprobante al equipo de LedBox."}
          </p>
        </div>
      ) : (
        <p className="portal-help">
          El equipo de LedBox todavía no cargó los datos bancarios de esta empresa. Escribinos y te los pasamos para
          completar el pago.
        </p>
      )}
    </section>
  ) : null;

  const proofCard = budget.proofUpload.allowed ? (
    <section className="portal-card portal-print-hide" aria-labelledby="portal-proof" ref={proofRef} tabIndex={-1}>
      <div className="portal-card-head">
        <PortalCardTitle id="portal-proof" icon="upload">
          Enviar comprobante
        </PortalCardTitle>
        <p className="portal-card-lead">
          Transferí el monto indicado y adjuntá el comprobante: JPG, PNG, WebP o PDF, hasta 2 MB. Indicá qué pago
          estás comprobando para que quede vinculado a ese concepto; el equipo de LedBox lo revisa desde el panel.
        </p>
      </div>
      <form className="portal-form" onSubmit={(event) => void submitProof(event)}>
        {openExpected.length > 0 ? (
          <label className="portal-field" htmlFor="portal-proof-concept">
            <span className="portal-field-label">¿Qué pago estás comprobando?</span>
            <select
              id="portal-proof-concept"
              name="proof-concept"
              value={proofExpectedId}
              onChange={(event) => {
                setProofExpectedId(event.target.value);
                setProofSent(false);
              }}
              required
            >
              <option value="">Elegí el concepto…</option>
              {openExpected.map((expected) => (
                <option key={expected.id} value={expected.id}>
                  {expected.label} · {formatMoney(expected.amount)}
                  {expected.status === "PROOF" ? " (en revisión)" : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="portal-form-row">
          <label className="portal-field" htmlFor="portal-proof-name">
            <span className="portal-field-label">Nombre y apellido</span>
            <input
              id="portal-proof-name"
              name="proof-name"
              value={proofName}
              onChange={(event) => {
                setProofName(event.target.value);
                setProofSent(false);
              }}
              maxLength={120}
              autoComplete="name"
              required
              aria-describedby="portal-proof-name-hint"
            />
            <span className="portal-help" id="portal-proof-name-hint">
              {contactName
                ? `Prellenado con el responsable de ${clientLabel}${contactRole ? ` · ${contactRole}` : ""}.`
                : `Escribí quién hizo la transferencia en nombre de ${clientLabel}.`}
            </span>
          </label>
          <label className="portal-field" htmlFor="portal-proof-file">
            <span className="portal-field-label">Comprobante</span>
            <input
              ref={proofInputRef}
              id="portal-proof-file"
              name="proof-file"
              type="file"
              accept={`${PAYMENT_PROOF_MIMES.join(",")},.jpg,.jpeg,.png,.webp,.pdf`}
              onChange={(event) => {
                setProofFile(event.target.files?.[0] ?? null);
                setProofError("");
                setProofSent(false);
              }}
              aria-describedby="portal-proof-hint"
              required
            />
          </label>
        </div>
        <p className="portal-help" id="portal-proof-hint">
          El archivo no se publica: solo lo ve el equipo de LedBox con su sesión del panel.
        </p>
        {proofError ? (
          <p className="portal-error" role="alert">
            {proofError}
          </p>
        ) : null}
        {proofSent ? (
          <p className="portal-ok" role="status">
            Recibimos tu comprobante. El equipo lo revisa y marca el cobro; vas a ver el estado en el plan de pagos.
          </p>
        ) : null}
        <button className="portal-btn portal-btn--primary" type="submit" disabled={proofBusy} aria-busy={proofBusy || undefined}>
          {proofBusy ? "Subiendo comprobante…" : "Enviar comprobante"}
        </button>
      </form>
    </section>
  ) : null;

  return (
    <article className={`portal-budget${canEdit ? " portal-budget--can-edit" : ""}`}>
      {demoBanner}

      <header className="portal-budget-head">
        <div className="portal-budget-head-top">
          {headTitle}
          <div className="portal-budget-chips">
            <span className="portal-chip" data-tone={statusTone(budget.status)}>
              {budgetStatusLabel(budget.status)}
            </span>
            <span className="portal-chip" data-tone={budgetApprovalTone(approvalState)}>
              {budgetApprovalLabel(approvalState)}
            </span>
            {pendingRequests.length > 0 && !approved ? (
              <span className="portal-chip" data-tone="warn">
                {formatNumber(pendingRequests.length)} {pendingRequests.length === 1 ? "pedido en revisión" : "pedidos en revisión"}
              </span>
            ) : null}
          </div>
        </div>
        {headFacts}
      </header>

      {approved ? (
        <section className="portal-banner portal-banner--ok portal-success" ref={approvedRef} tabIndex={-1} aria-labelledby="portal-approved">
          <h2 className="portal-banner-title" id="portal-approved">
            <AdminIcon name="check" size={16} />
            <span>{justApproved?.already ? "Este presupuesto ya estaba autorizado" : "¡Listo! Presupuesto autorizado"}</span>
          </h2>
          <p>
            {justApproved?.already
              ? "Registramos tu visita: la autorización original queda tal cual, sin cambios."
              : "Quedó registrada tu autorización. Estos son los próximos pasos:"}
          </p>
          <ol className="portal-success-steps">
            <li>
              <strong>El equipo de LedBox te contacta</strong> para coordinar el evento, los equipos y el montaje.
            </li>
            {transferNow ? (
              <li>
                <strong>
                  Transferí {transferNow.label.toLowerCase()} ({formatMoney(transferNow.amount)})
                </strong>{" "}
                y subí el comprobante desde esta misma página.
              </li>
            ) : null}
            <li>
              <strong>Descargá el presupuesto autorizado</strong> y guardalo para tus registros.
            </li>
          </ol>
          <dl className="portal-facts portal-facts--inline">
            <div>
              <dt>Autorizó</dt>
              <dd>{approvedByName ?? "—"}</dd>
            </div>
            <div>
              <dt>Fecha y hora</dt>
              <dd>{approvedAt ? formatDateTime(approvedAt) : "—"}</dd>
            </div>
            <div>
              <dt>Vía</dt>
              <dd>{budgetApprovalMethodLabel(approvalMethod)}</dd>
            </div>
          </dl>
          {budget.approval.note ? <p className="portal-banner-note">Comentario: {budget.approval.note}</p> : null}
          {pendingRequests.length > 0 ? (
            <p className="portal-banner-note">
              Enviaste {pendingRequests.map((request) => requestIntent(request)).join(" y ")} con la autorización: el equipo lo
              revisa y te confirma por este link. El presupuesto queda autorizado con los montos vigentes mientras tanto.
            </p>
          ) : null}
          <div className="portal-banner-actions portal-print-hide">
            <button type="button" className="portal-btn portal-btn--primary" onClick={() => window.print()}>
              Descargar el presupuesto (PDF)
            </button>
          </div>
        </section>
      ) : revisionPending ? (
        <section className="portal-banner portal-banner--warn" ref={revisionRef} tabIndex={-1} aria-labelledby="portal-revision">
          <h2 className="portal-banner-title" id="portal-revision">
            <AdminIcon name="edit" size={16} />
            <span>Pediste cambios</span>
          </h2>
          <p>
            Recibimos tu pedido{revisionAt ? ` el ${formatDateTime(revisionAt)}` : ""}. El equipo de LedBox lo revisa y te
            responde por este mismo link con una versión nueva; no hace falta que hagas nada más por ahora.
          </p>
          {revisionText ? <blockquote className="portal-banner-quote">{revisionText}</blockquote> : null}
        </section>
      ) : waitingRequest ? (
        <section className="portal-banner portal-banner--info" ref={revisionRef} tabIndex={-1} aria-labelledby="portal-waiting">
          <h2 className="portal-banner-title" id="portal-waiting">
            <AdminIcon name="clock" size={16} />
            <span>Tu pedido está en revisión</span>
          </h2>
          <p>
            Ya nos llegó {lastRequest ? requestIntent(lastRequest) : justRequested?.kind === "discount" ? "la rebaja" : "el ajuste"} y
            el equipo te responde por este link. Mientras esperás, podés autorizar abajo el presupuesto tal como está: la
            respuesta del equipo llega igual y no perdés tu lugar.
          </p>
          {lastRequest ? (
            <p className="portal-banner-note">
              Enviado el {formatDateTime(lastRequest.createdAt)}
              {lastRequest.note ? `: «${lastRequest.note}»` : "."}
            </p>
          ) : justRequested ? (
            <p className="portal-banner-note">
              Enviado el {formatDateTime(justRequested.at)}
              {justRequested.note ? `: «${justRequested.note}»` : "."}
            </p>
          ) : null}
        </section>
      ) : null}

      <PortalPending items={pendingItems} progress={paymentProgress} />

      <div className="portal-budget-grid">
        <div className="portal-budget-main">
          {/* Aprobado (issue #107): primero pago y plan; el scroll automático apunta acá. */}
          {approved ? (
            <div className="portal-pay-first" ref={payFirstRef}>
              {payCard}
              {paymentsCard}
              {proofCard}
            </div>
          ) : null}
          <section className="portal-card" aria-labelledby="portal-items">
            <div className="portal-card-head">
              <PortalCardTitle id="portal-items" icon="budgets">
                {canEdit ? "Ajustá tu presupuesto" : "Detalle del presupuesto"}
              </PortalCardTitle>
              {canEdit && budget.items.length > 0 ? (
                <p className="portal-card-lead">
                  Cambiá cantidades y días: el precio unitario queda fijo y el total se actualiza en vivo. Si dejás todo
                  igual, autorizás lo que te enviamos.
                </p>
              ) : null}
            </div>


            {budget.items.length === 0 ? (
              <p className="portal-empty">Este presupuesto no tiene ítems cargados.</p>
            ) : (
              <div className="portal-items-wrap">
                <table className="portal-table portal-table--items">
                  <thead>
                    <tr>
                      <th scope="col">Producto / servicio</th>
                      <th scope="col" className="portal-num">
                        Precio unitario
                      </th>
                      <th scope="col" className="portal-num">
                        Total
                      </th>
                      {canEdit ? <th scope="col" className="portal-item-action-cell"><span className="sr-only">Acción</span></th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {budget.items.map((item) => {
                      const current = !approved
                        ? draft[item.id] ?? { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) }
                        : { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) };
                      const changed = !approved && (current.quantity !== item.quantity || current.days !== item.days || Boolean(current.excluded) !== Boolean(item.excluded));
                      return (
                        <tr key={item.id} data-excluded={current.excluded ? "true" : undefined} data-changed={changed ? "true" : undefined}>
                          <td className="portal-item-cell">
                            <span className="portal-item-identity">
                              <PortalItemThumb imageUrl={item.imageUrl} />
                              <span className="portal-item-text">
                                <strong className="portal-item-name">{item.name}</strong>
                                {current.excluded ? <small className="portal-item-note">Retirado / no incluido</small> : null}
                                {item.notes ? <details><summary>Detalles</summary><p className="portal-item-note">{item.notes}</p></details> : null}
                                <div className="budget-client-quantity">
                                  <span>Cantidad</span>
                                  {canEdit && !current.excluded ? <Stepper value={current.quantity} max={MAX_QUANTITY} label={`Cantidad de ${item.name}`} onStep={(delta) => stepDraft(item.id, "quantity", delta)} onType={(text) => setDraftField(item.id, "quantity", text)} /> : <span>{formatNumber(item.quantity)}</span>}
                                  {item.usesDays || item.days > 1 ? <><span>Días</span>{canEdit && !current.excluded ? <Stepper value={current.days} max={MAX_DAYS} label={`Días de ${item.name}`} onStep={(delta) => stepDraft(item.id, "days", delta)} onType={(text) => setDraftField(item.id, "days", text)} /> : <span>{formatNumber(item.days)}</span>}</> : null}
                                </div>
                                {changed ? (
                                  <small className="portal-item-note">
                                    Antes: {formatNumber(item.quantity)} × {formatNumber(item.days)} d · subtotal{" "}
                                    {formatMoney(item.subtotal)}
                                  </small>
                                ) : null}
                              </span>
                            </span>
                          </td>
                          <td className="portal-num" data-label="Precio unitario">{formatMoney(item.unitPrice)}</td>
                          <td className={`portal-num${canEdit ? " portal-item-subtotal" : ""}`} data-label="Total">{formatMoney(current.excluded ? 0 : item.unitPrice * current.quantity * current.days)}</td>
                          {canEdit ? (
                            <td className="portal-item-action-cell">
                              <button
                                type="button"
                                className="portal-item-action"
                                title={`${current.excluded ? "Restaurar" : "Retirar"} ${item.name}`}
                                aria-label={`${current.excluded ? "Restaurar" : "Retirar"} ${item.name}`}
                                disabled={sending}
                                onClick={() => setDraft((rows) => ({ ...rows, [item.id]: { ...current, ...(!current.excluded ? { quantity: item.quantity, days: item.days } : {}), excluded: !current.excluded } }))}
                              >
                                <AdminIcon name={current.excluded ? "refresh" : "trash"} size={18} />
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="portal-totals">
              <div className="portal-total-row">
                <span>{itemsChanged ? "Subtotal con tus cambios" : "Subtotal"}</span>
                <span className="portal-num">{formatMoney(itemsChanged ? proposedSubtotal : budget.subtotal)}</span>
              </div>
              {budget.discount > 0 ? (
                <div className="portal-total-row">
                  <span>Descuento vigente</span>
                  <span className="portal-num">− {formatMoney(budget.discount)}</span>
                </div>
              ) : null}
            <div className="portal-total-row portal-total-row--strong">
              <span>{itemsChanged ? "Total con tus cambios" : "Total"}</span>
              <span className="portal-num">{formatMoney(summaryTotal)}</span>
            </div>
            <p className="portal-total-formula">
              Precio unitario × cantidad × días = subtotal · subtotal − descuento = total
            </p>
            </div>
            <p className="portal-help">
              Montos en guaraníes (PYG), sin decimales. {canEdit && itemsChanged ? "Los ajustes se revisan con tu autorización: el equipo aplica el precio unitario vigente." : ""}
            </p>
            {canEdit && itemsChanged ? (
              <div className="portal-form-actions">
                <button type="button" className="portal-btn portal-btn--ghost portal-btn--sm" onClick={resetDraft}>
                  Restablecer cantidades
                </button>
              </div>
            ) : null}
          </section>

          {budget.notes ? (
            <section className="portal-card quote-document-section--observations" aria-labelledby="portal-observations">
              <PortalCardTitle id="portal-observations" icon="edit">Observaciones</PortalCardTitle>
              <p className="quote-document-copy">{budget.notes}</p>
            </section>
          ) : null}

          {budget.deliveryAt || budget.ivaType || budget.warranty || budget.validUntil ? (
            <section className="portal-card quote-document-section--conditions" aria-labelledby="portal-terms">
              <div className="portal-card-head">
                <PortalCardTitle id="portal-terms" icon="plan">
                  Condiciones de la propuesta
                </PortalCardTitle>
              </div>
              <dl className="portal-facts portal-facts--pay">
                {budget.deliveryAt ? (
                  <div>
                    <dt>Entrega</dt>
                    <dd>{formatDate(budget.deliveryAt)}</dd>
                  </div>
                ) : null}
                {budget.ivaType ? (
                  <div>
                    <dt>IVA</dt>
                    <dd>{invoiceTaxTypeLabel(budget.ivaType)}</dd>
                  </div>
                ) : null}
                {budget.validUntil ? (
                  <div>
                    <dt>Válida hasta</dt>
                    <dd>{formatDate(budget.validUntil)}</dd>
                  </div>
                ) : null}
              </dl>
              {budget.warranty ? (
                <p className="portal-note">
                  <strong>Garantía:</strong> {budget.warranty}
                </p>
              ) : null}
            </section>
          ) : null}

          <PortalQuoteResources budget={budget} token={token} />

          {!approved && !revisionPending ? (
        <section className="portal-card portal-card--action" aria-labelledby="portal-action" ref={actionRef}>
          <div className="portal-card-head">
                <div className="portal-action-heading">
                  <PortalCardTitle id="portal-action" icon="check">
                    Tu decisión
                  </PortalCardTitle>
                  <span className="portal-action-step">Paso 2 de 3</span>
                </div>
                <p className="portal-card-lead">
                  {canEdit
                    ? "Autorizá el presupuesto tal como queda (con tus ajustes, si los hiciste) o pedí una rebaja o un cambio: el equipo responde por este mismo link."
                    : "Mientras revisamos tu pedido podés autorizar el presupuesto tal como está; no perdés la respuesta del equipo."}
                </p>
              </div>

              <ol className="portal-decision-progress" aria-label="Progreso de tu decisión">
                <li data-active="true"><span>1</span> Revisar</li>
                <li data-active={actionMode !== "authorize" || consent ? "true" : undefined}><span>2</span> Elegir</li>
                <li data-active={sending ? "true" : undefined}><span>3</span> Confirmar</li>
              </ol>

              <form className="portal-form" onSubmit={(event) => void runAction(event)}>
                {canEdit ? (
                  <>
                    <PortalDecisionOptions value={mode} options={decisionOptions} onChange={setMode} />
                    <p className="portal-action-intent" role="status">
                      {actionMode === "authorize" ? (
                        <>
                          {itemsChanged || pendingRequests.some((request) => request.kind === "items") ? "Vas a solicitar revisión por " : "Vas a autorizar por "}<strong className="portal-num">{formatMoney(actionTotal)}</strong>{" "}
                          {itemsChanged
                            ? `con ${formatNumber(draftChanges.length)} ${draftChanges.length === 1 ? "ítem ajustado" : "ítems ajustados"}`
                            : "tal como está el presupuesto"}
                          .
                        </>
                      ) : actionMode === "discount" ? (
                        discountError ? (
                          <span className="portal-error" role="alert">
                            {discountError}
                          </span>
                        ) : discountAmount > 0 ? (
                          <>
                            Vas a pedir una rebaja de <strong className="portal-num">{formatMoney(discountAmount)}</strong>
                            {discountType === "percent" ? ` (${formatNumber(discountNumber)} %)` : ""}. Si el equipo la acepta,
                            el total queda en <strong className="portal-num">{formatMoney(discountTotal)}</strong>.
                          </>
                        ) : (
                          <>Vas a pedir una rebaja sobre el total vigente de {formatMoney(budget.total)}.</>
                        )
                      ) : (
                        <>Vas a enviar un pedido de cambio: el equipo te responde con una versión nueva del presupuesto.</>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="portal-action-intent" role="status">
                    {itemsChanged || pendingRequests.some((request) => request.kind === "items") ? "Vas a solicitar revisión por " : "Vas a autorizar por "}<strong className="portal-num">{formatMoney(budget.total)}</strong> tal como está el
                    presupuesto.
                  </p>
                )}

                <label className="portal-field" htmlFor="portal-name">
                  <span className="portal-field-label">Nombre y apellido de quien autoriza o pide</span>
                  <input
                    id="portal-name"
                    name="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={120}
                    autoComplete="name"
                    required
                    aria-describedby="portal-name-hint"
                  />
                  <span className="portal-help" id="portal-name-hint">
                    {nameHint}
                  </span>
                </label>

                {canEdit && actionMode === "discount" ? (
                  <div className="portal-form-row portal-form-row--discount">
                    <label className="portal-field" htmlFor="portal-discount-value">
                      <span className="portal-field-label">{discountType === "percent" ? "Porcentaje (0–100)" : "Monto en guaraníes"}</span>
                      <input
                        ref={discountInputRef}
                        id="portal-discount-value"
                        name="discount-value"
                        type="text"
                        inputMode={discountType === "percent" ? "decimal" : "numeric"}
                        value={discountType === "percent" ? discountValue : moneyInputDisplay(discountValue)}
                        onKeyDown={(event) => {
                          if (event.ctrlKey || event.metaKey || event.altKey) return;
                          const permitido = discountType === "percent" ? /^[\d,]$/ : /^\d$/;
                          if (event.key.length === 1 && !permitido.test(event.key)) event.preventDefault();
                        }}
                        onChange={(event) => {
                          if (discountType === "percent") {
                            setDiscountValue(percentInput(event.target.value));
                            return;
                          }
                          // El formateo no mueve el caret (mismo criterio que MoneyField).
                          const input = event.currentTarget;
                          const before = input.value.slice(0, input.selectionStart ?? input.value.length);
                          const digitsBefore = (before.match(/\d/g) || []).length;
                          setDiscountValue(amountInput(input.value));
                          requestAnimationFrame(() => {
                            const node = discountInputRef.current;
                            if (!node || document.activeElement !== node) return;
                            const caret = caretAfterDigits(node.value, digitsBefore);
                            node.setSelectionRange?.(caret, caret);
                          });
                        }}
                        maxLength={discountType === "percent" ? 6 : moneyInputMaxLength()}
                        placeholder={discountType === "percent" ? "Ej.: 10" : "Ej.: 500000"}
                        aria-invalid={discountError ? true : undefined}
                        title={discountError ?? undefined}
                        required
                      />
                    </label>
                    <div className="portal-field portal-field--choice">
                      <span className="portal-field-label" id="portal-discount-type-label">Tipo de rebaja</span>
                      <PortalSegmented
                        label="Tipo de rebaja"
                        value={discountType}
                        onChange={(next) => {
                          setDiscountType(next);
                          setDiscountValue("");
                        }}
                        options={[
                          { value: "percent", label: "Porcentaje" },
                          { value: "amount", label: "Monto" },
                        ]}
                      />
                    </div>
                  </div>
                ) : null}

                <label className="portal-field" htmlFor="portal-note">
                  <span className="portal-field-label">
                    {actionMode === "authorize" ? "Comentario (opcional)" : actionMode === "discount" ? "Motivo de la rebaja" : "¿Qué cambios necesitás?"}
                  </span>
                  <textarea
                    id="portal-note"
                    name="note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={MAX_NOTE}
                    rows={actionMode === "authorize" ? 2 : 3}
                    required={actionMode !== "authorize"}
                    placeholder={
                      actionMode === "authorize"
                        ? "Algo que quieras aclarar con la autorización"
                        : actionMode === "discount"
                          ? "Ej.: somos una ONG y el evento es benéfico"
                          : "Ej.: necesito cambiar la fecha de montaje y sumar un equipo de sonido"
                    }
                  />
                </label>

                {actionMode === "authorize" ? (
                  <>
                    <label className="portal-consent" htmlFor="portal-consent">
                      <input
                        id="portal-consent"
                        type="checkbox"
                        checked={consent}
                        onChange={(event) => setConsent(event.target.checked)}
                        aria-describedby="portal-consent-hint portal-consent-purpose"
                        required
                      />
                      <span id="portal-consent-hint">
                        {itemsChanged || pendingRequests.some((request) => request.kind === "items") ? "Confirmo que solicito revisar esta selección propuesta por " : "Confirmo que revisé el detalle, los montos y las condiciones, y autorizo este presupuesto por "}
                        <strong className="portal-num">{formatMoney(actionTotal)}</strong> en nombre de {clientLabel}.
                      </span>
                    </label>
                    {/* Finalidad en texto claro + política (issue #93): el consentimiento
                        ya queda auditado con nombre, fecha/hora e IP; acá solo se informa. */}
                    <p className="portal-consent-purpose" id="portal-consent-purpose">
                      Finalidad: registrar tu solicitud o autorización y su evidencia (nombre, fecha, hora e IP).{" "}
                      Consultá la{" "}
                      <a href={privacyPolicyUrl()} target="_blank" rel="noreferrer">
                        política de privacidad
                      </a>
                      .
                    </p>
                  </>
                ) : (
                  <p className="portal-help">
                    Nada se aplica solo: el equipo revisa tu pedido y te responde con una versión nueva o una contra-oferta por
                    este mismo link.
                  </p>
                )}

                {actionError ? (
                  <p className="portal-error" role="alert">
                    {actionError}
                  </p>
                ) : null}

                <button
                  className="portal-btn portal-btn--primary portal-btn--block"
                  type="submit"
                  disabled={sending}
                  aria-busy={sending || undefined}
                >
                  {sending ? <span className="portal-spinner" aria-hidden="true" /> : null}
                  <span>{sending ? "Enviando…" : actionMode === "authorize" ? (itemsChanged || pendingRequests.some((request) => request.kind === "items") ? "Enviar selección para revisión" : `Autorizar por ${formatMoney(actionTotal)}`) : ACTION_BUTTON[actionMode]}</span>
                </button>
                <p className="portal-submit-state" role="status" aria-live="polite">
                  {sending
                    ? "Estamos registrando tu respuesta de forma segura."
                    : actionMode === "authorize"
                      ? "Tu autorización queda registrada con tu nombre y la fecha de envío."
                      : "Tu pedido queda en revisión y no modifica el presupuesto por sí solo."}
                </p>
              </form>
            </section>
          ) : null}

          {approved ? null : paymentsCard}

          {approved ? null : proofCard}

          <section className="portal-card quote-document-section--issuer" aria-labelledby="portal-issuer">
            <PortalCardTitle id="portal-issuer" icon="building">Emitido por</PortalCardTitle>
            <p className="quote-document-copy"><strong>{budget.organization}</strong></p>
            <p className="portal-help">La firma electrónica, cuando corresponda, se realiza en un proceso separado.</p>
          </section>


          {budget.proofs.length > 0 ? (
            <section className="portal-card" aria-labelledby="portal-proofs">
              <PortalCardTitle id="portal-proofs" icon="receipt">
                Tus comprobantes
              </PortalCardTitle>
              <ul className="portal-proofs">
                {budget.proofs.map((proof) => (
                  <li key={proof.id} className="portal-proof">
                    <span className="portal-chip" data-tone={PROOF_STATUS[proof.status].tone}>
                      {PROOF_STATUS[proof.status].label}
                    </span>
                    <span className="portal-proof-main">
                      <strong className="portal-proof-when">{formatDateTime(proof.createdAt)}</strong>
                      <span className="portal-proof-meta">
                        {paymentProofMimeLabel(proof.mime)} · {formatBytes(proof.size)} · {proof.uploadedByName}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {proofUploadHint(budget) ? <p className="portal-help">{proofUploadHint(budget)}</p> : null}
            </section>
          ) : null}

          {budget.requests.length > 0 ? (
            <section className="portal-card" aria-labelledby="portal-requests">
              <PortalCardTitle id="portal-requests" icon="edit">
                Tus pedidos
              </PortalCardTitle>
              <ul className="portal-requests">
                {budget.requests.map((request) => (
                  <li key={request.id} className="portal-request" data-status={request.status}>
                    <div className="portal-request-head">
                      <span className="portal-chip" data-tone={budgetChangeStatusTone(request.status)}>
                        {budgetChangeStatusLabel(request.status)}
                      </span>
                      <strong className="portal-request-kind">{budgetChangeKindLabel(request.kind)}</strong>
                      <span className="portal-request-when">{formatDateTime(request.createdAt)}</span>
                    </div>
                    {requestSummary(request) ? <p className="portal-request-summary">{requestSummary(request)}</p> : null}
                    {request.note ? <p className="portal-request-note">Motivo: {request.note}</p> : null}
                    {request.status !== "pending" && request.responseNote ? (
                      <p className="portal-request-response">
                        Respuesta del equipo{request.resolvedByName ? ` (${request.resolvedByName})` : ""}
                        {request.resolvedAt ? ` el ${formatDateTime(request.resolvedAt)}` : ""}: {request.responseNote}
                      </p>
                    ) : request.status === "accepted" ? (
                      <p className="portal-request-response">
                        El equipo aplicó tu pedido{request.resolvedAt ? ` el ${formatDateTime(request.resolvedAt)}` : ""}.
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {timeline}

          <section className="portal-card portal-help-card" aria-labelledby="portal-help">
            <PortalCardTitle id="portal-help" icon="info">
              ¿Necesitás algo más?
            </PortalCardTitle>
            <p className="portal-card-lead">
              Escribinos respondiendo el correo con el que te enviamos este presupuesto y citá el Nº {budget.reference}: el
              equipo de LedBox te contesta por el mismo canal.
            </p>
            <ul className="portal-help-list">
              {!approved ? (
                <li>
                  <strong>Autorizar o pedir un cambio:</strong> desde el bloque de decisión de esta página, con el nombre de
                  quien decide.
                </li>
              ) : null}
              {pendingRequests.length > 0 ? (
                <li>
                  <strong>Tus pedidos:</strong> el equipo de LedBox los revisa y te responde por este mismo link.
                </li>
              ) : null}
              <li>
                <strong>Pagos:</strong> el plan y los datos para transferir están en esta misma página.
                {budget.proofUpload.allowed ? " El comprobante se sube desde acá." : ""}
              </li>
              <li>
                <strong>Responsable registrado:</strong> {contactName ? `${contactName}${contactRole ? ` · ${contactRole}` : ""}` : "todavía no cargamos un responsable para tu empresa."}
              </li>
            </ul>
          </section>
        </div>

        <aside className="portal-budget-aside" aria-labelledby="portal-summary">
          <div className="portal-card portal-summary">
            <PortalCardTitle id="portal-summary" icon="overview">
              Resumen
            </PortalCardTitle>
            <p className="portal-summary-client">{clientLabel}</p>
            <div className="portal-budget-chips">
              <span className="portal-chip" data-tone={budgetApprovalTone(approvalState)}>
                {budgetApprovalLabel(approvalState)}
              </span>
              {/* Con el presupuesto aprobado la vigencia dejó de correr: se
                  esconde la cuenta (issue #107), el dato queda en el resumen. */}
              {!approved && budget.validUntil ? (
                <span className="portal-countdown" data-tone={countdownTone(budget.validUntil)}>
                  {formatCountdown(budget.validUntil, "client")}
                </span>
              ) : null}
            </div>
            <div className="portal-totals portal-totals--aside">
              <div className="portal-total-row portal-total-row--strong">
                <span>{itemsChanged ? "Total con tus cambios" : "Total"}</span>
                <span className="portal-num">{formatMoney(summaryTotal)}</span>
              </div>
            </div>
            <details className="portal-disclosure portal-disclosure--inner">
              <summary>
                <span>Detalle del resumen</span>
              </summary>
              <div className="portal-disclosure-body">
                <dl className="portal-facts portal-facts--aside">
                  <div>
                    <dt>Ítems</dt>
                    <dd>{formatNumber(budget.items.length)} en el detalle</dd>
                  </div>
                  <div>
                    <dt>Evento</dt>
                    <dd>{budget.event?.name || "Sin evento asociado"}</dd>
                  </div>
                  <div>
                    <dt>Lugar</dt>
                    <dd>{budget.event?.location || "—"}</dd>
                  </div>
                  <div>
                    <dt>Válido hasta</dt>
                    <dd>{budget.validUntil ? formatDate(budget.validUntil) : "Sin fecha de vencimiento"}</dd>
                  </div>
                </dl>
                {budget.discount > 0 || (!approved && budget.subtotal !== summaryTotal) ? (
                  <div className="portal-totals portal-totals--aside">
                    <div className="portal-total-row">
                      <span>Subtotal</span>
                      <span className="portal-num">{formatMoney(itemsChanged ? proposedSubtotal : budget.subtotal)}</span>
                    </div>
                    {budget.discount > 0 ? (
                      <div className="portal-total-row">
                        <span>Descuento</span>
                        <span className="portal-num">− {formatMoney(budget.discount)}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </details>
            {approved && transferNow ? (
              <div className="portal-pay-now portal-pay-now--aside">
                <span className="portal-pay-label">{transferNow.label}</span>
                <strong className="portal-pay-amount portal-num">{formatMoney(transferNow.amount)}</strong>
                <span className="portal-help">Transferí este monto y subí el comprobante.</span>
              </div>
            ) : null}
            {!approved && !revisionPending ? (
              <button
                type="button"
                className="portal-btn portal-btn--primary portal-btn--block portal-print-hide"
                onClick={() => actionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                aria-controls="portal-action"
              >
                Ir a la decisión
              </button>
            ) : null}
          </div>
        </aside>
      </div>
      {canEdit && actionBelowViewport && !footerVisible ? (
        <div className="portal-mobile-sticky" role="region" aria-label="Decisión y total">
          <div className="portal-mobile-sticky-total">
            <span>{itemsChanged ? "Total con tus cambios" : "Total actual"}</span>
            <strong className="portal-num">{formatMoney(actionTotal)}</strong>
            {budget.validUntil ? (
              <small className="portal-mobile-sticky-due" data-tone={countdownTone(budget.validUntil)}>
                {formatCountdown(budget.validUntil, "client")}
              </small>
            ) : null}
          </div>
          <button
            type="button"
            className="portal-btn portal-btn--primary portal-mobile-sticky-action"
            onClick={() => actionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            aria-controls="portal-action"
          >
            Ver decisión
          </button>
        </div>
      ) : null}
    </article>
  );
}
