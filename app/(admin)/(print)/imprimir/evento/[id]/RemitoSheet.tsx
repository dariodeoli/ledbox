import { formatDateTime, formatNumber } from "@/lib/admin-format";
import { organizationLogoUrl } from "@/lib/admin-types";
import {
  DELIVERY_NOTE_KIND_LABEL,
  deliveryNoteNumberLabel,
  deliveryNoteTotals,
  readDeliveryNoteLines,
} from "@/lib/delivery-note";
import { loadOrganizationLogos } from "@/lib/server/branding";
import { db } from "@/lib/server/db";
import { getRentalSettings } from "@/lib/server/rental-settings";
import { PrintEmpty, PrintField, PrintFooter, PrintHeader, PrintSection } from "../../../_components/PrintParts";
import { PrintToolbar } from "../../../_components/PrintToolbar";

/**
 * Hoja del remito de salida o devolución. Se arma SOLO desde el snapshot guardado (`linesSnapshot`,
 * firmante, condiciones congeladas al firmar): lo que se imprime hoy es igual a lo que se firmó.
 * Sin firmar, las condiciones son las vigentes y la hoja lo dice.
 */
export async function RemitoSheet({ organizationId, organizationName, eventId, noteId }: { organizationId: string; organizationName: string; eventId: string; noteId: string }) {
  const note = await db.deliveryNote.findFirst({
    where: { id: noteId, eventId, organizationId },
    include: {
      event: { select: { name: true, location: true, city: true, client: { select: { name: true, company: true, ruc: true, phone: true } } } },
      photos: { select: { id: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!note) return null;
  const signed = note.signedAt !== null;
  const lines = readDeliveryNoteLines(note.linesSnapshot);
  const totals = deliveryNoteTotals(lines);
  const out = note.kind === "OUT";
  const terms = signed ? note.termsSnapshot : (await getRentalSettings(organizationId)).rentalTerms;
  const logos = await loadOrganizationLogos(organizationId);
  const logo = logos.light ? organizationLogoUrl("light", logos.light.updatedAt) : null;
  const reference = deliveryNoteNumberLabel(note.number);
  const client = note.event.client;

  return (
    <>
      <PrintToolbar backHref="/eventos" backLabel="Volver a Eventos" />
      <article className="lbprint-sheet" aria-label={`${DELIVERY_NOTE_KIND_LABEL[note.kind]} ${reference}`}>
        <PrintHeader
          title={DELIVERY_NOTE_KIND_LABEL[note.kind]}
          reference={reference}
          organization={organizationName}
          issuedAt={formatDateTime(note.createdAt)}
          meta={signed ? "Firmado" : "Sin firmar"}
          logo={logo}
        />

        <PrintSection title="Evento y cliente">
          <div className="lbprint-grid">
            <PrintField label="Evento" value={note.event.name} />
            <PrintField label="Lugar" value={[note.event.location, note.event.city].filter(Boolean).join(", ") || "—"} />
            <PrintField label="Cliente" value={client.company || client.name} />
            <PrintField label="RUC" value={client.ruc || "—"} />
            <PrintField label="Teléfono" value={client.phone || "—"} />
          </div>
        </PrintSection>

        <PrintSection title={out ? "Equipos entregados" : "Equipos devueltos"} action={`${formatNumber(totals.moved)} unidades`}>
          {lines.length === 0 ? (
            <PrintEmpty>Este remito no tiene líneas.</PrintEmpty>
          ) : (
            <table className="lbprint-table lbprint-remito-table">
              <thead>
                <tr>
                  <th scope="col">Artículo</th>
                  <th scope="col" className="lbprint-num">{out ? "Pedidas" : "Salieron"}</th>
                  <th scope="col" className="lbprint-num">{out ? "Entregadas" : "Devueltas"}</th>
                  <th scope="col" className="lbprint-num">Dañadas</th>
                  <th scope="col" className="lbprint-num">Faltantes</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.assignmentId}>
                    <td>
                      {line.name}
                      {line.sku ? <span className="lbprint-sku"> · {line.sku}</span> : null}
                    </td>
                    <td className="lbprint-num">{formatNumber(line.ordered)}</td>
                    <td className="lbprint-num">{formatNumber(line.moved)}</td>
                    <td className="lbprint-num">{formatNumber(line.damaged)}</td>
                    <td className="lbprint-num">{formatNumber(line.missing)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {note.notes ? <p>{note.notes}</p> : null}
        </PrintSection>

        {note.photos.length > 0 ? (
          <PrintSection title="Fotos" action={`${formatNumber(note.photos.length)}`}>
            <div className="lbprint-remito-photos">
              {note.photos.map((photo, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={photo.id} src={`/api/admin/delivery-notes/${note.id}/photos/${photo.id}`} alt={`Foto ${index + 1} del remito`} />
              ))}
            </div>
          </PrintSection>
        ) : null}

        <PrintSection title="Condiciones del alquiler">
          {terms ? <p className="lbprint-remito-terms">{terms}</p> : <PrintEmpty>La empresa no cargó condiciones del alquiler.</PrintEmpty>}
          {!signed && terms ? <p className="lbprint-doc-meta">Condiciones vigentes: se congelan al firmar.</p> : null}
        </PrintSection>

        <PrintSection title={out ? "Conformidad de quien recibe" : "Conformidad de quien devuelve"}>
          {signed ? (
            <div className="lbprint-remito-signed">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="lbprint-remito-signature" src={`/api/admin/delivery-notes/${note.id}/signature`} alt="Firma" />
              <div className="lbprint-grid">
                <PrintField label="Nombre" value={note.signerName ?? "—"} />
                <PrintField label="Documento" value={note.signerDocument ?? "—"} />
                <PrintField label="Fecha y hora" value={formatDateTime(note.signedAt)} />
                <PrintField label="IP" value={note.signedIp ?? "—"} />
              </div>
            </div>
          ) : (
            <div className="lbprint-sign">
              <span className="lbprint-sign-box">{out ? "Firma de quien recibe" : "Firma de quien devuelve"}</span>
              <span className="lbprint-sign-box">Aclaración y documento</span>
            </div>
          )}
        </PrintSection>

        <PrintFooter note={`${DELIVERY_NOTE_KIND_LABEL[note.kind]} ${reference} · ${note.event.name}`} />
      </article>
    </>
  );
}
