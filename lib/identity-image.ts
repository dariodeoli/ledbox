"use client";

import {
  detectIdentityImageMime,
  IDENTITY_IMAGE_MAX_BYTES,
  type IdentityImageMime,
} from "./admin-types";

/**
 * Preparación de la imagen de identidad en el navegador (issue #22): avatar de
 * persona y logo de empresa, con canvas y sin librerías.
 *
 * - El tipo real se valida por **magic bytes** antes de mirar nada más (un PDF o
 *   un ejecutable renombrado se rechaza acá y otra vez en el API).
 * - El avatar se recorta cuadrado desde el centro y se escala a 512 px.
 * - El logo conserva su relación de aspecto (un logo ancho no se recorta) y se
 *   escala a 1024 px de lado máximo, sobre canvas transparente.
 * - La salida es WebP (con la menor calidad que haga falta para no pasar 1 MB) y
 *   viaja al API como base64 en el JSON del panel.
 */

export type PreparedIdentityImage = {
  /** Base64 sin el prefijo `data:` (lo que espera el API). */
  base64: string;
  mime: IdentityImageMime;
  width: number;
  height: number;
  size: number;
  /** Vista previa local (data URL) mientras la imagen no está guardada. */
  dataUrl: string;
};

export type PrepareIdentityImageResult =
  | { ok: true; image: PreparedIdentityImage }
  | { ok: false; error: string };

export type PrepareIdentityImageOptions = {
  /** Recorte cuadrado centrado (avatar de persona) o relación original (logo). */
  square: boolean;
  /** Lado máximo de la imagen final, en px. */
  maxSide: number;
};

type LoadedImage = { image: CanvasImageSource; width: number; height: number; release: () => void };

async function loadImageSource(file: Blob): Promise<LoadedImage | null> {
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image` respeta la orientación EXIF de las fotos de celular.
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { image: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Safari viejo o formato raro: se reintenta con `<img>`.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("No pudimos leer la imagen."));
      element.src = url;
    });
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function blobToBase64(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : null);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
}

/** Reintentos de calidad: la imagen tiene que entrar en 1 MB. */
const QUALITIES = [0.86, 0.7, 0.55];

/** Valida y prepara la imagen elegida en el navegador (canvas, sin librerías). */
export async function prepareIdentityImage(
  file: File,
  { square, maxSide }: PrepareIdentityImageOptions,
): Promise<PrepareIdentityImageResult> {
  if (file.size === 0) return { ok: false, error: "El archivo está vacío; probá de nuevo." };
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime = detectIdentityImageMime(header);
  if (!mime) {
    return { ok: false, error: "El archivo no es un JPG, PNG o WebP real: revisá que no esté renombrado." };
  }

  const loaded = await loadImageSource(file);
  if (!loaded || loaded.width < 1 || loaded.height < 1) {
    loaded?.release();
    return { ok: false, error: "No pudimos leer la imagen; probá con otro archivo." };
  }

  try {
    const scale = Math.min(1, maxSide / Math.max(loaded.width, loaded.height));
    const side = square ? Math.min(loaded.width, loaded.height) : 0;
    const width = square ? Math.max(1, Math.round(side * scale)) : Math.max(1, Math.round(loaded.width * scale));
    const height = square ? width : Math.max(1, Math.round(loaded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return { ok: false, error: "No pudimos procesar la imagen en este navegador." };

    if (square) {
      const sourceSide = Math.min(loaded.width, loaded.height);
      const sx = (loaded.width - sourceSide) / 2;
      const sy = (loaded.height - sourceSide) / 2;
      context.drawImage(loaded.image, sx, sy, sourceSide, sourceSide, 0, 0, width, height);
    } else {
      context.drawImage(loaded.image, 0, 0, width, height);
    }

    let blob: Blob | null = null;
    for (const quality of QUALITIES) {
      blob = await canvasToBlob(canvas, quality);
      if (blob && blob.size > 0 && blob.size <= IDENTITY_IMAGE_MAX_BYTES) break;
    }
    if (!blob || blob.size === 0) {
      return { ok: false, error: "No pudimos comprimir la imagen; probá con otra." };
    }
    if (blob.size > IDENTITY_IMAGE_MAX_BYTES) {
      return { ok: false, error: "La imagen sigue superando 1 MB después de comprimirla; probá con una más chica." };
    }

    const base64 = await blobToBase64(blob);
    if (!base64) return { ok: false, error: "No pudimos leer la imagen; probá de nuevo." };
    return {
      ok: true,
      image: {
        base64,
        mime: "image/webp",
        width,
        height,
        size: blob.size,
        dataUrl: `data:image/webp;base64,${base64}`,
      },
    };
  } finally {
    loaded.release();
  }
}
