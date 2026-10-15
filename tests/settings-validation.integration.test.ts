import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const base = process.env.SETTINGS_TEST_BASE_URL;
const local = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(process.env.DATABASE_URL ?? ""));

test("Ajustes HTTP: guardar y reabrir, cuerpos inválidos sin borrar datos y permisos por empresa", { skip: !local }, async (t) => {
  const db = new PrismaClient();
  const org = randomUUID(), foreign = randomUUID();
  const ids = Array.from({ length: 4 }, () => randomUUID());
  let cookie = "";
  const call = (path: string, method = "GET", body?: unknown) => fetch(`${base}/api/admin/${path}`, {
    method, headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    await db.organization.createMany({ data: [{ id: org, name: "Ajustes QA", slug: `settings-${org}` }, { id: foreign, name: "Empresa ajena QA", slug: `settings-${foreign}` }] });
    const roles = ["OWNER", "ADMIN", "VIEWER", "OWNER"] as const;
    const users = await Promise.all(ids.map((id, i) => db.adminUser.create({ data: { id, name: `Persona QA ${i}`, email: `${id}@example.invalid`, role: roles[i], passwordHash: "not-a-login", autoLockEnabled: false } })));
    await db.adminMembership.createMany({ data: ids.map((id, i) => ({ id: randomUUID(), adminUserId: id, organizationId: i === 3 ? foreign : org, role: roles[i] })) });
    const { createSession } = await import("../lib/server/auth");
    const login = async (i: number) => { cookie = `ledbox_session=${(await createSession(users[i], i === 3 ? foreign : org)).jwt}`; };
    await login(0);
    const payment = { bank: "Banco QA", holder: "Empresa QA", account: "123456", accountType: "AHORRO", currency: "PYG" };
    const profile = { contact: { email: "contacto@example.invalid", whatsapp: "+595 981 123456" }, conditions: "Retiro con reserva confirmada." };
    await t.test("los cambios válidos se guardan y la lectura los recupera", async () => {
      assert.equal((await call("organization/payment-details", "POST", payment)).status, 200);
      const reopened = await (await call("organization/payment-details")).json();
      assert.equal(reopened.paymentDetails.account, payment.account);
      assert.equal(reopened.paymentDetails.currency, "PYG");
      assert.equal((await call("organization/profile", "PATCH", { profile })).status, 200);
      const reopenedProfile = await (await call("organization/profile")).json();
      assert.equal(reopenedProfile.profile.conditions, profile.conditions);
      assert.equal(reopenedProfile.profile.contact.email, profile.contact.email);
    });
    for (const [route, method] of [["organization/payment-details", "POST"], ["organization/profile", "PATCH"], ["organization/branding", "PATCH"], ["users", "PATCH"], ["users", "POST"]]) {
      await t.test(`${method} ${route}: null, listas y escalares se rechazan sin mutación`, async () => {
        const before = await db.organization.findUniqueOrThrow({ where: { id: org } });
        for (const body of [null, [], true, "texto"]) {
          assert.equal((await call(route, method, body)).status, 400, `${route} ${JSON.stringify(body)}`);
          assert.deepEqual(await db.organization.findUniqueOrThrow({ where: { id: org } }), before);
        }
      });
    }
    await t.test("perfil envuelto inválido no vacía contacto ni condiciones", async () => {
      const before = await db.organization.findUniqueOrThrow({ where: { id: org } });
      for (const profile of [null, [], true, "texto"]) {
        assert.equal((await call("organization/profile", "PATCH", { profile })).status, 400);
        assert.deepEqual(await db.organization.findUniqueOrThrow({ where: { id: org } }), before);
      }
    });
    await t.test("valores inválidos y roles desconocidos se rechazan sin modificar", async () => {
      const before = await db.organization.findUniqueOrThrow({ where: { id: org } });
      assert.equal((await call("organization/payment-details", "POST", { ...payment, currency: "XYZ" })).status, 400);
      assert.equal((await call("organization/profile", "PATCH", { contact: { email: "incorrecto" } })).status, 400);
      assert.equal((await call("users", "PATCH", { id: ids[1], role: "SUPEROWNER" })).status, 400);
      assert.equal((await call("users", "PATCH", { id: ids[1], active: "false" })).status, 400);
      assert.deepEqual(await db.organization.findUniqueOrThrow({ where: { id: org } }), before);
      assert.equal((await db.adminMembership.findFirstOrThrow({ where: { adminUserId: ids[1], organizationId: org } })).role, "ADMIN");
    });
    await t.test("VIEWER no modifica ni obtiene ajustes privados; IDs de otra empresa no habilitan edición", async () => {
      await login(2);
      for (const route of ["organization/payment-details", "organization/profile", "organization/branding", "users"]) assert.equal((await call(route)).status, 403);
      assert.equal((await call("organization/payment-details", "POST", payment)).status, 403);
      assert.equal((await call("organization/profile", "PATCH", { profile })).status, 403);
      await login(0);
      assert.equal((await call("users", "PATCH", { id: ids[3], active: false })).status, 404);
      await login(3);
      assert.equal((await (await call("organization/payment-details")).json()).paymentDetails.account, null);
      assert.equal((await (await call("organization/profile")).json()).profile.conditions, null);
    });
    await t.test("el último propietario y el propio acceso no pueden quitarse; ADMIN no asciende a OWNER", async () => {
      await login(0);
      assert.equal((await call("users", "PATCH", { id: ids[0], active: false })).status, 400);
      assert.equal((await call("users", "PATCH", { id: ids[0], role: "ADMIN" })).status, 400);
      await login(1);
      assert.equal((await call("users", "PATCH", { id: ids[0], role: "ADMIN" })).status, 403);
      assert.equal((await call("users", "PATCH", { id: ids[2], role: "OWNER" })).status, 403);
      assert.equal(await db.adminMembership.count({ where: { organizationId: org, role: "OWNER", active: true } }), 1);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, foreign] } } });
    await db.adminUser.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
