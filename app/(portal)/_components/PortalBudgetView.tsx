"use client";
import { clientDisplayName } from "@/lib/client-identity";
import { budgetBalance, budgetCollectionStep } from "@/lib/budget-collection-step";
import { AdminAvatar } from "@/components/admin/AdminAvatar";
import { resolveBudgetPaymentPlan } from "@/lib/budget-payment-plan";

import { PortalQuoteResources } from "./PortalQuoteResources";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AdminIcon } from "@/components/admin/AdminIcons";
import {
  budgetChangeKindLabel,
  budgetChangeStatusLabel,
  budgetChangeStatusTone,
  countdownTone,
  formatBytes,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  invoiceTaxTypeLabel,
  paymentProofMimeLabel,
} from "@/lib/admin-format";
import { bankMark } from "@/lib/bank-mark";
import { BankLogo } from "@/components/admin/BankLogo";
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
import { portalItemLine } from "@/lib/quote-selection";
import type { PackageSummary } from "@/lib/price-tiers";
import { PortalCardTitle } from "./PortalCardTitle";
import { PortalNextStep } from "./PortalNextStep";
import type { AdminTone } from "@/lib/admin-format";
import type { AdminIconName } from "@/lib/admin-types";
import {
  portalApprovalByline,
  portalBudgetClosed,
  portalExpired,
  portalHeadDates,
  portalStage,
  portalStatusChip,
  portalTransferDestination,
} from "@/lib/portal-view";

/**
 * Vista pública del presupuesto (issue #12), rediseñada el 13-10-2026 para que
 * sea «más entendible». El cliente la lee de arriba abajo: encabezado (empresa,
 * nº, título y UN estado), «Qué tenés que hacer ahora» con la única acción
 * pendiente, «Pagar» (una sola sección: cuánto falta, datos bancarios,
 * comprobante y plan), detalle, condiciones, decisión, documentos, cronología
 * plegada y contacto. En escritorio, columna de lectura de ~720 px más una
 * columna lateral pegajosa con total, saldo y acción; en celular, la acción
 * principal queda fija abajo mientras haya algo pendiente.
 *
 * Qué ve el cliente en cada estado lo deciden las reglas puras de
 * `lib/portal-view.ts` (etapa, estado único, fechas sin contradicciones, destino
 * de la transferencia); acá solo se dibujan. Nada de lo que se expone cambia.
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
 * Autorizado el presupuesto desaparecen los editores y los pedidos nuevos: la
 * página queda en solo lectura (estado, pago, cronología y la impresión del
 * navegador). Lo mismo vale para una petición ya enviada.
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
/** Paquete (combo): precio del paquete, suma de sus piezas por separado y ahorro. Solo con precios completos. */
function PortalPackageNote({ summary, quantity }: { summary: PackageSummary; quantity: number }) {
  if (summary.incomplete || summary.packageTotal <= 0) return null;
  return (
    <small className="portal-item-note portal-package-note" data-testid="portal-package">
      Paquete: {formatMoney(summary.packageTotal)} por unidad · piezas por separado: {formatMoney(summary.unitSum)}
      {summary.savings > 0 ? <> · <strong>ahorrás {formatMoney(summary.savings * quantity)}</strong></> : null}
    </small>
  );
}

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
  /** Datos del evento (servidor); sin evento asociado no se dibuja nada. */
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
  const proofRef = useRef<HTMLDivElement | null>(null);
  /** Bloque de pago post-aprobación (issue #107): destino del scroll al confirmar. */
  const payFirstRef = useRef<HTMLElement | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const discountInputRef = useRef<HTMLInputElement | null>(null);
  const [targetOffscreen, setTargetOffscreen] = useState(false);
  const [footerVisible, setFooterVisible] = useState(false);

  const approved = Boolean(budget.approval.approvedAt) || Boolean(justApproved);
  const revisionPending = !approved && (Boolean(budget.approval.revisionRequestedAt) || justRequested?.kind === "change");
  const pendingRequests = budget.requests.filter((request) => request.status === "pending");
  /** Pedido ya enviado y esperando respuesta (rebaja o ajuste de ítems). */
  const waitingRequest = !approved && !revisionPending && (pendingRequests.length > 0 || Boolean(justRequested));
  /** El cliente todavía no envió nada: puede ajustar, autorizar o pedir. */
  const canEdit = !approved && !revisionPending && !pendingRequests.some((request) => request.kind !== "items") && (!justRequested || justRequested.kind === "items");

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
  const collectionStep = budgetCollectionStep({ total: budget.total, collected: budget.collectedAmount ?? 0, advanceAmount: budget.paymentPlan.advanceAmount, expectedPayments: budget.expectedPayments });
  const dueNowExpected = collectionStep.concept;
  const persistedPaymentPlan = budget.paymentPlan;
  /**
   * Qué se transfiere ahora: con pagos esperados manda el primer concepto abierto
   * (el que el plan muestra como «a transferir ahora»); sin ellos, lo dice el plan.
   * Si ya no queda nada abierto, no hay monto a transferir.
   */
  const transferNow = collectionStep.kind !== "payment" ? null : budget.expectedPayments.length > 0
    ? dueNowExpected
      ? {
          label: dueNowExpected.label,
          // De una seña se transfiere el saldo, no el total del concepto (#129).
          amount: collectionStep.amount,
        }
      : null
    : { label: collectionStep.label.replace(/^Cobrar /, ""), amount: collectionStep.amount };

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
  const draftChanges = useMemo(() => changedItems(budget, draft), [budget, draft]);
  /** Solo el cliente que todavía decide ajusta cantidades: aprobado o en revisión se lee. */
  const itemsChanged = !approved && draftChanges.length > 0;

  const proposedSubtotal = useMemo(
    () =>
      budget.items.reduce((sum, item) => {
        const current = draft[item.id] ?? { quantity: item.quantity, days: item.days, excluded: Boolean(item.excluded) };
        return sum + portalItemLine(item, current).total;
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

  // ── Qué ve el cliente según el estado real (lib/portal-view.ts) ─────────────
  /** Perdido o cancelado y sin aprobar: nada para decidir ni pagar. */
  const closed = !approved && portalBudgetClosed(budget.status);
  const expired = portalExpired(budget.validUntil, approved, budget.status);
  const stage = portalStage({
    approved,
    status: budget.status,
    waiting: waitingRequest || revisionPending,
    collection: collectionStep.kind,
    hasTransfer: Boolean(transferNow),
  });
  const statusChip = portalStatusChip({ approved, status: budget.status, revisionPending, waitingRequest, expired });
  const headDates = portalHeadDates({
    approved,
    approvedAt,
    status: budget.status,
    createdAt: budget.createdAt,
    validUntil: budget.validUntil,
  });
  const destination = portalTransferDestination(budget.paymentDetails);
  /** La decisión (autorizar, rebaja o cambio) solo existe mientras el presupuesto está en juego. */
  const decisionVisible = !approved && !revisionPending && !closed;
  /** Saldo real del presupuesto: total menos lo cobrado (un comprobante en revisión no resta). */
  const balance = budgetBalance({ total: budget.total, collected: budget.collectedAmount ?? 0 });
  /** Sección a la que lleva la acción principal fija en celular; sin pendiente, no hay barra. */
  const stickyKind: "authorize" | "pay" | null = stage === "authorize" && decisionVisible ? "authorize" : stage === "pay" ? "pay" : null;

  useEffect(() => {
    if (!stickyKind) {
      setTargetOffscreen(false);
      setFooterVisible(false);
      return;
    }
    const target = stickyKind === "pay" ? payFirstRef.current : actionRef.current;
    if (!target) return;
    const footer = document.querySelector<HTMLElement>(".app-footer--portal");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const rect = entry.boundingClientRect;
          const visible = rect.bottom > 0 && rect.top < window.innerHeight;
          if (entry.target === target) setTargetOffscreen(!visible);
          if (entry.target === footer) setFooterVisible(visible);
        }
      },
      { threshold: 0 },
    );
    observer.observe(target);
    if (footer) observer.observe(footer);
    return () => observer.disconnect();
  }, [stickyKind]);

  /** Conceptos con comprobante enviado y todavía sin confirmar por el equipo. */
  const proofsInReview = budget.expectedPayments.filter((expected) => expected.status === "PROOF");

  /** La única cosa pendiente del cliente, en palabras simples. */
  const nextStep: { icon: AdminIconName; tone: AdminTone; title: string; detail: string; cta?: { label: string; href: string } } = (() => {
    switch (stage) {
      case "authorize":
        return {
          icon: "check",
          tone: expired ? "danger" : "accent",
          title: itemsChanged ? "Enviá tu selección para revisión" : `Autorizá el presupuesto por ${formatMoney(actionTotal)}`,
          detail: expired
            ? `Esta oferta venció el ${formatDate(budget.validUntil)}. Pedí un cambio para que el equipo la actualice, o autorizala tal como está.`
            : "Revisá el detalle y autorizalo, o pedí una rebaja o un cambio. El equipo te responde por este mismo link.",
          cta: { label: "Ir a la decisión", href: "#portal-action" },
        };
      case "waiting":
        return {
          icon: "clock",
          tone: "info",
          title: "Tu pedido está en revisión",
          detail: revisionPending
            ? "No tenés que hacer nada más por ahora: el equipo de LedBox te responde por este mismo link con una versión nueva."
            : "No tenés que hacer nada más por ahora: el equipo de LedBox te responde por este link. Mientras tanto podés autorizar el presupuesto tal como está.",
        };
      case "closed":
        return {
          icon: "info",
          tone: "neutral",
          title: budget.status === "CANCELLED" ? "Este presupuesto fue cancelado" : "Este presupuesto ya no está vigente",
          detail: "No hay nada para hacer acá. Si querés retomarlo, escribinos respondiendo el correo con el que te lo enviamos.",
        };
      case "pay":
        return {
          icon: "bank",
          tone: "accent",
          title: `Transferí ${formatMoney(transferNow?.amount ?? balance)}`,
          detail: `${transferNow?.label ?? "Pago"} · después subí el comprobante. Abajo están los datos para transferir.${proofsInReview.length > 0 ? ` ${proofsInReview.length === 1 ? `Tu comprobante de ${proofsInReview[0]?.label}` : `Tus ${formatNumber(proofsInReview.length)} comprobantes`} sigue en revisión.` : ""}`,
          cta: { label: "Ver cómo pagar", href: "#portal-pay" },
        };
      case "review":
        return {
          icon: "clock",
          tone: "info",
          title: "Tu comprobante está en revisión",
          detail: "El equipo de LedBox confirma el cobro. No tenés que hacer nada más por ahora.",
        };
      case "coordinate":
        return {
          icon: "info",
          tone: "info",
          title: "El equipo de LedBox coordina el pago con vos",
          detail: `Todavía queda un saldo de ${formatMoney(balance)}, pero no hay un concepto abierto para transferir. Si tenés dudas, escribinos.`,
        };
      default:
        return {
          icon: "check",
          tone: "ok",
          title: "No tenés nada pendiente",
          detail: "El cobro registrado cubre el total del presupuesto. Si algo cambia, te avisamos por el correo con el que te lo enviamos.",
        };
    }
  })();

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

  // ── Pagos ───────────────────────────────────────────────────────────────────
  /** Cuántos conceptos tiene el plan: el pliegue solo existe si hay más de uno. */
  const planCount = budget.expectedPayments.length > 0 ? budget.expectedPayments.length : (paymentPlan.advanceAmount > 0 ? 1 : 0) + paymentPlan.installments.length;

  /** Plan real del presupuesto aprobado: cada concepto con su estado, sin cuentas internas. */
  const expectedList = (
    <ul className="portal-plan-list" aria-label="Tus pagos">
      {budget.expectedPayments.map((expected) => {
        const state = EXPECTED_STATUS[expected.status];
        const isDueNow = dueNowExpected?.id === expected.id;
        return (
          <li key={expected.id} className="portal-plan-row" data-status={expected.status}>
            <span className="portal-plan-main">
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
              {expected.status === "CONFIRMED" && expected.confirmedAt ? (
                <small className="portal-expected-note">Confirmado el {formatDateTime(expected.confirmedAt)}</small>
              ) : null}
              {expected.status === "CANCELLED" ? <small className="portal-expected-note">Ya no forma parte del plan.</small> : null}
            </span>
            <span
              className="portal-plan-amount portal-num"
              title={expected.status === "PARTIAL" ? `Total del concepto: ${formatMoney(expected.amount)} · pagado ${formatMoney(expected.paidAmount)}` : undefined}
            >
              {expected.status === "PARTIAL" ? formatMoney(expected.remaining) : formatMoney(expected.amount)}
            </span>
            <span className="portal-plan-due">
              {dueLabel(expected.dueAt)}
              {expected.dueAt && expected.status !== "CONFIRMED" && expected.status !== "CANCELLED" ? (
                <span className="portal-countdown" data-tone={countdownTone(expected.dueAt)}>
                  {formatCountdown(expected.dueAt, "client")}
                </span>
              ) : null}
            </span>
            <span className="portal-chip portal-plan-state" data-tone={state.tone}>
              {state.label}
            </span>
          </li>
        );
      })}
    </ul>
  );

  /** Cuotas del plan acordado (o provisional, con los ajustes del cliente) cuando no hay pagos esperados. */
  const installmentsTable = (
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
  );

  const planContent = provisionalPlanError ? (
    <p className="portal-error" role="alert">La selección requiere revisar las condiciones de pago: {provisionalPlanError} La oferta vigente no se modificó.</p>
  ) : !itemsChanged && budget.expectedPayments.length > 0 ? (
    expectedList
  ) : paymentPlan.installments.length > 0 ? (
    installmentsTable
  ) : (
    <p className="portal-empty">{itemsChanged ? "Pago único provisional" : "Se paga en un solo pago"}: {formatMoney(actionTotal)}.</p>
  );

  const planNotes = (
    <>
      {!provisionalPlanError && paymentPlan.pending > 0 && (!approved || collectionStep.kind !== "complete") ? (
        <p className="portal-help">
          Saldo sin cuota agendada: <span className="portal-num">{formatMoney(paymentPlan.pending)}</span>
        </p>
      ) : null}
      {paymentPlan.terms ? <div><h3 className="quote-document-subtitle">Condiciones de pago</h3><p className="quote-document-copy">{paymentPlan.terms}</p></div> : null}
    </>
  );

  /** Sin aprobar: el plan propuesto queda con las condiciones. Aprobado: vive dentro de «Pagar». */
  const paymentsCard = closed ? null : (
    <section className="portal-card quote-document-section--payments" aria-labelledby="portal-payments" data-plan-preview={itemsChanged ? "provisional" : "current"}>
      <div className="portal-card-head">
        <PortalCardTitle id="portal-payments" icon="wallet">
          Plan de pagos propuesto
        </PortalCardTitle>
        <p className="portal-card-lead">
          {itemsChanged
            ? "Vista previa de tu selección: no está aceptada hasta que el equipo la revise."
            : "Los datos bancarios de " + budget.organization + " aparecen cuando autorices el presupuesto."}
        </p>
      </div>
      {planContent}
      {planNotes}
    </section>
  );

  /** Comprobantes ya enviados, con el estado real de cada uno. */
  const proofsList = budget.proofs.length > 0 ? (
    <div className="portal-pay-block" aria-labelledby="portal-proofs">
      <h3 className="quote-document-subtitle" id="portal-proofs">Comprobantes enviados</h3>
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
    </div>
  ) : null;

  const proofFormVisible = collectionStep.kind !== "complete" && budget.proofUpload.allowed;

  /**
   * «Pagar» (una sola sección, aprobado): 1) cuánto falta y para qué concepto,
   * 2) datos bancarios con copiar, 3) subir el comprobante, 4) el plan de pagos
   * (plegable solo si tiene más de un concepto). Antes se repetía en cinco bloques.
   */
  const payCard = approved ? (
    <section className="portal-card portal-card--pay" id="portal-pay" aria-labelledby="portal-pay-title" ref={payFirstRef} tabIndex={-1}>
      <div className="portal-card-head">
        <PortalCardTitle id="portal-pay-title" icon="bank">
          {stage === "settled" ? "Pagos" : "Pagar"}
        </PortalCardTitle>
      </div>

      {/* 1 · Cuánto falta y para qué concepto */}
      {stage === "pay" && transferNow ? (
        <div className="portal-pay-now">
          <div>
            <span className="portal-pay-label">Falta transferir · {transferNow.label}</span>
            <strong className="portal-pay-amount portal-num">{formatMoney(transferNow.amount)}</strong>
          </div>
          <span className="portal-pay-total portal-num">
            {balance !== transferNow.amount ? `Saldo del presupuesto: ${formatMoney(balance)} · ` : ""}Total: {formatMoney(budget.total)}
          </span>
        </div>
      ) : stage === "settled" ? (
        <p className="portal-help">El cobro registrado cubre el total del presupuesto ({formatMoney(budget.total)}): no queda saldo por transferir.</p>
      ) : stage === "review" ? (
        <p className="portal-help">Tu comprobante está en revisión: todavía no es un cobro confirmado. El equipo de LedBox te responde; no se te pide otra transferencia.</p>
      ) : (
        <p className="portal-help">No hay un concepto abierto para transferir. Consultá al equipo por el saldo de {formatMoney(balance)}.</p>
      )}

      {/* 2 · Datos bancarios con copiar */}
      {stage === "pay" ? (
        destination.kind === "bank" ? (
          <div className="portal-pay-block">
            <h3 className="quote-document-subtitle">Datos bancarios</h3>
            <div className="portal-bank" title={`Banco: ${destination.details.bank ?? "—"}`}>
              <BankLogo bank={destination.details.bank} size="h-8" />
              <span className="portal-bank-name">{mark?.label ?? (destination.details.bank?.trim() || "Datos de pago")}</span>
            </div>
            <dl className="portal-facts portal-facts--pay">
              {destination.details.holder ? (
                <div>
                  <dt>Titular</dt>
                  <dd>{destination.details.holder}</dd>
                </div>
              ) : null}
              {destination.details.ruc ? (
                <div>
                  <dt>RUC</dt>
                  <dd>{destination.details.ruc}</dd>
                </div>
              ) : null}
              {destination.details.account ? (
                <div>
                  <dt>Cuenta</dt>
                  <dd>{destination.details.account}</dd>
                </div>
              ) : null}
              {destination.details.alias ? (
                <div>
                  <dt>Alias</dt>
                  <dd>{destination.details.alias}</dd>
                </div>
              ) : null}
            </dl>
            <div className="portal-form-actions portal-print-hide">
              <button type="button" className="portal-btn portal-btn--ghost" onClick={() => void copyPaymentDetails()}>
                {copied ? "Datos copiados" : "Copiar datos de pago"}
              </button>
            </div>
            <p className="portal-help" aria-live="polite">
              {copied ? "Quedaron en el portapapeles para pegarlos en tu banca." : "Transferí el monto indicado y subí el comprobante."}
            </p>
          </div>
        ) : (
          <div className="portal-pay-block">
            <h3 className="quote-document-subtitle">Datos bancarios</h3>
            <p className="portal-help">{destination.message}</p>
          </div>
        )
      ) : null}

      {/* 3 · Subir comprobante */}
      {proofFormVisible ? (
        <div className="portal-pay-block portal-print-hide" ref={proofRef} tabIndex={-1}>
          <h3 className="quote-document-subtitle" id="portal-proof">Subir comprobante</h3>
          <p className="portal-help">JPG, PNG, WebP o PDF, hasta 2 MB. Indicá qué pago estás comprobando; el equipo de LedBox lo revisa desde el panel.</p>
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
        </div>
      ) : null}

      {/* 4 · Plan de pagos */}
      {planCount > 1 ? (
        <details className="portal-disclosure portal-disclosure--inner portal-plan-fold">
          <summary>
            <span>Plan de pagos · {formatNumber(planCount)} conceptos</span>
          </summary>
          <div className="portal-disclosure-body">
            {planContent}
            {planNotes}
          </div>
        </details>
      ) : (
        <div className="portal-pay-block">
          <h3 className="quote-document-subtitle">Plan de pagos</h3>
          {planContent}
          {planNotes}
        </div>
      )}

      {proofsList}
    </section>
  ) : null;

  return (
    <article className={`portal-budget${stickyKind ? " portal-budget--sticky" : ""}`} data-stage={stage}>
      {demoBanner}

      <div className="portal-budget-grid">
        <div className="portal-budget-main">
          {/* 1 · Encabezado: empresa, nº y título, un solo estado */}
          <header className="portal-budget-head">
            <div className="portal-budget-head-top">
              {headTitle}
              <div className="portal-budget-chips">
                <span className="portal-chip" data-tone={statusChip.tone}>
                  {statusChip.label}
                </span>
              </div>
            </div>
            <p className="admin-identity"><AdminAvatar name={clientLabel} src={budget.client.logoUrl} className="admin-avatar--logo" size={32} /><span>{clientLabel}</span></p>
            {headDates.length > 0 || approved ? (
              <p className="portal-budget-dates">
                {headDates.map((row) => (
                  <span key={row.key} className="portal-budget-date">
                    {row.label} <strong className="portal-nowrap">{row.value}</strong>
                    {row.note ? (
                      <span className="portal-countdown" data-tone={row.tone ?? "neutral"}>
                        {row.note}
                      </span>
                    ) : null}
                  </span>
                ))}
                {approved ? <span className="portal-budget-date">{portalApprovalByline({ method: approvalMethod, name: approvedByName })}</span> : null}
              </p>
            ) : null}
            {headFacts}
          </header>

          {/* Confirmación inmediata de la autorización: próximos pasos y descarga */}
          {justApproved ? (
            <section className="portal-banner portal-banner--ok portal-success" ref={approvedRef} tabIndex={-1} aria-labelledby="portal-approved">
              <h2 className="portal-banner-title" id="portal-approved">
                <AdminIcon name="check" size={16} />
                <span>{justApproved.already ? "Este presupuesto ya estaba autorizado" : "¡Listo! Presupuesto autorizado"}</span>
              </h2>
              <p>
                {justApproved.already
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
          ) : null}

          {/* 2 · Qué tenés que hacer ahora */}
          <PortalNextStep
            icon={nextStep.icon}
            tone={nextStep.tone}
            title={nextStep.title}
            detail={nextStep.detail}
            cta={nextStep.cta}
            progress={approved ? paymentProgress : null}
            innerRef={revisionRef}
          />

          {revisionPending && revisionText ? (
            <section className="portal-card" aria-labelledby="portal-revision">
              <PortalCardTitle id="portal-revision" icon="edit">
                Lo que pediste{revisionAt ? ` el ${formatDateTime(revisionAt)}` : ""}
              </PortalCardTitle>
              <blockquote className="portal-banner-quote">{revisionText}</blockquote>
            </section>
          ) : null}
          {waitingRequest && (lastRequest || justRequested) ? (
            <p className="portal-help portal-print-hide">
              Enviado el {formatDateTime(lastRequest?.createdAt ?? justRequested?.at ?? "")}
              {(lastRequest?.note ?? justRequested?.note) ? `: «${lastRequest?.note ?? justRequested?.note}»` : "."}
            </p>
          ) : null}

          {/* 3 · Pagar (solo aprobado) */}
          {payCard}

          {/* 4 · Detalle del presupuesto */}
          <section className="portal-card" aria-labelledby="portal-items">
            <div className="portal-card-head">
              <PortalCardTitle id="portal-items" icon="budgets">
                Detalle del presupuesto
              </PortalCardTitle>
              {canEdit && budget.items.length > 0 ? (
                <p className="portal-card-lead">
                  Podés cambiar cantidades y días; el total se actualiza al instante.
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
                      const shown = portalItemLine(item, current);
                      return (
                        <tr key={item.id} data-excluded={current.excluded ? "true" : undefined} data-changed={changed ? "true" : undefined}>
                          <td className="portal-item-cell">
                            <span className="portal-item-identity">
                              <PortalItemThumb imageUrl={item.imageUrl} />
                              <span className="portal-item-text">
                                <strong className="portal-item-name">{item.name}</strong>
                                {current.excluded ? <small className="portal-item-note">Retirado / no incluido</small> : null}
                                {item.notes ? <details><summary>Detalles</summary><p className="portal-item-note">{item.notes}</p></details> : null}
                                {shown.package && !current.excluded ? <PortalPackageNote summary={shown.package} quantity={current.quantity} /> : null}
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
                          <td className="portal-num" data-label="Precio unitario">{formatMoney(shown.unitPrice)}{shown.periodTotal ? <small className="portal-item-note">total por {formatNumber(current.days)} {current.days === 1 ? "día" : "días"}</small> : null}</td>
                          <td className={`portal-num${canEdit ? " portal-item-subtotal" : ""}`} data-label="Total">{formatMoney(shown.total)}</td>
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
            </div>
            <p className="portal-help">
              Montos en guaraníes (PYG).{canEdit && itemsChanged ? " Tus ajustes los revisa el equipo antes de aprobar." : ""}
            </p>
            {canEdit && itemsChanged ? (
              <div className="portal-form-actions">
                <button type="button" className="portal-btn portal-btn--ghost portal-btn--sm" onClick={resetDraft}>
                  Restablecer cantidades
                </button>
              </div>
            ) : null}
          </section>

          {/* 5 · Condiciones */}
          {budget.notes ? (
            <section className="portal-card quote-document-section--observations" aria-labelledby="portal-observations">
              <PortalCardTitle id="portal-observations" icon="edit">Observaciones</PortalCardTitle>
              <p className="quote-document-copy">{budget.notes}</p>
            </section>
          ) : null}

          {budget.deliveryAt || budget.ivaType || budget.warranty ? (
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
                </dl>
              {budget.warranty ? (
                <p className="portal-note">
                  <strong>Garantía:</strong> {budget.warranty}
                </p>
              ) : null}
            </section>
          ) : null}

          {budget.securityDeposit ? (
            <section className="portal-card quote-document-section--deposit" aria-labelledby="portal-security-deposit">
              <div className="portal-card-head">
                <PortalCardTitle id="portal-security-deposit" icon="wallet">
                  Depósito de garantía
                </PortalCardTitle>
              </div>
              <dl className="portal-facts portal-facts--pay">
                <div>
                  <dt>Garantía</dt>
                  <dd className="portal-num">{formatMoney(budget.securityDeposit.amount)}</dd>
                </div>
                <div>
                  <dt>Estado</dt>
                  <dd>{budget.securityDeposit.statusLabel}</dd>
                </div>
                {budget.securityDeposit.retained > 0 ? (
                  <div>
                    <dt>Retenido</dt>
                    <dd className="portal-num">{formatMoney(budget.securityDeposit.retained)}</dd>
                  </div>
                ) : null}
                {budget.securityDeposit.status === "RETURNED" || budget.securityDeposit.status === "KEPT_PARTIAL" ? (
                  <div>
                    <dt>Devuelto</dt>
                    <dd className="portal-num">{formatMoney(budget.securityDeposit.returned)}</dd>
                  </div>
                ) : null}
              </dl>
              <p className="portal-help">No forma parte del total del presupuesto ni de las cuotas: se devuelve al cerrar el alquiler si el equipo vuelve sin daños.</p>
            </section>
          ) : null}

          {approved ? null : paymentsCard}

          {/* Decisión: autorizar, pedir rebaja o cambio */}
          {decisionVisible ? (
        <section className="portal-card portal-card--action" aria-labelledby="portal-action" ref={actionRef}>
          <div className="portal-card-head">
                <div className="portal-action-heading">
                  <PortalCardTitle id="portal-action" icon="check">
                    Tu decisión
                  </PortalCardTitle>
                </div>
                <p className="portal-card-lead">
                  {canEdit
                    ? "Autorizá el presupuesto tal como queda (con tus ajustes, si los hiciste) o pedí una rebaja o un cambio: el equipo responde por este mismo link."
                    : "Mientras revisamos tu pedido podés autorizar el presupuesto tal como está; no perdés la respuesta del equipo."}
                </p>
              </div>

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

          {/* 6 · Documentos */}
          <PortalQuoteResources budget={budget} token={token}>
            {approved ? (
              <div className="portal-quote-resource portal-print-hide">
                <strong>Presupuesto autorizado</strong>
                <button type="button" className="portal-btn portal-btn--ghost" onClick={() => window.print()}>
                  Descargar el presupuesto (PDF)
                </button>
              </div>
            ) : null}
          </PortalQuoteResources>

          <section className="portal-card quote-document-section--issuer" aria-labelledby="portal-issuer">
            <PortalCardTitle id="portal-issuer" icon="building">Emitido por</PortalCardTitle>
            <p className="quote-document-copy"><strong>{budget.organization}</strong></p>
            <p className="portal-help">La firma electrónica, cuando corresponda, se realiza en un proceso separado.</p>
          </section>

          {approved || !proofsList ? null : <section className="portal-card">{proofsList}</section>}

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

          {/* 7 · Cronología (plegada) */}
          {timeline}

          {/* 8 · Contacto */}
          <section className="portal-card portal-help-card" aria-labelledby="portal-help">
            <PortalCardTitle id="portal-help" icon="info">
              Contacto
            </PortalCardTitle>
            <p className="portal-card-lead">
              Escribinos respondiendo el correo con el que te enviamos este presupuesto y citá el Nº {budget.reference}: el
              equipo de LedBox te contesta por el mismo canal.
            </p>
            {contactName ? (
              <p className="portal-help">
                Responsable registrado de {clientLabel}: {contactName}
                {contactRole ? ` · ${contactRole}` : ""}.
              </p>
            ) : null}
          </section>
        </div>

        {/* Escritorio: total, saldo y acción principal siempre a la vista */}
        <aside className="portal-budget-aside" aria-labelledby="portal-summary">
          <div className="portal-card portal-summary">
            <PortalCardTitle id="portal-summary" icon="overview">
              Tu presupuesto
            </PortalCardTitle>
            <div className="portal-totals portal-totals--aside">
              <div className="portal-total-row portal-total-row--strong">
                <span>{itemsChanged ? "Total con tus cambios" : "Total"}</span>
                <span className="portal-num">{formatMoney(summaryTotal)}</span>
              </div>
              {approved && (budget.collectedAmount ?? 0) > 0 ? (
                <div className="portal-total-row">
                  <span>Cobrado</span>
                  <span className="portal-num">{formatMoney(budget.collectedAmount ?? 0)}</span>
                </div>
              ) : null}
              {approved ? (
                <div className="portal-total-row">
                  <span>Saldo</span>
                  <span className="portal-num">{formatMoney(balance)}</span>
                </div>
              ) : null}
            </div>
            {stage === "authorize" && budget.validUntil ? (
              <span className="portal-countdown" data-tone={countdownTone(budget.validUntil)}>
                {formatCountdown(budget.validUntil, "client")}
              </span>
            ) : null}
            {stickyKind === "authorize" ? (
              <button
                type="button"
                className="portal-btn portal-btn--primary portal-btn--block portal-print-hide"
                onClick={() => actionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                aria-controls="portal-action"
              >
                Ir a la decisión
              </button>
            ) : stickyKind === "pay" ? (
              <a className="portal-btn portal-btn--primary portal-btn--block portal-print-hide" href="#portal-pay">
                Ver cómo pagar
              </a>
            ) : (
              <p className="portal-help">{nextStep.title}.</p>
            )}
          </div>
        </aside>
      </div>

      {/* Celular: la acción principal queda fija abajo mientras haya algo pendiente */}
      {stickyKind && targetOffscreen && !footerVisible ? (
        <div className="portal-mobile-sticky" role="region" aria-label={stickyKind === "pay" ? "Pago pendiente" : "Decisión y total"}>
          <div className="portal-mobile-sticky-total">
            <span>{stickyKind === "pay" ? "Falta transferir" : itemsChanged ? "Total con tus cambios" : "Total actual"}</span>
            <strong className="portal-num">{formatMoney(stickyKind === "pay" ? transferNow?.amount ?? balance : actionTotal)}</strong>
            {stickyKind === "authorize" && budget.validUntil ? (
              <small className="portal-mobile-sticky-due" data-tone={countdownTone(budget.validUntil)}>
                {formatCountdown(budget.validUntil, "client")}
              </small>
            ) : null}
          </div>
          <button
            type="button"
            className="portal-btn portal-btn--primary portal-mobile-sticky-action"
            onClick={() => (stickyKind === "pay" ? payFirstRef : actionRef).current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            aria-controls={stickyKind === "pay" ? "portal-pay" : "portal-action"}
          >
            {stickyKind === "pay" ? "Cómo pagar" : "Ver decisión"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
