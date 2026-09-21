#!/usr/bin/env node
/**
 * Aplica las migraciones pendientes de Prisma antes de arrancar el servidor.
 * También corre en modo `--best-effort` durante el build (no falla si todavía no
 * hay base disponible: el arranque vuelve a intentar y ahí sí exige éxito).
 *
 * Casos que cubre:
 *  - Sin DATABASE_URL: no hace nada.
 *  - Base nueva: `prisma migrate deploy` crea todo desde cero.
 *  - Base publicada: el schema se creó con `prisma db push` y `_prisma_migrations`
 *    no tiene la migración init; se marca como aplicada (baseline) y recién
 *    después se aplican las pendientes, que son aditivas e idempotentes.
 *  - Base ya migrada: no hace nada.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

const BASELINE_MIGRATION = "202609150001_init";
const BEST_EFFORT = process.argv.includes("--best-effort");
const log = (message) => console.log(`[migrate] ${message}`);

async function needsBaseline() {
  const prisma = new PrismaClient();
  try {
    const [{ base }] = await prisma.$queryRawUnsafe(
      `select exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'AdminUser') as base`,
    );
    if (!base) return false;
    const [{ history }] = await prisma.$queryRawUnsafe(
      `select exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = '_prisma_migrations') as history`,
    );
    if (!history) return true;
    const rows = await prisma.$queryRawUnsafe(
      `select count(*)::int as count from _prisma_migrations where migration_name = $1 and finished_at is not null and rolled_back_at is null`,
      BASELINE_MIGRATION,
    );
    return rows[0].count === 0;
  } finally {
    await prisma.$disconnect();
  }
}

function runPrisma(args) {
  const require = createRequire(import.meta.url);
  let cli;
  try {
    cli = require.resolve("prisma/build/index.js");
  } catch {
    throw new Error("No se encontró el CLI de Prisma (prisma/build/index.js); revisá que `prisma` esté en dependencies.");
  }
  execFileSync(process.execPath, [cli, ...args], { stdio: "inherit", env: process.env });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    log("DATABASE_URL no configurada; se omiten las migraciones.");
    return;
  }
  if (await needsBaseline()) {
    log(`Base sin historial de migraciones: marco ${BASELINE_MIGRATION} como aplicada.`);
    runPrisma(["migrate", "resolve", "--applied", BASELINE_MIGRATION]);
  }
  log("Aplicando migraciones pendientes…");
  runPrisma(["migrate", "deploy"]);
  log("Migraciones al día.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (BEST_EFFORT) {
    console.warn(`[migrate] Omitido (best-effort): ${message}`);
    return;
  }
  console.error(`[migrate] No se pudieron aplicar las migraciones: ${message}`);
  process.exit(1);
});
