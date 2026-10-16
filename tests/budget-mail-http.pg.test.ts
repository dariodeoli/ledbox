import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("budget mail HTTP uses real local provider, persists receipt and never dispatches a replay", { skip: !process.env.TEST_DATABASE_URL || !process.env.MAIL_TEST_BASE_URL, timeout: 60000 }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!), base = new URL(process.env.MAIL_TEST_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  // Start the application with RESEND_BASE_URL=http://127.0.0.1:3170 and a fictional key.
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db"); const { createSession } = await import("../lib/server/auth");
  let deliveries = 0, mode: "accepted" | "uncertain" = "accepted";
  const provider = createServer((req, res) => {
    assert.equal(req.url, "/emails"); deliveries++; req.resume();
    res.setHeader("Content-Type", "application/json");
    if (mode === "uncertain") { res.statusCode = 500; res.end(JSON.stringify({ name: "internal_server_error", message: "Mock uncertain outcome" })); }
    else res.end(JSON.stringify({ id: `qa139-provider-${deliveries}` }));
  });
  await new Promise<void>(resolve => provider.listen(3170, "127.0.0.1", resolve));
  const org = randomUUID(), users: string[] = [];
  async function cookie() {
    const id = randomUUID(); users.push(id);
    const user = await db.adminUser.create({ data: { id, name: "HTTP mail QA", email: `${id}@example.invalid`, passwordHash: "no-login", role: "OWNER" } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: id, role: "OWNER" } });
    return `ledbox_session=${(await createSession(user, org)).jwt}`;
  }
  try {
    await db.organization.create({ data: { id: org, name: "Mail HTTP QA139 ficticio", slug: `qa139-http-${org}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente ficticio HTTP" } });
    const owner = await cookie(), otherActor = await cookie();
    const call = (body: unknown, session = owner) => fetch(`${base.origin}/api/admin/budgets/send`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: session }, body: JSON.stringify(body) });
    for (const scenario of ["accepted", "uncertain"] as const) {
      mode = scenario;
      const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: `QA139 ${scenario}`, publicToken: randomUUID(), subtotal: 1000, total: 1000,
        items: { create: { id: randomUUID(), name: "Ítem ficticio", quantity: 1, unitPrice: 1000, subtotal: 1000 } } } });
      const input = { budgetId: budget.id, to: "qa139@example.invalid" };
      const countBefore = deliveries;
      const previewResponse = await call({ ...input, preview: true }); assert.equal(previewResponse.status, 200);
      const preview = await previewResponse.json(); assert.ok(preview.attemptId); assert.equal(deliveries, countBefore);
      assert.equal(await db.idempotencyKey.count({ where: { organizationId: org, key: preview.attemptId } }), 0);
      const confirm = { ...input, confirm: true, confirmationToken: preview.confirmationToken };
      const sentResponse = await call(confirm); assert.equal(sentResponse.status, 200); const sent = await sentResponse.json();
      assert.equal(sent.status, scenario === "accepted" ? "sent" : "unknown");
      assert.equal(deliveries, countBefore + 1);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budget.id } })).status, scenario === "accepted" ? "SENT" : "DRAFT");
      const replayResponse = await call(confirm); assert.equal(replayResponse.status, 200);
      const recovered = await call({ budgetId: budget.id, receiptOnly: true, attemptId: preview.attemptId }); assert.equal(recovered.status, 200);
      assert.equal((await recovered.json()).status, sent.status); assert.equal(deliveries, countBefore + 1);
      assert.equal((await call({ budgetId: budget.id, receiptOnly: true, attemptId: preview.attemptId }, otherActor)).status, 404);
      const logs = await db.mailLog.findMany({ where: { organizationId: org, entityId: budget.id } }); assert.equal(logs.length, 1);
      assert.equal(logs[0].status, scenario === "accepted" ? "sent" : "sending");
    }
  } finally {
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
    await db.organization.deleteMany({ where: { id: org } }); await db.adminUser.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  }
});
