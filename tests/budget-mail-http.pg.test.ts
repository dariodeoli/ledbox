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
  async function cookie(role: "OWNER" | "VIEWER" = "OWNER", organizationId = org) {
    const id = randomUUID(); users.push(id);
    const user = await db.adminUser.create({ data: { id, name: "HTTP mail QA", email: `${id}@example.invalid`, passwordHash: "no-login", role: "OWNER" } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId, adminUserId: id, role } });
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
      const confirm = { ...input, confirm: true, confirmationToken: preview.confirmationToken, acceptAvailabilityWarnings: true };
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
    // La revisión nueva requiere consentimiento y nunca compromete stock.
    const stock = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Stock QA250", category: "QA", quantity: 2 } });
    const start = new Date("2036-10-15T12:00:00Z"), end = new Date("2036-10-16T12:00:00Z");
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "QA250 HTTP", startsAt: start, endsAt: end } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, eventId: event.id, title: "QA250 HTTP", publicToken: randomUUID(), subtotal: 1000, total: 1000,
      items: { create: { id: randomUUID(), name: "Stock", inventoryId: stock.id, quantity: 1, unitPrice: 1000, subtotal: 1000 } } } });
    const input = { budgetId: budget.id, to: "qa250@example.invalid" };
    mode = "accepted";
    const before = deliveries;
    const preview = await (await call({ ...input, preview: true })).json(); assert.equal(preview.availability.state, "available"); assert.equal(preview.availability.lines.length, 1); assert.equal(preview.availability.lines[0].available, 2);
    assert.equal(await db.eventInventory.count({ where: { eventId: event.id } }), 0);
    const viewer = await cookie("VIEWER"); assert.equal((await call({ ...input, preview: true }, viewer)).status, 403);
    const foreignOrg = randomUUID();
    await db.organization.create({ data: { id: foreignOrg, name: "Foreign QA250", slug: `qa250-${foreignOrg}` } });
    try {
      const foreign = await cookie("OWNER", foreignOrg); assert.equal((await call({ ...input, preview: true }, foreign)).status, 404);
    } finally { await db.organization.delete({ where: { id: foreignOrg } }); }
    const competing = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "PRIVATE_COMPETITOR", startsAt: start, endsAt: end } });
    const competingRow = await db.eventInventory.create({ data: { id: randomUUID(), organizationId: org, eventId: competing.id, inventoryId: stock.id, quantity: 1, startsAt: start, endsAt: end } });
    assert.equal((await call({ ...input, confirm: true, confirmationToken: preview.confirmationToken })).status, 409, "una capacidad nueva invalida incluso si todavía alcanza");
    const stillAvailable = await (await call({ ...input, preview: true })).json(); assert.equal(stillAvailable.availability.state, "available"); assert.equal(stillAvailable.availability.lines[0].available, 1);
    await db.eventInventory.update({ where: { id: competingRow.id }, data: { quantity: 2 } });
    const assignments = await db.eventInventory.findMany({ where: { event: { organizationId: org } }, orderBy: { id: "asc" } });
    assert.equal((await call({ ...input, confirm: true, confirmationToken: stillAvailable.confirmationToken, acceptAvailabilityWarnings: true })).status, 409);
    assert.equal(deliveries, before); assert.equal(await db.idempotencyKey.count({ where: { organizationId: org, key: preview.attemptId } }), 0);
    const shortage = await (await call({ ...input, preview: true })).json(); assert.equal(shortage.availability.state, "shortage"); assert.equal(shortage.availability.lines.length, 1); assert.equal(shortage.availability.lines[0].available, 0); assert.doesNotMatch(JSON.stringify(shortage.availability), /PRIVATE_COMPETITOR/);
    assert.equal((await call({ ...input, confirm: true, confirmationToken: shortage.confirmationToken })).status, 409);
    assert.equal(deliveries, before);
    const confirmed = await call({ ...input, confirm: true, confirmationToken: shortage.confirmationToken, acceptAvailabilityWarnings: true }); assert.equal(confirmed.status, 200); assert.equal((await confirmed.json()).status, "sent");
    assert.equal(deliveries, before + 1); assert.deepEqual(await db.eventInventory.findMany({ where: { event: { organizationId: org } }, orderBy: { id: "asc" } }), assignments);
    assert.equal(await db.eventInventory.count({ where: { eventId: event.id } }), 0);
    await db.inventoryItem.update({ where: { id: stock.id }, data: { stockCountStatus: "PENDING_COUNT" } });
    const replay = await call({ ...input, confirm: true, confirmationToken: shortage.confirmationToken }); assert.equal(replay.status, 200); assert.equal(deliveries, before + 1);
    assert.equal((await call({ budgetId: budget.id, receiptOnly: true, attemptId: shortage.attemptId })).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) => provider.close(error => error ? reject(error) : resolve()));
    await db.organization.deleteMany({ where: { id: org } }); await db.adminUser.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  }
});
