import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DEFAULT_MESSAGE_TEMPLATES } from "../lib/server/message-templates";

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_HTTP_BASE_URL);
test("Clientes / Mensajes guarda la misma biblioteca por empresa sin enviar", { skip: !enabled }, async (t) => {
  const database = new URL(process.env.TEST_DATABASE_URL!), base = new URL(process.env.TEST_HTTP_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  process.env.DATABASE_URL = database.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const org = randomUUID(), other = randomUUID(), userId = randomUUID();
  try {
    await db.organization.createMany({ data: [org, other].map(id => ({ id, name: "Mensajes QA", slug: `messages-${id}` })) });
    const user = await db.adminUser.create({ data: { id: userId, email: `${userId}@fixtures.test`, name: "Prueba mensajes", passwordHash: "fixture", role: "OWNER", autoLockEnabled: false } });
    const membership = await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: userId, role: "OWNER" } });
    const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
    const call = (method = "GET", body?: unknown) => fetch(new URL("/api/admin/message-templates", base), { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const model = DEFAULT_MESSAGE_TEMPLATES.find(row => row.category === "client")!;
    let id = "";
    await t.test("modelo compartido se personaliza y conserva el estado activo al recargar", async () => {
      const response = await call("POST", { category: model.category, title: model.title, body: model.body, active: true });
      assert.equal(response.status, 201, await response.clone().text()); id = (await response.json()).template.id;
      const changed = "Hola {{cliente}}, te saluda {{empresa}}. Mensaje personalizado de prueba.";
      assert.equal((await call("PATCH", { id, body: changed, active: false })).status, 200);
      const rows = (await (await call()).json()).templates;
      const saved = rows.find((row: { id: string }) => row.id === id);
      assert.equal(saved.body, changed); assert.equal(saved.active, false); assert.equal(saved.organizationId, org);
    });
    await t.test("restaurar usa el mismo texto de catálogo y guardar no crea envíos", async () => {
      assert.equal((await call("PATCH", { id, body: model.body })).status, 200);
      assert.equal((await db.messageTemplate.findUniqueOrThrow({ where: { id } })).body, model.body);
      assert.equal(await db.mailLog.count({ where: { organizationId: org } }), 0);
      assert.equal(await db.auditLog.count({ where: { organizationId: org, action: "send" } }), 0);
    });
    await t.test("variables de otra categoría se rechazan y el texto guardado no cambia", async () => {
      const before = await db.messageTemplate.findUniqueOrThrow({ where: { id } });
      assert.equal((await call("PATCH", { id, body: "Evento {{fecha}}" })).status, 400);
      assert.deepEqual(await db.messageTemplate.findUniqueOrThrow({ where: { id } }), before);
    });
    await t.test("OWNER reclasifica una plantilla existente y valida variables contra el nuevo contexto", async () => {
      const created = await call("POST", { category: "event", title: "Reclasificación QA", body: "Hola {{cliente}}, evento {{fecha}}" });
      assert.equal(created.status, 201);
      const template = (await created.json()).template;
      assert.equal((await call("PATCH", { id: template.id, category: "client" })).status, 400);
      assert.equal((await db.messageTemplate.findUniqueOrThrow({ where: { id: template.id } })).category, "event");
      assert.equal((await call("PATCH", { id: template.id, category: "client", body: "Hola {{cliente}} de {{empresa}}" })).status, 200);
      const saved = await db.messageTemplate.findUniqueOrThrow({ where: { id: template.id } });
      assert.equal(saved.category, "client"); assert.equal(saved.title, template.title);
    });
    await t.test("otra empresa no se lista ni edita; VIEWER puede leer sin guardar", async () => {
      const foreign = await db.messageTemplate.create({ data: { id: randomUUID(), organizationId: other, title: "Privada", body: model.body, category: model.category } });
      assert.ok(!(await (await call()).json()).templates.some((row: { id: string }) => row.id === foreign.id));
      assert.equal((await call("PATCH", { id: foreign.id, body: "Texto privado" })).status, 404);
      await db.adminMembership.update({ where: { id: membership.id }, data: { role: "VIEWER" } });
      assert.equal((await call()).status, 200);
      assert.equal((await call("PATCH", { id, body: model.body })).status, 403);
      assert.equal((await call("POST", { category: "client", title: "No autorizado", body: model.body })).status, 403);
    });
    await t.test("FINANCE guarda cobranzas y no edita categorías ajenas", async () => {
      await db.adminMembership.update({ where: { id: membership.id }, data: { role: "FINANCE" } });
      const collection = DEFAULT_MESSAGE_TEMPLATES.find(row => row.category === "collection")!;
      const created = await call("POST", { category: collection.category, title: collection.title, body: collection.body });
      assert.equal(created.status, 201);
      const owned = (await created.json()).template;
      assert.equal((await call("PATCH", { id: owned.id, category: "event", body: "Hola {{cliente}}" })).status, 403);
      assert.equal((await call("PATCH", { id, body: model.body })).status, 403);
    });
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
