import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { snapshotFromProduct } from "../lib/price-tiers";
import { counterofferDraftSubtotal, resolveCounterofferDraft } from "../lib/counteroffer-draft";

test("counteroffer HTTP/PG: actual request DTO preserves TOTAL, manual and EVENT prices through acceptance", { skip: !process.env.TEST_DATABASE_URL || !process.env.COUNTER_TEST_BASE_URL, timeout: 60000 }, async t => {
  const url = new URL(process.env.TEST_DATABASE_URL!), base = new URL(process.env.COUNTER_TEST_BASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname)); assert.ok(["127.0.0.1", "localhost"].includes(base.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db"); const { createSession } = await import("../lib/server/auth");
  const org = randomUUID(), foreign = randomUUID(), users: string[] = [];
  const cookie = async (organizationId: string) => {
    const id = randomUUID(); users.push(id);
    const user = await db.adminUser.create({ data: { id, name: "QA140 counteroffer", email: `${id}@example.invalid`, passwordHash: "no-login", role: "OWNER" } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId, adminUserId: id, role: "OWNER" } });
    return `ledbox_session=${(await createSession(user, organizationId)).jwt}`;
  };
  try {
    for (const id of [org, foreign]) await db.organization.create({ data: { id, name: "QA140 ficticio", slug: `qa140-${id}` } });
    const owner = await cookie(org), foreignOwner = await cookie(foreign);
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente ficticio QA140" } });
    const inventory = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Servicio EVENT ficticio", category: "QA", quantity: 0, billingUnit: "EVENT" } });
    const snapshot = snapshotFromProduct({ basePrice: 100000, tiers: [{ fromDays: 3, mode: "TOTAL", price: 250000 }] }, "RETAIL", 3);
    const call = (path: string, session: string, body?: unknown) => fetch(`${base.origin}${path}`, { method: body ? "POST" : "GET", headers: { Cookie: session, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    for (const kind of ["TOTAL-exclude", "TOTAL-reprice", "manual", "EVENT"] as const) await t.test(kind, async () => {
      const id = randomUUID(), lineId = randomUUID(), price = kind === "manual" ? 240000 : kind === "EVENT" ? 1000 : 250000;
      const budget = await db.budget.create({ data: { id, organizationId: org, clientId: client.id, title: `QA140 ${kind}`, subtotal: price * 2 + 500, total: price * 2 + 500,
        items: { create: [{ id: lineId, name: "Línea de prueba", quantity: 2, days: 1, unitPrice: price, subtotal: price * 2,
          ...(kind === "EVENT" ? { inventoryId: inventory.id } : { pricingSnapshot: JSON.parse(JSON.stringify(snapshot)) }) },
          { id: randomUUID(), name: "Línea conservada", quantity: 1, days: 1, unitPrice: 500, subtotal: 500 }] } } });
      const change = await db.budgetChangeRequest.create({ data: { id: randomUUID(), organizationId: org, budgetId: id, kind: "items", requestedByName: "Cliente ficticio", payload: { items: [{ id: lineId, quantity: 2, days: kind.startsWith("TOTAL") ? 3 : 1 }] } } });
      const response = await call("/api/admin/budgets", owner); assert.equal(response.status, 200);
      const wire = await response.json(), request = wire.budgetRequests.find((row: { id: string }) => row.id === change.id); assert.ok(request);
      const item = request.budget.items.find((row: { id: string }) => row.id === lineId); assert.ok(item);
      if (kind === "EVENT") assert.equal(item.inventory.billingUnit, "EVENT"); else assert.deepEqual(item.pricingSnapshot, snapshot);
      const drafts = { [lineId]: { quantity: kind === "TOTAL-exclude" ? "2" : kind === "EVENT" ? "3" : "1", days: kind === "TOTAL-reprice" ? "2" : kind === "EVENT" ? "5" : "3", excluded: kind === "TOTAL-exclude" } };
      const parsed = resolveCounterofferDraft(request.budget.items, drafts); assert.ok(parsed.ok, parsed.ok ? "" : parsed.error);
      if (!parsed.ok) return;
      const preview = counterofferDraftSubtotal(request.budget.items, drafts);
      const input = { requestId: change.id, decision: "accept", counter: { items: parsed.value } };
      assert.equal((await call("/api/admin/budgets/requests", foreignOwner, input)).status, 404);
      const applied = await call("/api/admin/budgets/requests", owner, input); assert.equal(applied.status, 200, await applied.clone().text());
      const saved = await db.budget.findUniqueOrThrow({ where: { id: budget.id }, include: { items: true } });
      const expected = kind === "TOTAL-exclude" ? 500 : kind === "TOTAL-reprice" ? 200500 : kind === "manual" ? 720500 : 3500;
      assert.equal(preview, expected); assert.equal(saved.total, expected); assert.equal(saved.status, "NEGOTIATING");
      const stored = saved.items.find(row => row.id === lineId)!;
      if (kind === "TOTAL-exclude") { assert.equal(stored.excluded, true); assert.equal(stored.quantity, 2); assert.equal(stored.days, 1); assert.deepEqual(stored.pricingSnapshot, snapshot); }
      if (kind === "EVENT") assert.equal(stored.days, 1);
      assert.equal((await call("/api/admin/budgets/requests", owner, input)).status, 409);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id } })).total, expected);
    });
    await t.test("a real snapshot edit while acceptance waits on the budget still conflicts", async () => {
      const id = randomUUID(), lineId = randomUUID();
      await db.budget.create({ data: { id, organizationId: org, clientId: client.id, title: "QA140 real CAS", subtotal: 500000, total: 500000,
        items: { create: { id: lineId, name: "CAS snapshot", quantity: 2, days: 1, unitPrice: 250000, subtotal: 500000, pricingSnapshot: JSON.parse(JSON.stringify(snapshot)) } } } });
      const change = await db.budgetChangeRequest.create({ data: { id: randomUUID(), organizationId: org, budgetId: id, kind: "items", requestedByName: "QA140", payload: { items: [{ id: lineId, quantity: 1, days: 2 }] } } });
      const nextSnapshot = snapshotFromProduct({ basePrice: 110000, tiers: [{ fromDays: 3, mode: "TOTAL", price: 250000 }] }, "RETAIL", 3);
      let pending: Promise<Response> | undefined;
      try {
        await db.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "Budget" WHERE id = ${id} FOR UPDATE`;
          const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
          pending = call("/api/admin/budgets/requests", owner, { requestId: change.id, decision: "accept", counter: { items: [{ id: lineId, quantity: 1, days: 2, excluded: false }] } });
          let blocked = false;
          for (let index = 0; index < 100 && !blocked; index++) {
            const [{ waiting }] = await db.$queryRaw<Array<{ waiting: boolean }>>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS waiting`;
            blocked = waiting; if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.equal(blocked, true, "acceptance must really wait after its original read");
          await tx.budgetItem.update({ where: { id: lineId }, data: { pricingSnapshot: JSON.parse(JSON.stringify(nextSnapshot)) } });
        }, { timeout: 10000 });
        assert.ok(pending); const response = await pending; assert.equal(response.status, 409);
        assert.match((await response.json()).error, /presupuesto cambió/);
        const saved = await db.budget.findUniqueOrThrow({ where: { id }, include: { items: true } });
        assert.equal(saved.status, "DRAFT"); assert.equal(saved.total, 500000); assert.equal(saved.items[0].quantity, 2);
        assert.deepEqual(saved.items[0].pricingSnapshot, nextSnapshot);
        assert.equal((await db.budgetChangeRequest.findUniqueOrThrow({ where: { id: change.id } })).status, "pending");
      } finally { if (pending) await pending.catch(() => undefined); }
    });
    assert.equal(await db.clientPayment.count({ where: { organizationId: org } }), 0);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, foreign] } } }); await db.adminUser.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  }
});
