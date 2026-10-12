import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/server/auth";

const base = process.env.MOBILE_API_TEST_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)
  && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_mobile_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? ""));

test("mobile real HTTP/PG: revocation, effective role, cross-company isolation and actual deletion", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const prefix = `mobile-${randomUUID()}`;
  const userId = `${prefix}-user`, successorId = `${prefix}-successor`;
  const orgA = `${prefix}-A`, orgB = `${prefix}-B`;
  const password = "local-mobile-test-password";
  const email = `${prefix}@example.invalid`;
  const call = (path: string, token?: string, method = "GET", body?: unknown) => fetch(`${base}/api/mobile/${path}`, {
    method, signal: AbortSignal.timeout(10000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const login = async () => {
    const response = await call("login", undefined, "POST", { email, password });
    assert.equal(response.status, 200);
    return (await response.json()).session.accessToken as string;
  };
  try {
    await db.organization.createMany({ data: [{ id: orgA, slug: orgA, name: "Own A" }, { id: orgB, slug: orgB, name: "Own B" }] });
    await db.adminUser.create({ data: { id: userId, name: "Mobile tester", email, passwordHash: await hashPassword(password), role: "OWNER" } });
    await db.adminMembership.createMany({ data: [{ id: `${prefix}-memberA`, adminUserId: userId, organizationId: orgA, role: "VIEWER" }, { id: `${prefix}-memberB`, adminUserId: userId, organizationId: orgB, role: "OWNER" }] });
    for (const [organizationId, suffix] of [[orgA, "A"], [orgB, "B"]]) {
      await db.client.create({ data: { id: `${prefix}-client${suffix}`, organizationId, name: "Private client" } });
      await db.event.create({ data: { id: `${prefix}-event${suffix}`, organizationId, clientId: `${prefix}-client${suffix}`, name: `Event ${suffix}`, notes: "PRIVATE-NOTES", responsibleEmail: "private@example.invalid", startsAt: new Date("2026-10-09T03:00:00Z"), endsAt: new Date("2026-10-12T03:00:00Z") } });
    }
    const budget = await db.budget.create({ data: { id: `${prefix}-budget`, organizationId: orgB, clientId: `${prefix}-clientB`, title: "Retained financial terms", total: 123456 } });
    const document = await db.signatureRequest.create({ data: { id: `${prefix}-document`, organizationId: orgB, budgetId: budget.id, publicCode: prefix, title: "Retention fixture", senderId: userId, senderName: "Mobile tester", recipientName: "Recipient", expiresAt: new Date("2030-01-01"), documentHash: "retained-document-hash", documentHashCapturedAt: new Date(), signedDocumentHash: "retained-signed-hash" } });
    assert.equal((await call("me", "lbx_service_key")).status, 401);
    const firstToken = await login();
    assert.equal((await call("logout", firstToken, "POST")).status, 200);
    assert.equal((await call("me", firstToken)).status, 401);
    const token = await login();
    assert.equal((await call("active-organization", token, "POST", { organizationId: orgA })).status, 200);
    const me = await (await call("me", token)).json();
    assert.equal(me.activeOrganization.role, "VIEWER");
    assert.equal(me.capabilities.includes("finance.write"), false);
    const eventsResponse = await call("events", token);
    assert.equal(eventsResponse.status, 200);
    const events = await eventsResponse.json();
    assert.deepEqual(events.events.map((event: { id: string }) => event.id), [`${prefix}-eventA`]);
    assert.equal(JSON.stringify(events).includes("PRIVATE-NOTES"), false);
    assert.equal((await call(`events?organizationId=${orgB}`, token)).status, 400);
    const calendar = await call("calendar?from=2026-10-10&to=2026-10-10", token);
    assert.equal(calendar.status, 200);
    assert.equal((await calendar.json()).items[0].date, "2026-10-10");
    assert.equal((await call("active-organization", token, "POST", { organizationId: `${prefix}-foreign` })).status, 403);
    await db.adminMembership.update({ where: { id: `${prefix}-memberA` }, data: { active: false } });
    assert.equal((await call("events", token)).status, 403); // No fallback a empresaB.
    await db.adminMembership.update({ where: { id: `${prefix}-memberA` }, data: { active: true } });
    const body = { password, confirmation: "DELETE_ACCOUNT" };
    const blocked = await call("account", token, "DELETE", body);
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, "OWNER_TRANSFER_REQUIRED");
    assert.ok(await db.adminUser.findUnique({ where: { id: userId } }));
    await db.adminUser.create({ data: { id: successorId, name: "Successor", email: `${prefix}-successor@example.invalid`, passwordHash: await hashPassword(password), role: "OWNER" } });
    await db.adminMembership.create({ data: { id: `${prefix}-successorMember`, adminUserId: successorId, organizationId: orgB, role: "VIEWER" } });
    const transferBody = { password, targetUserId: successorId, confirmation: "TRANSFER_OWNERSHIP" };
    assert.equal((await call("account/transfer-ownership", token, "POST", transferBody)).status, 403); // VIEWER en A aunque JWT dice OWNER.
    assert.equal((await call("active-organization", token, "POST", { organizationId: orgB })).status, 200);
    assert.equal((await call("account/transfer-ownership", token, "POST", { ...transferBody, targetUserId: `${prefix}-foreign` })).status, 409);
    assert.equal((await call("account/transfer-ownership", token, "POST", transferBody)).status, 200);
    assert.equal((await db.adminMembership.findUniqueOrThrow({ where: { id: `${prefix}-successorMember` } })).role, "OWNER");
    assert.equal((await (await call("me", token)).json()).activeOrganization.role, "ADMIN");
    assert.equal((await call("account", token, "DELETE", { ...body, password: "wrong" })).status, 401);
    const deleted = await call("account", token, "DELETE", body);
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).deleted, true);
    assert.equal(await db.adminUser.findUnique({ where: { id: userId } }), null);
    assert.equal(await db.adminSession.count({ where: { userId } }), 0);
    assert.equal((await call("me", token)).status, 401);
    assert.deepEqual(await db.budget.findUnique({ where: { id: budget.id } }), budget);
    assert.deepEqual(await db.signatureRequest.findUnique({ where: { id: document.id } }), document);
    assert.equal(await db.organization.count({ where: { id: { in: [orgA, orgB] } } }), 2);
  } finally {
    // Únicamente fixtures propias en DB local dedicada, después de las aserciones.
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.adminUser.deleteMany({ where: { id: { in: [userId, successorId] } } });
    await db.$disconnect();
    await (await import("../lib/server/db")).db.$disconnect();
  }
});
