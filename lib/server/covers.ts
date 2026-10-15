import { randomUUID } from "node:crypto";
import { COVER_MAX_BYTES, COVER_MESSAGES, COVER_MIN_WIDTH, COVER_SPEC, checkCoverFile, type CoverKind } from "@/lib/appearance";
import { recordAudit } from "./audit";
import { db } from "./db";
import { cuotaArchivosOk, SANDBOX_QUOTA_MESSAGE } from "./demo-sandbox";
import { jsonError } from "./http";
import type { AdminContext } from "./tenancy";

/**
 * Portada de la tienda: valida por magic bytes (nunca el MIME declarado) y la comprime y
 * redimensiona con sharp, con el mismo patrón de la foto de producto (`preparePhoto`):
 * se corrige la orientación EXIF, se achica al ancho recomendado sin agrandar y se guarda
 * en WebP, bajando la calidad hasta entrar en el tope.
 */

const QUALITIES = [82, 72, 60, 48];
const OUTPUT_MAX_BYTES = 2 * 1024 * 1024;

export type PreparedCover =
  | { ok: true; data: Uint8Array<ArrayBuffer>; mime: "image/webp"; width: number; height: number; originalBytes: number }
  | { ok: false; status: number; error: string };

export async function prepareCover(bytes: Uint8Array, kind: CoverKind): Promise<PreparedCover> {
  return prepareImage(bytes, COVER_SPEC[kind].width);
}

/** Misma receta para cualquier foto de la tienda (portada, inspiración, editorial, colecciones): `width` es el ancho máximo. */
export async function prepareImage(bytes: Uint8Array, width: number): Promise<PreparedCover> {
  const checked = checkCoverFile(bytes);
  if (!checked.ok) return { ok: false, status: checked.error === COVER_MESSAGES.tooBig ? 413 : 400, error: checked.error };
  const spec = { width };
  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).metadata();
    if (!meta.width || !meta.height) return { ok: false, status: 400, error: COVER_MESSAGES.unreadable };
    if (meta.width < COVER_MIN_WIDTH) return { ok: false, status: 400, error: COVER_MESSAGES.tooSmall };
    for (const quality of QUALITIES) {
      const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
        .rotate()
        .resize({ width: spec.width, height: spec.width * 2, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
      if (data.byteLength > 0 && data.byteLength <= OUTPUT_MAX_BYTES) {
        const out = new Uint8Array(new ArrayBuffer(data.byteLength));
        out.set(data);
        return { ok: true, data: out, mime: "image/webp", width: info.width, height: info.height, originalBytes: bytes.byteLength };
      }
    }
    return { ok: false, status: 413, error: COVER_MESSAGES.tooBig };
  } catch (error) {
    console.error("[portada] No se pudo procesar la imagen:", error instanceof Error ? error.message : error);
    return { ok: false, status: 400, error: COVER_MESSAGES.unreadable };
  }
}

/**
 * Cuerpo del `POST` de la portada: `multipart/form-data` con `file`. Valida el tamaño, la firma real
 * (magic bytes: un archivo renombrado responde 400), comprime con sharp, aplica la cuota de la demo
 * y las sandboxes (`cuotaArchivosOk`) y guarda la portada de ESA empresa. Separado de la ruta para
 * poder probarlo con un contexto de panel sin sesión.
 */
export async function uploadCover(context: AdminContext, kind: CoverKind, request: Request): Promise<Response> {
  const { organizationId, organization } = context;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("No pudimos leer la portada enviada.", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Elegí una imagen (JPG, PNG o WebP).", 400);
  if (file.size === 0) return jsonError(COVER_MESSAGES.empty, 400);
  if (file.size > COVER_MAX_BYTES) return jsonError(COVER_MESSAGES.tooBig, 413);

  const prepared = await prepareCover(new Uint8Array(await file.arrayBuffer()), kind);
  if (!prepared.ok) return jsonError(prepared.error, prepared.status);
  if (!(await cuotaArchivosOk(organizationId, prepared.data.byteLength))) return jsonError(SANDBOX_QUOTA_MESSAGE, 413);

  const cover = await db.organizationCover.upsert({
    where: { organizationId_kind: { organizationId, kind } },
    create: { id: randomUUID(), organizationId, kind, mime: prepared.mime, size: prepared.data.byteLength, width: prepared.width, height: prepared.height, data: prepared.data },
    update: { mime: prepared.mime, size: prepared.data.byteLength, width: prepared.width, height: prepared.height, data: prepared.data },
    select: { updatedAt: true },
  });
  await recordAudit({
    context,
    action: "update",
    entity: "Organization",
    entityId: organizationId,
    summary: `Subió la ${COVER_SPEC[kind].label.toLowerCase()} de «${organization.name}»`,
    detail: { fields: { [kind === "desktop" ? "portadaEscritorio" : "portadaCelular"]: "subida", mime: prepared.mime, size: prepared.data.byteLength, width: prepared.width, height: prepared.height } },
  });
  return Response.json({ kind, updatedAt: cover.updatedAt.toISOString(), width: prepared.width, height: prepared.height, size: prepared.data.byteLength });
}
