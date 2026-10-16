import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
test("backup HTTP requires privileged demo, binds preview and restores once into NEW sandbox with isolated cookie", { skip: !process.env.TEST_DATABASE_URL || !process.env.BACKUP_TEST_BASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!), base = process.env.BACKUP_TEST_BASE_URL!; assert.ok(["127.0.0.1", "localhost"].includes(url.hostname)); assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname)); process.env.DATABASE_URL = url.toString();
  const { dbWithDeleted: db } = await import("../lib/server/db"); const { createSession } = await import("../lib/server/auth"); const { exportInventoryBackup } = await import("../lib/server/inventory-backup"); const { purgeSandbox } = await import("../lib/server/demo-sandboxes");
  const parent = randomUUID(), sandbox = randomUUID(), users: string[] = [], targets: string[] = [];
  const host = "demo.localhost:3168";
  async function session(role: "OWNER" | "VIEWER", organizationId: string) {
    const id = randomUUID(); users.push(id); const user = await db.adminUser.create({ data: { id, email: `${id}@example.invalid`, name: "Backup HTTP QA", passwordHash: "not-a-login", role } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId, adminUserId: id, role } });
    return `ledbox_demo=${(await createSession(user, organizationId)).jwt}`;
  }
  try {
    await db.organization.create({ data: { id: parent, name: "Backup parent QA", slug: `back-http-${parent}` } });
    await db.organization.create({ data: { id: sandbox, name: "Backup sandbox QA", slug: `back-http-${sandbox}`, isDemo: true, demoParentId: parent, demoReady: true, demoExpiresAt: new Date(Date.now() + 3600000), demoLastSeenAt: new Date() } });
    const owner = await session("OWNER", sandbox), viewer = await session("VIEWER", sandbox);
    const realOwner = (await session("OWNER", parent)).replace("ledbox_demo=", "ledbox_session=");
    const bytes = await exportInventoryBackup(parent);
    const call = (action: string, cookie: string, token?: string, requestHost = host) => { const form = new FormData(); form.set("backup", new Blob([Buffer.from(bytes)], { type: "application/zip" }), "backup.zip"); form.set("action", action); if (token) form.set("token", token); return fetch(`${base}/api/admin/inventory/backup`, { method: "POST", headers: { Host: requestHost, "X-Forwarded-Host": requestHost, Cookie: cookie }, body: form }); };
    assert.equal((await call("preview", "")).status, 401); assert.equal((await call("preview", viewer)).status, 403);
    assert.equal((await call("preview", realOwner, undefined, "localhost:3168")).status, 403, "real tenant cannot be a restoration target");
    const preview = await call("preview", owner); assert.equal(preview.status, 200); const data = await preview.json(); assert.ok(data.token);
    assert.equal((await call("restore", owner, `${data.token}bad`)).status, 409);
    const [response, concurrent] = await Promise.all([call("restore", owner, data.token), call("restore", owner, data.token)]);
    assert.equal(concurrent.status, 201); const concurrentResult = await concurrent.json(); assert.equal(response.status, 201); const out = await response.json(); targets.push(out.sandbox.organizationId); assert.equal(concurrentResult.sandbox.organizationId, out.sandbox.organizationId); assert.notEqual(out.sandbox.organizationId, sandbox);
    assert.match(response.headers.get("set-cookie") ?? "", /ledbox_demo=/);
    const replay = await call("restore", owner, data.token); assert.equal(replay.headers.get("idempotent-replay"), "true"); const repeated = await replay.json(); assert.equal(repeated.sandbox.organizationId, out.sandbox.organizationId);
    const target = await db.organization.findUniqueOrThrow({ where: { id: out.sandbox.organizationId } }); assert.equal(target.isDemo, true); assert.equal(target.demoReady, true); assert.equal(target.paymentDetails, null); assert.equal(target.fiscalDetails, null);
    assert.equal(await db.inventoryItem.count({ where: { organizationId: target.id } }), 0, "factory must not seed commercial demo products");
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: sandbox } })).demoReady, true, "current demo remains intact");
  } finally {
    for (const id of targets) await purgeSandbox(id);
    await db.organization.deleteMany({ where: { id: { in: [sandbox, parent] } } }); await db.adminUser.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  }
});
