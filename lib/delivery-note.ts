/**
 * Remito de salida y de devolución (alquileres P1-5): tipos y reglas puras compartidas entre el
 * servidor, el panel y la hoja impresa. Sin acceso a datos.
 */

import { sniffImageMime } from "./appearance";

export const DELIVERY_NOTE_KINDS = ["OUT", "IN"] as const;
export type DeliveryNoteKindValue = (typeof DELIVERY_NOTE_KINDS)[number];

export const DELIVERY_NOTE_KIND_LABEL: Record<DeliveryNoteKindValue, string> = {
  OUT: "Remito de salida",
  IN: "Remito de devolución",
};

export const DELIVERY_NOTE_MAX_PHOTOS = 10;
export const DELIVERY_NOTE_PHOTO_MAX_BYTES = 1024 * 1024;
export const DELIVERY_NOTE_MAX_NAME = 120;
export const DELIVERY_NOTE_MIN_NAME = 3;
export const DELIVERY_NOTE_MAX_DOCUMENT = 40;
export const DELIVERY_NOTE_MIN_DOCUMENT = 3;

/** Una línea del remito: lo realmente movido en esa salida o devolución. */
export type DeliveryNoteLine = {
  assignmentId: string;
  inventoryId: string;
  name: string;
  sku: string | null;
  /** Salida: unidades asignadas. Devolución: unidades que habían salido. */
  ordered: number;
  /** Salida: entregadas. Devolución: devueltas (incluye las dañadas). */
  moved: number;
  damaged: number;
  missing: number;
};

export function deliveryNoteNumberLabel(number: number): string {
  return `Nº ${String(number).padStart(6, "0")}`;
}

/** Suma `line` a las líneas (una por asignación): lo despachado o devuelto antes de firmar se acumula. */
export function mergeDeliveryNoteLine(lines: readonly DeliveryNoteLine[], line: DeliveryNoteLine): DeliveryNoteLine[] {
  const index = lines.findIndex((row) => row.assignmentId === line.assignmentId);
  if (index < 0) return [...lines, line];
  return lines.map((row, position) =>
    position === index
      ? { ...row, ordered: line.ordered, moved: row.moved + line.moved, damaged: row.damaged + line.damaged, missing: row.missing + line.missing }
      : row,
  );
}

function intOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Lee el JSON guardado sin confiar en su forma. */
export function readDeliveryNoteLines(value: unknown): DeliveryNoteLine[] {
  if (!Array.isArray(value)) return [];
  const lines: DeliveryNoteLine[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.assignmentId !== "string" || typeof row.name !== "string") continue;
    lines.push({
      assignmentId: row.assignmentId,
      inventoryId: typeof row.inventoryId === "string" ? row.inventoryId : "",
      name: row.name,
      sku: typeof row.sku === "string" && row.sku ? row.sku : null,
      ordered: intOf(row.ordered),
      moved: intOf(row.moved),
      damaged: intOf(row.damaged),
      missing: intOf(row.missing),
    });
  }
  return lines;
}

export function deliveryNoteTotals(lines: readonly DeliveryNoteLine[]) {
  return lines.reduce(
    (sum, line) => ({ moved: sum.moved + line.moved, damaged: sum.damaged + line.damaged, missing: sum.missing + line.missing }),
    { moved: 0, damaged: 0, missing: 0 },
  );
}

export type SignerInput = { name: string; document: string };

/** Valida al firmante (nombre y documento). */
export function parseDeliveryNoteSigner(raw: { name?: unknown; document?: unknown }): { ok: true; value: SignerInput } | { ok: false; error: string } {
  const name = typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim() : "";
  const document = typeof raw.document === "string" ? raw.document.replace(/\s+/g, " ").trim() : "";
  if (name.length < DELIVERY_NOTE_MIN_NAME) return { ok: false, error: "Escribí el nombre completo de quien recibe." };
  if (name.length > DELIVERY_NOTE_MAX_NAME) return { ok: false, error: `El nombre no puede superar los ${DELIVERY_NOTE_MAX_NAME} caracteres.` };
  if (document.length < DELIVERY_NOTE_MIN_DOCUMENT) return { ok: false, error: "Escribí el número de documento de quien recibe." };
  if (document.length > DELIVERY_NOTE_MAX_DOCUMENT) return { ok: false, error: `El documento no puede superar los ${DELIVERY_NOTE_MAX_DOCUMENT} caracteres.` };
  return { ok: true, value: { name, document } };
}

/** Vista del remito para el panel (sin binarios: fotos y firma se piden por su URL). */
export type AdminDeliveryNote = {
  id: string;
  eventId: string;
  kind: DeliveryNoteKindValue;
  number: number;
  lines: DeliveryNoteLine[];
  notes: string | null;
  createdAt: string;
  signed: boolean;
  signedAt: string | null;
  signerName: string | null;
  signerDocument: string | null;
  photos: Array<{ id: string; size: number; mime: string }>;
};

/** Valida una foto por sus bytes reales (magic bytes) y su tamaño; el MIME declarado no cuenta. */
export function checkDeliveryPhoto(bytes: Uint8Array): { ok: true; mime: "image/jpeg" | "image/png" | "image/webp" } | { ok: false; status: 400 | 413; error: string } {
  if (bytes.byteLength === 0) return { ok: false, status: 400, error: "La foto está vacía." };
  if (bytes.byteLength > DELIVERY_NOTE_PHOTO_MAX_BYTES) return { ok: false, status: 413, error: "Cada foto puede pesar hasta 1 MB." };
  const mime = sniffImageMime(bytes);
  if (!mime) return { ok: false, status: 400, error: "El archivo no es una foto válida (JPG, PNG o WebP)." };
  return { ok: true, mime };
}
