import { randomUUID } from "node:crypto";
import { Prisma, type DeliveryNoteKind } from "@prisma/client";
import {
  DELIVERY_NOTE_MAX_PHOTOS,
  checkDeliveryPhoto,
  mergeDeliveryNoteLine,
  parseDeliveryNoteSigner,
  readDeliveryNoteLines,
  type AdminDeliveryNote,
  type DeliveryNoteLine,
} from "../delivery-note";
import { db } from "./db";
import { cuotaArchivosOk, SANDBOX_QUOTA_MESSAGE } from "./demo-sandbox";
import { getRentalSettings } from "./rental-settings";
import { parseSignatureSubmission } from "./signature/submission";

/**
 * Remitos de salida y de devolución (alquileres P1-5).
 *
 * - El remito nace dentro de la transacción del despacho o la devolución (`recordDeliveryNoteLine`),
 *   con lo realmente movido. Antes de firmar acumula las líneas de los movimientos del mismo evento;
 *   al firmar queda congelado y el siguiente movimiento abre otro.
 * - El número es correlativo por empresa y sin huecos: un upsert atómico sobre
 *   `DeliveryNoteCounter` dentro de la misma transacción (si se revierte, el número también).
 * - Todo está acotado por `organizationId`; un id ajeno responde 404.
 */

type Tx = Prisma.TransactionClient;
type Failure = { ok: false; status: 400 | 404 | 409 | 413; error: string };
const fail = (status: Failure["status"], error: string): Failure => ({ ok: false, status, error });

/** Siguiente número de la empresa. Debe correr dentro de una transacción. */
export async function nextDeliveryNoteNumber(tx: Tx, organizationId: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ last: number }>>(
    Prisma.sql`INSERT INTO "DeliveryNoteCounter" ("organizationId", "last") VALUES (${organizationId}, 1)
      ON CONFLICT ("organizationId") DO UPDATE SET "last" = "DeliveryNoteCounter"."last" + 1
      RETURNING "last"`,
  );
  return Number(rows[0].last);
}

/** Agrega lo movido a un remito abierto del evento (o abre uno nuevo con número). */
export async function recordDeliveryNoteLine(
  tx: Tx,
  options: { organizationId: string; eventId: string; kind: DeliveryNoteKind; actorId?: string | null; line: DeliveryNoteLine },
): Promise<{ id: string; number: number }> {
  const open = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "DeliveryNote" WHERE "organizationId" = ${options.organizationId} AND "eventId" = ${options.eventId}
      AND "kind" = ${options.kind}::"DeliveryNoteKind" AND "signedAt" IS NULL ORDER BY "number" DESC LIMIT 1 FOR UPDATE`,
  );
  if (open[0]) {
    const note = await tx.deliveryNote.findFirstOrThrow({ where: { id: open[0].id, organizationId: options.organizationId } });
    const lines = mergeDeliveryNoteLine(readDeliveryNoteLines(note.linesSnapshot), options.line);
    await tx.deliveryNote.update({ where: { id: note.id }, data: { linesSnapshot: lines as unknown as Prisma.InputJsonValue } });
    return { id: note.id, number: note.number };
  }
  const number = await nextDeliveryNoteNumber(tx, options.organizationId);
  const note = await tx.deliveryNote.create({
    data: {
      id: randomUUID(),
      organizationId: options.organizationId,
      eventId: options.eventId,
      kind: options.kind,
      number,
      linesSnapshot: [options.line] as unknown as Prisma.InputJsonValue,
      createdById: options.actorId ?? null,
    },
  });
  return { id: note.id, number: note.number };
}

type NoteRow = Prisma.DeliveryNoteGetPayload<{ include: { photos: { select: { id: true; size: true; mime: true } } } }>;

export function toAdminDeliveryNote(note: NoteRow): AdminDeliveryNote {
  return {
    id: note.id,
    eventId: note.eventId,
    kind: note.kind,
    number: note.number,
    lines: readDeliveryNoteLines(note.linesSnapshot),
    notes: note.notes,
    createdAt: note.createdAt.toISOString(),
    signed: note.signedAt !== null,
    signedAt: note.signedAt?.toISOString() ?? null,
    signerName: note.signerName,
    signerDocument: note.signerDocument,
    photos: note.photos.map((photo) => ({ id: photo.id, size: photo.size, mime: photo.mime })),
  };
}

const NOTE_INCLUDE = { photos: { select: { id: true, size: true, mime: true }, orderBy: { createdAt: "asc" as const } } };

export async function listDeliveryNotes(organizationId: string, eventId: string): Promise<AdminDeliveryNote[]> {
  const notes = await db.deliveryNote.findMany({
    where: { organizationId, eventId },
    include: NOTE_INCLUDE,
    orderBy: { number: "desc" },
    take: 200,
  });
  return notes.map(toAdminDeliveryNote);
}

export async function loadDeliveryNote(organizationId: string, id: string): Promise<AdminDeliveryNote | null> {
  const note = await db.deliveryNote.findFirst({ where: { id, organizationId }, include: NOTE_INCLUDE });
  return note ? toAdminDeliveryNote(note) : null;
}

export async function addDeliveryNotePhoto(options: { organizationId: string; noteId: string; bytes: Uint8Array; actorId?: string | null }) {
  const checked = checkDeliveryPhoto(options.bytes);
  if (!checked.ok) return fail(checked.status, checked.error);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ signedAt: Date | null }>>(
      Prisma.sql`SELECT "signedAt" FROM "DeliveryNote" WHERE "id" = ${options.noteId} AND "organizationId" = ${options.organizationId} FOR UPDATE`,
    );
    if (!rows[0]) return fail(404, "El remito no existe en esta empresa.");
    if (rows[0].signedAt) return fail(409, "El remito ya está firmado: no admite más fotos.");
    const count = await tx.deliveryNotePhoto.count({ where: { noteId: options.noteId } });
    if (count >= DELIVERY_NOTE_MAX_PHOTOS) return fail(409, `Un remito admite hasta ${DELIVERY_NOTE_MAX_PHOTOS} fotos.`);
    const photo = await tx.deliveryNotePhoto.create({
      data: {
        id: randomUUID(),
        organizationId: options.organizationId,
        noteId: options.noteId,
        mime: checked.mime,
        size: options.bytes.byteLength,
        data: new Uint8Array(options.bytes),
        createdById: options.actorId ?? null,
      },
      select: { id: true, size: true, mime: true },
    });
    return { ok: true as const, photo };
  });
}

export async function removeDeliveryNotePhoto(options: { organizationId: string; noteId: string; photoId: string }) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ signedAt: Date | null }>>(
      Prisma.sql`SELECT "signedAt" FROM "DeliveryNote" WHERE "id" = ${options.noteId} AND "organizationId" = ${options.organizationId} FOR UPDATE`,
    );
    if (!rows[0]) return fail(404, "El remito no existe en esta empresa.");
    if (rows[0].signedAt) return fail(409, "El remito ya está firmado: no se pueden quitar fotos.");
    const removed = await tx.deliveryNotePhoto.deleteMany({ where: { id: options.photoId, noteId: options.noteId, organizationId: options.organizationId } });
    if (removed.count === 0) return fail(404, "La foto no existe en este remito.");
    return { ok: true as const };
  });
}

/** Firma el remito en el lugar con el trazo DRAWN (PNG) de la firma del portal. Una sola vez. */
export async function signDeliveryNote(options: {
  organizationId: string;
  noteId: string;
  signer: { name?: unknown; document?: unknown };
  signatureDataUrl: unknown;
  actorId?: string | null;
  ip: string | null;
  userAgent: string | null;
  at?: Date;
}) {
  const signer = parseDeliveryNoteSigner(options.signer);
  if (!signer.ok) return fail(400, signer.error);
  const submission = parseSignatureSubmission("DRAWN", { dataUrl: options.signatureDataUrl }, signer.value.name);
  if (!submission.ok || submission.value.kind !== "drawn") return fail(400, submission.ok ? "Dibujá la firma." : submission.error);
  const strokes = submission.value.data;
  if (!(await cuotaArchivosOk(options.organizationId, strokes.byteLength))) return fail(413, SANDBOX_QUOTA_MESSAGE);
  const terms = (await getRentalSettings(options.organizationId)).rentalTerms;

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ signedAt: Date | null }>>(
      Prisma.sql`SELECT "signedAt" FROM "DeliveryNote" WHERE "id" = ${options.noteId} AND "organizationId" = ${options.organizationId} FOR UPDATE`,
    );
    if (!rows[0]) return fail(404, "El remito no existe en esta empresa.");
    if (rows[0].signedAt) return fail(409, "El remito ya fue firmado.");
    const note = await tx.deliveryNote.update({
      where: { id: options.noteId },
      data: {
        signerName: signer.value.name,
        signerDocument: signer.value.document,
        signatureData: new Uint8Array(strokes),
        signatureMime: "image/png",
        signedAt: options.at ?? new Date(),
        signedById: options.actorId ?? null,
        signedIp: options.ip ? options.ip.slice(0, 64) : null,
        signedUserAgent: options.userAgent ? options.userAgent.slice(0, 400) : null,
        termsSnapshot: terms ?? null,
      },
      include: NOTE_INCLUDE,
    });
    return { ok: true as const, note: toAdminDeliveryNote(note) };
  });
}
