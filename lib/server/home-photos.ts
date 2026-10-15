import { randomUUID } from "node:crypto";
import { COVER_MAX_BYTES, COVER_MESSAGES } from "@/lib/appearance";
import { HOME_PHOTO_LABEL, HOME_PHOTO_SLOTS, HOME_PHOTO_WIDTH, type HomePhotoSlot } from "@/lib/store-home";
import { recordAudit } from "./audit";
import { prepareImage } from "./covers";
import { db } from "./db";
import { cuotaArchivosOk, SANDBOX_QUOTA_MESSAGE } from "./demo-sandbox";
import { jsonError } from "./http";
import type { AdminContext } from "./tenancy";

/**
 * Fotos de ambientación del inicio de la tienda (inspiración 1 a 3 y bloque editorial). Viven en
 * `OrganizationCover` con la ranura como `kind` (una por empresa y ranura), con el mismo pipeline que la
 * portada: firma real por magic bytes, sharp, WebP, tope de 2 MB y cuota de la demo.
 */

export type HomePhotoVersions = Record<HomePhotoSlot, string | null>;

export async function loadHomePhotoVersions(organizationId: string): Promise<HomePhotoVersions> {
  const rows = await db.organizationCover.findMany({ where: { organizationId, kind: { in: [...HOME_PHOTO_SLOTS] } }, select: { kind: true, updatedAt: true } });
  const result = Object.fromEntries(HOME_PHOTO_SLOTS.map((slot) => [slot, null])) as HomePhotoVersions;
  for (const row of rows) if ((HOME_PHOTO_SLOTS as readonly string[]).includes(row.kind)) result[row.kind as HomePhotoSlot] = row.updatedAt.toISOString();
  return result;
}

/** URL pública de la foto del inicio (con versión para la caché); `null` si no hay. */
export function homePhotoUrl(slug: string, slot: HomePhotoSlot, version: string | null): string | null {
  return version ? `/api/catalog/${encodeURIComponent(slug)}/home/${slot}?v=${encodeURIComponent(version)}` : null;
}

/** `POST`: `multipart/form-data` con `file`. Guarda (o reemplaza) la foto de ESA empresa. */
export async function uploadHomePhoto(context: AdminContext, slot: HomePhotoSlot, request: Request): Promise<Response> {
  const { organizationId, organization } = context;
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
  const prepared = await prepareImage(new Uint8Array(await file.arrayBuffer()), HOME_PHOTO_WIDTH);
  if (!prepared.ok) return jsonError(prepared.error, prepared.status);
  if (!(await cuotaArchivosOk(organizationId, prepared.data.byteLength))) return jsonError(SANDBOX_QUOTA_MESSAGE, 413);
  const saved = await db.organizationCover.upsert({
    where: { organizationId_kind: { organizationId, kind: slot } },
    create: { id: randomUUID(), organizationId, kind: slot, mime: prepared.mime, size: prepared.data.byteLength, width: prepared.width, height: prepared.height, data: prepared.data },
    update: { mime: prepared.mime, size: prepared.data.byteLength, width: prepared.width, height: prepared.height, data: prepared.data },
    select: { updatedAt: true },
  });
  await recordAudit({
    context,
    action: "update",
    entity: "Organization",
    entityId: organizationId,
    summary: `Subió «${HOME_PHOTO_LABEL[slot]}» del inicio de «${organization.name}»`,
    detail: { fields: { [slot]: "subida", mime: prepared.mime, size: prepared.data.byteLength } },
  });
  return Response.json({ slot, updatedAt: saved.updatedAt.toISOString() });
}

export async function deleteHomePhoto(context: AdminContext, slot: HomePhotoSlot): Promise<Response> {
  const { organizationId, organization } = context;
  const removed = await db.organizationCover.deleteMany({ where: { organizationId, kind: slot } });
  if (removed.count > 0) {
    await recordAudit({
      context,
      action: "update",
      entity: "Organization",
      entityId: organizationId,
      summary: `Quitó «${HOME_PHOTO_LABEL[slot]}» del inicio de «${organization.name}»`,
      detail: { fields: { [slot]: "quitada" } },
    });
  }
  return Response.json({ slot, updatedAt: null, unchanged: removed.count === 0 });
}
