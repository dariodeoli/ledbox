import { detectPaymentProofMime, PAYMENT_PROOF_MAX_BYTES } from "@/lib/admin-types";

/**
 * Preparación del comprobante de pago en el navegador (issue #17): valida la
 * firma real por magic bytes y comprime las fotos con canvas, sin librerías.
 *
 * Vive en su propio módulo (issue #63) para que el portal lo cargue **recién al
 * enviar** el comprobante (`import()` dentro del submit): es código que no hace
 * falta para leer ni para decidir el presupuesto, así que no viaja en el bundle
 * inicial de la página.
 */

const PROOF_MAX_SIDE = 1600;
const PROOF_QUALITY = 0.82;

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

/** Comprime una foto a WebP (o lo que soporte el navegador); `null` si no se pudo. */
async function compressProofImage(file: File): Promise<Blob | null> {
  const loaded = await loadImageSource(file);
  if (!loaded || loaded.width < 1 || loaded.height < 1) {
    loaded?.release();
    return null;
  }
  try {
    const scale = Math.min(1, PROOF_MAX_SIDE / Math.max(loaded.width, loaded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(loaded.width * scale));
    canvas.height = Math.max(1, Math.round(loaded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(loaded.image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", PROOF_QUALITY));
    return blob && blob.size > 0 ? blob : null;
  } finally {
    loaded.release();
  }
}

/** Prepara el archivo del comprobante: valida la firma real y comprime las fotos. */
export async function prepareProofFile(file: File): Promise<{ blob: Blob; mime: string } | { error: string }> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const detected = detectPaymentProofMime(header);
  if (!detected) {
    return { error: "El archivo no es un JPG, PNG, WebP o PDF: revisá que no esté renombrado." };
  }
  if (detected === "application/pdf") {
    if (file.size > PAYMENT_PROOF_MAX_BYTES) {
      return { error: "El PDF supera los 2 MB; subí una versión más liviana." };
    }
    return { blob: file, mime: detected };
  }
  const compressed = await compressProofImage(file);
  const blob = compressed && compressed.size < file.size ? compressed : file;
  if (blob.size > PAYMENT_PROOF_MAX_BYTES) {
    return { error: "La imagen sigue superando los 2 MB después de comprimirla; probá con otra foto." };
  }
  return { blob, mime: detected };
}
