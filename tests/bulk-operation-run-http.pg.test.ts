import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("BulkOperationRun: escritor real, replay idempotente, outcomes por fila y aislamiento tenant", { skip: !process.env.TEST_DATABASE_URL || !process.env.BULKRUN_TEST_BASE_URL }, async () => {
  const dbUrl = new URL(process.env.TEST_DATABASE_URL!);
  const base = new URL(process.env.BULKRUN_TEST_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(dbUrl.hostname));
  assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  process.env.DATABASE_URL = dbUrl.toString();
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const orgId = randomUUID(), otherOrgId = randomUUID();
  const userIds: string[] = [];
  async function session(organizationId: string) {
    const userId = randomUUID(); userIds.push(userId);
    const user = await db.adminUser.create({ data: { id: userId, name: "Bulk run QA", email: `${userId}@example.invalid`, passwordHash: "no-login" } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: userId, organizationId, role: "OWNER" } });
    return `ledbox_session=${(await createSession(user, organizationId)).jwt}`;
  }
  try {
    await db.organization.createMany({ data: [
      { id: orgId, name: "Bulk run QA", slug: `bulk-run-${orgId}` },
      { id: otherOrgId, name: "Bulk run QA other", slug: `bulk-run-${otherOrgId}` },
    ] });
    const itemId = randomUUID();
    await db.inventoryItem.create({ data: { id: itemId, organizationId: orgId, name: "Ficha QA", category: "QA", quantity: 4, notes: "antes" } });
    const owner = await session(orgId), otherOwner = await session(otherOrgId);
    const request = (cookie: string, key: string, body: object) => fetch(new URL("/api/admin/inventory", base), {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body),
    });
    const body = { kind: "bulk-items", ids: [itemId], changes: { notes: "después" } };
    const first = await request(owner, "run-276-same", body);
    assert.equal(first.status, 200, await first.clone().text());
    const firstBody = await first.json();
    assert.equal(firstBody.status, "COMPLETED");
    assert.deepEqual(firstBody.outcomes, [{ id: itemId, status: "succeeded" }]);
    const replay = await request(owner, "run-276-same", body);
    assert.equal(replay.status, 200);
    assert.equal(replay.headers.get("Idempotent-Replay"), "true");
    assert.equal((await replay.json()).runId, firstBody.runId);
    const conflict = await request(owner, "run-276-same", { ...body, changes: { notes: "distinto" } });
    assert.equal(conflict.status, 409);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).notes, "después");
    const read = await fetch(new URL(`/api/admin/inventory?bulkOperationRunId=${firstBody.runId}`, base), { headers: { Cookie: owner } });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).run.actorName, "Bulk run QA");
    const crossTenant = await fetch(new URL(`/api/admin/inventory?bulkOperationRunId=${firstBody.runId}`, base), { headers: { Cookie: otherOwner } });
    assert.equal(crossTenant.status, 404);
    const missingKey = await fetch(new URL("/api/admin/inventory", base), { method: "POST", headers: { Cookie: owner, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal(missingKey.status, 400);
    const foreignId = randomUUID();
    const rejected = await request(owner, "run-276-foreign", { ...body, ids: [foreignId] });
    assert.equal(rejected.status, 404);
    const failedRun = await db.bulkOperationRun.findUniqueOrThrow({ where: { organizationId_idempotencyKey: { organizationId: orgId, idempotencyKey: "run-276-foreign" } } });
    assert.equal(failedRun.status, "FAILED");
    assert.deepEqual(failedRun.outcomes, [{ id: foreignId, status: "failed", message: "La selección contiene registros que no existen en esta empresa. No se aplicó ningún cambio." }]);
    assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).quantity, 4);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
    await db.adminUser.deleteMany({ where: { id: { in: userIds } } });
  }
});
