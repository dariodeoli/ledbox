import { recordAudit } from "@/lib/server/audit";
import { addDeliveryNotePhoto } from "@/lib/server/delivery-notes";
import { cuotaArchivosOk, SANDBOX_QUOTA_MESSAGE } from "@/lib/server/demo-sandbox";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { DELIVERY_NOTE_PHOTO_MAX_BYTES } from "@/lib/delivery-note";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Foto del remito (multipart `file`): hasta 10, 1 MiB cada una, validada por magic bytes. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("No pudimos leer la foto enviada.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Elegí una foto (JPG, PNG o WebP).", 400);
  if (file.size > DELIVERY_NOTE_PHOTO_MAX_BYTES) return jsonError("Cada foto puede pesar hasta 1 MB.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Tope de archivos de la demo y las sandboxes (fuera de ellas siempre cabe).
  if (!(await cuotaArchivosOk(auth.context.organizationId, bytes.byteLength))) return jsonError(SANDBOX_QUOTA_MESSAGE, 413);
  const result = await addDeliveryNotePhoto({
    organizationId: auth.context.organizationId,
    noteId: id,
    bytes,
    actorId: auth.context.user.id,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  const note = await db.deliveryNote.findFirst({ where: { id, organizationId: auth.context.organizationId }, select: { eventId: true, number: true } });
  if (note) {
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "Event",
      entityId: note.eventId,
      summary: `Agregó una foto al remito Nº ${String(note.number).padStart(6, "0")}`,
      detail: { fields: { photoId: result.photo.id, size: result.photo.size } },
    });
  }
  return Response.json({ photo: result.photo }, { status: 201 });
}
