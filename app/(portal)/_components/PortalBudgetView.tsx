"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  budgetApprovalLabel,
  budgetApprovalMethodLabel,
  budgetApprovalTone,
  budgetChangeKindLabel,
  budgetChangeStatusLabel,
  budgetChangeStatusTone,
  budgetStatusLabel,
  formatBytes,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  paymentProofMimeLabel,
  statusTone,
} from "@/lib/admin-format";
import { bankMark } from "@/lib/bank-mark";
import {
  detectPaymentProofMime,
  PAYMENT_PROOF_MAX_BYTES,
  PAYMENT_PROOF_MIMES,
  paymentProofExtension,
} from "@/lib/admin-types";
import type { PortalBudget, PortalBudgetProof, PortalBudgetRequest } from "@/lib/server/budget-portal";

/**
 * Vista pública del presupuesto (issue #12) con autogestión del cliente
 * (issue #14): el cliente ajusta cantidades y días con el precio unitario fijo
 * y ve el total en vivo, pide una rebaja, sigue el estado de sus solicitudes y,
 * una vez aprobado, ve el monto a transferir con los datos de pago de la empresa.
 *
 * Suma el comprobante de pago (issue #17): el cliente sube la foto o el PDF de
 * la transferencia —las fotos se comprimen acá, en el navegador— y sigue el
 * estado real de cada comprobante. El archivo no se sirve en el portal: lo ve
 * el equipo desde el panel con sesión.
 *
 * Nada se aplica solo: las propuestas quedan pendientes y el equipo las acepta
 * o rechaza desde el panel. La aprobación sigue siendo única y con evidencia.
 */

type DraftItem = { quantity: number; days: number };

const MAX_QUANTITY = 999;
const MAX_DAYS = 365;
const MAX_NOTE = 600;
/** Lado máximo de la foto comprimida y calidad del WebP/JPEG resultante. */
const PROOF_MAX_SIDE = 1600;
const PROOF_QUALITY = 0.82;

/** Estado del comprobante en el portal, con su tono de cápsula. */
const PROOF_STATUS: Record<PortalBudgetProof["status"], { label: string; tone: string }> = {
  received: { label: "Recibido", tone: "info" },
  collected: { label: "Cobrado", tone: "ok" },
  cancelled: { label: "Cobro anulado", tone: "danger" },
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
        item.quantity === item.previousQuantity && item.days === item.previousDays
          ? `${item.name} sin cambios`
          : `${item.name}: ${formatNumber(item.previousQuantity)} × ${formatNumber(item.previousDays)} d → ${formatNumber(item.quantity)} × ${formatNumber(item.days)} d`,
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

// ── Comprobante de pago (issue #17) ─────────────────────────────────────────
// La foto se comprime en el navegador (canvas, sin librerías): lado máximo
// 1600 px y salida WebP con caída a JPEG. El PDF viaja tal cual. El tipo real
// se valida por magic bytes antes de subir (y el API lo revalida siempre).

type LoadedImage = { image: CanvasImageSource; width: number; height: number; release: () => void };

async function loadImageSource(file: Blob): Promise<LoadedImage | null> {
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image` respeta la orientación EXIF de las fotos de celular.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Safari viejo o formato raro: se reintenta con `<img>`.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("No pudimos leer la imagen."));
      element.src = url;
    });
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

/** Comprime una foto a WebP (o lo que soporte el navegador); `null` si no se pudo. */
async function compressProofImage(file: File): Promise<Blob | null> {
  const loaded = await loadImageSource(file);
  if (!loaded || loaded.width < 1 || loaded.height < 1) {
    loaded?.release();
    return null;
  }
  try {
    const scale = Math.min(1, PROOF_MAX_SIDE / Math.max(loaded.width, loaded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(loaded.width * scale));
    canvas.height = Math.max(1, Math.round(loaded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", PROOF_QUALITY));
    return blob && blob.size > 0 ? blob : null;
  } finally {
    loaded.release();
  }
}

/** Prepara el archivo del comprobante: valida la firma real y comprime las fotos. */
async function prepareProofFile(file: File): Promise<{ blob: Blob; mime: string } | { error: string }> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detected = detectPaymentProofMime(header);
  if (!detected) {
    return { error: "El archivo no es un JPG, PNG, WebP o PDF: revisá que no esté renombrado." };
  }
  if (detected === "application/pdf") {
    if (file.size > PAYMENT_PROOF_MAX_BYTES) {
      return { error: "El PDF supera los 2 MB; subí una versión más liviana." };
    }
    return { blob: file, mime: detected };
  }
  const compressed = await compressProofImage(file);
  const blob = compressed && compressed.size < file.size ? compressed : file;
  if (blob.size > PAYMENT_PROOF_MAX_BYTES) {
    return { error: "La imagen sigue superando los 2 MB después de comprimirla; probá con otra foto." };
  }
  return { blob, mime: detected };
}

function Stepper({
  value,
  max,
  label,
  onChange,
}: {
  value: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <span className="portal-stepper">
      <button
        type="button"
        className="portal-step"
        onClick={() => onChange(Math.max(1, value - 1))}
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
        onChange={(event) => onChange(clampInt(event.target.value, max))}
        aria-label={`${label} (1 a ${max})`}
      />
      <button
        type="button"
        className="portal-step"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Sumar uno a ${label}`}
        title={`Sumar uno a ${label}`}
      >
        +
      </button>
    </span>
  );
}

export function PortalBudgetView({ budget, token }: { budget: PortalBudget; token: string }) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [approveNote, setApproveNote] = useState("");
  const [approveError, setApproveError] = useState("");
  const [approving, setApproving] = useState(false);
  const [justApproved, setJustApproved] = useState<null | { already: boolean }>(null);

  const [revisionName, setRevisionName] = useState("");
  const [revisionNote, setRevisionNote] = useState("");
  const [revisionError, setRevisionError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [justRequested, setJustRequested] = useState<null | { at: string; note: string }>(null);

  // Autogestión (issue #14): borrador de ítems, rebaja y datos de contacto.
  const [draft, setDraft] = useState<Record<string, DraftItem>>(() =>
    Object.fromEntries(budget.items.map((item) => [item.id, { quantity: item.quantity, days: item.days }])),
  );
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [itemsNote, setItemsNote] = useState("");
  const [itemsError, setItemsError] = useState("");
  const [itemsSending, setItemsSending] = useState(false);
  const [itemsSent, setItemsSent] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("");
  const [discountNote, setDiscountNote] = useState("");
  const [discountError, setDiscountError] = useState("");
  const [discountSending, setDiscountSending] = useState(false);
  const [discountSent, setDiscountSent] = useState(false);
  const [copied, setCopied] = useState(false);

  // Comprobante de pago (issue #17).
  const [proofName, setProofName] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofError, setProofError] = useState("");
  const [proofBusy, setProofBusy] = useState(false);
  const [proofSent, setProofSent] = useState(false);

  const approvedRef = useRef<HTMLElement | null>(null);
  const revisionRef = useRef<HTMLElement | null>(null);
  const proposalRef = useRef<HTMLElement | null>(null);
  const proofRef = useRef<HTMLElement | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);

  const approved = Boolean(budget.approval.approvedAt) || Boolean(justApproved);
  const revisionPending = !approved && (Boolean(budget.approval.revisionRequestedAt) || Boolean(justRequested));

  // El foco acompaña el cambio de estado para que un lector de pantalla anuncie
  // el resultado de la acción (el bloque nuevo entra al tabulado).
  useEffect(() => {
    if (justApproved) approvedRef.current?.focus();
  }, [justApproved]);
  useEffect(() => {
    if (justRequested) revisionRef.current?.focus();
  }, [justRequested]);
  useEffect(() => {
    if (itemsSent) proposalRef.current?.focus();
  }, [itemsSent]);
  useEffect(() => {
    if (proofSent) proofRef.current?.focus();
  }, [proofSent]);

  // El borrador sigue los ítems reales: cuando el equipo aplica la propuesta,
  // el portal se refresca y los valores de partida son los nuevos.
  const itemsSignature = budget.items.map((item) => `${item.id}:${item.quantity}:${item.days}`).join("|");
  useEffect(() => {
    setDraft(Object.fromEntries(budget.items.map((item) => [item.id, { quantity: item.quantity, days: item.days }])));
  }, [itemsSignature]); // eslint-disable-line react-hooks/exhaustive-deps -- el borrador solo depende de la firma de los ítems

  const approvedAt = budget.approval.approvedAt ?? (justApproved ? new Date().toISOString() : null);
  const approvedByName = budget.approval.approvedByName ?? (justApproved ? name.trim() : null);
  const approvalMethod = budget.approval.method ?? (justApproved ? "digital" : null);
  const revisionAt = budget.approval.revisionRequestedAt ?? justRequested?.at ?? null;
  const revisionText = justRequested ? justRequested.note : budget.approval.revisionNote;
  const approvalState = approved
    ? approvalMethod === "manual"
      ? "APROBADO_MANUAL"
      : "APROBADO_DIGITAL"
    : revisionPending
      ? "CAMBIOS_SOLICITADOS"
      : "PENDIENTE";

  const itemsChanged = useMemo(
    () =>
      budget.items.some((item) => {
        const current = draft[item.id];
        return Boolean(current) && (current.quantity !== item.quantity || current.days !== item.days);
      }),
    [budget.items, draft],
  );

  const proposedSubtotal = useMemo(
    () =>
      budget.items.reduce((sum, item) => {
        const current = draft[item.id] ?? { quantity: item.quantity, days: item.days };
        return sum + item.unitPrice * current.quantity * current.days;
      }, 0),
    [budget.items, draft],
  );
  const proposedTotal = Math.max(0, proposedSubtotal - budget.discount);

  const pendingRequests = budget.requests.filter((request) => request.status === "pending");
  const paymentPlan = budget.paymentPlan;
  const mark = bankMark(budget.paymentDetails?.bank);

  async function approve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 3) {
      setApproveError("Ingresá tu nombre y apellido.");
      return;
    }
    if (!consent) {
      setApproveError("Marcá el consentimiento para registrar la aprobación.");
      return;
    }
    setApproving(true);
    setApproveError("");
    try {
      const response = await fetch(`/api/portal/budget/${encodeURIComponent(token)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), consent: true, note: approveNote.trim() || undefined }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; alreadyApproved?: boolean } | null;
      if (!response.ok) {
        setApproveError(payload?.error || "No pudimos registrar la aprobación. Probá de nuevo.");
        return;
      }
      setJustApproved({ already: Boolean(payload?.alreadyApproved) });
      router.refresh();
    } catch {
      setApproveError("No pudimos conectar con el portal. Revisá tu conexión y probá de nuevo.");
    } finally {
      setApproving(false);
    }
  }

  async function requestRevision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!revisionNote.trim()) {
      setRevisionError("Contanos qué cambios necesitás.");
      return;
    }
    setRequesting(true);
    setRevisionError("");
    try {
      const response = await fetch(`/api/portal/budget/${encodeURIComponent(token)}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: revisionName.trim() || undefined, note: revisionNote.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setRevisionError(payload?.error || "No pudimos enviar tu comentario. Probá de nuevo.");
        return;
      }
      setJustRequested({ at: new Date().toISOString(), note: revisionNote.trim() });
      setRevisionNote("");
      router.refresh();
    } catch {
      setRevisionError("No pudimos conectar con el portal. Revisá tu conexión y probá de nuevo.");
    } finally {
      setRequesting(false);
    }
  }

  function updateDraft(id: string, patch: Partial<DraftItem>) {
    setDraft((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
    setItemsSent(false);
  }

  async function sendProposal(kind: "items" | "discount", event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isItems = kind === "items";
    const setError = isItems ? setItemsError : setDiscountError;
    const note = isItems ? itemsNote : discountNote;
    const setSending = isItems ? setItemsSending : setDiscountSending;
    setError("");
    if (contactName.trim().length < 3) {
      setError("Ingresá tu nombre y apellido.");
      return;
    }
    if (!note.trim()) {
      setError("Contanos el motivo de tu pedido.");
      return;
    }

    let body: Record<string, unknown> = {
      kind,
      name: contactName.trim(),
      email: contactEmail.trim() || undefined,
      note: note.trim(),
    };
    if (isItems) {
      if (!itemsChanged) {
        setError("Cambiá alguna cantidad o días antes de enviar la propuesta.");
        return;
      }
      body = {
        ...body,
        items: budget.items.map((item) => ({
          id: item.id,
          quantity: draft[item.id]?.quantity ?? item.quantity,
          days: draft[item.id]?.days ?? item.days,
        })),
      };
    } else {
      const raw = discountType === "percent" ? discountValue.replace(",", ".").trim() : discountValue.replace(/\D/g, "");
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        setError(discountType === "percent" ? "Ingresá un porcentaje mayor a cero." : "Ingresá un monto mayor a cero.");
        return;
      }
      body = { ...body, discount: { type: discountType, value } };
    }

    setSending(true);
    try {
      const response = await fetch(`/api/portal/budget/${encodeURIComponent(token)}/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(payload?.error || "No pudimos enviar tu solicitud. Probá de nuevo.");
        return;
      }
      if (isItems) {
        setItemsSent(true);
        setItemsNote("");
      } else {
        setDiscountSent(true);
        setDiscountNote("");
        setDiscountValue("");
      }
      router.refresh();
    } catch {
      setError("No pudimos conectar con el portal. Revisá tu conexión y probá de nuevo.");
    } finally {
      setSending(false);
    }
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
      paymentPlan.dueNow ? `Monto a transferir ahora: ${formatMoney(paymentPlan.dueNow.amount)}` : null,
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

  /** Sube el comprobante (foto comprimida o PDF) y refresca la vista del presupuesto. */
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
      const prepared = await prepareProofFile(proofFile);
      if ("error" in prepared) {
        setProofError(prepared.error);
        return;
      }
      const form = new FormData();
      form.append("name", proofName.trim());
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

  return (
    <article className="portal-budget">
      <header className="portal-budget-head">
        <p className="portal-kicker">Presupuesto Nº {budget.reference}</p>
        <h1 className="portal-budget-title">{budget.title}</h1>
        <p className="portal-budget-meta">
          {budget.client.company || budget.client.name} · {budget.organization}
        </p>
        <p className="portal-budget-meta">
          Emitido el {formatDateTime(budget.createdAt)} ·{" "}
          {budget.validUntil ? `Válido hasta el ${formatDate(budget.validUntil)}` : "Sin fecha de vencimiento"}
        </p>
        <div className="portal-budget-chips">
          <span className="portal-chip" data-tone={statusTone(budget.status)}>
            {budgetStatusLabel(budget.status)}
          </span>
          <span className="portal-chip" data-tone={budgetApprovalTone(approvalState)}>
            {budgetApprovalLabel(approvalState)}
          </span>
          {pendingRequests.length > 0 ? (
            <span className="portal-chip" data-tone="warn">
              {formatNumber(pendingRequests.length)} {pendingRequests.length === 1 ? "solicitud pendiente" : "solicitudes pendientes"}
            </span>
          ) : null}
        </div>
      </header>

      {approved ? (
        <section className="portal-banner portal-banner--ok" ref={approvedRef} tabIndex={-1} aria-labelledby="portal-approved">
          <h2 className="portal-banner-title" id="portal-approved">
            {justApproved?.already ? "Este presupuesto ya estaba aprobado" : "Presupuesto aprobado"}
          </h2>
          <p>
            {justApproved?.already
              ? "Registramos tu visita: la aprobación original queda tal cual, sin cambios."
              : "Quedó registrada tu aprobación. El equipo de LedBox te contacta para coordinar el evento."}
          </p>
          <dl className="portal-facts portal-facts--inline">
            <div>
              <dt>Nombre</dt>
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
        </section>
      ) : revisionPending ? (
        <section className="portal-banner portal-banner--warn" ref={revisionRef} tabIndex={-1} aria-labelledby="portal-revision">
          <h2 className="portal-banner-title" id="portal-revision">
            Pediste cambios
          </h2>
          <p>
            Recibimos tu comentario{revisionAt ? ` el ${formatDateTime(revisionAt)}` : ""}. El equipo de LedBox lo revisa y
            te responde; mientras tanto podés aprobar el presupuesto con el detalle actual o proponer los ajustes con el
            editor.
          </p>
          {revisionText ? <blockquote className="portal-banner-quote">{revisionText}</blockquote> : null}
        </section>
      ) : null}

      {approved && paymentPlan.dueNow ? (
        <section className="portal-card portal-card--pay" aria-labelledby="portal-pay">
          <h2 className="portal-card-title" id="portal-pay">
            Pago
          </h2>
          <div className="portal-pay-now">
            <div>
              <span className="portal-pay-label">{paymentPlan.dueNow.label}</span>
              <strong className="portal-pay-amount portal-num">{formatMoney(paymentPlan.dueNow.amount)}</strong>
            </div>
            <span className="portal-pay-total portal-num">Total del presupuesto: {formatMoney(budget.total)}</span>
          </div>

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
              <button type="button" className="portal-btn" onClick={() => void copyPaymentDetails()}>
                {copied ? "Datos copiados" : "Copiar datos de pago"}
              </button>
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

          {paymentPlan.installments.length > 0 || paymentPlan.terms ? (
            <div className="portal-pay-plan">
              {paymentPlan.installments.length > 0 ? (
                <div className="portal-table-wrap">
                  <table className="portal-table portal-table--plan">
                    <caption className="portal-table-caption">Plan de pagos</caption>
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
                          <td>Anticipo (a transferir ahora)</td>
                          <td className="portal-num">{formatMoney(paymentPlan.advanceAmount)}</td>
                          <td>Con la aprobación</td>
                        </tr>
                      ) : null}
                      {paymentPlan.installments.map((installment, index) => (
                        <tr key={`${installment.label}-${index}`}>
                          <td>
                            {installment.label}
                            {paymentPlan.advanceAmount === 0 && index === 0 ? " (a transferir ahora)" : ""}
                          </td>
                          <td className="portal-num">{formatMoney(installment.amount)}</td>
                          <td>{dueLabel(installment.dueAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {paymentPlan.pending > 0 ? (
                <p className="portal-help">
                  Saldo sin cuota agendada: <span className="portal-num">{formatMoney(paymentPlan.pending)}</span>
                </p>
              ) : null}
              {paymentPlan.terms ? <p className="portal-note">{paymentPlan.terms}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {budget.proofUpload.allowed ? (
        <section
          className="portal-card portal-card--action"
          aria-labelledby="portal-proof"
          ref={proofRef}
          tabIndex={-1}
        >
          <h2 className="portal-card-title" id="portal-proof">
            Enviar comprobante
          </h2>
          <p className="portal-card-lead">
            Transferí el monto indicado y adjuntá el comprobante: JPG, PNG, WebP o PDF, hasta 2 MB. Las fotos se comprimen
            en tu navegador antes de subirse y el equipo de LedBox las revisa desde el panel.
          </p>
          <form className="portal-form" onSubmit={(event) => void submitProof(event)}>
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
                />
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
                Recibimos tu comprobante. El equipo lo revisa y marca el cobro; vas a ver el estado acá abajo.
              </p>
            ) : null}
            <button className="portal-btn portal-btn--primary" type="submit" disabled={proofBusy} aria-busy={proofBusy || undefined}>
              {proofBusy ? "Subiendo comprobante…" : "Enviar comprobante"}
            </button>
          </form>
        </section>
      ) : null}

      {budget.proofs.length > 0 ? (
        <section className="portal-card" aria-labelledby="portal-proofs">
          <h2 className="portal-card-title" id="portal-proofs">
            Tus comprobantes
          </h2>
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
          <h2 className="portal-card-title" id="portal-requests">
            Tus solicitudes
          </h2>
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

      <section className="portal-card" aria-labelledby="portal-items">
        <h2 className="portal-card-title" id="portal-items">
          Detalle
        </h2>
        {budget.items.length === 0 ? (
          <p className="portal-empty">Este presupuesto no tiene ítems cargados.</p>
        ) : (
          <div className="portal-table-wrap">
            <table className="portal-table">
              <thead>
                <tr>
                  <th scope="col">Producto / servicio</th>
                  <th scope="col" className="portal-num">
                    Cantidad
                  </th>
                  <th scope="col" className="portal-num">
                    Días
                  </th>
                  <th scope="col" className="portal-num">
                    Precio unitario
                  </th>
                  <th scope="col" className="portal-num">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {budget.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      {item.name}
                      {item.notes ? <small className="portal-item-note">{item.notes}</small> : null}
                    </td>
                    <td className="portal-num">{formatNumber(item.quantity)}</td>
                    <td className="portal-num">{formatNumber(item.days)}</td>
                    <td className="portal-num">{formatMoney(item.unitPrice)}</td>
                    <td className="portal-num">{formatMoney(item.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="portal-totals">
          <div className="portal-total-row">
            <span>Subtotal</span>
            <span className="portal-num">{formatMoney(budget.subtotal)}</span>
          </div>
          {budget.discount > 0 ? (
            <div className="portal-total-row">
              <span>Descuento</span>
              <span className="portal-num">− {formatMoney(budget.discount)}</span>
            </div>
          ) : null}
          <div className="portal-total-row portal-total-row--strong">
            <span>Total</span>
            <span className="portal-num">{formatMoney(budget.total)}</span>
          </div>
        </div>
      </section>

      {!approved && budget.items.length > 0 ? (
        <section className="portal-card portal-card--action" aria-labelledby="portal-editor" ref={proposalRef} tabIndex={-1}>
          <h2 className="portal-card-title" id="portal-editor">
            Ajustá tu presupuesto
          </h2>
          <p className="portal-card-lead">
            Cambiá cantidades y días: el precio unitario queda fijo. Vas a ver el total en vivo y podés enviarnos tu
            propuesta para que la revise el equipo.
          </p>

          <div className="portal-table-wrap">
            <table className="portal-table portal-table--editor">
              <thead>
                <tr>
                  <th scope="col">Producto / servicio</th>
                  <th scope="col" className="portal-num">
                    Cantidad
                  </th>
                  <th scope="col" className="portal-num">
                    Días
                  </th>
                  <th scope="col" className="portal-num">
                    Precio unitario
                  </th>
                  <th scope="col" className="portal-num">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {budget.items.map((item) => {
                  const current = draft[item.id] ?? { quantity: item.quantity, days: item.days };
                  const changed = current.quantity !== item.quantity || current.days !== item.days;
                  return (
                    <tr key={item.id} data-changed={changed ? "true" : undefined}>
                      <td>
                        {item.name}
                        {changed ? (
                          <small className="portal-item-note">
                            Antes: {formatNumber(item.quantity)} × {formatNumber(item.days)} d
                          </small>
                        ) : null}
                      </td>
                      <td className="portal-num">
                        <Stepper
                          value={current.quantity}
                          max={MAX_QUANTITY}
                          label={`Cantidad de ${item.name}`}
                          onChange={(quantity) => updateDraft(item.id, { quantity })}
                        />
                      </td>
                      <td className="portal-num">
                        <Stepper
                          value={current.days}
                          max={MAX_DAYS}
                          label={`Días de ${item.name}`}
                          onChange={(days) => updateDraft(item.id, { days })}
                        />
                      </td>
                      <td className="portal-num">{formatMoney(item.unitPrice)}</td>
                      <td className="portal-num">
                        <strong>{formatMoney(item.unitPrice * current.quantity * current.days)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="portal-totals">
            <div className="portal-total-row">
              <span>Subtotal propuesto</span>
              <span className="portal-num">{formatMoney(proposedSubtotal)}</span>
            </div>
            {budget.discount > 0 ? (
              <div className="portal-total-row">
                <span>Descuento vigente</span>
                <span className="portal-num">− {formatMoney(budget.discount)}</span>
              </div>
            ) : null}
            <div className="portal-total-row portal-total-row--strong">
              <span>Total estimado</span>
              <span className="portal-num">{formatMoney(proposedTotal)}</span>
            </div>
          </div>

          <form className="portal-form" onSubmit={(event) => void sendProposal("items", event)}>
            <div className="portal-form-row">
              <label className="portal-field" htmlFor="portal-contact-name">
                <span className="portal-field-label">Nombre y apellido</span>
                <input
                  id="portal-contact-name"
                  name="contact-name"
                  value={contactName}
                  onChange={(event) => setContactName(event.target.value)}
                  maxLength={120}
                  autoComplete="name"
                  required
                />
              </label>
              <label className="portal-field" htmlFor="portal-contact-email">
                <span className="portal-field-label">Correo (opcional)</span>
                <input
                  id="portal-contact-email"
                  name="contact-email"
                  type="email"
                  value={contactEmail}
                  onChange={(event) => setContactEmail(event.target.value)}
                  maxLength={200}
                  autoComplete="email"
                />
              </label>
            </div>
            <label className="portal-field" htmlFor="portal-items-note">
              <span className="portal-field-label">Motivo de tu propuesta</span>
              <textarea
                id="portal-items-note"
                name="items-note"
                value={itemsNote}
                onChange={(event) => setItemsNote(event.target.value)}
                maxLength={MAX_NOTE}
                rows={3}
                required
                placeholder="Ej.: necesito una pantalla más y un día menos de alquiler"
              />
            </label>
            {itemsError ? (
              <p className="portal-error" role="alert">
                {itemsError}
              </p>
            ) : null}
            {itemsSent ? (
              <p className="portal-ok" role="status">
                Recibimos tu propuesta. El equipo la revisa y te responde por este mismo link.
              </p>
            ) : null}
            <div className="portal-form-actions">
              <button
                type="button"
                className="portal-btn"
                onClick={() => {
                  setDraft(Object.fromEntries(budget.items.map((item) => [item.id, { quantity: item.quantity, days: item.days }])));
                  setItemsSent(false);
                }}
              >
                Restablecer
              </button>
              <button
                className="portal-btn portal-btn--primary"
                type="submit"
                disabled={itemsSending || !itemsChanged}
                aria-busy={itemsSending || undefined}
              >
                {itemsSending ? "Enviando propuesta…" : "Enviar propuesta"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {!approved ? (
        <section className="portal-card portal-card--action" aria-labelledby="portal-discount">
          <h2 className="portal-card-title" id="portal-discount">
            Pedir una rebaja
          </h2>
          <p className="portal-card-lead">
            Contanos qué descuento necesitás y por qué. El equipo puede aceptarlo, responderte con una contra-oferta o
            rechazarlo con una nota.
          </p>
          <form className="portal-form" onSubmit={(event) => void sendProposal("discount", event)}>
            <div className="portal-form-row portal-form-row--discount">
              <label className="portal-field" htmlFor="portal-discount-value">
                <span className="portal-field-label">{discountType === "percent" ? "Porcentaje (0–100)" : "Monto en guaraníes"}</span>
                <input
                  id="portal-discount-value"
                  name="discount-value"
                  inputMode={discountType === "percent" ? "decimal" : "numeric"}
                  value={discountValue}
                  onChange={(event) => setDiscountValue(event.target.value)}
                  maxLength={discountType === "percent" ? 6 : 12}
                  placeholder={discountType === "percent" ? "Ej.: 10" : "Ej.: 500000"}
                  required
                />
              </label>
              <div className="portal-field portal-field--choice" role="group" aria-label="Tipo de descuento">
                <span className="portal-field-label">Tipo</span>
                <div className="portal-segmented">
                  <button
                    type="button"
                    className="portal-segment"
                    data-active={discountType === "percent" ? "true" : undefined}
                    aria-pressed={discountType === "percent"}
                    onClick={() => {
                      setDiscountType("percent");
                      setDiscountValue("");
                    }}
                  >
                    Porcentaje
                  </button>
                  <button
                    type="button"
                    className="portal-segment"
                    data-active={discountType === "amount" ? "true" : undefined}
                    aria-pressed={discountType === "amount"}
                    onClick={() => {
                      setDiscountType("amount");
                      setDiscountValue("");
                    }}
                  >
                    Monto
                  </button>
                </div>
              </div>
            </div>
            <label className="portal-field" htmlFor="portal-discount-note">
              <span className="portal-field-label">Motivo del pedido</span>
              <textarea
                id="portal-discount-note"
                name="discount-note"
                value={discountNote}
                onChange={(event) => setDiscountNote(event.target.value)}
                maxLength={MAX_NOTE}
                rows={3}
                required
                placeholder="Ej.: somos una ONG y el evento es benéfico"
              />
            </label>
            {discountError ? (
              <p className="portal-error" role="alert">
                {discountError}
              </p>
            ) : null}
            {discountSent ? (
              <p className="portal-ok" role="status">
                Recibimos tu pedido de rebaja. El equipo te responde por este mismo link.
              </p>
            ) : null}
            <button className="portal-btn" type="submit" disabled={discountSending} aria-busy={discountSending || undefined}>
              {discountSending ? "Enviando pedido…" : "Solicitar rebaja"}
            </button>
          </form>
        </section>
      ) : null}

      <section className="portal-card" aria-labelledby="portal-facts">
        <h2 className="portal-card-title" id="portal-facts">
          Evento y condiciones
        </h2>
        <dl className="portal-facts">
          <div>
            <dt>Cliente</dt>
            <dd>{budget.client.company || budget.client.name}</dd>
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
            <dt>Inicio</dt>
            <dd>{budget.event?.startsAt ? formatDateTime(budget.event.startsAt) : "—"}</dd>
          </div>
          <div>
            <dt>Validez de la oferta</dt>
            <dd>{budget.validUntil ? `Hasta el ${formatDate(budget.validUntil)}` : "Sin fecha de vencimiento"}</dd>
          </div>
          <div>
            <dt>Moneda</dt>
            <dd>Guaraníes (PYG), sin decimales</dd>
          </div>
        </dl>
        {budget.notes ? <p className="portal-note">{budget.notes}</p> : null}
      </section>

      {!approved ? (
        <section className="portal-card portal-card--action" aria-labelledby="portal-approve">
          <h2 className="portal-card-title" id="portal-approve">
            Aprobar este presupuesto
          </h2>
          <form className="portal-form" onSubmit={approve}>
            <label className="portal-field" htmlFor="portal-name">
              <span className="portal-field-label">Nombre y apellido</span>
              <input
                id="portal-name"
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                autoComplete="name"
                required
                aria-describedby="portal-consent-hint"
              />
            </label>
            <label className="portal-field" htmlFor="portal-note">
              <span className="portal-field-label">Comentario (opcional)</span>
              <textarea
                id="portal-note"
                name="note"
                value={approveNote}
                onChange={(event) => setApproveNote(event.target.value)}
                maxLength={600}
                rows={3}
                placeholder="Algo que quieras aclarar con la aprobación"
              />
            </label>
            <label className="portal-consent" htmlFor="portal-consent">
              <input
                id="portal-consent"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                aria-describedby="portal-consent-hint"
                required
              />
              <span id="portal-consent-hint">
                Confirmo que revisé el detalle, los montos y las condiciones, y apruebo este presupuesto en nombre de{" "}
                {budget.client.company || budget.client.name}.
              </span>
            </label>
            {approveError ? (
              <p className="portal-error" role="alert">
                {approveError}
              </p>
            ) : null}
            <button className="portal-btn portal-btn--primary" type="submit" disabled={approving} aria-busy={approving || undefined}>
              {approving ? "Registrando aprobación…" : "Aprobar presupuesto"}
            </button>
          </form>
        </section>
      ) : null}

      {!approved ? (
        <section className="portal-card portal-card--action" aria-labelledby="portal-changes">
          <h2 className="portal-card-title" id="portal-changes">
            Pedir cambios
          </h2>
          <p className="portal-card-lead">
            Si necesitás algo que no se resuelve con cantidades o días, dejá tu comentario y el equipo de LedBox te
            responde con una versión nueva.
          </p>
          <form className="portal-form" onSubmit={requestRevision}>
            <label className="portal-field" htmlFor="portal-revision-name">
              <span className="portal-field-label">Nombre (opcional)</span>
              <input
                id="portal-revision-name"
                name="revision-name"
                value={revisionName}
                onChange={(event) => setRevisionName(event.target.value)}
                maxLength={120}
                autoComplete="name"
              />
            </label>
            <label className="portal-field" htmlFor="portal-revision-note">
              <span className="portal-field-label">¿Qué cambios necesitás?</span>
              <textarea
                id="portal-revision-note"
                name="revision-note"
                value={revisionNote}
                onChange={(event) => setRevisionNote(event.target.value)}
                maxLength={1000}
                rows={4}
                required
                placeholder="Ej.: sumar un día más de alquiler y cambiar el lugar del evento"
              />
            </label>
            {revisionError ? (
              <p className="portal-error" role="alert">
                {revisionError}
              </p>
            ) : null}
            <button className="portal-btn" type="submit" disabled={requesting} aria-busy={requesting || undefined}>
              {requesting ? "Enviando…" : "Solicitar cambios"}
            </button>
          </form>
        </section>
      ) : null}
    </article>
  );
}
