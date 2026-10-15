"use client";

import { useId, useState } from "react";
import { SignatureCanvas } from "@/app/(portal)/_components/SignatureCanvas";
import { adminApiUpload, adminSend, useAdminResource } from "@/lib/admin-api";
import { formatDateTime, formatNumber } from "@/lib/admin-format";
import {
  DELIVERY_NOTE_KIND_LABEL,
  DELIVERY_NOTE_MAX_DOCUMENT,
  DELIVERY_NOTE_MAX_NAME,
  DELIVERY_NOTE_MAX_PHOTOS,
  DELIVERY_NOTE_PHOTO_MAX_BYTES,
  deliveryNoteNumberLabel,
  deliveryNoteTotals,
  type AdminDeliveryNote,
} from "@/lib/delivery-note";
import { FileField, TextField } from "../AdminFields";
import { AdminBadge, AdminButton, AdminButtonLink, AdminDataState, AdminDialog, AdminDialogSection, AdminNote } from "../AdminUI";

/**
 * Remitos de salida y de devolución de un evento (P1-5). Nacen solos al despachar o devolver, con lo
 * realmente movido. El operador los firma en el lugar, en su celular (trazo dibujado del portal),
 * con fotos opcionales; ya firmados no se pueden cambiar. VIEWER solo los mira y los imprime.
 */
export function RemitosPanel({ eventId, writable, reloadKey }: { eventId: string; writable: boolean; reloadKey: number }) {
  const resource = useAdminResource<AdminDeliveryNote[]>(
    `/api/admin/delivery-notes?eventId=${encodeURIComponent(eventId)}&k=${reloadKey}`,
    (payload) => payload.notes ?? [],
  );
  const [signing, setSigning] = useState<AdminDeliveryNote | null>(null);
  const notes = resource.data ?? [];

  return (
    <section aria-label="Remitos">
      <AdminDataState
        loading={resource.loading && !resource.data}
        error={resource.error}
        onRetry={resource.reload}
        empty={notes.length === 0}
        emptyTitle="Sin remitos todavía"
        emptyHint="El remito se genera al despachar o devolver equipos del evento."
        emptyIcon="print"
        rows={2}
      >
        <ul className="admin-remito-list">
          {notes.map((note) => {
            const totals = deliveryNoteTotals(note.lines);
            const out = note.kind === "OUT";
            return (
              <li key={note.id} className="admin-remito">
                <div className="admin-remito-head">
                  <strong>
                    {DELIVERY_NOTE_KIND_LABEL[note.kind]} {deliveryNoteNumberLabel(note.number)}
                  </strong>
                  <AdminBadge tone={note.signed ? "ok" : "warn"}>{note.signed ? "Firmado" : "Sin firmar"}</AdminBadge>
                </div>
                <ul className="admin-remito-lines">
                  {note.lines.map((line) => (
                    <li key={line.assignmentId}>
                      <span className="admin-remito-name">{line.name}</span>
                      <span className="admin-remito-qty">
                        {formatNumber(line.moved)} de {formatNumber(line.ordered)} {out ? "entregadas" : "devueltas"}
                        {line.damaged > 0 ? ` · ${formatNumber(line.damaged)} dañadas` : ""}
                        {line.missing > 0 ? ` · ${formatNumber(line.missing)} faltantes` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="admin-remito-meta">
                  {formatNumber(totals.moved)} {out ? "unidades entregadas" : "unidades devueltas"}
                  {note.signed ? ` · Firmó ${note.signerName} (${note.signerDocument}) el ${formatDateTime(note.signedAt)}` : ""}
                  {note.photos.length > 0 ? ` · ${formatNumber(note.photos.length)} foto${note.photos.length === 1 ? "" : "s"}` : ""}
                </p>
                <div className="admin-actions">
                  {writable && !note.signed ? (
                    <AdminButton type="button" variant="primary" icon="check" onClick={() => setSigning(note)}>
                      Firmar remito
                    </AdminButton>
                  ) : null}
                  <AdminButtonLink href={`/imprimir/evento/${encodeURIComponent(eventId)}?remito=${encodeURIComponent(note.id)}`} target="_blank">
                    Imprimir
                  </AdminButtonLink>
                </div>
              </li>
            );
          })}
        </ul>
      </AdminDataState>
      {signing ? (
        <SignDialog
          note={signing}
          onClose={() => setSigning(null)}
          onSigned={() => {
            setSigning(null);
            resource.reload();
          }}
        />
      ) : null}
    </section>
  );
}

function SignDialog({ note, onClose, onSigned }: { note: AdminDeliveryNote; onClose: () => void; onSigned: () => void }) {
  const formId = useId();
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [photos, setPhotos] = useState(note.photos);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const out = note.kind === "OUT";

  async function addPhoto(file: File | null) {
    if (!file) return;
    setError("");
    if (photos.length >= DELIVERY_NOTE_MAX_PHOTOS) return setError(`Un remito admite hasta ${DELIVERY_NOTE_MAX_PHOTOS} fotos.`);
    setPhotoBusy(true);
    try {
      // La foto del celular se achica en el navegador para entrar en 1 MB.
      const { prepareProofFile } = await import("@/app/(portal)/_components/portal-proof-image");
      const prepared = await prepareProofFile(file);
      if ("error" in prepared || prepared.mime === "application/pdf") {
        setError("error" in prepared ? prepared.error : "Subí una foto (JPG, PNG o WebP).");
        return;
      }
      if (prepared.blob.size > DELIVERY_NOTE_PHOTO_MAX_BYTES) return setError("La foto sigue pesando más de 1 MB; sacá otra.");
      const form = new FormData();
      form.append("file", prepared.blob, "foto");
      const result = await adminApiUpload<{ photo: { id: string; size: number; mime: string } }>(`/api/admin/delivery-notes/${note.id}/photos`, form);
      if (!result.ok) return setError(result.error);
      setPhotos((current) => [...current, result.data.photo]);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto(photoId: string) {
    setError("");
    const result = await adminSend<{ ok: true }>(`/api/admin/delivery-notes/${note.id}/photos/${photoId}`, undefined, "DELETE");
    if (!result.ok) return setError(result.error);
    setPhotos((current) => current.filter((photo) => photo.id !== photoId));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !document.trim()) return setError("Completá el nombre y el documento de quien recibe.");
    if (!signature) return setError("Dibujá la firma dentro del recuadro.");
    setBusy(true);
    setError("");
    const result = await adminSend<{ note: AdminDeliveryNote }>(`/api/admin/delivery-notes/${note.id}/sign`, { signerName: name, signerDocument: document, signature });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onSigned();
  }

  return (
    <AdminDialog
      title={`Firmar ${DELIVERY_NOTE_KIND_LABEL[note.kind].toLowerCase()} ${deliveryNoteNumberLabel(note.number)}`}
      icon="check"
      description={out ? "Quien recibe los equipos firma acá, en este celular." : "Quien entrega los equipos de vuelta firma acá, en este celular."}
      size="md"
      dirty={Boolean(name || document || signature)}
      error={error || null}
      onClose={onClose}
      footer={({ requestClose }) => (
        <>
          <AdminButton type="button" onClick={requestClose}>
            Cancelar
          </AdminButton>
          <AdminButton type="submit" form={formId} variant="primary" icon="check" busy={busy} busyLabel="Firmando…">
            Firmar y cerrar remito
          </AdminButton>
        </>
      )}
    >
      <form id={formId} className="admin-form" onSubmit={submit} noValidate aria-busy={busy || undefined}>
        <AdminDialogSection title="Lo que se firma">
          <ul className="admin-remito-lines">
            {note.lines.map((line) => (
              <li key={line.assignmentId}>
                <span className="admin-remito-name">{line.name}</span>
                <span className="admin-remito-qty">
                  {formatNumber(line.moved)} de {formatNumber(line.ordered)} {out ? "entregadas" : "devueltas"}
                  {line.damaged > 0 ? ` · ${formatNumber(line.damaged)} dañadas` : ""}
                  {line.missing > 0 ? ` · ${formatNumber(line.missing)} faltantes` : ""}
                </span>
              </li>
            ))}
          </ul>
          <AdminNote>Una vez firmado, el remito no se puede cambiar.</AdminNote>
        </AdminDialogSection>
        <AdminDialogSection title="Quien firma">
          <TextField label="Nombre completo" required maxLength={DELIVERY_NOTE_MAX_NAME} autoComplete="off" value={name} onChange={setName} />
          <TextField label="Documento (CI o RUC)" required maxLength={DELIVERY_NOTE_MAX_DOCUMENT} autoComplete="off" inputMode="text" value={document} onChange={setDocument} />
        </AdminDialogSection>
        <AdminDialogSection title="Fotos" collapsible defaultOpen={photos.length > 0} hint={`${photos.length} de ${DELIVERY_NOTE_MAX_PHOTOS}`}>
          <FileField
            label="Agregar foto del estado de los equipos"
            hint="JPG, PNG o WebP. Se achica sola para entrar en 1 MB."
            accept="image/jpeg,image/png,image/webp"
            maxBytes={30 * 1024 * 1024}
            disabled={photoBusy || photos.length >= DELIVERY_NOTE_MAX_PHOTOS}
            file={null}
            onSelect={(file) => void addPhoto(file)}
            wide
          />
          {photos.length > 0 ? (
            <ul className="admin-remito-photos">
              {photos.map((photo, index) => (
                <li key={photo.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/admin/delivery-notes/${note.id}/photos/${photo.id}`} alt={`Foto ${index + 1} del remito`} loading="lazy" />
                  <AdminButton type="button" icon="close" aria-label={`Quitar la foto ${index + 1}`} onClick={() => void removePhoto(photo.id)} />
                </li>
              ))}
            </ul>
          ) : null}
        </AdminDialogSection>
        <AdminDialogSection title="Firma">
          <SignatureCanvas onChange={setSignature} disabled={busy} />
        </AdminDialogSection>
      </form>
    </AdminDialog>
  );
}
