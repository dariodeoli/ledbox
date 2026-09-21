import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { jsonError } from "./http";

/**
 * Capa única de idempotencia financiera (issue #20).
 *
 * Toda alta o cambio financiero del panel pasa por acá con una **clave por
 * intento** que manda la UI (`Idempotency-Key` en el header o `idempotencyKey`
 * en el body; el cliente API del panel usa el header). La operación, sus
 * escrituras y el resultado (`status` + `response`) se confirman en **la misma
 * transacción** que la fila de `IdempotencyKey`: repetir la misma clave devuelve
 * exactamente la misma respuesta sin volver a tocar los datos —ni duplicar
 * cobros, movimientos, gastos o pagos—, y la misma clave con otro cuerpo
 * responde 409 (nunca se pisa una operación con otra).
 *
 * Diseño:
 * - Carrera entre dos requests con la misma clave: el índice único
 *   `(organizationId, scope, key)` define el ganador. El perdedor recibe la
 *   violación de unicidad, su transacción se revierte completa (no queda ningún
 *   dato suelto) y responde con el resultado del ganador.
 * - La clave es por empresa y por `scope` (`recurso:método:variante`), así la
 *   misma clave puede usarse en endpoints distintos sin chocar.
 * - La auditoría viaja en `afterCommit`: corre **una sola vez**, después del
 *   commit y solo para el request que completó la operación (el reintento
 *   idempotente no audita de nuevo).
 * - Sin clave, la operación corre igual (con la misma transacción) pero sin
 *   protección de reintentos: los clientes viejos no se rompen.
 * - `expiresAt` vence a los 7 días y `purgeExpiredIdempotencyKeys` borra las
 *   claves vencidas (se ejecuta al inicio de cada operación con clave).
 */

/** Vencimiento de una clave: más allá de esto la limpieza la borra. */
export const IDEMPOTENCY_TTL_DAYS = 7;
/** Tope de la clave aceptada (header o body). */
export const IDEMPOTENCY_MAX_KEY = 200;
/** Header estándar que manda el cliente API del panel. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** Transacción de la operación: todas las escrituras de una operación idempotente van acá. */
export type IdempotentTx = Prisma.TransactionClient;

/**
 * Resultado exitoso de una operación idempotente. `body` es exactamente lo que
 * se guarda y se responde (JSON serializable); `afterCommit` agrupa los efectos
 * best-effort —auditoría— que deben correr una sola vez, ya confirmada la
 * transacción.
 */
export type IdempotentOutcome = {
  status: number;
  body: Record<string, unknown>;
  afterCommit?: () => Promise<void> | void;
};

/**
 * Handler de la operación. Devuelve un `Response` para cortar sin escribir nada
 * (validaciones y conflictos): la transacción se revierte y no queda clave ni
 * fila. Cualquier escritura tiene que usar el `tx` recibido.
 */
export type IdempotentHandler = (tx: IdempotentTx) => Promise<Response | IdempotentOutcome>;

export type IdempotencyOptions = {
  request: Request;
  organizationId: string;
  /** Operación agrupada: `recurso:método:variante` (por ejemplo `finance:POST:client`). */
  scope: string;
  /** Cuerpo ya leído por la ruta; de ahí sale `idempotencyKey` si no vino el header. */
  body: Record<string, unknown>;
};

/** Corte controlado dentro de la transacción (validación o conflicto): no escribe nada. */
class EarlyResponse extends Error {
  constructor(readonly response: Response) {
    super("idempotent-operation-early-response");
    this.name = "EarlyResponse";
  }
}

type StoredKey = { requestHash: string; status: number; response: unknown };

/** Clave normalizada del request: `null` si no vino, `false` si es inválida. */
export function readIdempotencyKey(request: Request, body: Record<string, unknown>): string | null | false {
  const raw = request.headers.get(IDEMPOTENCY_HEADER) ?? body.idempotencyKey;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return false;
  const key = raw.trim();
  if (!key) return null;
  if (key.length > IDEMPOTENCY_MAX_KEY) return false;
  return key;
}

/** Normaliza a JSON estable: claves ordenadas y fechas ISO (mismo cuerpo, mismo hash). */
function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const nested = canonical(source[key]);
      if (nested !== undefined) result[key] = nested;
    }
    return result;
  }
  return value;
}

/** Hash del cuerpo de la operación, sin la clave de idempotencia (comparación exacta). */
export function requestHashOf(body: Record<string, unknown>): string {
  const { idempotencyKey: _ignored, ...operation } = body;
  return createHash("sha256").update(JSON.stringify(canonical(operation))).digest("hex");
}

/** Valor listo para el `Json` de Prisma: fechas ISO, sin `undefined`. */
function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

/** Borra las claves vencidas (limpieza); nunca rompe la operación que la llama. */
export async function purgeExpiredIdempotencyKeys(now = new Date()): Promise<number> {
  try {
    const { count } = await db.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } });
    return count;
  } catch (error) {
    console.error(
      "[idempotency] No se pudieron limpiar las claves vencidas:",
      error instanceof Error ? error.message : error,
    );
    return 0;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "P2002";
}

function expiresAtFrom(now: Date): Date {
  return new Date(now.getTime() + IDEMPOTENCY_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Respuesta de un reintento: el resultado guardado, sin volver a ejecutar nada. */
function replayResponse(stored: StoredKey, requestHash: string): Response {
  if (stored.requestHash !== requestHash) {
    return jsonError("Esa clave de idempotencia ya se usó para otra operación: generá una nueva.", 409);
  }
  return Response.json(stored.response ?? {}, {
    status: stored.status >= 200 && stored.status <= 599 ? stored.status : 200,
    headers: { "Idempotent-Replay": "true" },
  });
}

async function storedKeyOf(organizationId: string, scope: string, key: string): Promise<StoredKey | null> {
  const row = await db.idempotencyKey.findUnique({
    where: { organizationId_scope_key: { organizationId, scope, key } },
    select: { requestHash: true, status: true, response: true },
  });
  return row ? { requestHash: row.requestHash, status: row.status, response: row.response } : null;
}

async function runTransaction(
  options: IdempotencyOptions,
  run: IdempotentHandler,
  key: string | null,
  requestHash: string,
): Promise<Response> {
  const { organizationId, scope } = options;
  let outcome: IdempotentOutcome | null = null;

  let transaction: { kind: "replay"; stored: StoredKey } | { kind: "done" };
  try {
    transaction = await db.$transaction(
      async (tx) => {
        if (key) {
          const existing = await tx.idempotencyKey.findUnique({
            where: { organizationId_scope_key: { organizationId, scope, key } },
            select: { requestHash: true, status: true, response: true },
          });
          if (existing) return { kind: "replay" as const, stored: existing as StoredKey };
        }
        const result = await run(tx);
        if (result instanceof Response) throw new EarlyResponse(result);
        outcome = result;
        if (key) {
          await tx.idempotencyKey.create({
            data: {
              id: randomUUID(),
              organizationId,
              scope,
              key,
              requestHash,
              status: result.status,
              response: jsonSafe(result.body),
              expiresAt: expiresAtFrom(new Date()),
            },
          });
        }
        return { kind: "done" as const };
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
  } catch (error) {
    if (error instanceof EarlyResponse) return error.response;
    throw error;
  }

  if (transaction.kind === "replay") return replayResponse(transaction.stored, requestHash);

  const committed = outcome as IdempotentOutcome | null;
  if (!committed) return jsonError("No pudimos completar la operación.", 500);
  try {
    await committed.afterCommit?.();
  } catch (error) {
    console.error(
      `[idempotency] No se pudieron correr los efectos posteriores de ${scope}:`,
      error instanceof Error ? error.message : error,
    );
  }
  return Response.json(committed.body, { status: committed.status });
}

/**
 * Ejecuta una operación financiera con idempotencia. Siempre envuelve las
 * escrituras en una transacción; con clave, además deja la fila de
 * `IdempotencyKey` y los reintentos devuelven la misma respuesta.
 */
export async function withIdempotency(options: IdempotencyOptions, run: IdempotentHandler): Promise<Response> {
  const key = readIdempotencyKey(options.request, options.body);
  if (key === false) {
    return jsonError(`La clave de idempotencia no puede superar los ${IDEMPOTENCY_MAX_KEY} caracteres.`, 400);
  }
  const requestHash = requestHashOf(options.body);
  if (!key) return runTransaction(options, run, null, requestHash);

  await purgeExpiredIdempotencyKeys();

  try {
    return await runTransaction(options, run, key, requestHash);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Otra petición con la misma clave ganó la carrera: se devuelve su resultado.
    const stored = await storedKeyOf(options.organizationId, options.scope, key);
    if (stored) return replayResponse(stored, requestHash);
    // La limpieza borró la fila mientras tanto: un único reintento.
    return await runTransaction(options, run, key, requestHash);
  }
}
