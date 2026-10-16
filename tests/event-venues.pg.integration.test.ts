import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_HTTP_BASE_URL);
test("recintos guardados, ciudad estricta y aislamiento por empresa", { skip: !enabled }, async (t) => {
  const database = new URL(process.env.TEST_DATABASE_URL!);
  const base = new URL(process.env.TEST_HTTP_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  process.env.DATABASE_URL = database.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const org = randomUUID(), foreignOrg = randomUUID(), userId = randomUUID();
  try {
    await db.organization.createMany({ data: [org, foreignOrg].map(id => ({ id, name: "Recintos QA", slug: `venue-${id}` })) });
    const user = await db.adminUser.create({ data: { id: userId, name: "Prueba recintos", email: `${userId}@fixtures.test`, passwordHash: "fixture", role: "OWNER", autoLockEnabled: false } });
    const membership = await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: userId, role: "OWNER" } });
    const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
    const request = async (path: string, method = "GET", data?: unknown, authenticated = true) => fetch(new URL(path, base), { method, headers: { ...(authenticated ? { Cookie: cookie } : {}), "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente de prueba" } });
    const otherClient = await db.client.create({ data: { id: randomUUID(), organizationId: foreignOrg, name: "Privado" } });
    await db.event.createMany({ data: [
      { id: randomUUID(), organizationId: foreignOrg, clientId: otherClient.id, name: "Privado", location: "Recinto privado", venueContactName: "Privado" },
      { id: randomUUID(), organizationId: org, clientId: client.id, name: "Papelera", location: "Recinto borrado", deletedAt: new Date() },
      { id: randomUUID(), organizationId: org, clientId: client.id, name: "Antiguo", location: "Salón QA", address: "Dirección anterior", venueContactName: "Antiguo", updatedAt: new Date("2020-01-01"), createdAt: new Date("2020-01-01") },
      ...Array.from({ length: 205 }, (_, index) => ({ id: randomUUID(), organizationId: org, clientId: client.id, name: `Histórico ${index}`, location: `Recinto ${index}`, updatedAt: new Date("2021-01-01"), createdAt: new Date("2021-01-01") })),
    ] });
    // Ensaya la migración real sólo sobre las fixtures históricas de esta empresa.
    const migration = readFileSync("prisma/migrations/202611040001_event_venue_directory/migration.sql", "utf8");
    const backfill = migration.slice(migration.indexOf("WITH source AS")).replace('WHERE e."deletedAt" IS NULL', 'WHERE e."organizationId" = $1 AND e."deletedAt" IS NULL');
    await db.$executeRawUnsafe(backfill, org);
    let eventId = "";
    await t.test("texto libre de recinto se guarda con contacto y dirección completos", async () => {
      const response = await request("/api/admin/events", "POST", { clientId: client.id, name: "Nuevo evento", location: "Salón QA", city: "asuncion", address: "Nueva dirección", addressReference: "Portón azul", locationUrl: "https://maps.example.invalid/qa", venueContactName: "Ana", venueContactPhone: "+595 981123456", venueContactEmail: "ANA@FIXTURES.TEST", responsibleName: "Responsable privado" });
      assert.equal(response.status, 201, await response.clone().text());
      const event = (await response.json()).event; eventId = event.id;
      assert.equal(event.location, "Salón QA"); assert.equal(event.city, "Asunción"); assert.equal(event.venueContactEmail, "ana@fixtures.test");
      const defaults = (await (await request("/api/admin/events?fields=venues")).json()).venues.find((row: { location: string }) => row.location === "Salón QA");
      assert.equal(defaults.venueContactName, "Antiguo", "guardar evento no reemplaza datos predeterminados");
      const save = await request("/api/admin/venues", "POST", { ...event, id: defaults.id, expectedRevision: defaults.revision });
      assert.equal(save.status, 200, await save.clone().text());

    });
    await t.test("libreta supera listado de 200; defaults explícitos, sin papelera ni otras empresas ni responsables", async () => {
      const response = await request("/api/admin/events?fields=venues"); assert.equal(response.status, 200);
      const { venues } = await response.json();
      assert.equal(venues.length, 206);
      const venue = venues.find((row: { location: string }) => row.location === "Salón QA");
      assert.equal(venue.address, "Nueva dirección"); assert.equal(venue.venueContactName, "Ana"); assert.equal(venue.addressReference, "Portón azul");
      assert.equal(venue.responsibleName, undefined); assert.equal(venue.clientId, undefined);
      assert.ok(!venues.some((row: { location: string }) => ["Recinto privado", "Recinto borrado"].includes(row.location)));
    });
    await t.test("ciudad inválida se rechaza antes de crear o editar; ciudad histórica idéntica permanece", async () => {
      const before = await db.event.findUniqueOrThrow({ where: { id: eventId } });
      assert.equal((await request("/api/admin/events", "POST", { clientId: client.id, name: "No crear", city: "Asunciónx" })).status, 400);
      assert.equal((await request("/api/admin/events", "PATCH", { id: eventId, city: "Asunciónx" })).status, 400);
      assert.deepEqual(await db.event.findUniqueOrThrow({ where: { id: eventId } }), before);
      await db.event.update({ where: { id: eventId }, data: { city: "Ciudad histórica" } });
      assert.equal((await request("/api/admin/events", "PATCH", { id: eventId, city: "Ciudad histórica", notes: "Otra edición" })).status, 200);
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: eventId } })).city, "Ciudad histórica");
    });
    await t.test("lectura requiere sesión; VIEWER consulta libreta pero no modifica eventos", async () => {
      assert.equal((await request("/api/admin/events?fields=venues", "GET", undefined, false)).status, 401);
      await db.adminMembership.update({ where: { id: membership.id }, data: { role: "VIEWER" } });
      assert.equal((await request("/api/admin/events?fields=venues")).status, 200);
      assert.equal((await request("/api/admin/events", "PATCH", { id: eventId, location: "No autorizado" })).status, 403);
    });
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: { in: [org, foreignOrg] } } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
