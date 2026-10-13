"use client";

import { kpiState } from "@/components/admin/kpi-state";
import { useMemo, useState } from "react";
import {
  daysUntilDue,
  formatDate,
  formatDateShort,
  formatNumber,
  maskEmailDisplay,
  maskPhoneDisplay,
  type AdminTone,
} from "@/lib/admin-format";
import { canWriteFinance, matchesQuery } from "@/lib/admin-policy";
import type { AdminSignatureRequestRow } from "@/lib/admin-types";
import { signatureEvidenceLabel, signatureStatusLabel, signatureStatusTone } from "@/lib/server/signature/rules";
import { useAdminSession } from "../AdminShell";
import { SignatureTimeline } from "../SignatureTimeline";
import { PresupuestosTabs } from "./PresupuestosTabs";
import {
  AdminBadge,
  AdminButton,
  AdminCell,
  AdminCountdown,
  AdminDataState,
  AdminDialog,
  AdminEmpty,
  AdminIconLink,
  AdminKpi,
  AdminKpis,
  AdminNote,
  AdminRow,
  AdminSelect,
  AdminTable,
  AdminToolbar,
} from "../AdminUI";
import { SearchField, TextField } from "../AdminFields";
import { adminSend, useAdminResource } from "@/lib/admin-api";

/**
 * Sección «Firmas» (issue #81): el listado global de solicitudes de firma de la
 * empresa, con su estado real, vencimiento, destinatario enmascarado y
 * presupuesto de origen. Reusa el API de firmas del #79: mismas acciones
 * (copiar/abrir link, enviar por correo, cancelar y cronología de auditoría).
 *
 * El listado llega del servidor (últimas 200, ya vencidas aplicadas); los
 * filtros y la búsqueda se resuelven acá, como en el resto del panel.
 */

/** Estados en juego (el cliente todavía puede firmar). */
const ACTIVE_STATUSES = new Set(["SENT", "DELIVERED", "VIEWED", "PENDING_SIGNATURE", "SIGNING"]);
/** Estados con firma recibida. */
const SIGNED_STATUSES = new Set(["SIGNED", "VALIDATED"]);

const STATUS_FILTERS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "ACTIVE", label: "En curso (sin firmar)" },
  { value: "EXPIRING", label: "Por vencer (≤7 días)" },
  { value: "SIGNED", label: "Firmadas" },
  { value: "REJECTED", label: "Rechazadas" },
  { value: "EXPIRED", label: "Vencidas" },
  { value: "CANCELLED", label: "Canceladas" },
];

const EVIDENCE_STATUS: Record<string, string> = {
  PENDING: "Pendiente",
  OPTIONAL: "Opcional",
  COMPLETED: "Completa",
  FAILED: "Falló",
};

/** Etiquetas compactas de la tabla (los nombres largos van en el `title`). */
const COMPACT_STATUS: Record<string, string> = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  DELIVERED: "Entregada",
  VIEWED: "Vista",
  PENDING_SIGNATURE: "Pendiente",
  SIGNING: "Firmando",
  SIGNED: "Firmada",
  VALIDATED: "Validada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
  CANCELLED: "Cancelada",
};

const COMPACT_METHOD: Record<string, string> = {
  DRAWN: "Dibujada",
  TYPED: "Tipográfica",
};

/** Resumen del último correo de la solicitud (historial real de `MailLog`). */
function mailSummary(request: AdminSignatureRequestRow): { badge: string; tone: AdminTone; detail: string } {
  const masked = maskEmailDisplay(request.mail?.to ?? request.recipient.email);
  if (!request.recipient.email) return { badge: "Sin correo", tone: "neutral", detail: "Se comparte a mano" };
  if (!request.mail) return { badge: "Sin envío", tone: "warn", detail: "Ningún correo todavía" };
  if (request.mail.status === "sent") return { badge: "Enviado", tone: "ok", detail: masked ?? "al destinatario" };
  if (request.mail.status === "failed") {
    return { badge: "Falló", tone: "danger", detail: request.mail.error ?? "sin detalle del proveedor" };
  }
  return { badge: "Enviando", tone: "info", detail: masked ?? "al destinatario" };
}

/** Prioridad del listado: primero lo que sigue en juego, por vencimiento. */
function signatureRank(request: AdminSignatureRequestRow): number {
  return ACTIVE_STATUSES.has(request.status) ? 0 : 1;
}

export function FirmasModule() {
  const { role } = useAdminSession();
  const writable = canWriteFinance(role);
  const resource = useAdminResource<AdminSignatureRequestRow[]>("/api/admin/signatures", (payload) => (payload.requests as AdminSignatureRequestRow[] | undefined) ?? []);
  const requests = useMemo(() => resource.data ?? [], [resource.data]);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [timeline, setTimeline] = useState<AdminSignatureRequestRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminSignatureRequestRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  const kpis = useMemo(() => {
    const active = requests.filter((request) => ACTIVE_STATUSES.has(request.status));
    const expiring = active.filter((request) => {
      const days = daysUntilDue(request.expiresAt);
      return days !== null && days >= 0 && days <= 7;
    });
    return {
      active: active.length,
      expiring: expiring.length,
      signed: requests.filter((request) => SIGNED_STATUSES.has(request.status)).length,
      expired: requests.filter((request) => request.status === "EXPIRED").length,
    };
  }, [requests]);

  const rows = useMemo(() => {
    return requests
      .filter((request) => {
        if (status === "ALL") return true;
        if (status === "ACTIVE") return ACTIVE_STATUSES.has(request.status);
        if (status === "EXPIRING") {
          const days = daysUntilDue(request.expiresAt);
          return ACTIVE_STATUSES.has(request.status) && days !== null && days >= 0 && days <= 7;
        }
        if (status === "SIGNED") return SIGNED_STATUSES.has(request.status);
        return request.status === status;
      })
      .filter((request) =>
        matchesQuery(query, [
          request.title,
          request.code,
          request.recipient.name,
          request.recipient.email,
          request.budgetTitle,
          request.document.name,
        ]),
      )
      .sort((a, b) => {
        const rank = signatureRank(a) - signatureRank(b);
        if (rank !== 0) return rank;
        if (signatureRank(a) === 0) return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [requests, query, status]);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`Link copiado: ${url}`);
      setError("");
    } catch {
      setNotice("");
      setError(`No pudimos copiar automáticamente; el link es ${url}`);
    }
  }

  async function sendByEmail(request: AdminSignatureRequestRow) {
    setBusyId(request.id);
    setNotice("");
    setError("");
    const result = await adminSend<{ mail: { status: "sent" | "failed" | "skipped"; error: string | null; to: string | null } }>(
      `/api/admin/signatures/${encodeURIComponent(request.id)}/resend`,
      {},
    );
    setBusyId("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const masked = maskEmailDisplay(result.data.mail.to) ?? "el destinatario";
    if (result.data.mail.status === "sent") {
      setNotice(`Correo enviado a ${masked} (solicitud ${request.code}).`);
    } else {
      setError(`No se pudo enviar a ${masked}: ${result.data.mail.error ?? "el correo no está configurado"}.`);
    }
    resource.reload();
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setCancelBusy(true);
    setNotice("");
    setError("");
    const result = await adminSend<{ request: AdminSignatureRequestRow }>(
      `/api/admin/signatures/${encodeURIComponent(cancelTarget.id)}/cancel`,
      { reason: cancelReason },
    );
    setCancelBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNotice(`Solicitud ${cancelTarget.code} cancelada: el link ya no permite firmar.`);
    setCancelTarget(null);
    setCancelReason("");
    resource.reload();
  }

  return (
    <div className="admin-module-page">
      <PresupuestosTabs active="firmas" />
      <AdminKpis state={kpiState(resource)} label="Indicadores de firmas">
        <AdminKpi label="En curso" icon="pen" value={formatNumber(kpis.active)} note="esperando la firma del cliente" />
        <AdminKpi
          label="Por vencer"
          icon="clock"
          value={formatNumber(kpis.expiring)}
          note="vencen en 7 días o menos"
          tone={kpis.expiring > 0 ? "warn" : undefined}
        />
        <AdminKpi label="Firmadas" icon="check" value={formatNumber(kpis.signed)} note="con firma recibida" tone="ok" />
        <AdminKpi
          label="Vencidas"
          icon="alert"
          value={formatNumber(kpis.expired)}
          note="sin firmar a tiempo"
          tone={kpis.expired > 0 ? "danger" : undefined}
        />
      </AdminKpis>

      <AdminToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Buscar solicitudes de firma"
          placeholder="Buscar por documento, código, destinatario o presupuesto…"
        />
        <AdminSelect value={status} onChange={setStatus} label="Filtrar por estado de firma" options={STATUS_FILTERS} />
      </AdminToolbar>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
      {error ? <AdminNote tone="error">{error}</AdminNote> : null}

      <AdminDataState
        loading={resource.loading}
        error={resource.error}
        onRetry={resource.reload}
        empty={requests.length === 0}
        emptyTitle="Todavía no hay solicitudes de firma"
        emptyIcon="pen"
        emptyHint="Enviá un presupuesto a firma desde su ficha (Presupuestos → Firma del cliente) y aparecerá acá."
      >
        {rows.length === 0 ? (
          <AdminEmpty icon="search" title="Sin resultados" hint="Probá con otro término de búsqueda o cambiá el filtro de estado." />
        ) : (
          <AdminTable
            view="firmas"
            label="Solicitudes de firma"
            columns={[
              { label: "Documento" },
              { label: "Destinatario" },
              { label: "Estado" },
              { label: "Vence" },
              { label: "Correo" },
              { label: "Creada" },
              { label: "Acciones", end: true },
            ]}
          >
            {rows.map((request) => {
              const mail = mailSummary(request);
              const days = daysUntilDue(request.expiresAt);
              return (
                <AdminRow key={request.id}>
                  <AdminCell title={`${request.budgetTitle}${request.document.kind === "attachment" ? ` · ${request.document.name}` : ""}`}>
                    <strong>{request.budgetTitle}</strong>
                    <small className="admin-cell-sub">
                      {" "}
                      · {request.document.kind === "attachment" ? request.document.name : request.title}
                    </small>
                  </AdminCell>
                  <AdminCell title={`${request.recipient.name}${request.recipient.email ? ` · ${maskEmailDisplay(request.recipient.email)}` : ""}`}>
                    {request.recipient.name}
                    <small className="admin-cell-sub">
                      {" "}
                      · {request.recipient.email ? maskEmailDisplay(request.recipient.email) : "sin correo"}
                      {request.recipient.phone ? ` · ${maskPhoneDisplay(request.recipient.phone)}` : ""}
                    </small>
                  </AdminCell>
                  <AdminCell title={`${request.statusLabel} · ${request.methodLabel}${request.otpRequired ? " · pide código por correo" : ""}`}>
                    <AdminBadge tone={signatureStatusTone(request.status)}>
                      {COMPACT_STATUS[request.status] ?? request.statusLabel}
                    </AdminBadge>
                    <small className="admin-cell-sub"> · {COMPACT_METHOD[request.method] ?? request.methodLabel}</small>
                  </AdminCell>
                  <AdminCell title={formatDate(request.expiresAt)}>
                    <span className="admin-nowrap">
                      {ACTIVE_STATUSES.has(request.status) ? formatDateShort(request.expiresAt) : formatDate(request.expiresAt)}
                    </span>
                    {ACTIVE_STATUSES.has(request.status) && days !== null ? (
                      <AdminCountdown
                        value={request.expiresAt}
                        short
                        className="admin-countdown--inline"
                        title={`Vencimiento de la firma ${request.code}`}
                      />
                    ) : null}
                  </AdminCell>
                  <AdminCell title={mail.detail}>
                    <AdminBadge tone={mail.tone}>{mail.badge}</AdminBadge>
                    <small className="admin-cell-sub"> {mail.detail}</small>
                  </AdminCell>
                  <AdminCell title={formatDate(request.createdAt)}>
                    <span className="admin-nowrap">{formatDate(request.createdAt)}</span>
                  </AdminCell>
                  <AdminCell end className="admin-cell--actions">
                    <span className="admin-actions">
                      <AdminButton
                        icon="clock"
                        title={`Ver la cronología de la solicitud ${request.code}`}
                        aria-label={`Ver la cronología de la solicitud ${request.code}`}
                        onClick={() => setTimeline(request)}
                      />
                      <AdminButton
                        icon="copy"
                        title={`Copiar el link de firma ${request.code}`}
                        aria-label={`Copiar el link de firma ${request.code}`}
                        onClick={() => void copyLink(request.portalUrl)}
                      />
                      <AdminIconLink
                        href={request.portalUrl}
                        icon="external"
                        label={`Abrir el portal de firma ${request.code}`}
                        external
                      />
                      {writable && request.active ? (
                        <AdminButton
                          icon="mail"
                          busy={busyId === request.id}
                          title={
                            request.recipient.email
                              ? `Enviar por correo a ${maskEmailDisplay(request.recipient.email)}`
                              : "La solicitud no tiene correo cargado: compartí el link a mano"
                          }
                          aria-label={`Enviar por correo la solicitud ${request.code}`}
                          disabled={!request.recipient.email}
                          onClick={() => void sendByEmail(request)}
                        />
                      ) : null}
                      {writable && request.active ? (
                        <AdminButton
                          icon="close"
                          title={`Cancelar la solicitud ${request.code}`}
                          aria-label={`Cancelar la solicitud ${request.code}`}
                          onClick={() => {
                            setCancelTarget(request);
                            setCancelReason("");
                          }}
                        />
                      ) : null}
                    </span>
                  </AdminCell>
                </AdminRow>
              );
            })}
          </AdminTable>
        )}
      </AdminDataState>

      {timeline ? (
        <AdminDialog title={`Firma · ${timeline.code}`} size="wide" icon="pen" onClose={() => setTimeline(null)}>
          <dl className="admin-dialog-facts">
            <div>
              <dt>Documento</dt>
              <dd>
                {timeline.title} · {timeline.budgetTitle}
              </dd>
            </div>
            <div>
              <dt>Destinatario</dt>
              <dd>
                {timeline.recipient.name}
                {timeline.recipient.email ? ` · ${maskEmailDisplay(timeline.recipient.email)}` : ""}
                {timeline.recipient.phone ? ` · ${maskPhoneDisplay(timeline.recipient.phone)}` : ""}
              </dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>
                {signatureStatusLabel(timeline.status)} · {timeline.methodLabel}
                {timeline.otpRequired ? ` · código ${timeline.otpVerified ? "verificado" : "pendiente"}` : ""}
              </dd>
            </div>
            <div>
              <dt>Vence</dt>
              <dd>{formatDate(timeline.expiresAt)}</dd>
            </div>
          </dl>
          <section aria-label="Evidencias de firma">
            <h3 className="admin-dialog-title admin-dialog-subtitle">Evidencias</h3>
            <p className="admin-signature-detail">
              {timeline.evidence.map((item) => `${signatureEvidenceLabel(item.type)}: ${EVIDENCE_STATUS[item.status] ?? item.status}`).join(" · ")}
            </p>
          </section>
          <SignatureTimeline
            events={timeline.events}
            chainValid={timeline.chainValid}
            documentHash={timeline.documentHash}
            signedDocumentHash={timeline.signedDocumentHash}
            identifier={timeline.signatureIdentifier}
            signedAt={timeline.signedAt}
          />
          <div className="admin-dialog-foot">
            {writable && timeline.active && timeline.recipient.email ? (
              <AdminButton
                icon="mail"
                busy={busyId === timeline.id}
                onClick={() => void sendByEmail(timeline)}
                title={`Enviar por correo a ${maskEmailDisplay(timeline.recipient.email)}`}
              >
                Enviar por correo
              </AdminButton>
            ) : null}
            <span className="admin-dialog-spacer" />
            <AdminButton icon="close" onClick={() => setTimeline(null)}>
              Cerrar
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}

      {cancelTarget ? (
        <AdminDialog title={`Cancelar firma · ${cancelTarget.code}`} icon="close" onClose={() => setCancelTarget(null)}>
          <p className="admin-dialog-text">
            La solicitud de {cancelTarget.recipient.name} deja de aceptar firma al instante; el link muestra el aviso de
            cancelada y la cadena guarda el motivo.
          </p>
          <TextField
            label="Motivo de la cancelación (opcional)"
            value={cancelReason}
            onChange={setCancelReason}
            maxLength={300}
            placeholder="Ej.: el cliente pidió una versión corregida."
          />
          <div className="admin-dialog-foot">
            <AdminButton icon="arrow-left" onClick={() => setCancelTarget(null)} disabled={cancelBusy}>
              Volver
            </AdminButton>
            <span className="admin-dialog-spacer" />
            <AdminButton variant="primary" icon="close" busy={cancelBusy} onClick={() => void confirmCancel()}>
              Confirmar cancelación
            </AdminButton>
          </div>
        </AdminDialog>
      ) : null}
    </div>
  );
}
