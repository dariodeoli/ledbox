/**
 * Fotos de la importación: lectura segura del ZIP y la misma preparación que
 * la foto de producto del panel (`lib/inventory-image.ts`): lado máximo 1600
 * px, WebP con calidades 0,82 / 0,70 / 0,55 hasta entrar en 2 MB, respetando
 * la orientación EXIF. El resultado va al mismo almacenamiento
 * (`imageData` / `imageMime`).
 */

import { unzipSync } from "fflate";
import { detectInventoryImageMime, INVENTORY_IMAGE_MAX_BYTES } from "@/lib/admin-types";
import { CATALOG_LIMITS, PHOTO_EXTENSIONS, photoKey, type ImportProblem } from "@/lib/import-catalog";

/** Error del ZIP con mensaje para mostrar a la persona. */
export class ImportZipError extends Error {}

const PHOTO_MAX_SIDE = 1600;
const QUALITIES = [82, 70, 55];

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|\._)/i;

/** Rechaza `../`, rutas absolutas, unidades de Windows y bytes nulos. */
export function assertSafeEntryName(name: string): void {
  const segments = name.split(/[\\/]/);
  if (name.includes("\0") || /^[\\/]/.test(name) || /^[a-zA-Z]:/.test(name) || segments.includes("..")) {
    throw new ImportZipError(`El ZIP trae una ruta insegura («${name.replace(/[^\x20-\x7e]/g, "?").slice(0, 80)}»): se rechazó el archivo completo.`);
  }
}

export type PhotoZip = { photos: Map<string, Uint8Array>; problems: ImportProblem[] };

/**
 * Lee `fotos.zip` sin escribir nada a disco. Topes: 60 MB comprimido, 400
 * archivos, 12 MB por foto y 320 MB descomprimido (según el tamaño declarado
 * del encabezado, que fflate respeta como tope de salida). Las entradas que no
 * son imagen real (bytes mágicos) se ignoran con un aviso.
 */
export function readPhotoZip(data: Uint8Array): PhotoZip {
  if (data.byteLength > CATALOG_LIMITS.zipBytes) throw new ImportZipError("El ZIP supera los 60 MB.");
  if (data.byteLength < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw new ImportZipError("El archivo no es un ZIP válido.");
  const problems: ImportProblem[] = [];
  let files = 0;
  let inflated = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter(file) {
        assertSafeEntryName(file.name);
        if (file.name.endsWith("/") || JUNK.test(file.name)) return false;
        files += 1;
        if (files > CATALOG_LIMITS.zipFiles) throw new ImportZipError(`El ZIP tiene más de ${CATALOG_LIMITS.zipFiles} archivos.`);
        if (file.originalSize > CATALOG_LIMITS.photoBytes) {
          problems.push({ nivel: "aviso", tipo: "foto-invalida", codigo: null, fila: null, mensaje: `«${photoKey(file.name)}» pesa más de 12 MB y se ignora.` });
          return false;
        }
        inflated += file.originalSize;
        if (inflated > CATALOG_LIMITS.zipInflatedBytes) throw new ImportZipError("El contenido del ZIP es demasiado grande una vez descomprimido.");
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ImportZipError) throw error;
    throw new ImportZipError("No pudimos leer el ZIP: está dañado o no es un ZIP válido.");
  }

  const photos = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    const key = photoKey(name);
    const extension = key.split(".").pop() ?? "";
    if (!(PHOTO_EXTENSIONS as readonly string[]).includes(extension) || !detectInventoryImageMime(bytes.subarray(0, 16))) {
      problems.push({ nivel: "aviso", tipo: "foto-invalida", codigo: null, fila: null, mensaje: `«${key}» no es una imagen JPG, PNG o WebP real y se ignora.` });
      continue;
    }
    if (photos.has(key)) {
      problems.push({ nivel: "aviso", tipo: "foto-invalida", codigo: null, fila: null, mensaje: `«${key}» está repetida en el ZIP (en carpetas distintas): se usa la primera.` });
      continue;
    }
    photos.set(key, bytes);
  }
  return { photos, problems };
}

export type PreparedPhoto = { data: Uint8Array<ArrayBuffer>; mime: "image/webp" };

/**
 * Redimensiona y comprime una foto (la misma receta del panel). Devuelve
 * `null` si no se puede leer o sigue pesando más de 2 MB.
 */
export async function preparePhoto(bytes: Uint8Array): Promise<PreparedPhoto | null> {
  if (!detectInventoryImageMime(bytes.subarray(0, 16))) return null;
  try {
    const { default: sharp } = await import("sharp");
    for (const quality of QUALITIES) {
      const out = await sharp(bytes, { limitInputPixels: 80_000_000, failOn: "error" })
        .rotate()
        .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      if (out.byteLength > 0 && out.byteLength <= INVENTORY_IMAGE_MAX_BYTES) return { data: new Uint8Array(out), mime: "image/webp" };
    }
    return null;
  } catch (error) {
    console.error("[import-catalogo] No se pudo procesar una foto:", error instanceof Error ? error.message : error);
    return null;
  }
}
