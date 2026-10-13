"use client";

import { useId, useMemo, useState } from "react";
import { formatDate, maskEmailDisplay } from "@/lib/admin-format";
import { adminSend, useAdminResource } from "@/lib/admin-api";
import type { AdminBudgetRow, AdminSignatureRequestRow } from "@/lib/admin-types";
import { canWriteFinance } from "@/lib/admin-policy";
import { signatureStatusTone } from "@/lib/server/signature/rules";
import { useAdminSession } from "../AdminShell";
import { EmailField, PhoneField, SelectField, SwitchField, TextAreaField, TextField } from "../AdminFields";
import { AdminIcon } from "../AdminIcons";
import { SignatureTimeline } from "../SignatureTimeline";
import { AdminBadge, AdminButton, AdminDialog, AdminDialogSection, AdminIconLink, AdminNote } from "../AdminUI";

/**
 * Diálogo «Firma del cliente» de la ficha del presupuesto (issue #79):
 * enviar a firma (documento, destinatario, vencimiento y método), ver el estado
 * de las solicitudes, la cronología de auditoría con su cadena de hashes,
 * copiar/abrir el link público, reenviar el correo y cancelar (revocar).
 *
 * El envío real lo hace el API (`/api/admin/signatures`); acá no se inventa
 * ningún estado: todo sale de la respuesta.
 */

const EXPIRES_OPTIONS = [
  { value: "7", label: "7 días" },
  { value: "15", label: "15 días" },
  { value: "30", label: "30 días" },
  { value: "60", label: "60 días" },
];

type CreateResult = {
  request: AdminSignatureRequestRow;
  mail: { status: "sent" | "failed" | "skipped"; error: string | null; to: string | null };
};

export function SignatureDialog({ budget, onClose }: { budget: AdminBudgetRow; onClose: () => void }) {
  const { role } = useAdminSession();
  const writable = canWriteFinance(role);
  const resource = useAdminResource<AdminSignatureRequestRow[]>(
    `/api/admin/signatures?budgetId=${encodeURIComponent(budget.id)}`,
    (payload) => (payload.requests as AdminSignatureRequestRow[] | undefined) ?? [],
  );
  const requests = useMemo(() => resource.data ?? [], [resource.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = requests.find((request) => request.id === selectedId) ?? requests[0] ?? null;

  // Alta de la solicitud.
  const [attachmentId, setAttachmentId] = useState("");
  const [recipientName, setRecipientName] = useState(budget.client.name || budget.client.company || "");
  const [recipientEmail, setRecipientEmail] = useState(budget.client.email ?? "");
  const [recipientPhone, setRecipientPhone] = useState(budget.client.phone ?? "");
  const [method, setMethod] = useState("DRAWN");
  const [expiresInDays, setExpiresInDays] = useState("15");
  const [otpRequired, setOtpRequired] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [created, setCreated] = useState<CreateResult | null>(null);
  const createFormId = useId();
  const [notice, setNotice] = useState("");

  // Cancelación y reenvío.
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const attachmentOptions = useMemo(
    () => [
      { value: "", label: "Presupuesto imprimible (recomendado)" },
      ...(budget.attachments ?? []).map((attachment) => ({ value: attachment.id, label: `Adjunto: ${attachment.name}` })),
    ],
    [budget.attachments],
  );

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setNotice(`Link copiado: ${url}`);
    } catch {
      setNotice(`No pudimos copiar automáticamente; el link es ${url}`);
    }
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend<CreateResult>("/api/admin/signatures", {
      budgetId: budget.id,
      attachmentId: attachmentId || null,
      recipientName,
      recipientEmail: recipientEmail || null,
      recipientPhone: recipientPhone || null,
      method,
      expiresInDays: Number(expiresInDays),
      otpRequired,
      message,
    });
    setBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setCreated(result.data);
    setSelectedId(result.data.request.id);
    resource.reload();
  }

  async function cancelRequest(request: AdminSignatureRequestRow) {
    setActionBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend<{ request: AdminSignatureRequestRow }>(
      `/api/admin/signatures/${encodeURIComponent(request.id)}/cancel`,
      { reason: cancelReason },
    );
    setActionBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setCancelId(null);
    setCancelReason("");
    setNotice(`Solicitud ${request.code} cancelada: el link ya no permite firmar.`);
    resource.reload();
  }

  /** Envía (o reenvía) el correo de la solicitud con el destinatario enmascarado. */
  async function sendByEmail(request: AdminSignatureRequestRow) {
    setActionBusy(true);
    setFormError("");
    setNotice("");
    const result = await adminSend<{ mail: { status: "sent" | "failed" | "skipped"; error: string | null; to: string | null } }>(
      `/api/admin/signatures/${encodeURIComponent(request.id)}/resend`,
      {},
    );
    setActionBusy(false);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    const masked = maskEmailDisplay(result.data.mail.to);
    const sent = result.data.mail.status === "sent";
    setNotice(
      sent
        ? `Correo enviado a ${masked ?? "el destinatario"}.`
        : `No se pudo enviar a ${masked ?? "el destinatario"}: ${result.data.mail.error ?? "el correo no está configurado"}.`,
    );
    if (!sent) setFormError("El envío falló: revisá el historial de correo o compartí el link a mano.");
    if (created && created.request.id === request.id) {
      setCreated({ ...created, mail: result.data.mail });
    }
    resource.reload();
  }

  return (
    <AdminDialog
      title={`Firma del cliente · ${budget.title}`}
      size="lg"
      icon="pen"
      description="El cliente recibe un link seguro con código, lee el documento, acepta el consentimiento y firma desde el celular o la computadora. Cada paso queda en una cadena de auditoría inmutable."
      error={formError}
      dirty={!created && writable && (recipientName.trim() !== "" || recipientEmail.trim() !== "" || recipientPhone.trim() !== "" || message.trim() !== "")}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton icon="close" type="button" onClick={requestClose}>
            Cerrar
          </AdminButton>
          {!created && writable ? (
            <AdminButton variant="primary" icon="pen" type="submit" form={createFormId} busy={busy} busyLabel="Enviando…" disabled={!recipientName.trim()}>
              Enviar a firma
            </AdminButton>
          ) : null}
        </>
      )}
    >

      {created ? (
        <section className="admin-signature-result" aria-label="Solicitud creada">
          <h3 className="admin-dialog-title admin-dialog-subtitle">
            <AdminIcon name="check" size={13} /> Solicitud creada
          </h3>
          <dl className="admin-dialog-facts">
            <div>
              <dt>Código</dt>
              <dd className="admin-signature-code">{created.request.code}</dd>
            </div>
            <div>
              <dt>Vence</dt>
              <dd>{formatDate(created.request.expiresAt)}</dd>
            </div>
            <div>
              <dt>Correo</dt>
              <dd>
                {created.mail.status === "sent"
                  ? `enviado a ${maskEmailDisplay(created.mail.to) ?? "el destinatario"}`
                  : created.mail.to
                    ? `no se pudo enviar a ${maskEmailDisplay(created.mail.to)}: ${created.mail.error ?? "sin detalle"}`
                    : "sin correo cargado: compartí el link"}
              </dd>
            </div>
          </dl>
          <div className="admin-signature-actions">
            <AdminButton
              icon="copy"
              onClick={() => void copyLink(created.request.portalUrl)}
              title="Copiar el link de firma para dictarlo o enviarlo a mano"
            >
              Copiar link
            </AdminButton>
            {created.request.recipient.email && created.request.active ? (
              <AdminButton
                icon="mail"
                busy={actionBusy}
                onClick={() => void sendByEmail(created.request)}
                title={`Enviar por correo a ${maskEmailDisplay(created.request.recipient.email)}`}
              >
                Enviar por correo
              </AdminButton>
            ) : null}
            <AdminIconLink href={created.request.portalUrl} icon="external" label="Abrir el portal de firma" external />
            <span className="admin-dialog-spacer" />
            <AdminButton icon="pen" onClick={() => setCreated(null)}>
              Preparar otra
            </AdminButton>
          </div>
        </section>
      ) : writable ? (
        <form id={createFormId} className="admin-form admin-signature-create" onSubmit={(event) => void submitCreate(event)}>
          <AdminDialogSection title="Enviar a firma">
          <SelectField
            label="Documento a firmar"
            value={attachmentId}
            onChange={setAttachmentId}
            options={attachmentOptions}
            wide
            hint="Sin adjunto se firma el presupuesto imprimible (título, ítems, totales y plan)."
          />
          <TextField
            label="Quién firma"
            required
            value={recipientName}
            onChange={setRecipientName}
            maxLength={120}
            placeholder="Nombre y apellido"
          />
          <EmailField
            label="Correo del destinatario"
            value={recipientEmail}
            onChange={setRecipientEmail}
            hint="Opcional: sin correo no se envía el aviso, pero el link se comparte a mano."
          />
          <PhoneField label="Teléfono (opcional)" value={recipientPhone} onChange={setRecipientPhone} />
          </AdminDialogSection>
          <AdminDialogSection title="Más opciones" collapsible hint="método, vencimiento, código OTP y mensaje">
          <SelectField
            label="Método de firma"
            value={method}
            onChange={setMethod}
            options={[
              { value: "DRAWN", label: "Dibujada en pantalla" },
              { value: "TYPED", label: "Tipográfica (nombre escrito)" },
            ]}
          />
          <SelectField label="Vencimiento" value={expiresInDays} onChange={setExpiresInDays} options={EXPIRES_OPTIONS} />
          <SwitchField
            label="Pedir código por correo antes de firmar (OTP)"
            checked={otpRequired}
            onChange={setOtpRequired}
            hint="Requiere el correo del destinatario: enviamos un código de 6 dígitos."
            wide
          />
          <TextAreaField
            label="Mensaje corto (opcional)"
            wide
            value={message}
            onChange={setMessage}
            maxLength={600}
            rows={2}
            placeholder="Ej.: cualquier duda me escribís antes de firmar."
          />
          </AdminDialogSection>
        </form>
      ) : null}

      <section aria-label="Solicitudes de firma del presupuesto">
        <h3 className="admin-dialog-title admin-dialog-subtitle">
          <AdminIcon name="audit" size={13} /> Solicitudes
        </h3>
        {resource.loading ? (
          <p className="admin-dialog-text">Cargando solicitudes…</p>
        ) : resource.error ? (
          <AdminNote tone="error">{resource.error}</AdminNote>
        ) : requests.length === 0 ? (
          <p className="admin-dialog-text">Este presupuesto todavía no tiene solicitudes de firma.</p>
        ) : (
          <div className="admin-signature-list">
            {requests.map((request) => {
              const isSelected = selected?.id === request.id;
              return (
                <article className="admin-signature-card" key={request.id} data-selected={isSelected || undefined}>
                  <header className="admin-signature-head">
                    <AdminBadge tone={signatureStatusTone(request.status)}>{request.statusLabel}</AdminBadge>
                    <span className="admin-signature-code">{request.code}</span>
                    <span className="admin-signature-meta">
                      {request.recipient.name}
                      {request.recipient.email ? ` · ${maskEmailDisplay(request.recipient.email)}` : " · sin correo"} ·{" "}
                      {request.methodLabel} · vence {formatDate(request.expiresAt)}
                    </span>
                  </header>
                  {request.rejectionReason ? (
                    <p className="admin-signature-detail">Motivo del rechazo: {request.rejectionReason}</p>
                  ) : null}
                  {request.cancelReason ? (
                    <p className="admin-signature-detail">Cancelada por {request.senderName}: {request.cancelReason}</p>
                  ) : null}
                  <div className="admin-signature-actions">
                    <AdminButton
                      icon="clock"
                      onClick={() => setSelectedId(isSelected && selected ? null : request.id)}
                      title={`Ver la cronología de la solicitud ${request.code}`}
                    >
                      {isSelected && selected ? "Ocultar" : "Cronología"}
                    </AdminButton>
                    <AdminButton icon="copy" onClick={() => void copyLink(request.portalUrl)} title="Copiar el link de firma">
                      Copiar
                    </AdminButton>
                    <AdminIconLink href={request.portalUrl} icon="external" label={`Abrir el portal de ${request.code}`} external />
                    {writable && request.active ? (
                      <AdminButton
                        icon="mail"
                        busy={actionBusy}
                        onClick={() => void sendByEmail(request)}
                        title={
                          request.recipient.email
                            ? `Enviar por correo a ${maskEmailDisplay(request.recipient.email)}`
                            : "La solicitud no tiene correo cargado: compartí el link a mano"
                        }
                        disabled={!request.recipient.email}
                      >
                        Enviar por correo
                      </AdminButton>
                    ) : null}
                    {writable && request.active ? (
                      cancelId === request.id ? null : (
                        <AdminButton icon="close" onClick={() => { setCancelId(request.id); setCancelReason(""); }} title="Cancelar la solicitud">
                          Cancelar
                        </AdminButton>
                      )
                    ) : null}
                  </div>
                  {cancelId === request.id ? (
                    <div className="admin-signature-cancel">
                      <TextField
                        label="Motivo de la cancelación (opcional)"
                        value={cancelReason}
                        onChange={setCancelReason}
                        maxLength={300}
                      />
                      <div className="admin-signature-actions">
                        <AdminButton icon="arrow-left" onClick={() => setCancelId(null)} disabled={actionBusy}>
                          Volver
                        </AdminButton>
                        <AdminButton variant="primary" icon="close" busy={actionBusy} onClick={() => void cancelRequest(request)}>
                          Confirmar cancelación
                        </AdminButton>
                      </div>
                    </div>
                  ) : null}
                  {isSelected && selected ? (
                    <SignatureTimeline
                      events={selected.events}
                      chainValid={selected.chainValid}
                      documentHash={selected.documentHash}
                      signedDocumentHash={selected.signedDocumentHash}
                      identifier={selected.signatureIdentifier}
                      signedAt={selected.signedAt}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {notice ? <AdminNote tone="ok">{notice}</AdminNote> : null}
    </AdminDialog>
  );
}
