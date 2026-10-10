import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

const base = process.env.QUOTE_TEST_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? ""));

test("A04 expanded: strict costs and aggregate Int HTTP400 without rows/audits; PATCH plan/ledger unchanged", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient(), suffix = randomUUID(), org = `money-boundary-${suffix}`;
  try {
    const { createSession } = await import("../lib/server/auth");
    await db.organization.create({ data: { id: org, name: "QA boundaries", slug: org } });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "QA owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: user.id, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "QA client" } });
    const headers = { "Content-Type": "application/json", Cookie: `ledbox_session=${(await createSession(user, org)).jwt}` };
    const call = (method: string, body: unknown) => fetch(base + "/api/admin/budgets", { method, headers, body: JSON.stringify(body) });
    const item = { name: "Service", quantity: 1, days: 1, unitPrice: 100, costPrice: 0 };
    const createBody = { clientId: client.id, title: "A04 cost boundaries", items: [item] };
    const MAX = 2147483647;
    const q = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Pending ledger", subtotal: 100, total: 100, installmentsJson: [{ label: "Balance", amount: 100, type: "remainder", value: 0, dueAt: null, moment: "At finish" }], items: { create: { ...item, id: randomUUID(), subtotal: 100 } } }, include: { items: true } });
    await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: q.id, label: "Balance", amount: 100, concept: "installment", slot: "installment:1", status: "AWAITING" } });
    const counts = async () => ({ budgets: await db.budget.count({ where: { organizationId: org } }), items: await db.budgetItem.count({ where: { budget: { organizationId: org } } }), audits: await db.auditLog.count({ where: { organizationId: org } }) });
    const snapshot = async () => ({ quote: await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } }), ledger: await db.expectedPayment.findMany({ where: { budgetId: q.id } }) });
    const before = await counts(), original = await snapshot();
    const invalid = [-1, "1", 0.5, MAX + 1, null, true];
    for (const field of ["materialCost", "laborCost"]) {
      for (const value of invalid) {
        assert.equal((await call("POST", { ...createBody, [field]: value })).status, 400, `${field}=${JSON.stringify(value)}`);
        assert.deepEqual(await counts(), before, "no Budget/Item/success audit on invalid create");
        for (const kind of ["editor", "commercial"]) {
          assert.equal((await call("PATCH", { budgetId: q.id, kind, items: q.items, [field]: value })).status, 400);
          assert.deepEqual(await snapshot(), original, "invalid PATCH preserves plan/ledger/rows");
          assert.deepEqual(await counts(), before);
        }
      }
    }
    const overflowItems = [{ ...item, unitPrice: 0, costPrice: MAX }, { ...item, name: "Second", unitPrice: 0, costPrice: MAX }];
    assert.equal((await call("POST", { ...createBody, items: overflowItems })).status, 400, "two individually valid costs cannot overflow stored costEstimate Int");
    assert.deepEqual(await counts(), before);
    for (const kind of ["editor", "items"]) {
      assert.equal((await call("PATCH", { budgetId: q.id, kind, items: overflowItems })).status, 400);
      assert.deepEqual(await snapshot(), original); assert.deepEqual(await counts(), before);
    }
    for (const value of [undefined, 0, MAX]) {
      const response = await call("POST", { ...createBody, materialCost: value, laborCost: value });
      assert.equal(response.status, 201, "separate stored cost fields can each be MAX; no combined artificial limit");
      const row = (await response.json()).budget;
      assert.equal(row.materialCost, value ?? 0); assert.equal(row.laborCost, value ?? 0);
    }
    for (const kind of ["editor", "commercial"]) {
      assert.equal((await call("PATCH", { budgetId: q.id, kind, items: q.items, materialCost: MAX, laborCost: MAX })).status, 200);
      const row = (await snapshot()).quote; assert.equal(row.materialCost, MAX); assert.equal(row.laborCost, MAX);
    }
    console.log("A04 money-boundaries: 13 invalid POST vectors400 (12 fields+aggregate), no rows/audits; invalid PATCH plan/ledger stable; omitted/0/MAX valid, independent stored costsMAX+MAX accepted");
  } finally { await db.$disconnect(); await (await import("../lib/server/db")).db.$disconnect(); }
});
