import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PANEL_HOME } from "../lib/admin-routes";

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.LOGIN_TEST_BASE_URL);
test("login HTTP local: sesión válida, ausente, revocada y bloqueada conservan su flujo", { skip: !enabled, timeout: 90000 }, async () => {
  const database = new URL(process.env.TEST_DATABASE_URL!), base = new URL(process.env.LOGIN_TEST_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  process.env.DATABASE_URL = database.toString();
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const id = randomUUID(), userId = randomUUID();
  const get = (path: string, cookie?: string) => fetch(new URL(path, base), { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
  try {
    await db.organization.create({ data: { id, slug: `qa141-login-${id}`, name: "Empresa ficticia de acceso" } });
    const user = await db.adminUser.create({ data: { id: userId, name: "QA acceso", email: `${id}@example.invalid`, passwordHash: "sin-login", role: "OWNER", pinHash: "hash-no-utilizado", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: userId, organizationId: id, role: "OWNER" } });
    const session = await createSession(user, id), cookie = `ledbox_session=${session.jwt}`;
    const anonymous = await get("/login"); assert.equal(anonymous.status, 200); assert.match(await anonymous.text(), /type="password"/);
    const valid = await get("/login", cookie); assert.equal(valid.status, 307); assert.equal(new URL(valid.headers.get("location")!, base).pathname, PANEL_HOME);
    const home = await get(PANEL_HOME, cookie); assert.equal(home.status, 200, "el destino no vuelve al login");
    await db.adminSession.update({ where: { id: session.sessionId }, data: { lockedAt: new Date(), lockReason: "manual" } });
    const locked = await get("/login", cookie); assert.equal(locked.status, 307); assert.equal(new URL(locked.headers.get("location")!, base).pathname, PANEL_HOME);
    const state = await get("/api/admin/session", cookie); assert.equal(state.status, 200); const payload = await state.json();
    assert.equal(payload.locked, true); assert.equal(payload.lock?.hasPin, true, "el redirect no elimina el PIN ni desbloquea la sesión");
    assert.equal((await get(PANEL_HOME, cookie)).status, 200);
    assert.ok((await db.adminSession.findUniqueOrThrow({ where: { id: session.sessionId } })).lockedAt);
    await db.adminSession.update({ where: { id: session.sessionId }, data: { revokedAt: new Date() } });
    const revoked = await get("/login", cookie); assert.equal(revoked.status, 200); assert.match(await revoked.text(), /type="password"/);
  } finally {
    await db.organization.deleteMany({ where: { id } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
});
