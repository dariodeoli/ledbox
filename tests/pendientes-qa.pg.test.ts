import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/pendientes-qa.pg.test.ts
test("pendientes QA en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const orgs: string[] = [];
  const plans: string[] = [];
  async function seedOrg(maxEvents: number | null) {
    const planId = randomUUID();
    plans.push(planId);
    await db.plan.create({ data: { id: planId, code: `qa-${planId.slice(0, 8)}`, name: "Plan QA", maxEventsPerMonth: maxEvents, priceMonthly: 0 } });
    const org = randomUUID();
    orgs.push(org);
    await db.organization.create({ data: { id: org, name: `Empresa ${org.slice(0, 6)}`, slug: `pq-${org.slice(0, 8)}`, planId } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente" } });
    const organization = await db.organization.findUniqueOrThrow({ where: { id: org } });
    return { org, client, context: { organizationId: org, organization } as never };
  }

  try {
    await t.test("tope de eventos: dos altas simultáneas con un solo cupo crean un solo evento", async () => {
      const { lockedEventLimitViolation } = await import("../lib/server/plan-limits");
      const a = await seedOrg(1);
      const attempt = () =>
        db.$transaction(async (tx) => {
          const violation = await lockedEventLimitViolation(tx, a.context);
          if (violation) return violation.code;
          await new Promise((resolve) => setTimeout(resolve, 150));
          await tx.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: a.client.id, name: "Evento", status: "CONFIRMED" } });
          return "created";
        });
      const results = await Promise.all([attempt(), attempt(), attempt()]);
      assert.deepEqual([...results].sort(), ["created", "plan_limit", "plan_limit"]);
      assert.equal(await db.event.count({ where: { organizationId: a.org } }), 1);
    });

    await t.test("sin tope no bloquea y el tope de otra empresa no cuenta", async () => {
      const { lockedEventLimitViolation } = await import("../lib/server/plan-limits");
      const free = await seedOrg(null);
      const other = await seedOrg(1);
      await db.event.create({ data: { id: randomUUID(), organizationId: other.org, clientId: other.client.id, name: "Ajeno", status: "CONFIRMED" } });
      assert.equal(await db.$transaction((tx) => lockedEventLimitViolation(tx, free.context)), null);
    });

    await t.test("leads del cliente: por email, teléfono y presupuesto, sin tope y aislado por empresa", async () => {
      const { leadsForClient } = await import("../lib/server/lead-client");
      const a = await seedOrg(null);
      const b = await seedOrg(null);
      const lead = (org: string, over: Record<string, unknown>) =>
        db.lead.create({ data: { id: randomUUID(), name: "Lead", phone: "000", email: `${randomUUID()}@x.test`, consentAt: new Date(), organizationId: org, ...over } });
      const byEmail = await lead(a.org, { email: "Ana@Example.com" });
      const byPhone = await lead(a.org, { phone: "+595 981 123-456" });
      const byBudget = await lead(a.org, {});
      await lead(a.org, { phone: "0991 999 999" });
      await lead(b.org, { email: "ana@example.com", phone: "0981123456" });
      // Ruido para pasar el tamaño de una página del recorrido por teléfono.
      await db.lead.createMany({
        data: Array.from({ length: 1100 }, (_, i) => ({ id: randomUUID(), name: `Ruido ${i}`, phone: `0971 ${String(100000 + i)}`, email: `r${i}-${randomUUID()}@x.test`, consentAt: new Date(), organizationId: a.org })),
      });
      const late = await lead(a.org, { phone: "(0981) 123456" });
      const found = await leadsForClient(db, a.org, { emails: ["ana@example.com", null], phones: ["0981123456"] }, new Set([byBudget.id]));
      assert.deepEqual(new Set(found.map((row) => row.id)), new Set([byEmail.id, byPhone.id, byBudget.id, late.id]));
      assert.ok(found.every((row, i) => i === 0 || found[i - 1].createdAt >= row.createdAt));
      const none = await leadsForClient(db, a.org, { emails: [], phones: [] }, new Set());
      assert.equal(none.length, 0);
    });

    await t.test("tope diario de preórdenes: cuenta solo la empresa y el día de hoy", async () => {
      const { preorderDailyLimit, PREORDER_DAILY_LIMIT } = await import("../lib/server/catalog-public");
      assert.equal(PREORDER_DAILY_LIMIT, 200);
      const a = await seedOrg(null);
      const b = await seedOrg(null);
      const make = (org: string, over: Record<string, unknown> = {}) =>
        db.quoteRequest.create({ data: { id: randomUUID(), organizationId: org, source: "catalogo", status: "NEW", ...over } });
      await make(a.org);
      await make(a.org);
      await make(a.org, { createdAt: new Date(Date.now() - 3 * 86_400_000) });
      await make(a.org, { source: "website" });
      await make(b.org);
      const under = await preorderDailyLimit(a.org, { limit: 3 });
      assert.equal(under.used, 2);
      assert.equal(under.reached, false);
      const hit = await preorderDailyLimit(a.org, { limit: 2 });
      assert.equal(hit.reached, true);
      assert.ok(hit.retryAfter >= 60 && hit.retryAfter <= 86_400);
      assert.equal((await preorderDailyLimit(b.org, { limit: 2 })).reached, false);
    });
  } finally {
    await db.quoteRequest.deleteMany({ where: { organizationId: { in: orgs } } });
    await db.lead.deleteMany({ where: { organizationId: { in: orgs } } });
    await db.event.deleteMany({ where: { organizationId: { in: orgs } } });
    await db.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.plan.deleteMany({ where: { id: { in: plans } } });
    await db.$disconnect();
  }
  void execFileSync;
});
