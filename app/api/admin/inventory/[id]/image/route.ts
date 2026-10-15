import { db } from "@/lib/server/db";
import { cuotaArchivosOk, SANDBOX_QUOTA_MESSAGE } from "@/lib/server/demo-sandbox";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { recordAudit } from "@/lib/server/audit";
import { detectInventoryImageMime, INVENTORY_IMAGE_MAX_BYTES } from "@/lib/admin-types";
import { inventoryImageUrl } from "@/lib/server/inventory-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `POST /api/admin/inventory/[id]/image` (issue #109): sube —o reemplaza— la foto
 * del ítem de inventario.
 *
 * Recibe `multipart/form-data` con `file`, ya comprimido en el navegador (hasta
 * 2 MB). El tipo se decide por **magic bytes** (JPG, PNG o WebP): ni el MIME
 * declarado ni la extensión cuentan, así un ejecutable renombrado se rechaza. El
 * binario queda en la base y se sirve público por `/api/inventory-images/<id>`.
 *
 * La respuesta trae el `imageUrl` efectivo: la URL manual del ítem tiene
 * prioridad sobre la foto subida.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const item = await db.inventoryItem.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true, name: true, imageUrl: true },
  });
  if (!item) return jsonError("El ítem de inventario no existe en esta empresa.", 404);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("No pudimos leer la foto enviada.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Elegí una foto (JPG, PNG o WebP).", 400);
  if (file.size === 0) return jsonError("La foto está vacía; probá con otra.", 400);
  if (file.size > INVENTORY_IMAGE_MAX_BYTES) {
    return jsonError("La foto supera los 2 MB; probá con otra.", 400);
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const mime = detectInventoryImageMime(data);
  if (!mime) {
    return jsonError("El archivo no es un JPG, PNG o WebP real: revisá que no esté renombrado.", 400);
  }
  if (!(await cuotaArchivosOk(auth.context.organizationId, data.byteLength))) return jsonError(SANDBOX_QUOTA_MESSAGE, 413);

  const inventory = await db.inventoryItem.update({
    where: { id: item.id },
    data: { imageData: data, imageMime: mime },
    select: { id: true, imageUrl: true, imageMime: true, updatedAt: true },
  });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "InventoryItem",
    entityId: item.id,
    summary: `Subió la foto de «${item.name}»`,
    detail: { fields: { imageMime: mime, imageSize: data.byteLength } },
  });

  return Response.json({ inventory: { id: inventory.id, imageUrl: inventoryImageUrl(inventory) } });
}

/**
 * `DELETE /api/admin/inventory/[id]/image`: quita la foto subida del ítem
 * (issue #111). No toca la URL manual: si existe, sigue siendo la imagen del
 * ítem. La respuesta deja el `imageUrl` efectivo resultante.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const item = await db.inventoryItem.findFirst({
    where: { id, organizationId: auth.context.organizationId },
    select: { id: true, name: true, imageUrl: true, imageMime: true, updatedAt: true },
  });
  if (!item) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
  if (!item.imageMime) {
    return Response.json({ inventory: { id: item.id, imageUrl: inventoryImageUrl({ ...item, imageMime: null }) } });
  }
  const inventory = await db.inventoryItem.update({
    where: { id: item.id },
    data: { imageData: null, imageMime: null },
    select: { id: true, imageUrl: true, imageMime: true, updatedAt: true },
  });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "InventoryItem",
    entityId: item.id,
    summary: `Quitó la foto del ítem «${item.name}»`,
    detail: { fields: { imageMime: item.imageMime } },
  });
  return Response.json({ inventory: { id: inventory.id, imageUrl: inventoryImageUrl(inventory) } });
}
