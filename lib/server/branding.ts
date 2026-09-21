import {
  detectIdentityImageMime,
  IDENTITY_IMAGE_MAX_BYTES,
  type IdentityImageMime,
  type LogoVariant,
} from "@/lib/admin-types";
import { db } from "./db";

/**
 * Imagen de identidad del panel (issue #22): avatar del usuario y logo de la
 * empresa por tema.
 *
 * El binario llega como base64 en el JSON (el panel usa su cliente API único) ya
 * recortado y comprimido por el navegador; acá se decodifica con tope de 1 MB y
 * se valida por **magic bytes** —el tipo real sale del contenido, nunca del MIME
 * declarado— antes de guardarlo en la base (`bytea`), igual que los comprobantes
 * de pago. Nada de esto se expone en el sitio público: se sirve solo con sesión.
 */

export type ImageUploadPayload = {
  /** Binario ya decodificado y validado; el `ArrayBuffer` propio lo pide Prisma (`Bytes`). */
  bytes: Uint8Array<ArrayBuffer>;
  mime: IdentityImageMime;
  width: number | null;
  height: number | null;
};

export type ImageUploadResult =
  | { ok: true; image: ImageUploadPayload }
  | { ok: false; error: string };

/** El base64 ocupa ~4/3 del binario: se corta antes de decodificar. */
const MAX_BASE64_LENGTH = Math.ceil((IDENTITY_IMAGE_MAX_BYTES * 4) / 3) + 64;
/** Lado máximo del recorte que informa el navegador (evita valores absurdos). */
const MAX_SIDE = 8192;

function dimension(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SIDE ? value : null;
}

/**
 * Lee y valida la imagen de identidad del cuerpo JSON: `{ data, mime?, width?,
 * height? }`. `mime` es solo una ayuda del cliente — se ignora para decidir el
 * tipo real.
 */
export function parseImageUpload(body: unknown): ImageUploadResult {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const raw = typeof record.data === "string" ? record.data.trim() : "";
  if (!raw) return { ok: false, error: "Adjuntá una imagen (JPG, PNG o WebP)." };
  if (raw.length > MAX_BASE64_LENGTH) {
    return { ok: false, error: "La imagen supera 1 MB: recortala o comprimila antes de subirla." };
  }

  const decoded = Buffer.from(raw, "base64");
  const bytes = new Uint8Array(decoded.byteLength);
  bytes.set(decoded);
  if (bytes.byteLength === 0) return { ok: false, error: "La imagen llegó vacía; probá de nuevo." };
  if (bytes.byteLength > IDENTITY_IMAGE_MAX_BYTES) {
    return { ok: false, error: "La imagen supera 1 MB: recortala o comprimila antes de subirla." };
  }

  const mime = detectIdentityImageMime(bytes);
  if (!mime) {
    return { ok: false, error: "El archivo no es un JPG, PNG o WebP real: revisá que no esté renombrado." };
  }

  return { ok: true, image: { bytes, mime, width: dimension(record.width), height: dimension(record.height) } };
}

export type OrganizationLogoRow = {
  variant: LogoVariant;
  mime: string;
  updatedAt: Date;
};

/** Metadatos de los logos de la empresa (sin el binario), por variante. */
export async function loadOrganizationLogos(organizationId: string): Promise<Record<LogoVariant, OrganizationLogoRow | null>> {
  const logos = await db.organizationLogo.findMany({
    where: { organizationId },
    select: { variant: true, mime: true, updatedAt: true },
  });
  const result: Record<LogoVariant, OrganizationLogoRow | null> = { light: null, dark: null };
  for (const logo of logos) result[logo.variant] = logo;
  return result;
}

/** Cuándo se subió cada variante (`null` si falta), para el contrato del panel. */
export function logoVersions(logos: Record<LogoVariant, OrganizationLogoRow | null>): Record<LogoVariant, string | null> {
  return {
    light: logos.light?.updatedAt.toISOString() ?? null,
    dark: logos.dark?.updatedAt.toISOString() ?? null,
  };
}
