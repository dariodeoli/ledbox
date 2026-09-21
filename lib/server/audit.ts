import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AuditActionValue, AuditEntity } from "@/lib/admin-types";
import { db } from "./db";
import type { AdminContext } from "./tenancy";

/**
 * Auditoría del panel: fuente única para registrar cambios en `AuditLog`.
 *
 * Toda mutación de `app/api/admin/*` (y el PATCH comercial de leads) llama a
 * `recordAudit` con el contexto de tenancy (`organizationId` + actor) y un
 * resumen legible. El registro es **best-effort**: si el log falla, se reporta
 * en consola y la operación principal sigue igual (nunca se rompe por auditar).
 *
 * El detalle se acota a los campos que cambian: `changes` (antes/después) en
 * ediciones, `fields` en altas y `before` en bajas. No se vuelcan filas enteras.
 */

export type AuditContext = Pick<AdminContext, "organizationId" | "user">;

/** Contexto de auditoría para acciones del portal del cliente (actor externo, sin cuenta del panel). */
export function portalAuditContext(organizationId: string, name: string, email?: string | null): AuditContext {
  return {
    organizationId,
    user: {
      id: "portal",
      name: name.trim() || "Cliente (portal)",
      email: (email ?? "").trim(),
      // `role` solo satisface el tipo; `recordAudit` no lo persiste.
      role: "VIEWER",
    },
  };
}

export type AuditDetail = {
  changes?: Record<string, { from: unknown; to: unknown }>;
  fields?: Record<string, unknown>;
  before?: Record<string, unknown>;
};

export type AuditEntry = {
  context: AuditContext;
  action: AuditActionValue;
  entity: AuditEntity;
  entityId: string;
  summary: string;
  detail?: AuditDetail | null;
};

const MAX_SUMMARY = 400;
const MAX_TEXT_VALUE = 500;

type JsonSafe = string | number | boolean | null | JsonSafe[] | { [key: string]: JsonSafe };

/** Valor serializable seguro para `Json`: fechas ISO, sin `undefined`, NaN ni textos enormes. */
function jsonSafe(value: unknown): JsonSafe {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    return value.length > MAX_TEXT_VALUE ? `${value.slice(0, MAX_TEXT_VALUE - 1)}…` : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === "object") {
    const result: { [key: string]: JsonSafe } = {};
    for (const [key, nested] of Object.entries(value)) result[key] = jsonSafe(nested);
    return result;
  }
  return String(value);
}

/** Normaliza para comparar: `undefined` y las fechas inválidas cuentan como `null`. */
function comparable(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

/** Registra un cambio. Nunca lanza: si falla, la operación principal no se rompe. */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        id: randomUUID(),
        organizationId: entry.context.organizationId,
        actorId: entry.context.user.id,
        actorName: entry.context.user.name,
        actorEmail: entry.context.user.email,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        summary: entry.summary.slice(0, MAX_SUMMARY),
        detail: entry.detail ? (jsonSafe(entry.detail) as Prisma.InputJsonObject) : undefined,
      },
    });
  } catch (error) {
    console.error(
      `[audit] No se pudo registrar ${entry.action} de ${entry.entity}:${entry.entityId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Campos que cambiaron entre el estado anterior y el nuevo, comparando solo los
 * indicados. Devuelve `null` cuando no hubo cambios (así el endpoint no ensucia
 * el historial con ediciones vacías).
 */
export function auditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: readonly string[],
): Record<string, { from: unknown; to: unknown }> | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const field of fields) {
    const previous = comparable(before[field]);
    const next = comparable(after[field]);
    if (!Object.is(previous, next)) changes[field] = { from: before[field] ?? null, to: after[field] ?? null };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Recorta `source` a los campos indicados, sin `undefined` (para altas y bajas). */
export function auditPick(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined) picked[field] = source[field];
  }
  return picked;
}

// ── Días de Asunción para el filtro desde/hasta ───────────────────────────────
// Misma regla que el calendario operativo: el rango se resuelve con las 00:00
// locales (no con la medianoche UTC del servidor). Paraguay no aplica horario
// de verano desde 2024, pero el offset se calcula igual con Intl.

const TIME_ZONE = "America/Asuncion";
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const zonePartsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function zoneOffsetMs(instant: Date): number {
  const parts = zonePartsFormat.formatToParts(instant);
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return (
    Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour"), pick("minute"), pick("second")) - instant.getTime()
  );
}

/** `YYYY-MM-DD` válido (día real del calendario). */
export function isAuditDayKey(value: string): boolean {
  if (!DAY_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Instante UTC de las 00:00 de un día de Asunción. */
export function auditDayStart(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const firstGuess = utcMidnight - zoneOffsetMs(new Date(utcMidnight));
  return new Date(utcMidnight - zoneOffsetMs(new Date(firstGuess)));
}

/** Inicio (exclusivo) del día siguiente a una clave `YYYY-MM-DD`. */
export function auditNextDayStart(dayKey: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  return auditDayStart(
    new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10),
  );
}
