import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const base = process.env.CRM_TEST_BASE_URL;
const local = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(process.env.DATABASE_URL ?? ""));

test("CRM manual: contacto WhatsApp sin inventar correo y cuerpos de proveedor válidos", { skip: !local }, async (t) => {
  const db = new PrismaClient();
  const org = randomUUID(), otherOrg = randomUUID(), userId = randomUUID(), viewerId = randomUUID();
  let cookie = "";
  const call = (path: string, method: string, body: unknown) => fetch(`${base}${path}`, {
    method, headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    await db.organization.createMany({ data: [{ id: org, name: "Eventos CRM local", slug: `crm2-${org}` }, { id: otherOrg, name: "Otra empresa CRM local", slug: `crm2-${otherOrg}` }] });
    const owner = await db.adminUser.create({ data: { id: userId, name: "Owner CRM", email: `${userId}@example.invalid`, role: "OWNER", passwordHash: "fixture-local", autoLockEnabled: false } });
    const viewer = await db.adminUser.create({ data: { id: viewerId, name: "Viewer CRM", email: `${viewerId}@example.invalid`, role: "VIEWER", passwordHash: "fixture-local", autoLockEnabled: false } });
    await db.adminMembership.createMany({ data: [{ id: randomUUID(), organizationId: org, adminUserId: userId, role: "OWNER" }, { id: randomUUID(), organizationId: org, adminUserId: viewerId, role: "VIEWER" }] });
    const { createSession } = await import("../lib/server/auth");
    cookie = `ledbox_session=${(await createSession(owner, org)).jwt}`;
    const manual = { name: "Ana Eventos", phone: "+595 981 345678", source: "whatsapp", consent: true };
    await t.test("alta sin correo, conversión y reintento preservan contacto sin duplicados", async () => {
      const res = await call("/api/admin/leads", "POST", manual);
      assert.equal(res.status, 201, await res.clone().text());
      const { lead } = await res.json();
      const saved = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
      assert.equal(saved.email, ""); assert.equal(saved.phone, manual.phone); assert.equal(saved.consentChannel, "panel-manual");
      const first = await call("/api/leads", "PATCH", { id: lead.id, convertToClient: true });
      assert.equal(first.status, 200, await first.clone().text());
      const converted = (await first.json()).client;
      const second = await call("/api/leads", "PATCH", { id: lead.id, convertToClient: true });
      assert.equal(second.status, 200, await second.clone().text());
      assert.equal((await second.json()).client.id, converted.id);
      assert.equal(await db.client.count({ where: { organizationId: org, phone: manual.phone } }), 1);
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: converted.id } })).email, null);
    });
    await t.test("correo vacío también es opcional; un correo válido se normaliza", async () => {
      for (const email of ["", "  ", " CRM@EXAMPLE.INVALID "]) {
        const res = await call("/api/admin/leads", "POST", { ...manual, email });
        assert.equal(res.status, 201, await res.clone().text());
        const { lead } = await res.json();
        assert.equal((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).email, email.trim().toLowerCase());
      }
    });
    await t.test("correo inválido, falta de teléfono o consentimiento no crean datos", async () => {
      const before = await db.lead.count({ where: { organizationId: org } });
      for (const body of [{ ...manual, email: "incorrecto" }, { ...manual, email: 123 }, { ...manual, phone: "" }, { ...manual, phone: "abcde" }, { ...manual, phone: undefined }, { ...manual, consent: undefined }, { ...manual, consent: false }]) {
        assert.equal((await call("/api/admin/leads", "POST", body)).status, 400);
      }
      assert.equal(await db.lead.count({ where: { organizationId: org } }), before);
    });
    await t.test("el alta pública mantiene el correo obligatorio sin crear datos", async () => {
      const before = await db.lead.count();
      const res = await call("/api/leads", "POST", manual);
      assert.equal(res.status, 400, await res.clone().text());
      assert.equal(await db.lead.count(), before);
    });
    await t.test("proveedores rechaza JSON no objeto sin mutación", async () => {
      const before = await db.supplier.count({ where: { organizationId: org } });
      for (const method of ["POST", "PATCH"]) for (const body of [null, [], true, 5, "texto"]) {
        const res = await call("/api/admin/suppliers", method, body);
        assert.equal(res.status, 400, `${method} ${JSON.stringify(body)}: ${await res.text()}`);
      }
      assert.equal(await db.supplier.count({ where: { organizationId: org } }), before);
    });
    await t.test("proveedor alta, edición, archivo y reapertura respetan tenant", async () => {
      const created = await call("/api/admin/suppliers", "POST", { name: "Sonido del Sur", category: "OTHER", email: " SONIDO@EXAMPLE.INVALID " });
      assert.equal(created.status, 201, await created.clone().text());
      const { supplier } = await created.json();
      assert.equal(supplier.email, "sonido@example.invalid");
      assert.equal((await call("/api/admin/suppliers", "PATCH", { id: supplier.id, notes: "Montaje nocturno" })).status, 200);
      assert.equal((await call("/api/admin/suppliers", "PATCH", { id: supplier.id, active: false })).status, 200);
      assert.ok((await db.supplier.findUniqueOrThrow({ where: { id: supplier.id } })).archivedAt);
      assert.equal((await call("/api/admin/suppliers", "PATCH", { id: supplier.id, active: true })).status, 200);
      assert.equal((await db.supplier.findUniqueOrThrow({ where: { id: supplier.id } })).archivedAt, null);
      const foreign = await db.supplier.create({ data: { id: randomUUID(), organizationId: otherOrg, name: "Proveedor privado" } });
      assert.equal((await call("/api/admin/suppliers", "PATCH", { id: foreign.id, name: "No permitido" })).status, 404);
      const current = await db.supplier.findUniqueOrThrow({ where: { id: supplier.id } });
      assert.equal((await call("/api/admin/suppliers", "PATCH", { id: supplier.id, email: "invalido" })).status, 400);
      assert.deepEqual(await db.supplier.findUniqueOrThrow({ where: { id: supplier.id } }), current);
    });
    await t.test("VIEWER no crea leads ni proveedores ni edita", async () => {
      cookie = `ledbox_session=${(await createSession(viewer, org)).jwt}`;
      assert.equal((await call("/api/admin/leads", "POST", manual)).status, 403);
      assert.equal((await call("/api/admin/suppliers", "POST", { name: "No permitido" })).status, 403);
      assert.equal((await call("/api/admin/suppliers", "PATCH", { id: randomUUID(), name: "No permitido" })).status, 403);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } });
    await db.adminUser.deleteMany({ where: { id: { in: [userId, viewerId] } } });
    await db.$disconnect();
  }
});
