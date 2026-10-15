import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { COLLECTIONS_MAX, collectionSlug, parseCollectionInput, sortCollections, uniqueSlug } from "@/lib/collections";
import { COVER_MAX_BYTES, COVER_MESSAGES } from "@/lib/appearance";
import { recordAudit } from "./audit";
import { prepareImage } from "./covers";
import { db } from "./db";
import { cuotaArchivosOk, SANDBOX_QUOTA_MESSAGE } from "./demo-sandbox";
import { jsonError } from "./http";
import type { AdminContext } from "./tenancy";

/**
 * Colecciones con nombre de la tienda. Todo está acotado a la empresa del contexto: una colección o un producto de
 * otra empresa responde 404 (o 400 «no existe en esta empresa» al elegir productos) y nunca se mezclan.
 */

export const COLLECTION_PHOTO_WIDTH = 1400;

export type CollectionAdminView = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  visible: boolean;
  sortOrder: number;
  /** Versión de la foto (ISO) o `null`; la ruta es `/api/admin/collections/<id>/image?v=`. */
  imageVersion: string | null;
  itemIds: string[];
};

export function collectionImagePath(id: string, version?: string | Date | null): string {
  const value = version instanceof Date ? version.toISOString() : version;
  return `/api/collection-images/${encodeURIComponent(id)}${value ? `?v=${encodeURIComponent(value)}` : ""}`;
}

export async function listCollections(organizationId: string): Promise<CollectionAdminView[]> {
  const rows = await db.collection.findMany({
    where: { organizationId },
    select: { id: true, name: true, slug: true, description: true, visible: true, sortOrder: true, imageMime: true, updatedAt: true, items: { orderBy: { position: "asc" }, select: { itemId: true } } },
  });
  return sortCollections(rows).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    visible: row.visible,
    sortOrder: row.sortOrder,
    imageVersion: row.imageMime ? row.updatedAt.toISOString() : null,
    itemIds: row.items.map((entry) => entry.itemId),
  }));
}

async function ownedItemIds(tx: Prisma.TransactionClient | typeof db, organizationId: string, ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const found = await tx.inventoryItem.count({ where: { id: { in: [...ids] }, organizationId } });
  return found === ids.length;
}

async function replaceItems(tx: Prisma.TransactionClient, organizationId: string, collectionId: string, ids: readonly string[]) {
  await tx.collectionItem.deleteMany({ where: { collectionId, organizationId } });
  if (ids.length > 0) await tx.collectionItem.createMany({ data: ids.map((itemId, index) => ({ collectionId, itemId, organizationId, position: index })) });
}

export async function createCollection(context: AdminContext, body: unknown): Promise<Response> {
  const { organizationId } = context;
  const parsed = parseCollectionInput(body);
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const value = parsed.value;
  if (!(await ownedItemIds(db, organizationId, value.itemIds))) return jsonError("Alguno de los productos elegidos no existe en esta empresa.", 400);
  try {
    const created = await db.$transaction(async (tx) => {
      const rows = await tx.collection.findMany({ where: { organizationId }, select: { slug: true } });
      if (rows.length >= COLLECTIONS_MAX) return null;
      const slug = uniqueSlug(collectionSlug(value.name), new Set(rows.map((row) => row.slug)));
      const row = await tx.collection.create({ data: { id: randomUUID(), organizationId, name: value.name, slug, description: value.description, visible: value.visible, sortOrder: value.sortOrder } });
      await replaceItems(tx, organizationId, row.id, value.itemIds);
      return row;
    });
    if (!created) return jsonError(`Cada empresa admite hasta ${COLLECTIONS_MAX} colecciones.`, 409);
    await recordAudit({ context, action: "create", entity: "Organization", entityId: organizationId, summary: `Creó la colección «${created.name}»`, detail: { fields: { nombre: created.name, productos: value.itemIds.length } } });
    return Response.json({ collection: (await listCollections(organizationId)).find((entry) => entry.id === created.id) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return jsonError("Ya existe una colección con ese nombre; probá con otro.", 409);
    throw error;
  }
}

export async function updateCollection(context: AdminContext, id: string, body: unknown): Promise<Response> {
  const { organizationId } = context;
  const current = await db.collection.findFirst({ where: { id, organizationId }, select: { id: true, name: true, description: true, visible: true, sortOrder: true, items: { orderBy: { position: "asc" }, select: { itemId: true } } } });
  if (!current) return jsonError("La colección no existe en esta empresa.", 404);
  const parsed = parseCollectionInput(body, { name: current.name, description: current.description, visible: current.visible, sortOrder: current.sortOrder, itemIds: current.items.map((entry) => entry.itemId) });
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const value = parsed.value;
  if (!(await ownedItemIds(db, organizationId, value.itemIds))) return jsonError("Alguno de los productos elegidos no existe en esta empresa.", 400);
  await db.$transaction(async (tx) => {
    await tx.collection.updateMany({ where: { id, organizationId }, data: { name: value.name, description: value.description, visible: value.visible, sortOrder: value.sortOrder } });
    await replaceItems(tx, organizationId, id, value.itemIds);
  });
  await recordAudit({ context, action: "update", entity: "Organization", entityId: organizationId, summary: `Editó la colección «${value.name}»`, detail: { fields: { nombre: value.name, productos: value.itemIds.length, visible: value.visible } } });
  return Response.json({ collection: (await listCollections(organizationId)).find((entry) => entry.id === id) });
}

export async function deleteCollection(context: AdminContext, id: string): Promise<Response> {
  const { organizationId } = context;
  const current = await db.collection.findFirst({ where: { id, organizationId }, select: { name: true } });
  if (!current) return jsonError("La colección no existe en esta empresa.", 404);
  await db.collection.deleteMany({ where: { id, organizationId } });
  await recordAudit({ context, action: "delete", entity: "Organization", entityId: organizationId, summary: `Eliminó la colección «${current.name}»`, detail: { fields: { nombre: current.name } } });
  return Response.json({ ok: true });
}

export async function uploadCollectionImage(context: AdminContext, id: string, request: Request): Promise<Response> {
  const { organizationId } = context;
  const current = await db.collection.findFirst({ where: { id, organizationId }, select: { name: true } });
  if (!current) return jsonError("La colección no existe en esta empresa.", 404);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("No pudimos leer la foto enviada.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Elegí una imagen (JPG, PNG o WebP).", 400);
  if (file.size === 0) return jsonError(COVER_MESSAGES.empty, 400);
  if (file.size > COVER_MAX_BYTES) return jsonError("La foto supera los 2 MB: comprimila o elegí otra.", 413);
  const prepared = await prepareImage(new Uint8Array(await file.arrayBuffer()), COLLECTION_PHOTO_WIDTH);
  if (!prepared.ok) return jsonError(prepared.error, prepared.status);
  if (!(await cuotaArchivosOk(organizationId, prepared.data.byteLength))) return jsonError(SANDBOX_QUOTA_MESSAGE, 413);
  const saved = await db.collection.update({ where: { id }, data: { imageData: prepared.data, imageMime: prepared.mime }, select: { updatedAt: true } });
  await recordAudit({ context, action: "update", entity: "Organization", entityId: organizationId, summary: `Subió la foto de la colección «${current.name}»`, detail: { fields: { foto: "subida", size: prepared.data.byteLength } } });
  return Response.json({ imageVersion: saved.updatedAt.toISOString() });
}

export async function removeCollectionImage(context: AdminContext, id: string): Promise<Response> {
  const { organizationId } = context;
  const current = await db.collection.findFirst({ where: { id, organizationId }, select: { name: true, imageMime: true } });
  if (!current) return jsonError("La colección no existe en esta empresa.", 404);
  if (!current.imageMime) return Response.json({ imageVersion: null, unchanged: true });
  await db.collection.updateMany({ where: { id, organizationId }, data: { imageData: null, imageMime: null } });
  await recordAudit({ context, action: "update", entity: "Organization", entityId: organizationId, summary: `Quitó la foto de la colección «${current.name}»`, detail: { fields: { foto: "quitada" } } });
  return Response.json({ imageVersion: null });
}

/**
 * Importación: crea o actualiza una colección por nombre (clave sin tildes ni mayúsculas) de ESA empresa y deja los
 * productos pedidos (sin quitar los que ya tenía). Devuelve el id y si se creó. Corre dentro de la transacción del llamador.
 */
export async function upsertCollectionByName(
  tx: Prisma.TransactionClient,
  organizationId: string,
  entry: { nombre: string; descripcion?: string | null; orden?: number | null },
): Promise<{ id: string; created: boolean }> {
  const slugBase = collectionSlug(entry.nombre);
  const existing = await tx.collection.findFirst({ where: { organizationId, slug: slugBase }, select: { id: true } });
  if (existing) {
    const data: Prisma.CollectionUpdateManyMutationInput = {};
    if (entry.descripcion) data.description = entry.descripcion;
    if (entry.orden !== null && entry.orden !== undefined) data.sortOrder = entry.orden;
    if (Object.keys(data).length > 0) await tx.collection.updateMany({ where: { id: existing.id, organizationId }, data });
    return { id: existing.id, created: false };
  }
  const taken = new Set((await tx.collection.findMany({ where: { organizationId }, select: { slug: true } })).map((row) => row.slug));
  const row = await tx.collection.create({
    data: { id: randomUUID(), organizationId, name: entry.nombre, slug: uniqueSlug(slugBase, taken), description: entry.descripcion ?? null, sortOrder: entry.orden ?? 0 },
    select: { id: true },
  });
  return { id: row.id, created: true };
}

/** Importación: suma productos a una colección sin quitar los que ya estaban. */
export async function addItemsToCollection(tx: Prisma.TransactionClient, organizationId: string, collectionId: string, itemIds: readonly string[]): Promise<number> {
  if (itemIds.length === 0) return 0;
  const owned = await tx.inventoryItem.findMany({ where: { id: { in: [...itemIds] }, organizationId }, select: { id: true } });
  const have = new Set((await tx.collectionItem.findMany({ where: { collectionId, organizationId }, select: { itemId: true } })).map((row) => row.itemId));
  const fresh = owned.map((row) => row.id).filter((id) => !have.has(id));
  if (fresh.length === 0) return 0;
  const last = await tx.collectionItem.aggregate({ where: { collectionId, organizationId }, _max: { position: true } });
  const start = (last._max.position ?? -1) + 1;
  await tx.collectionItem.createMany({ data: fresh.map((itemId, index) => ({ collectionId, itemId, organizationId, position: start + index })) });
  return fresh.length;
}
