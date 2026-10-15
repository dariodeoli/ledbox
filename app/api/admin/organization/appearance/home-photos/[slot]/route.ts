import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { deleteHomePhoto, uploadHomePhoto } from "@/lib/server/home-photos";
import { requireAdminContext } from "@/lib/server/tenancy";
import { isHomePhotoSlot } from "@/lib/store-home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fotos de ambientación del inicio (Ajustes → Apariencia): `editorial`, `inspiracion-1`, `inspiracion-2` e
 * `inspiracion-3`. `GET` la sirve con sesión (vista previa), `POST` sube o reemplaza (multipart, JPG/PNG/WebP de
 * hasta 2 MB validada por magic bytes) y `DELETE` la quita. Solo OWNER/ADMIN; siempre la empresa de la sesión.
 */
const slotError = (slot: string) => jsonError(`Foto inválida: «${slot}».`, 400);

export async function GET(_request: Request, { params }: { params: Promise<{ slot: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { slot } = await params;
  if (!isHomePhotoSlot(slot)) return slotError(slot);
  const row = await db.organizationCover.findUnique({ where: { organizationId_kind: { organizationId: auth.context.organizationId, kind: slot } }, select: { mime: true, size: true, data: true } });
  if (!row) return jsonError("Todavía no subiste esa foto.", 404);
  return new Response(new Uint8Array(row.data), { status: 200, headers: { "Content-Type": row.mime, "Content-Length": String(row.size), "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ slot: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { slot } = await params;
  if (!isHomePhotoSlot(slot)) return slotError(slot);
  return uploadHomePhoto(auth.context, slot, request);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ slot: string }> }) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { slot } = await params;
  if (!isHomePhotoSlot(slot)) return slotError(slot);
  return deleteHomePhoto(auth.context, slot);
}
