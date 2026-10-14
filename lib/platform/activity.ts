import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/server/db";

/**
 * Registro de actividad del panel (docs/SUPERADMIN.md §3). Una fila por (usuario, día de
 * Paraguay) con un bit por hora, y `AdminUser.lastActiveAt`. A lo sumo UNA escritura por
 * usuario y hora de Paraguay: si `lastActiveAt` ya cae en la hora actual, no se escribe.
 * Nunca frena ni rompe la respuesta: corre en `after()` y cualquier error queda en un warn.
 */

const TIME_ZONE = "America/Asuncion";

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Día (`YYYY-MM-DD`) y hora (0–23) de Paraguay para un instante. */
export function paraguayDayHour(date: Date): { day: string; hour: number } {
  const parts: Record<string, string> = {};
  for (const part of partsFormat.formatToParts(date)) parts[part.type] = part.value;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** ¿Hay que escribir? Sí si nunca se registró o si el último registro es de otra hora de Paraguay. */
export function shouldRecordActivity(lastActiveAt: Date | null | undefined, now: Date): boolean {
  if (!lastActiveAt) return true;
  const last = paraguayDayHour(lastActiveAt);
  const current = paraguayDayHour(now);
  return last.day !== current.day || last.hour !== current.hour;
}

export type ActivityWrite = { userId: string; organizationId: string | null; now: Date };

/**
 * Upsert idempotente y conmutativo: `hourMask |` suma el bit sin pisar los otros y
 * `GREATEST` evita que un request viejo retrase `lastSeenAt` / `lastActiveAt`.
 */
export async function recordAdminActivity({ userId, organizationId, now }: ActivityWrite): Promise<void> {
  const { day, hour } = paraguayDayHour(now);
  const bit = 1 << hour;
  const at = now.toISOString();
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "AdminActivityDay" ("id", "userId", "organizationId", "day", "firstSeenAt", "lastSeenAt", "hourMask")
    VALUES (${randomUUID()}, ${userId}, ${organizationId}, ${day}::date,
            (${at}::timestamptz AT TIME ZONE 'UTC'), (${at}::timestamptz AT TIME ZONE 'UTC'), ${bit}::int)
    ON CONFLICT ("userId", "day") DO UPDATE SET
      "hourMask" = "AdminActivityDay"."hourMask" | ${bit}::int,
      "lastSeenAt" = GREATEST("AdminActivityDay"."lastSeenAt", (${at}::timestamptz AT TIME ZONE 'UTC')),
      "firstSeenAt" = LEAST("AdminActivityDay"."firstSeenAt", (${at}::timestamptz AT TIME ZONE 'UTC')),
      "organizationId" = COALESCE("AdminActivityDay"."organizationId", ${organizationId})`);
  await db.$executeRaw(Prisma.sql`
    UPDATE "AdminUser"
    SET "lastActiveAt" = GREATEST(COALESCE("lastActiveAt", (${at}::timestamptz AT TIME ZONE 'UTC')), (${at}::timestamptz AT TIME ZONE 'UTC'))
    WHERE "id" = ${userId}`);
}

export type TrackActivityInput = {
  userId: string;
  organizationId: string | null;
  lastActiveAt: Date | null | undefined;
  /** La demo nunca escribe. */
  demo: boolean;
  now?: Date;
  /** Inyectables para pruebas; por defecto `after()` y `recordAdminActivity`. */
  schedule?: (work: () => Promise<void>) => void;
  write?: (input: ActivityWrite) => Promise<void>;
};

/**
 * Se llama solo desde la rama de cookie de `requireAdminContext` (nunca con API key).
 * Devuelve si programó una escritura. No lanza jamás.
 */
export function trackAdminActivity(input: TrackActivityInput): boolean {
  try {
    if (input.demo) return false;
    const now = input.now ?? new Date();
    if (!shouldRecordActivity(input.lastActiveAt, now)) return false;
    const write = input.write ?? recordAdminActivity;
    const schedule = input.schedule ?? ((work: () => Promise<void>) => after(work));
    schedule(async () => {
      try {
        await write({ userId: input.userId, organizationId: input.organizationId, now });
      } catch (error) {
        console.warn("[platform] no se pudo registrar la actividad", error instanceof Error ? error.message : error);
      }
    });
    return true;
  } catch (error) {
    console.warn("[platform] no se pudo programar el registro de actividad", error instanceof Error ? error.message : error);
    return false;
  }
}
