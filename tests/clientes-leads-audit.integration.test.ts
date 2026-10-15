import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const base = process.env.CRM_TEST_BASE_URL;
const local = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(process.env.DATABASE_URL ?? ""));

test("CRM HTTP: buscar fuera del límite, permisos, validaciones y conversión concurrente sin duplicados", { skip: !local }, async (t) => {
  const db = new PrismaClient();
  const org = randomUUID(), foreignOrg = randomUUID(), ownerId = randomUUID(), viewerId = randomUUID();
  let cookie = "";
  const call = (path: string, method = "GET", body?: unknown, authenticated = true) => fetch(`${base}${path}`, {
    method,
    headers: { ...(authenticated ? { Cookie: cookie } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await db.organization.createMany({ data: [{ id: org, name: "CRM QA ficticio", slug: `crm-${org}` }, { id: foreignOrg, name: "Otra empresa QA", slug: `crm-${foreignOrg}` }] });
    const owner = await db.adminUser.create({ data: { id: ownerId, name: "Owner CRM QA", email: `${ownerId}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    const viewer = await db.adminUser.create({ data: { id: viewerId, name: "Viewer CRM QA", email: `${viewerId}@example.invalid`, role: "VIEWER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.createMany({ data: [{ id: randomUUID(), adminUserId: ownerId, organizationId: org, role: "OWNER" }, { id: randomUUID(), adminUserId: viewerId, organizationId: org, role: "VIEWER" }] });
    const { createSession } = await import("../lib/server/auth");
    cookie = `ledbox_session=${(await createSession(owner, org)).jwt}`;
    const oldId = randomUUID(), foreignId = randomUUID();
    await db.client.createMany({ data: [
      { id: oldId, organizationId: org, name: "ZAFIRO antiguo", phone: "0981 777 666", email: "antiguo@example.invalid", createdAt: new Date("2020-01-01T12:00:00Z") },
      { id: foreignId, organizationId: foreignOrg, name: "ZAFIRO privado", email: "otro@example.invalid" },
      ...Array.from({ length: 1001 }, (_, i) => ({ id: randomUUID(), organizationId: org, name: `Reciente ${i}`, email: `reciente-${i}@example.invalid` })),
    ] });
    await t.test("búsqueda remota atraviesa 200, tiene scope y admite mayúsculas", async () => {
      const initial = await (await call("/api/admin/clients")).json();
      assert.equal(initial.clients.length, 200); assert.equal(initial.truncated, true);
      assert.equal(initial.clients.some((c: { id: string }) => c.id === oldId), false);
      const searched = await (await call("/api/admin/clients?q=zafiro")).json();
      assert.deepEqual(searched.clients.map((c: { id: string }) => c.id), [oldId]);
      assert.equal(searched.truncated, false);
      assert.equal((await call(`/api/admin/clients?q=${"a".repeat(201)}`)).status, 400);
    });
    await t.test("crear, editar, rechazar sin mutación y separar empresas", async () => {
      assert.equal((await call("/api/admin/clients", "POST", { tradeName: "Sin sesión" }, false)).status, 401);
      const res = await call("/api/admin/clients", "POST", { tradeName: "Aurora & Eventos QA", phone: "0981123456", email: " QA@EXAMPLE.INVALID " });
      assert.equal(res.status, 201, await res.clone().text());
      const client = (await res.json()).client;
      assert.equal(client.email, "qa@example.invalid");
      assert.equal((await call(`/api/admin/clients/${client.id}`, "PATCH", { contacts: [{ name: "Ana López", role: "Compras", phone: "0981234567" }], city: "Asunción" })).status, 200);
      const before = await db.client.findUniqueOrThrow({ where: { id: client.id } });
      for (const body of [null, [], { email: "incorrecto" }, { contacts: [{ name: "" }] }, { notes: "a".repeat(2001) }]) {
        assert.equal((await call(`/api/admin/clients/${client.id}`, "PATCH", body)).status, 400);
        assert.deepEqual(await db.client.findUniqueOrThrow({ where: { id: client.id } }), before);
      }
      assert.equal((await call(`/api/admin/clients/${foreignId}`)).status, 404);
      assert.equal((await call(`/api/admin/clients/${foreignId}`, "PATCH", { tradeName: "No" })).status, 404);
    });
    const lead = async (email: string, phone: string) => db.lead.create({ data: { id: randomUUID(), organizationId: org, name: "Contacto CRM QA", email, phone, source: "test-local", consentAt: new Date() } });
    await t.test("conversión reutiliza cliente más antiguo que los 1000 candidatos previos", async () => {
      const l = await lead("nuevo-email@example.invalid", "+595 981 777666");
      const res = await call("/api/leads", "PATCH", { id: l.id, convertToClient: true });
      assert.equal(res.status, 200, await res.clone().text());
      const body = await res.json();
      assert.equal(body.client.id, oldId); assert.equal(body.clientCreated, false);
    });
    await t.test("dos conversiones simultáneas del mismo lead crean un solo cliente", async () => {
      const l = await lead("mismo-lead@example.invalid", "+595 991 111222");
      const responses = await Promise.all(Array.from({ length: 2 }, () => call("/api/leads", "PATCH", { id: l.id, convertToClient: true })));
      for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
      const results = await Promise.all(responses.map(r => r.json()));
      assert.equal(results[0].client.id, results[1].client.id);
      assert.equal(await db.client.count({ where: { organizationId: org, email: l.email } }), 1);
    });
    await t.test("leads distintos con mismo contacto concurrentes se deduplican", async () => {
      const [a, b] = await Promise.all([lead("compartido@example.invalid", "0981555666"), lead("COMPARTIDO@example.invalid", "+595981555666")]);
      const results = await Promise.all([a, b].map(async l => {
        const response = await call("/api/leads", "PATCH", { id: l.id, convertToClient: true });
        assert.equal(response.status, 200, await response.clone().text()); return response.json();
      }));
      assert.equal(results[0].client.id, results[1].client.id);
    });
    await t.test("conversión no reutiliza cliente de otra empresa y reintento es estable", async () => {
      const l = await lead("otro@example.invalid", "+595 991 333444");
      const first = await (await call("/api/leads", "PATCH", { id: l.id, convertToClient: true })).json();
      assert.notEqual(first.client.id, foreignId);
      const again = await (await call("/api/leads", "PATCH", { id: l.id, convertToClient: true })).json();
      assert.equal(again.client.id, first.client.id); assert.equal(again.clientCreated, false);
    });
    await t.test("búsqueda de leads encuentra ingreso antiguo fuera de los últimos 100", async () => {
      const oldLead = await db.lead.create({ data: { id: randomUUID(), organizationId: org, name: "ZAFIRO lead antiguo", email: "antiguo-lead@example.invalid", phone: "0981123456", consentAt: new Date(), createdAt: new Date("2020-01-01T12:00:00Z") } });
      await db.lead.createMany({ data: Array.from({ length: 101 }, (_, i) => ({ id: randomUUID(), organizationId: org, name: `Reciente lead ${i}`, email: `lead-${i}@example.invalid`, phone: "0981123456", consentAt: new Date() })) });
      await db.lead.create({ data: { id: randomUUID(), organizationId: foreignOrg, name: "ZAFIRO lead privado", email: "privado@example.invalid", phone: "0981123456", consentAt: new Date() } });
      const initial = await (await call("/api/leads")).json();
      assert.equal(initial.leads.length, 100); assert.equal(initial.truncated, true);
      const searched = await (await call("/api/leads?q=zafiro")).json();
      assert.deepEqual(searched.leads.map((l: { id: string }) => l.id), [oldLead.id]);
      assert.equal(searched.truncated, false);
      assert.equal((await call(`/api/leads?q=${"a".repeat(201)}`)).status, 400);
    });
    await t.test("lead manual exige consentimiento; PATCH inválido no da 500; VIEWER sólo lee", async () => {
      for (const body of [null, [], true]) assert.equal((await call("/api/leads", "PATCH", body)).status, 400);
      const manual = { name: "Ana López", email: "lead@example.invalid", phone: "+595 981 123456", source: "whatsapp" };
      assert.equal((await call("/api/admin/leads", "POST", manual)).status, 400);
      assert.equal((await call("/api/admin/leads", "POST", { ...manual, consent: true })).status, 201);
      cookie = `ledbox_session=${(await createSession(viewer, org)).jwt}`;
      assert.equal((await call("/api/admin/clients?q=zafiro")).status, 200);
      assert.equal((await call("/api/admin/clients", "POST", { tradeName: "No permitido" })).status, 403);
      assert.equal((await call(`/api/admin/clients/${oldId}`, "PATCH", { tradeName: "No permitido" })).status, 403);
      assert.equal((await call("/api/admin/leads", "POST", { ...manual, consent: true })).status, 403);
      assert.equal((await call("/api/leads", "PATCH", { id: randomUUID(), convertToClient: true })).status, 403);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, foreignOrg] } } });
    await db.adminUser.deleteMany({ where: { id: { in: [ownerId, viewerId] } } });
    await db.$disconnect();
  }
});
