/**
 * Foto propia de una categoría de inventario (cuadrada, ≤ 1 MB). Misma receta que la foto de
 * producto (sharp, WebP, EXIF respetado) pero con lado máximo 1200 px y tope de 1 MB. La
 * guarda `InventoryCategory.imageData/imageMime` y expone `imageUrl` (ruta pública con `?v=`).
 */

import type { Prisma } from "@prisma/client";
import { detectInventoryImageMime } from "@/lib/admin-types";

export const CATEGORY_IMAGE_MAX_BYTES = 1024 * 1024;
const MAX_SIDE = 1200;
const MIN_SIDE = 300;
/** Tolerancia de «cuadrada»: hasta 2 % de diferencia entre ancho y alto. */
const SQUARE_TOLERANCE = 0.02;
const QUALITIES = [82, 70, 55];

export type PreparedCategoryPhoto = { data: Uint8Array<ArrayBuffer>; mime: "image/webp" };
export type CategoryPhotoResult = { ok: true; photo: PreparedCategoryPhoto } | { ok: false; error: string };

/** ¿Las medidas son de una foto cuadrada? (pura, para probar sin imagen). */
export function isSquareEnough(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  return Math.abs(width - height) / Math.max(width, height) <= SQUARE_TOLERANCE;
}

export async function prepareCategoryPhoto(bytes: Uint8Array): Promise<CategoryPhotoResult> {
  if (!detectInventoryImageMime(bytes.subarray(0, 16))) return { ok: false, error: "No es un JPG, PNG o WebP real." };
  try {
    const { default: sharp } = await import("sharp");
    const probe = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().toBuffer({ resolveWithObject: true });
    const { width, height } = probe.info;
    if (!isSquareEnough(width, height)) return { ok: false, error: `La foto debe ser cuadrada (la tuya mide ${width} × ${height} px).` };
    if (Math.min(width, height) < MIN_SIDE) return { ok: false, error: `La foto es muy chica: mide al menos ${MIN_SIDE} × ${MIN_SIDE} px.` };
    for (const quality of QUALITIES) {
      const out = await sharp(probe.data).resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "cover", withoutEnlargement: true }).webp({ quality }).toBuffer();
      if (out.byteLength > 0 && out.byteLength <= CATEGORY_IMAGE_MAX_BYTES) return { ok: true, photo: { data: new Uint8Array(out), mime: "image/webp" } };
    }
    return { ok: false, error: "La foto sigue pesando más de 1 MB después de comprimirla." };
  } catch (error) {
    console.error("[categoria-foto] No se pudo procesar la foto:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos leer la foto." };
  }
}

/** Guarda (o quita, con `null`) la foto de una categoría de la empresa. `false` = la categoría no es de esta empresa. */
export async function setCategoryImage(tx: Prisma.TransactionClient, organizationId: string, id: string, photo: PreparedCategoryPhoto | null): Promise<boolean> {
  const found = await tx.inventoryCategory.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!found) return false;
  await tx.inventoryCategory.update({
    where: { id },
    data: photo
      ? { imageData: photo.data, imageMime: photo.mime, imageUrl: `/api/category-images/${id}?v=${Date.now()}` }
      : { imageData: null, imageMime: null, imageUrl: null },
  });
  return true;
}
