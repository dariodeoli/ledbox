import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const base = process.env.PLAN_REQUEST_TEST_BASE_URL;
const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(url));

test("planes HTTP/PG local: solicitud concurrente única, tenant, demo y cola protegida", { skip: !enabled, timeout: 120000 }, async t => {
  process.env.DATABASE_URL = url;
  const { PrismaClient } = await import("@prisma/client");
  const db = new PrismaClient();
  const { createSession } = await import("../lib/server/auth");
  const { loadPendingPlanRequests } = await import("../lib/platform/queries/plan-requests");
  const suffix = randomUUID(), A = `plans-A-${suffix}`, B = `plans-B-${suffix}`, D = `plans-demo-${suffix}`;
  const p1 = `plans-one-${suffix}`, p2 = `plans-two-${suffix}`, p3 = `plans-three-${suffix}`;
  const users: string[] = [], sessions: string[] = [];
  const call = (path: string, cookie = "", body?: unknown, demoHost = false) => fetch(`${base}${path}`, { method: body === undefined ? "GET" : "POST", redirect: "manual", headers: { Cookie: demoHost ? cookie.replace(/^ledbox_session=/, "ledbox_demo=") : cookie, ...(demoHost ? { "X-Forwarded-Host": "demo.localhost:3160" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  async function account(role: "OWNER" | "VIEWER", org: string) {
    const u = await db.adminUser.create({ data: { id: randomUUID(), name: `Plans QA ${role}`, email: `${randomUUID()}@example.invalid`, passwordHash: "not-a-login", role, autoLockEnabled: false } }); users.push(u.id);
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: u.id, organizationId: org, role } });
    const s = await createSession(u, org); sessions.push(s.sessionId); return `ledbox_session=${s.jwt}`;
  }
  try {
    await db.plan.createMany({ data: [{ id: p1, code: p1, name: "QA inicial", priceMonthly: 1 }, { id: p2, code: p2, name: "QA superior", priceMonthly: 2 }, { id: p3, code: p3, name: "QA otro superior", priceMonthly: 3 }] });
    await db.organization.createMany({ data: [{ id: A, slug: A, name: `Plans A ${suffix}`, planId: p1 }, { id: B, slug: B, name: `Plans B ${suffix}`, planId: p1 }, { id: D, slug: D, name: "Sandbox planes", isDemo: true, demoParentId: A, demoReady: true, demoExpiresAt: new Date(Date.now() + 3600000), demoLastSeenAt: new Date(), planId: p1 }] });
    const ownerA = await account("OWNER", A), ownerB = await account("OWNER", B), viewer = await account("VIEWER", A), demo = await account("OWNER", D);
    const endpoint = "/api/admin/plan/requests";
    await t.test("doce solicitudes simultáneas crean sólo una pending sin conceder plan", async () => {
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call(endpoint, ownerA, { planId: p2, note: `nota${i}`, organizationId: B })));
      assert.ok(results.every(r => r.status === 200 || r.status === 201), results.map(r => r.status).join(","));
      assert.equal(await db.planChangeRequest.count({ where: { organizationId: A, status: "pending" } }), 1);
      assert.equal(await db.planChangeRequest.count({ where: { organizationId: B } }), 0);
      assert.equal((await db.organization.findUniqueOrThrow({ where: { id: A } })).planId, p1);
      const id = (await db.planChangeRequest.findFirstOrThrow({ where: { organizationId: A } })).id;
      assert.equal((await call(endpoint, ownerA, { planId: p3, note: "Última nota" })).status, 200);
      const row = await db.planChangeRequest.findUniqueOrThrow({ where: { id } }); assert.equal(row.planId, p3); assert.equal(row.note, "Última nota"); assert.equal(row.status, "pending");
    });
    await t.test("permisos, JSON, plan actual y demo no alteran pendientes", async () => {
      assert.equal((await call(endpoint, viewer, { planId: p2 })).status, 403);
      assert.equal((await call(endpoint, demo, { planId: p2 })).status, 401, "demo aislada fuera de su host");
      assert.equal((await call(endpoint, demo, { planId: p2 }, true)).status, 403, "demo en su host no solicita planes");
      assert.equal((await call(endpoint, "", { planId: p2 })).status, 401);
      assert.equal((await call(endpoint, ownerA, null)).status, 400);
      assert.equal((await call(endpoint, ownerA, { planId: p1 })).status, 409);
      assert.equal(await db.planChangeRequest.count({ where: { organizationId: D } }), 0);
      assert.equal((await call(endpoint, ownerB, { planId: p2 })).status, 201);
    });
    await t.test("cola global y acceso: empresa visible, plan pendiente, ninguna concesión y no demo", async () => {
      const queue = await loadPendingPlanRequests(1);
      assert.ok(queue.rows.some(r => r.organization.id === A && r.plan.name === "QA otro superior"));
      assert.ok(queue.rows.some(r => r.organization.id === B)); assert.ok(!queue.rows.some(r => r.organization.id === D));
      const denied = await call("/superadmin", ownerA); assert.equal(denied.status, 307); assert.equal(denied.headers.get("location"), "/");
      // Sólo reutiliza una cuenta local de plataforma si existe; no convierte un tenant en superadmin.
      const platform = await db.adminUser.findUnique({ where: { email: "dariodeoli@gmail.com" } });
      if (platform?.active && platform.emailVerifiedAt) {
        const s = await createSession(platform); sessions.push(s.sessionId);
        const response = await call("/superadmin", `ledbox_session=${s.jwt}`); assert.equal(response.status, 200); assert.match(await response.text(), /Solicitudes de plan pendientes/);
      } else t.diagnostic("Acceso positivo HTTP de plataforma NOT_RUN: no hay cuenta local activa/verificada; guard puro tiene suite propia.");
    });
  } finally {
    await db.adminSession.deleteMany({ where: { id: { in: sessions } } });
    await db.organization.deleteMany({ where: { id: { in: [A, B, D] } } });
    await db.adminUser.deleteMany({ where: { id: { in: users } } });
    await db.plan.deleteMany({ where: { id: { in: [p1, p2, p3] } } });
    await db.$disconnect();
  }
});
