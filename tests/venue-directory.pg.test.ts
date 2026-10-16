import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const base = process.env.TEST_HTTP_BASE_URL;
const url = process.env.TEST_DATABASE_URL ?? "";
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(url));

test("libreta durable HTTP/PG local: defaults explícitos, CAS, snapshots, roles, backfill y dedup", { skip: !enabled, timeout: 120000 }, async t => {
  process.env.DATABASE_URL = url;
  const { PrismaClient } = await import("@prisma/client"); const db = new PrismaClient();
  const { createSession } = await import("../lib/server/auth");
  const suffix = randomUUID(), A = `venue-A-${suffix}`, B = `venue-B-${suffix}`, L = `venue-legacy-${suffix}`;
  const ids: string[] = [], sessions: string[] = [];
  async function cookie(org: string, role: "OWNER" | "VIEWER" | "FINANCE" | "OPERATIONS") {
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: `Venue ${role}`, email: `${randomUUID()}@example.invalid`, passwordHash: "not-a-login", role, autoLockEnabled: false } }); ids.push(user.id);
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: user.id, role } });
    const s = await createSession(user, org); sessions.push(s.sessionId); return `ledbox_session=${s.jwt}`;
  }
  const call = (path: string, auth: string, body?: unknown) => fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", headers: { Cookie: auth, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const all = async (auth: string) => { const r = await call("/api/admin/venues", auth); assert.equal(r.status, 200); return (await r.json()).venues; };
  try {
    await db.organization.createMany({ data: [A, B, L].map(id => ({ id, slug: id.toLowerCase(), name: id })) });
    const a = await cookie(A, "OWNER"), b = await cookie(B, "OWNER"), l = await cookie(L, "OWNER"), viewer = await cookie(A, "VIEWER"), finance = await cookie(A, "FINANCE"), ops = await cookie(A, "OPERATIONS");
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: A, name: "Cliente ficticio" } });
    let venue: any;
    await t.test("crea recinto sin evento, datos propios normalizados y lectura legacy compatible", async () => {
      assert.equal((await all(a)).length, 0);
      const r = await call("/api/admin/venues", a, { location: " Salón\t Norte ", city: "asuncion", venueContactName: "Ana", venueContactEmail: "ANA@EXAMPLE.INVALID", organizationId: B, responsibleName: "Privado" });
      assert.equal(r.status, 201, await r.clone().text()); venue = (await r.json()).venue;
      assert.equal(venue.location, "Salón Norte"); assert.equal(venue.city, "Asunción"); assert.equal(venue.venueContactEmail, "ana@example.invalid"); assert.equal(venue.responsibleName, undefined); assert.equal(venue.organizationId, undefined);
      assert.equal(await db.event.count({ where: { organizationId: A } }), 0);
      const legacy = await call("/api/admin/events?fields=venues", a); assert.equal((await legacy.json()).venues[0].id, venue.id);
      assert.equal((await all(b)).length, 0);
      assert.equal((await call("/api/admin/venues", a, { location: "SALÓN  NORTE", venueContactName: "No reemplazar" })).status, 409);
      assert.equal((await all(a))[0].venueContactName, "Ana");
    });
    await t.test("evento normal no actualiza defaults; actualización explícita no reescribe eventos ni depende de ellos", async () => {
      const r = await call("/api/admin/events", a, { clientId: client.id, name: "Evento independiente", location: venue.location, city: venue.city, venueContactName: "Contacto de este evento" }); assert.equal(r.status, 201);
      const event = (await r.json()).event;
      assert.equal((await all(a))[0].venueContactName, "Ana");
      const update = await call("/api/admin/venues", a, { id: venue.id, expectedRevision: venue.revision, venueContactName: "Bea", address: "Nueva dirección" }); assert.equal(update.status, 200); venue = (await update.json()).venue;
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: event.id } })).venueContactName, "Contacto de este evento");
      await db.event.delete({ where: { id: event.id } });
      assert.equal((await all(a))[0].venueContactName, "Bea"); assert.equal((await all(a))[0].address, "Nueva dirección");
    });
    await t.test("CAS y dedup concurrentes, nombre editado mantieneID; otro tenant no altera ficha", async () => {
      assert.equal((await call("/api/admin/venues", b, { id: venue.id, expectedRevision: venue.revision, address: "Ajeno" })).status, 404);
      const race = await Promise.all([call("/api/admin/venues", a, { id: venue.id, expectedRevision: venue.revision, address: "A" }), call("/api/admin/venues", a, { id: venue.id, expectedRevision: venue.revision, address: "B" })]); assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
      venue = (await all(a))[0];
      const rename = await call("/api/admin/venues", a, { id: venue.id, expectedRevision: venue.revision, location: "Salón Renombrado" }); assert.equal(rename.status, 200); const renamed = (await rename.json()).venue; assert.equal(renamed.id, venue.id); venue = renamed;
      const creates = await Promise.all([call("/api/admin/venues", a, { location: "Nuevo recinto" }), call("/api/admin/venues", a, { location: " NUEVO  RECINTO " })]); assert.deepEqual(creates.map(r => r.status).sort(), [201, 409]);
    });
    await t.test("roles y entradas inválidas: lectura VIEWER, escritura sólo operación, sin cambios parciales", async () => {
      assert.equal((await call("/api/admin/venues", "")).status, 401);
      assert.equal((await call("/api/admin/venues", viewer)).status, 200);
      for (const auth of [viewer, finance]) assert.equal((await call("/api/admin/venues", auth, { location: "No autorizado" })).status, 403);
      assert.equal((await call("/api/admin/venues", ops, { location: "Operación autorizada" })).status, 201);
      const before = JSON.stringify(await all(a));
      for (const body of [null, [], { location: "Inválido", city: "AsunciónX" }, { location: "Inválido", venueContactEmail: "no-es-correo" }]) assert.equal((await call("/api/admin/venues", a, body)).status, 400);
      assert.equal(JSON.stringify(await all(a)), before);
    });
    await t.test("backfill real conserva ficha con contacto y no mezcla persona/último domicilio; revisión explícita", async () => {
      const legacyClient = await db.client.create({ data: { id: randomUUID(), organizationId: L, name: "Histórico" } });
      const common = { organizationId: L, clientId: legacyClient.id, location: " Salón\u00a0  Patrimonio " };
      await db.event.createMany({ data: [
        { ...common, id: randomUUID(), name: "Completo previo", address: "Dirección de Ana", city: "Ciudad histórica", venueContactName: "Ana", venueContactEmail: "ana@example.invalid", updatedAt: new Date("2020-01-01") },
        { ...common, id: randomUUID(), name: "Sin contacto", address: "Dirección nueva sin contacto", updatedAt: new Date("2022-01-01") },
        { ...common, id: randomUUID(), name: "Borrado", venueContactName: "No usar", venueContactEmail: "borrado@example.invalid", deletedAt: new Date(), updatedAt: new Date("2025-01-01") },
      ] });
      const migration = readFileSync("prisma/migrations/202611040001_event_venue_directory/migration.sql", "utf8");
      const backfill = migration.slice(migration.indexOf("WITH source AS")).replace('WHERE e."deletedAt" IS NULL', 'WHERE e."organizationId" = $1 AND e."deletedAt" IS NULL');
      await db.$executeRawUnsafe(backfill, L);
      const saved = (await all(l))[0]; assert.equal(saved.location, "Salón Patrimonio"); assert.equal(saved.venueContactName, "Ana"); assert.equal(saved.address, "Dirección de Ana"); assert.equal(saved.city, "Ciudad histórica"); assert.equal(saved.needsReview, true);
      const confirm = await call("/api/admin/venues", l, { id: saved.id, expectedRevision: saved.revision, addressReference: "Revisado" }); assert.equal(confirm.status, 200); const confirmed = (await confirm.json()).venue; assert.equal(confirmed.needsReview, false);
      // Segunda ejecución de DDL y backfill: no cambia defaults ya revisados, revisión ni ID.
      const ddl = migration.slice(0, migration.indexOf("WITH source AS")).split(";").filter(statement => /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)/.test(statement));
      for (const statement of ddl) await db.$executeRawUnsafe(statement);
      await db.$executeRawUnsafe(backfill, L);
      const afterReplay = (await all(l))[0]; assert.deepEqual(afterReplay, confirmed);
      await db.event.deleteMany({ where: { organizationId: L } }); assert.deepEqual((await all(l))[0], confirmed);

    });
  } finally {
    await db.adminSession.deleteMany({ where: { id: { in: sessions } } });
    await db.organization.deleteMany({ where: { id: { in: [A, B, L] } } });
    await db.adminUser.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
  }
});
