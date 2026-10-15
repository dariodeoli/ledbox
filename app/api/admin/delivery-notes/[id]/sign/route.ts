import { recordAudit } from "@/lib/server/audit";
import { signDeliveryNote } from "@/lib/server/delivery-notes";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { trustedIp } from "@/lib/server/trusted-ip";
import { DELIVERY_NOTE_KIND_LABEL, deliveryNoteNumberLabel } from "@/lib/delivery-note";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Firma el remito en el lugar (celular del operador): trazo DRAWN + nombre y documento. Una sola vez. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await readJson(request)) as Record<string, unknown> | null;
  const result = await signDeliveryNote({
    organizationId: auth.context.organizationId,
    noteId: id,
    signer: { name: body?.signerName, document: body?.signerDocument },
    signatureDataUrl: body?.signature,
    actorId: auth.context.user.id,
    ip: trustedIp(request),
    userAgent: request.headers.get("user-agent"),
  });
  if (!result.ok) return jsonError(result.error, result.status);
  const { note } = result;
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "Event",
    entityId: note.eventId,
    summary: `Firmó el ${DELIVERY_NOTE_KIND_LABEL[note.kind].toLowerCase()} ${deliveryNoteNumberLabel(note.number)} (recibe ${note.signerName})`,
    detail: { fields: { remito: note.number, kind: note.kind, signerDocument: note.signerDocument, lines: note.lines.length } },
  });
  return Response.json({ note });
}
