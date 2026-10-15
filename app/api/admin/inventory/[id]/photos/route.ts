import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { addProductPhoto, listProductPhotos, MAX_EXTRA_PHOTOS, reorderProductPhotos } from "@/lib/server/product-photos";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fotos extra de un producto (tienda, parte 2). `GET` las lista, `POST` suma una (multipart `file`, ya comprimida en
 * el navegador, JPG/PNG/WebP real de hasta 2 MB) y `PATCH { ids }` las reordena. Escribir exige `inventory.write`; el
 * producto es siempre de la empresa de la sesión (otro → 404).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const item = await db.inventoryItem.findFirst({ where: { id, organizationId: auth.context.organizationId }, select: { id: true } });
  if (!item) return jsonError("El producto no existe en esta empresa.", 404);
  return Response.json({ photos: await listProductPhotos(auth.context.organizationId, id), max: MAX_EXTRA_PHOTOS });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  return addProductPhoto(auth.context, id, request);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const body = (await readJson(request)) as { ids?: unknown } | null;
  return reorderProductPhotos(auth.context, id, body?.ids);
}
