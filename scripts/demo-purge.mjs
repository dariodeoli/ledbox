#!/usr/bin/env node
/**
 * Purga a mano las sandboxes vencidas de la demo (docs/DEMO-INTERACTIVA.md §1 y §9).
 *
 * Es la misma purga que corre sola en cada entrada a /api/demo/session: guarda las acciones en
 * `DemoSession`, borra datos, usuarios y archivos de la sandbox y la empresa. Se puede correr las veces que
 * sea (repetible; las filas bloqueadas por otra purga se saltean).
 *
 * Uso (con DATABASE_URL y AUTH_SECRET del entorno; nunca contra producción sin avisar al dueño):
 *   node --import tsx scripts/demo-purge.mjs            # solo las vencidas (1 h sin uso, 24 h o sin sembrar)
 *   node --import tsx scripts/demo-purge.mjs --limit 50 # tope de sandboxes a borrar (por defecto 500)
 *   node --import tsx scripts/demo-purge.mjs --idle     # además libera las ociosas de más de 30 min
 *   node --import tsx scripts/demo-purge.mjs --count    # solo cuenta cuántas hay, no borra
 */
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 500;

if (!process.env.DATABASE_URL) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}
if (!Number.isInteger(limit) || limit < 1) {
  console.error("--limit tiene que ser un entero mayor que 0.");
  process.exit(1);
}
process.env.AUTH_SECRET ||= "demo-purge-no-usa-sesiones";

let lib;
try {
  lib = await import("../lib/server/demo-sandboxes.ts");
} catch (error) {
  console.error("No se pudo cargar la purga. Correla con: node --import tsx scripts/demo-purge.mjs");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
const { db } = await import("../lib/server/db.ts");

try {
  if (flag("--count")) {
    const rows = await db.$queryRaw`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE "demoExpiresAt" <= now() OR COALESCE("demoLastSeenAt","createdAt") <= now() - interval '1 hour' OR (NOT "demoReady" AND "createdAt" <= now() - interval '5 minutes'))::int AS vencidas
      FROM "Organization" WHERE "isDemo" AND "demoParentId" IS NOT NULL`;
    console.log(`Sandboxes: ${rows[0].total} en total, ${rows[0].vencidas} vencidas.`);
  } else {
    const purged = await lib.purgeExpiredSandboxes({ limit });
    let idle = 0;
    if (flag("--idle")) {
      while (idle < limit && (await lib.purgeMostIdleSandbox())) idle += 1;
    }
    console.log(`Sandboxes borradas: ${purged} vencidas${flag("--idle") ? ` y ${idle} ociosas` : ""}.`);
  }
} catch (error) {
  console.error("La purga falló:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
