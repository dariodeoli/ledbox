import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_HTTP_BASE_URL);
test("fechas del presupuesto: guardado explícito atómico, permisos y disponibilidad", { skip: !enabled }, async t => {
  const database = new URL(process.env.TEST_DATABASE_URL!);
  const base = new URL(process.env.TEST_HTTP_BASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
  assert.ok(["127.0.0.1", "localhost"].includes(base.hostname));
  process.env.DATABASE_URL = database.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const { commitInventoryAssignment } = await import("../lib/server/inventory-availability");
  const org = randomUUID(), foreign = randomUUID(), planId = randomUUID();
  const users: string[] = [];
  const at = (day: number) => new Date(Date.UTC(2034, 5, day, 12));
  let cookie = "";
  try {
    await db.plan.create({ data: { id: planId, code: `schedule-${planId}`, name: "Plan QA", priceMonthly: 0 } });
    await db.organization.createMany({ data: [{ id: org, name: "Fechas QA", slug: `schedule-${org}`, planId }, { id: foreign, name: "Ajena QA", slug: `schedule-${foreign}`, planId }] });
    const login = async (role: "OWNER" | "FINANCE" | "VIEWER", organizationId = org) => {
      const id = randomUUID(); users.push(id);
      const user = await db.adminUser.create({ data: { id, email: `${id}@example.invalid`, name: role, role, passwordHash: "fixture", autoLockEnabled: false } });
      await db.adminMembership.create({ data: { id: randomUUID(), organizationId, adminUserId: id, role } });
      cookie = `ledbox_session=${(await createSession(user, organizationId)).jwt}`;
    };
    await login("OWNER");
    const owner = cookie;
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente QA" } });
    const budget = (status: "DRAFT" | "SENT" | "APPROVED" | "CANCELLED" = "DRAFT", eventId?: string) => db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Boda de prueba", status, eventId, total: 90000, subtotal: 100000, discount: 10000, paymentTerms: "Seña de prueba" } });
    const patch = async (id: string, body: unknown) => {
      const r = await fetch(new URL(`/api/admin/budgets/${id}/schedule`, base), { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    const range = { startsAt: at(10).toISOString(), endsAt: at(11).toISOString(), originalEventId: null };
    await t.test("guardar antes del envío crea un solo borrador vinculado, sin aprobar ni reservar ni mandar correo", async () => {
      const b = await budget("SENT");
      const result = await patch(b.id, range);
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.event.status, "DRAFT");
      assert.equal(result.body.event.startsAt, range.startsAt); assert.equal(result.body.event.endsAt, range.endsAt);
      const fresh = await db.budget.findUniqueOrThrow({ where: { id: b.id } });
      assert.equal(fresh.eventId, result.body.event.id); assert.equal(fresh.status, "SENT");
      assert.equal(fresh.total, b.total); assert.equal(fresh.paymentTerms, b.paymentTerms);
      assert.equal(await db.eventTask.count({ where: { eventId: fresh.eventId! } }), 4);
      assert.equal(await db.eventInventory.count({ where: { eventId: fresh.eventId! } }), 0);
      assert.equal(await db.mailLog.count({ where: { organizationId: org } }), 0);
    });
    await t.test("dos guardados simultáneos no crean dos eventos", async () => {
      const b = await budget();
      const before = await db.event.count({ where: { organizationId: org } });
      const results = await Promise.all([patch(b.id, range), patch(b.id, range)]);
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
      assert.equal(await db.event.count({ where: { organizationId: org } }), before + 1);
    });
    await t.test("presupuesto aprobado conserva aprobación, importes y documento firmado", async () => {
      const b = await budget("APPROVED");
      const signature = await db.signatureRequest.create({ data: { id: randomUUID(), organizationId: org, budgetId: b.id, publicCode: randomUUID(), title: "Documento histórico QA", senderName: "QA", recipientName: "Cliente QA", status: "SIGNED", expiresAt: at(30), documentHash: "original-hash", signedDocumentHash: "signed-hash", documentHashCapturedAt: at(1), signedAt: at(2) } });
      const result = await patch(b.id, range);
      assert.equal(result.status, 200); assert.equal(result.body.event.status, "CONFIRMED");
      const fresh = await db.budget.findUniqueOrThrow({ where: { id: b.id } });
      const { eventId: _old, updatedAt: _oldTime, ...before } = b;
      const { eventId: _new, updatedAt: _newTime, ...after } = fresh;
      assert.deepEqual(after, before);
      assert.deepEqual(await db.signatureRequest.findUniqueOrThrow({ where: { id: signature.id } }), signature);
    });
    await t.test("rango inválido, vacío y JSON inválido no crean ni vinculan eventos", async () => {
      const b = await budget(); const count = await db.event.count({ where: { organizationId: org } });
      for (const body of [null, [], { ...range, startsAt: "2026-02-30T12:00:00Z" }, { ...range, endsAt: at(9).toISOString() }, { ...range, startsAt: null, endsAt: null }]) assert.equal((await patch(b.id, body)).status, 400);
      assert.equal(await db.event.count({ where: { organizationId: org } }), count);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: b.id } })).eventId, null);
    });
    await t.test("crear sin fin sigue siendo opcional; reprogramar exige versión original", async () => {
      const b = await budget(); const first = await patch(b.id, { ...range, endsAt: null });
      assert.equal(first.status, 200); assert.equal(first.body.event.endsAt, null);
      const event = first.body.event;
      const body = { ...range, startsAt: at(12).toISOString(), endsAt: at(13).toISOString(), originalEventId: event.id, originalStartsAt: event.startsAt, originalEndsAt: null };
      assert.equal((await patch(b.id, body)).status, 200);
      assert.equal((await patch(b.id, body)).status, 409);
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: event.id } })).startsAt!.toISOString(), body.startsAt);
    });
    await t.test("cambiar fechas con stock ocupado revierte rango y conserva asignación", async () => {
      const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Mesas QA", category: "Mesas", quantity: 8 } });
      const a = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "A", status: "CONFIRMED", startsAt: at(10), endsAt: at(11) } });
      const other = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "B", status: "CONFIRMED", startsAt: at(20), endsAt: at(21) } });
      assert.ok((await commitInventoryAssignment({ organizationId: org, eventId: a.id, inventoryId: item.id, quantity: 8 })).ok);
      assert.ok((await commitInventoryAssignment({ organizationId: org, eventId: other.id, inventoryId: item.id, quantity: 8 })).ok);
      const b = await budget("APPROVED", a.id);
      const result = await patch(b.id, { ...range, startsAt: at(20).toISOString(), endsAt: at(21).toISOString(), originalEventId: a.id, originalStartsAt: a.startsAt!.toISOString(), originalEndsAt: a.endsAt!.toISOString() });
      assert.equal(result.status, 409, JSON.stringify(result.body));
      assert.deepEqual(await db.event.findUniqueOrThrow({ where: { id: a.id } }), a);
      assert.equal(await db.eventInventory.count({ where: { eventId: a.id } }), 1);
    });
    await t.test("el límite del plan no deja evento ni vínculo parcial", async () => {
      const b = await budget(); await db.plan.update({ where: { id: planId }, data: { maxEventsPerMonth: 0 } });
      const count = await db.event.count({ where: { organizationId: org } });
      assert.equal((await patch(b.id, range)).status, 403);
      assert.equal(await db.event.count({ where: { organizationId: org } }), count);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: b.id } })).eventId, null);
      await db.plan.update({ where: { id: planId }, data: { maxEventsPerMonth: null } });
    });
    await t.test("presupuesto cerrado no crea evento", async () => {
      const b = await budget("CANCELLED"); assert.equal((await patch(b.id, range)).status, 409);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: b.id } })).eventId, null);
    });
    await t.test("FINANCE y VIEWER no pueden editar fechas; otra empresa recibe 404", async () => {
      const b = await budget();
      for (const role of ["FINANCE", "VIEWER"] as const) { await login(role); assert.equal((await patch(b.id, range)).status, 403); }
      await login("OWNER", foreign); assert.equal((await patch(b.id, range)).status, 404);
      cookie = owner;
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: b.id } })).eventId, null);
    });
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: { in: [org, foreign] } } });
    await db.adminUser.deleteMany({ where: { id: { in: users } } });
    await db.plan.deleteMany({ where: { id: planId } });
    await db.$disconnect();
  }
});
