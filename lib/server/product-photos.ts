import { randomUUID } from "node:crypto";
import { detectInventoryImageMime, INVENTORY_IMAGE_MAX_BYTES } from "@/lib/admin-types";
import { recordAudit } from "./audit";
import { db } from "./db";
import { cuotaArchivosOk, SANDBOX_QUOTA_MESSAGE } from "./demo-sandbox";
import { jsonError } from "./http";
import type { AdminContext } from "./tenancy";

/**
 * Varias fotos por producto (tienda, parte 2). La foto principal sigue en `InventoryItem` (`imageUrl` o la subida) y
 * es siempre la primera de la galería; las demás viven en `InventoryImage`, ordenadas por `position`.
 * Todo está acotado a la empresa del contexto: un producto o una foto de otra empresa responde 404.
 */

export const MAX_EXTRA_PHOTOS = 8;
export const PHOTO_ALT_MAX = 120;

export type ProductPhotoView = { id: string; position: number; alt: string | null; url: string };

/** Ruta pública de una foto extra; `version` corta la caché inmutable al reemplazarla. */
export function productPhotoPath(id: string, version?: string | Date | null): string {
  const value = version instanceof Date ? version.toISOString() : version;
  return `/api/inventory-photos/${encodeURIComponent(id)}${value ? `?v=${encodeURIComponent(value)}` : ""}`;
}

export async function listProductPhotos(organizationId: string, itemId: string): Promise<ProductPhotoView[]> {
  const rows = await db.inventoryImage.findMany({
    where: { organizationId, itemId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true, position: true, alt: true, updatedAt: true },
  });
  return rows.map((row) => ({ id: row.id, position: row.position, alt: row.alt, url: productPhotoPath(row.id, row.updatedAt) }));
}

/** Fotos extra de varios productos de una empresa en UNA consulta (sin los bytes): para la tienda. */
export async function loadGalleryUrls(organizationId: string, itemIds: readonly string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (itemIds.length === 0) return result;
  const rows = await db.inventoryImage.findMany({
    where: { organizationId, itemId: { in: [...itemIds] } },
    orderBy: [{ itemId: "asc" }, { position: "asc" }, { createdAt: "asc" }],
    select: { id: true, itemId: true, updatedAt: true },
  });
  for (const row of rows) {
    const list = result.get(row.itemId) ?? [];
    list.push(productPhotoPath(row.id, row.updatedAt));
    result.set(row.itemId, list);
  }
  return result;
}

async function itemOf(context: AdminContext, itemId: string) {
  return db.inventoryItem.findFirst({ where: { id: itemId, organizationId: context.organizationId }, select: { id: true, name: true } });
}

/** `POST`: multipart con `file` (ya comprimido en el navegador, hasta 2 MB). La firma real manda sobre el MIME declarado. */
export async function addProductPhoto(context: AdminContext, itemId: string, request: Request): Promise<Response> {
  const { organizationId } = context;
  const item = await itemOf(context, itemId);
  if (!item) return jsonError("El producto no existe en esta empresa.", 404);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("No pudimos leer la foto enviada.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Elegí una foto (JPG, PNG o WebP).", 400);
  if (file.size === 0) return jsonError("La foto está vacía; probá con otra.", 400);
  if (file.size > INVENTORY_IMAGE_MAX_BYTES) return jsonError("La foto supera los 2 MB; probá con otra.", 400);
  const data = new Uint8Array(await file.arrayBuffer());
  const mime = detectInventoryImageMime(data);
  if (!mime) return jsonError("El archivo no es un JPG, PNG o WebP real: revisá que no esté renombrado.", 400);
  if (!(await cuotaArchivosOk(organizationId, data.byteLength))) return jsonError(SANDBOX_QUOTA_MESSAGE, 413);
  const altRaw = form.get("alt");
  const alt = typeof altRaw === "string" ? altRaw.replace(/\s+/g, " ").trim().slice(0, PHOTO_ALT_MAX) || null : null;

  const created = await db.$transaction(async (tx) => {
    // El candado del producto ordena las altas simultáneas: el tope y la posición no se pisan.
    await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${item.id} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const current = await tx.inventoryImage.findMany({ where: { organizationId, itemId: item.id }, select: { position: true } });
    if (current.length >= MAX_EXTRA_PHOTOS) return null;
    const position = current.reduce((max, row) => Math.max(max, row.position), 0) + 1;
    return tx.inventoryImage.create({
      data: { id: randomUUID(), organizationId, itemId: item.id, position, alt, mime, size: data.byteLength, data },
      select: { id: true, position: true, alt: true, updatedAt: true },
    });
  });
  if (!created) return jsonError(`Cada producto admite hasta ${MAX_EXTRA_PHOTOS + 1} fotos (la principal y ${MAX_EXTRA_PHOTOS} más). Quitá una para sumar otra.`, 409);
  await recordAudit({ context, action: "update", entity: "InventoryItem", entityId: item.id, summary: `Sumó una foto a «${item.name}»`, detail: { fields: { fotoExtra: "subida", mime, size: data.byteLength } } });
  return Response.json({ photo: { id: created.id, position: created.position, alt: created.alt, url: productPhotoPath(created.id, created.updatedAt) } }, { status: 201 });
}

/** Reordena: `ids` tiene que ser exactamente el conjunto actual de fotos extra del producto. */
export async function reorderProductPhotos(context: AdminContext, itemId: string, ids: unknown): Promise<Response> {
  const { organizationId } = context;
  const item = await itemOf(context, itemId);
  if (!item) return jsonError("El producto no existe en esta empresa.", 404);
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return jsonError("El orden de las fotos no es válido.", 400);
  const wanted = ids as string[];
  const ok = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${item.id} AND "organizationId" = ${organizationId} FOR UPDATE`;
    const current = await tx.inventoryImage.findMany({ where: { organizationId, itemId: item.id }, select: { id: true } });
    if (current.length !== wanted.length || new Set(wanted).size !== wanted.length || !current.every((row) => wanted.includes(row.id))) return false;
    for (let index = 0; index < wanted.length; index += 1) {
      await tx.inventoryImage.updateMany({ where: { id: wanted[index], organizationId, itemId: item.id }, data: { position: index + 1 } });
    }
    return true;
  });
  if (!ok) return jsonError("La lista de fotos cambió: recargá la ficha y probá de nuevo.", 409);
  await recordAudit({ context, action: "update", entity: "InventoryItem", entityId: item.id, summary: `Reordenó las fotos de «${item.name}»`, detail: { fields: { fotos: wanted.length } } });
  return Response.json({ photos: await listProductPhotos(organizationId, item.id) });
}

export async function removeProductPhoto(context: AdminContext, itemId: string, photoId: string): Promise<Response> {
  const { organizationId } = context;
  const item = await itemOf(context, itemId);
  if (!item) return jsonError("El producto no existe en esta empresa.", 404);
  const removed = await db.$transaction(async (tx) => {
    const gone = await tx.inventoryImage.deleteMany({ where: { id: photoId, itemId: item.id, organizationId } });
    if (gone.count === 0) return false;
    const rest = await tx.inventoryImage.findMany({ where: { organizationId, itemId: item.id }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
    for (let index = 0; index < rest.length; index += 1) await tx.inventoryImage.updateMany({ where: { id: rest[index].id, organizationId }, data: { position: index + 1 } });
    return true;
  });
  if (!removed) return jsonError("Esa foto no existe en este producto.", 404);
  await recordAudit({ context, action: "update", entity: "InventoryItem", entityId: item.id, summary: `Quitó una foto de «${item.name}»`, detail: { fields: { fotoExtra: "quitada" } } });
  return Response.json({ photos: await listProductPhotos(organizationId, item.id) });
}

/** Texto alternativo de una foto (accesibilidad). */
export async function updateProductPhotoAlt(context: AdminContext, itemId: string, photoId: string, altRaw: unknown): Promise<Response> {
  const { organizationId } = context;
  if (altRaw !== null && typeof altRaw !== "string") return jsonError("El texto alternativo tiene que ser un texto.", 400);
  const alt = typeof altRaw === "string" ? altRaw.replace(/\s+/g, " ").trim() : "";
  if (alt.length > PHOTO_ALT_MAX) return jsonError(`El texto alternativo no puede superar los ${PHOTO_ALT_MAX} caracteres.`, 400);
  const updated = await db.inventoryImage.updateMany({ where: { id: photoId, itemId, organizationId }, data: { alt: alt || null } });
  if (updated.count === 0) return jsonError("Esa foto no existe en este producto.", 404);
  return Response.json({ photos: await listProductPhotos(organizationId, itemId) });
}
