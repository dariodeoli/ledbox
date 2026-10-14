import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/platform-activity.pg.test.ts
test("panel de plataforma E0: registro de actividad, correo verificado y reserva del dueño en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const activity = await import("../lib/platform/activity");
  const access = await import("../lib/platform/access");

  const created: string[] = [];
  async function seedUser(email = `u-${randomUUID().slice(0, 8)}@test.dev`) {
    const id = randomUUID();
    created.push(id);
    await db.adminUser.create({ data: { id, name: "Usuaria Prueba", email, passwordHash: "x", role: "ADMIN" } });
    return id;
  }
  const rows = (userId: string) =>
    db.$queryRaw<Array<{ day: string; hourMask: number; organizationId: string | null }>>`
      SELECT to_char("day", 'YYYY-MM-DD') AS day, "hourMask", "organizationId" FROM "AdminActivityDay" WHERE "userId" = ${userId}`;
  const bits = (mask: number) => mask.toString(2).split("").filter((c) => c === "1").length;
  const runAll = async (jobs: Array<() => Promise<void>>) => { for (const job of jobs) await job(); };
  // `schedule` de prueba: en el servidor real lo ejecuta `after()`; acá se junta para esperarlo.
  const pending: Promise<void>[] = [];
  const schedule = (work: () => Promise<void>) => { pending.push(work()); };

  try {
    await t.test("50 llamadas en la misma hora = 1 fila y 1 bit, y lastActiveAt queda puesto", async () => {
      const userId = await seedUser();
      const now = new Date("2026-10-14T15:20:00Z"); // 12:20 en Paraguay
      let lastActiveAt: Date | null = null;
      let writes = 0;
      for (let i = 0; i < 50; i += 1) {
        const at = new Date(now.getTime() + i * 1000);
        const scheduled = activity.trackAdminActivity({ userId, organizationId: null, lastActiveAt, demo: false, now: at, schedule });
        if (scheduled) {
          writes += 1;
          await Promise.all(pending.splice(0));
          lastActiveAt = (await db.adminUser.findUniqueOrThrow({ where: { id: userId }, select: { lastActiveAt: true } })).lastActiveAt;
        }
      }
      assert.equal(writes, 1, "solo la primera llamada de la hora escribe");
      const found = await rows(userId);
      assert.equal(found.length, 1);
      assert.equal(bits(found[0].hourMask), 1);
      assert.equal(found[0].hourMask, 1 << 12);
      assert.ok(lastActiveAt && lastActiveAt.getTime() === now.getTime());
      // Aun forzando 50 escrituras directas, el upsert no duplica fila ni bit.
      await runAll(Array.from({ length: 50 }, (_, i) => () => activity.recordAdminActivity({ userId, organizationId: null, now: new Date(now.getTime() + i) })));
      const again = await rows(userId);
      assert.equal(again.length, 1);
      assert.equal(again[0].hourMask, 1 << 12);
    });

    await t.test("hora nueva suma un bit; lastSeenAt y lastActiveAt nunca retroceden", async () => {
      const userId = await seedUser();
      await activity.recordAdminActivity({ userId, organizationId: null, now: new Date("2026-10-14T16:10:00Z") }); // 13 h PY
      await activity.recordAdminActivity({ userId, organizationId: null, now: new Date("2026-10-14T15:05:00Z") }); // 12 h PY, llegó tarde
      const [row] = await rows(userId);
      assert.equal(row.hourMask, (1 << 12) | (1 << 13));
      const seen = await db.$queryRaw<Array<{ lastSeenAt: Date; firstSeenAt: Date }>>`SELECT "lastSeenAt", "firstSeenAt" FROM "AdminActivityDay" WHERE "userId" = ${userId}`;
      assert.equal(seen[0].lastSeenAt.toISOString(), "2026-10-14T16:10:00.000Z");
      assert.equal(seen[0].firstSeenAt.toISOString(), "2026-10-14T15:05:00.000Z");
      const user = await db.adminUser.findUniqueOrThrow({ where: { id: userId }, select: { lastActiveAt: true } });
      assert.equal(user.lastActiveAt?.toISOString(), "2026-10-14T16:10:00.000Z");
    });

    await t.test("2 llamadas simultáneas en una hora nueva no fallan y dejan 1 fila", async () => {
      const userId = await seedUser();
      const now = new Date("2026-10-15T09:00:00Z");
      const results = await Promise.allSettled([
        activity.recordAdminActivity({ userId, organizationId: null, now }),
        activity.recordAdminActivity({ userId, organizationId: null, now: new Date(now.getTime() + 5) }),
      ]);
      assert.deepEqual(results.map((r) => r.status), ["fulfilled", "fulfilled"]);
      const found = await rows(userId);
      assert.equal(found.length, 1);
      assert.equal(bits(found[0].hourMask), 1);
    });

    await t.test("borde de zona horaria: 02:30 UTC cuenta en el día anterior de Paraguay", async () => {
      const userId = await seedUser();
      await activity.recordAdminActivity({ userId, organizationId: null, now: new Date("2026-10-14T02:30:00Z") });
      const [row] = await rows(userId);
      assert.equal(row.day, "2026-10-13");
      assert.equal(row.hourMask, 1 << 23);
    });

    await t.test("la demo no escribe", async () => {
      const userId = await seedUser();
      const scheduled = activity.trackAdminActivity({ userId, organizationId: null, lastActiveAt: null, demo: true, schedule });
      assert.equal(scheduled, false);
      assert.equal(pending.length, 0);
      assert.equal((await rows(userId)).length, 0);
    });

    await t.test("la API key no pasa por el registro: la rama Bearer de requireAdminContext no lo llama", async () => {
      const source = readFileSync(join(process.cwd(), "lib/server/tenancy.ts"), "utf8");
      const bearerFn = source.slice(source.indexOf("async function requireApiTokenContext"));
      assert.ok(!bearerFn.includes("trackAdminActivity"), "requireApiTokenContext no puede registrar actividad");
      const main = source.slice(source.indexOf("export async function requireAdminContext"), source.indexOf("async function requireApiTokenContext"));
      assert.ok(main.indexOf("if (bearer) return requireApiTokenContext") < main.indexOf("trackAdminActivity("), "el registro va después del retorno anticipado del Bearer");
      assert.equal((source.match(/trackAdminActivity\(/g) ?? []).length, 1);
    });

    await t.test("si el upsert tira error, la request responde igual (sin lanzar) y deja un warn", async () => {
      const warnings: unknown[][] = [];
      const original = console.warn;
      console.warn = (...args: unknown[]) => { warnings.push(args); };
      try {
        // Usuario inexistente: la FK real hace fallar el INSERT.
        const scheduled = activity.trackAdminActivity({ userId: randomUUID(), organizationId: null, lastActiveAt: null, demo: false, schedule });
        assert.equal(scheduled, true);
        await assert.doesNotReject(Promise.all(pending.splice(0)));
        // `after()` mismo roto (fuera de un request): tampoco lanza.
        const broken = activity.trackAdminActivity({ userId: randomUUID(), organizationId: null, lastActiveAt: null, demo: false, schedule: () => { throw new Error("sin request"); } });
        assert.equal(broken, false);
        // Escritura que lanza de forma síncrona o asíncrona.
        activity.trackAdminActivity({ userId: "x", organizationId: null, lastActiveAt: null, demo: false, schedule, write: async () => { throw new Error("base caída"); } });
        await assert.doesNotReject(Promise.all(pending.splice(0)));
      } finally {
        console.warn = original;
      }
      assert.ok(warnings.length >= 3, "cada falla queda registrada, no se traga en silencio");
    });

    await t.test("borrar al usuario borra sus días de actividad (cascade)", async () => {
      const userId = await seedUser();
      await activity.recordAdminActivity({ userId, organizationId: null, now: new Date("2026-10-16T12:00:00Z") });
      await db.adminUser.delete({ where: { id: userId } });
      assert.equal((await rows(userId)).length, 0);
    });

    await t.test("cambiar el correo deja emailVerifiedAt en null", async () => {
      const userId = await seedUser();
      await db.adminUser.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      const next = `nuevo-${randomUUID().slice(0, 8)}@test.dev`;
      await db.adminUser.update({ where: { id: userId }, data: access.emailChangePatch(next) });
      const user = await db.adminUser.findUniqueOrThrow({ where: { id: userId } });
      assert.equal(user.email, next);
      assert.equal(user.emailVerifiedAt, null);
      // La ruta usa exactamente este patch.
      const route = readFileSync(join(process.cwd(), "app/api/admin/users/route.ts"), "utf8");
      assert.match(route, /emailChangePatch\(email\)/);
    });

    await t.test("409 por el correo del dueño: asignarlo a otra cuenta o cambiar el de la cuenta del dueño", async () => {
      const owner = access.PLATFORM_OWNER_EMAIL;
      // Alta (POST) con el correo del dueño y cambio (PATCH) hacia el correo del dueño.
      assert.equal(access.ownerEmailConflict({ currentEmail: null, nextEmail: owner }), true);
      assert.equal(access.ownerEmailConflict({ currentEmail: "otra@test.dev", nextEmail: ` ${owner.toUpperCase()} ` }), true);
      // Cambiar el correo de la cuenta del dueño.
      assert.equal(access.ownerEmailConflict({ currentEmail: owner, nextEmail: "otro@test.dev" }), true);
      // Sin cambio de correo o correos ajenos al dueño: no hay conflicto.
      assert.equal(access.ownerEmailConflict({ currentEmail: owner, nextEmail: owner }), false);
      assert.equal(access.ownerEmailConflict({ currentEmail: "a@test.dev", nextEmail: "b@test.dev" }), false);
      assert.equal(access.ownerEmailConflict({ currentEmail: null, nextEmail: "b@test.dev" }), false);
      // La ruta responde 409 con esas dos condiciones, en POST y en PATCH.
      const route = readFileSync(join(process.cwd(), "app/api/admin/users/route.ts"), "utf8");
      assert.equal((route.match(/ownerEmailConflict\(/g) ?? []).length, 2);
      assert.equal((route.match(/OWNER_EMAIL_RESERVED, 409/g) ?? []).length, 2);
    });

    await t.test("la migración 202610180001 corre dos veces sin error y no pierde datos", async () => {
      const userId = await seedUser();
      await activity.recordAdminActivity({ userId, organizationId: null, now: new Date("2026-10-17T12:00:00Z") });
      const file = join(process.cwd(), "prisma/migrations/202610180001_platform_activity/migration.sql");
      const psqlUrl = new URL(url.toString());
      psqlUrl.search = "";
      for (let run = 0; run < 2; run += 1) {
        execFileSync("psql", [psqlUrl.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
      }
      assert.equal((await rows(userId)).length, 1);
      const idx = await db.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname IN
        ('AdminActivityDay_day_idx','AdminActivityDay_userId_day_key','AuditLog_entity_createdAt_idx','AuditLog_createdAt_idx',
         'AdminSession_createdAt_idx','Budget_approvedAt_idx','ClientPayment_paidAt_idx','Event_createdAt_idx')`;
      assert.equal(idx.length, 8);
    });
  } finally {
    for (const id of created) await db.adminUser.deleteMany({ where: { id } }).catch(() => undefined);
    await db.$disconnect();
  }
});
