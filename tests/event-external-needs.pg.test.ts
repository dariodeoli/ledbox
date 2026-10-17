import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("necesidades externas fase A: aislamiento, replay, CAS y ninguna mutación de stock", { skip: !process.env.TEST_DATABASE_URL || !process.env.EVENT_EXTERNAL_NEEDS_TEST_BASE_URL }, async () => {
  const dbUrl = new URL(process.env.TEST_DATABASE_URL!);
  const base = new URL(process.env.EVENT_EXTERNAL_NEEDS_TEST_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(dbUrl.hostname));
  assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  process.env.DATABASE_URL = dbUrl.toString();
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const orgIds = [randomUUID(), randomUUID()];
  const userIds: string[] = [];
  const sessions: string[] = [];
  try {
    await db.organization.createMany({ data: orgIds.map((id, i) => ({ id, name: `Need QA ${i}`, slug: `need-qa-${id}` })) });
    for (const [index, organizationId] of orgIds.entries()) {
      const userId = randomUUID(); userIds.push(userId);
      const user = await db.adminUser.create({ data: { id: userId, name: "Needs QA", email: `${userId}@example.invalid`, passwordHash: "no-login" } });
      await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: userId, organizationId, role: "OWNER" } });
      sessions.push(`ledbox_session=${(await createSession(user, organizationId)).jwt}`);
    }
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: orgIds[0], name: "QA cliente" } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: orgIds[0], clientId: client.id, name: "QA evento" } });
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: orgIds[0], name: "Equipo QA", category: "QA", quantity: 2 } });
    const foreignItem = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: orgIds[1], name: "Ajeno QA", category: "QA", quantity: 9 } });
    const path = `/api/admin/events/${event.id}/external-needs`;
    const post = (cookie: string, key: string, body: object) => fetch(new URL(path, base), { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
    const payload = { inventoryId: item.id, requestedQuantity: 7, startsAt: "2031-05-10T10:00:00.000Z", endsAt: "2031-05-11T18:00:00.000Z", notes: "Pendiente de consulta" };
    const first = await post(sessions[0], "need-270-create", payload);
    assert.equal(first.status, 201, await first.clone().text());
    const created = (await first.json()).need;
    assert.equal(created.status, "OPEN"); assert.equal(created.revision, 1);
    const replay = await post(sessions[0], "need-270-create", payload);
    assert.equal(replay.status, 201); assert.equal(replay.headers.get("Idempotent-Replay"), "true");
    assert.equal((await replay.json()).need.id, created.id);
    const conflict = await post(sessions[0], "need-270-create", { ...payload, requestedQuantity: 8 });
    assert.equal(conflict.status, 409);
    assert.equal((await post(sessions[0], "need-270-foreign", { ...payload, inventoryId: foreignItem.id })).status, 404);
    const duplicate = await post(sessions[0], "need-270-duplicate", payload);
    assert.equal(duplicate.status, 409);
    const patch = (expectedRevision: number, changes: object) => fetch(new URL(path, base), { method: "PATCH", headers: { Cookie: sessions[0], "Content-Type": "application/json", "Idempotency-Key": `need-270-patch-${expectedRevision}-${JSON.stringify(changes)}` }, body: JSON.stringify({ id: created.id, expectedRevision, changes }) });
    const updated = await patch(1, { requestedQuantity: 8 });
    assert.equal(updated.status, 200, await updated.clone().text());
    assert.equal((await updated.json()).need.revision, 2);
    assert.equal((await patch(1, { requestedQuantity: 10 })).status, 409);
    const cancel = await patch(2, { status: "CANCELLED" });
    assert.equal(cancel.status, 200);
    assert.equal((await cancel.json()).need.status, "CANCELLED");
    const read = await fetch(new URL(path, base), { headers: { Cookie: sessions[1] } });
    assert.equal(read.status, 404);
    assert.equal(await db.eventExternalNeed.count({ where: { organizationId: orgIds[0], eventId: event.id } }), 1);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 2);
    assert.equal(await db.eventInventory.count({ where: { eventId: event.id } }), 0);
    assert.equal(await db.auditLog.count({ where: { organizationId: orgIds[0], entity: "EventExternalNeed" } }), 3);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgIds } } });
    await db.adminUser.deleteMany({ where: { id: { in: userIds } } });
  }
});
