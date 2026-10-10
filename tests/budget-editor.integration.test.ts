import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

const base = process.env.QUOTE_TEST_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\/ledbox_quote_qa(?:\?|$)/.test(process.env.DATABASE_URL ?? ""));

test("FIN #173 real PostgreSQL: duplicate IDs, atomic plan rollback and sync/collection races", { skip: !enabled, timeout: 120000 }, async () => {
  const db = new PrismaClient();
  const { db: serverDb } = await import("../lib/server/db");
  const { syncBudgetExpectedPayments, confirmExpectedPayment } = await import("../lib/server/expected-payments");
  const { QuoteComparisonError } = await import("../lib/server/quote-comparison");
  const suffix = randomUUID(), org = `fin-editor-${suffix}`;
  try {
    await db.organization.create({ data: { id: org, slug: org, name: "FIN editor QA" } });
    const user = await db.adminUser.create({ data: { id: randomUUID(), name: "QA owner", email: `${suffix}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: user.id, organizationId: org, role: "OWNER" } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Historical name", company: "Not legal", tradeName: "Commercial QA", legalName: "Legal QA" } });
    const account = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "QA cash" } });
    await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Foreign first", currency: "USD", sortOrder: -100 } });
    const actor = { user: { id: user.id, name: user.name, email: user.email, role: "OWNER" as const }, organizationId: org, role: "OWNER" as const };
    const { createSession } = await import("../lib/server/auth");
    const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
    const call = (body: unknown) => fetch(base + "/api/admin/budgets", { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
    const fixture = async () => db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Original", subtotal: 100, total: 100, items: { create: { id: randomUUID(), name: "Service", quantity: 1, days: 1, unitPrice: 100, subtotal: 100 } } }, include: { items: true } });
    const fixed = (value: number) => ({ label: "Reserva", type: "fixed", value, moment: "Al confirmar" });
    const remainder = { label: "Saldo", type: "remainder", moment: "Antes del montaje" };
    const q = await fixture();
    const item = { id: q.items[0].id, name: "Service", quantity: 1, days: 1, unitPrice: 100, costPrice: 0 };
    const createBody = { clientId: client.id, title: "A04 strict discount", items: [{ name: "Service", quantity: 1, days: 1, unitPrice: 100 }] };
    const initialCount = await db.budget.count({ where: { organizationId: org } });
    const initialItems = await db.budgetItem.count({ where: { budget: { organizationId: org } } });
    const invalidDiscounts = [-1, "1", "-1", "", 0.5, 2147483648, null, true, false, [], {}];
    for (const discount of invalidDiscounts) {
      const response = await fetch(base + "/api/admin/budgets", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ ...createBody, discount }) });
      assert.equal(response.status, 400, `A04 POST discount ${JSON.stringify(discount)} must reject`);
      assert.equal(await db.budget.count({ where: { organizationId: org } }), initialCount);
      assert.equal(await db.budgetItem.count({ where: { budget: { organizationId: org } } }), initialItems, "no partial item creation");
      for (const kind of ["editor", "commercial"]) {
        assert.equal((await call({ budgetId: q.id, kind, items: [item], discount })).status, 400, `${kind} discount must also be strict`);
        const unchanged = await db.budget.findUniqueOrThrow({ where: { id: q.id } });
        assert.equal(unchanged.total, 100); assert.equal(unchanged.discount, 0); assert.equal(unchanged.updatedAt.toISOString(), q.updatedAt.toISOString());
      }
    }
    // JSON numeric overflow parses to Infinity; never serialize NaN as null,
    // since null is not a numeric value and is independently rejected.
    const infinite = await fetch(base + "/api/admin/budgets", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(createBody).replace(/}$/, ',"discount":1e309}') });
    assert.equal(infinite.status, 400);
    assert.equal(await db.budget.count({ where: { organizationId: org } }), initialCount);
    for (const discount of [undefined, 0, 20]) {
      const response = await fetch(base + "/api/admin/budgets", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ ...createBody, discount }) });
      assert.equal(response.status, 201);
      const created = (await response.json()).budget;
      assert.equal(created.discount, discount ?? 0); assert.equal(created.total, 100 - (discount ?? 0));
    }
    console.log("A04 strict POST/editor/commercial: invalid discounts400 atomic, omitted/0/20 valid; no coercion or clamp");
    for (const kind of ["items", "editor"]) {
      const response = await call({ budgetId: q.id, kind, items: [item, item] });
      assert.equal(response.status, 400, `${kind} duplicates must fail`);
      const saved = await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
      assert.equal(saved.total, 100); assert.equal(saved.items.length, 1); assert.equal(saved.items[0].subtotal, 100);
      assert.equal(saved.updatedAt.toISOString(), q.updatedAt.toISOString());
    }
    for (const plan of [[fixed(150)], [{ ...fixed(50), value: true }], [{ ...fixed(50), dueAt: "2026-02-30" }]]) {
      assert.equal((await call({ budgetId: q.id, kind: "editor", title: "Must rollback", items: [{ ...item, unitPrice: 120 }], installmentsJson: plan })).status, 400);
      const saved = await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
      assert.equal(saved.title, "Original"); assert.equal(saved.total, 100); assert.equal(saved.items[0].unitPrice, 100);
    }
    assert.equal((await call({ budgetId: q.id, kind: "editor", items: [item], installmentsJson: [fixed(50), remainder] })).status, 200);
    const expected = await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: q.id, concept: "installment", slot: "installment:1", label: "Reserva", amount: 50, status: "PARTIAL", paidAmount: 20 } });
    // Registered cash before acceptance is valid: incompatible revisions fail.
    await db.clientPayment.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, budgetId: q.id, amount: 20, status: "RECEIVED", method: "Efectivo" } });
    assert.equal((await call({ budgetId: q.id, kind: "editor", items: [item], installmentsJson: [fixed(70), remainder] })).status, 409);
    assert.equal((await call({ budgetId: q.id, kind: "editor", items: [{ ...item, unitPrice: 120 }], installmentsJson: [fixed(50), remainder] })).status, 200);
    const revised = await db.budget.findUniqueOrThrow({ where: { id: q.id } });
    assert.deepEqual((revised.installmentsJson as Array<{ amount: number }>).map((row) => row.amount), [50, 70]);
    assert.equal(revised.total - 20, 100); assert.equal((await db.expectedPayment.findUniqueOrThrow({ where: { id: expected.id } })).paidAmount, 20);
    const ledger = await db.expectedPayment.findMany({ where: { budgetId: q.id, status: { not: "CANCELLED" } } });
    assert.equal(ledger.reduce((sum, row) => sum + row.amount - row.paidAmount, 0), 100, "pending ledger exactly equals final total minus registered cash");
    assert.equal(ledger.find((row) => row.slot === "installment:2")?.expectedAccountId, account.id, "USD first must not become default for a PYG condition");
    await db.treasuryAccount.update({ where: { id: account.id }, data: { active: false } });
    const withoutPyg = await fixture();
    await db.budget.update({ where: { id: withoutPyg.id }, data: { approvedAt: new Date() } });
    await syncBudgetExpectedPayments({ organizationId: org, budgetId: withoutPyg.id });
    assert.equal((await db.expectedPayment.findFirstOrThrow({ where: { budgetId: withoutPyg.id } })).expectedAccountId, null, "no PYG available means no default, not an implicit currency conversion");
    await db.treasuryAccount.update({ where: { id: account.id }, data: { active: true } });
    await db.budget.update({ where: { id: q.id }, data: { installmentsJson: [{ ...fixed(70), amount: 70 }, { ...remainder, amount: 50 }] } });
    await assert.rejects(syncBudgetExpectedPayments({ organizationId: org, budgetId: q.id }), (error: unknown) => error instanceof QuoteComparisonError && error.status === 409, "direct sync reports an honest ledger conflict409");
    console.log("Default currency: USD first skipped, PYG selected, foreign-only leaves null; direct ledger conflict409");
    const invalidAccount = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Inactive account", active: false } });
    assert.equal((await call({ budgetId: q.id, kind: "editor", title: "Must rollback", items: [{ ...item, unitPrice: 130 }], installmentsJson: [{ ...fixed(50), accountId: invalidAccount.id }, remainder] })).status, 400);
    assert.equal((await db.budget.findUniqueOrThrow({ where: { id: q.id } })).total, 120);
    // Rename locks all quotes sharing the event, including the sibling that is
    // signing. Either the rename invalidates the old document or signing wins.
    for (let n = 0; n < 2; n++) {
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Original event" } });
      const first = await fixture(), sibling = await fixture();
      await db.budget.updateMany({ where: { id: { in: [first.id, sibling.id] } }, data: { eventId: event.id } });
      const issued = await fetch(base + "/api/admin/signatures", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ budgetId: sibling.id, recipientName: "QA signer", method: "TYPED", otpRequired: false }) });
      assert.equal(issued.status, 201);
      const signature = (await issued.json()).request;
      const [renamed, signed] = await Promise.all([
        fetch(`${base}/api/admin/budgets/${first.id}/event`, { method: "PATCH", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ name: "Renamed event", originalName: "Original event" }) }),
        fetch(`${base}/api/portal/firma/${signature.code}/sign`, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `qa-fin-event-${suffix}` }, body: JSON.stringify({ consent: true, signature: { name: "QA signer" } }) }),
      ]);
      assert.deepEqual([renamed.status, signed.status].sort(), [200, 409]);
      if (signed.status === 200) assert.equal((await db.event.findUniqueOrThrow({ where: { id: event.id } })).name, "Original event");
      console.log(`Shared event/sign race: rename=${renamed.status}, sign=${signed.status}`);
    }
    // Deterministic scheduling at the actual sync CAS boundary; both operations
    // execute the production functions against PostgreSQL, with no fake DB.
    for (const mode of ["update", "cancel"] as const) {
      const race = await fixture();
      await db.budget.update({ where: { id: race.id }, data: { approvedAt: new Date(), installmentsJson: [fixed(mode === "update" ? 70 : 100)] } });
      const row = await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: race.id, concept: "installment", slot: mode === "update" ? "installment:1" : "installment:2", label: "Old concept", amount: 50, expectedAccountId: account.id } });
      const original = serverDb.expectedPayment.updateMany;
      let intercepted = false;
      serverDb.expectedPayment.updateMany = (async (args: Parameters<typeof original>[0]) => {
        if (args.where?.id === row.id && !intercepted) {
          intercepted = true;
          const paid = await confirmExpectedPayment({ organizationId: org, expectedPaymentId: row.id, accountId: account.id, actor });
          assert.ok(paid.ok); assert.equal(paid.appliedAmount, 50);
        }
        return original.call(serverDb.expectedPayment, args);
      }) as unknown as typeof original;
      try {
        await assert.rejects(syncBudgetExpectedPayments({ organizationId: org, budgetId: race.id }), (error: unknown) => error instanceof QuoteComparisonError && error.status === 409);
        assert.equal(intercepted, true);
      } finally { serverDb.expectedPayment.updateMany = original; }
      const saved = await db.expectedPayment.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(saved.status, "CONFIRMED"); assert.equal(saved.amount, 50); assert.equal(saved.paidAmount, 50); assert.ok(saved.paymentId);
      assert.equal((await db.clientPayment.findUniqueOrThrow({ where: { id: saved.paymentId! } })).status, "RECEIVED");
      assert.equal(await db.treasuryMovement.count({ where: { sourceId: saved.paymentId! } }), 1);
      console.log(`F01 ${mode}: stale sync409, CONFIRMED50/paid50/payment preserved; F02 duplicate legacy/editor400 atomic`);
    }
  } finally { await db.$disconnect(); await serverDb.$disconnect(); }
});
