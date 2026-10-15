import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";

/** Cuerpo acotado e idempotencia del lote de «Importar» (`/api/admin/import/[modulo]`). */

const IMPORT_LOTE_SCOPE = "import:apply";
/** Mientras se aplica: si el proceso muere, el lote queda libre a los 30 minutos. */
const IMPORT_LOTE_INFLIGHT_MS = 30 * 60_000;

/** Lee el cuerpo con un tope duro (sin confiar en `content-length`). */
export async function readBodyLimited(request: Request, max: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false }> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) return { ok: false };
  if (!request.body) return { ok: true, bytes: new Uint8Array(0) };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return { ok: false };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

/** Toma el lote de forma atómica (índice único). `false` si otro pedido ya lo tiene o lo aplicó. */
export async function claimImportLote(organizationId: string, lote: string): Promise<boolean> {
  const now = new Date();
  await db.idempotencyKey.deleteMany({ where: { organizationId, scope: IMPORT_LOTE_SCOPE, key: lote, expiresAt: { lte: now } } });
  try {
    await db.idempotencyKey.create({
      data: { id: randomUUID(), organizationId, scope: IMPORT_LOTE_SCOPE, key: lote, requestHash: lote, status: 202, expiresAt: new Date(now.getTime() + IMPORT_LOTE_INFLIGHT_MS) },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

export async function settleImportLote(organizationId: string, lote: string, applied: boolean): Promise<void> {
  try {
    if (applied) {
      await db.idempotencyKey.updateMany({
        where: { organizationId, scope: IMPORT_LOTE_SCOPE, key: lote },
        data: { status: 200, expiresAt: new Date(Date.now() + 7 * 86_400_000) },
      });
    } else {
      await db.idempotencyKey.deleteMany({ where: { organizationId, scope: IMPORT_LOTE_SCOPE, key: lote } });
    }
  } catch (error) {
    console.error("[import-catalogo] No se pudo cerrar la clave del lote:", error instanceof Error ? error.message : error);
  }
}

