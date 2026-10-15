import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { recordAudit } from "@/lib/server/audit";
import { requireAdminContext } from "@/lib/server/tenancy";
import { cuotaArchivosOk, SANDBOX_QUOTA_MESSAGE } from "@/lib/server/demo-sandbox";
import { CATEGORY_IMAGE_MAX_BYTES, prepareCategoryPhoto, setCategoryImage } from "@/lib/server/category-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Foto propia de una categoría (Ajustes → Inventario, `org.manage`: OWNER y ADMIN).
 * - `POST multipart { id, file }`: sube o reemplaza (JPG/PNG/WebP real, cuadrada, hasta 1 MB).
 * Quitarla va por `POST /api/admin/inventory/categories { kind: "image-clear", id }`.
 * Todo id se valida contra la empresa activa; uno ajeno responde 404.
 */
export async function POST(request: Request) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("No pudimos leer la foto enviada.", 400);
  }
  const id = typeof form.get("id") === "string" ? (form.get("id") as string) : "";
  const file = form.get("file");
  if (!id) return jsonError("Falta la categoría.", 400);
  const category = await db.inventoryCategory.findFirst({ where: { id, organizationId }, select: { id: true, name: true } });
  if (!category) return jsonError("La categoría no existe en esta empresa.", 404);
  if (!(file instanceof File)) return jsonError("Elegí una foto (JPG, PNG o WebP).", 400);
  if (file.size === 0) return jsonError("La foto está vacía; probá con otra.", 400);
  if (file.size > CATEGORY_IMAGE_MAX_BYTES) return jsonError("La foto supera 1 MB; probá con una más liviana.", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(await cuotaArchivosOk(organizationId, bytes.byteLength))) return jsonError(SANDBOX_QUOTA_MESSAGE, 413);
  const prepared = await prepareCategoryPhoto(bytes);
  if (!prepared.ok) return jsonError(prepared.error, 400);
  const ok = await db.$transaction((tx) => setCategoryImage(tx, organizationId, id, prepared.photo));
  if (!ok) return jsonError("La categoría no existe en esta empresa.", 404);
  await recordAudit({ context: auth.context, action: "update", entity: "InventoryCategory", entityId: id, summary: `Subió la foto de la categoría «${category.name}»`, detail: { fields: { operacion: "foto", bytes: prepared.photo.data.byteLength } } });
  const updated = await db.inventoryCategory.findFirst({ where: { id, organizationId }, select: { imageUrl: true } });
  return Response.json({ category: { id, imageUrl: updated?.imageUrl ?? null } });
}
