import { NextResponse } from "next/server";
import { db } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health del proceso + estado de la base. Siempre responde 200 (el healthcheck
 * solo verifica que el contenedor esté arriba); `database` y `migrations`
 * permiten ver desde afuera si la base está accesible y las migraciones aplicadas.
 */
export async function GET() {
  const { database, migrations } = await probe();
  return NextResponse.json({ status: "ok", service: "ledbox", database, migrations });
}

async function probe(): Promise<{ database: "ok" | "unavailable"; migrations: number | null }> {
  try {
    await db.$queryRawUnsafe("select 1");
  } catch {
    return { database: "unavailable", migrations: null };
  }
  try {
    const rows = await db.$queryRawUnsafe<Array<{ count: number }>>(
      `select count(*)::int as count from _prisma_migrations where finished_at is not null and rolled_back_at is null`,
    );
    return { database: "ok", migrations: Number(rows[0]?.count ?? 0) };
  } catch {
    return { database: "ok", migrations: null };
  }
}
