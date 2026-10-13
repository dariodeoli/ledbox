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
  } finally {
    await db.event.deleteMany({ where: { organizationId: { in: orgs } } });
    await db.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.plan.deleteMany({ where: { id: { in: plans } } });
    await db.$disconnect();
  }
  void execFileSync;
});
