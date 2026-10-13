import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/security-deposit.pg.test.ts
test("depósito de garantía en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { SecurityDepositError, setBudgetSecurityDeposit, transitionBudgetSecurityDeposit, equipmentReturnByEvent } = await import("../lib/server/security-deposit");
  const { portalBudgetView, portalInclude } = await import("../lib/server/budget-portal");

  const orgs: string[] = [];
  async function seed() {
    const org = randomUUID();
    orgs.push(org);
    await db.organization.create({ data: { id: org, name: `Empresa ${org.slice(0, 6)}`, slug: `sg-${org.slice(0, 8)}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente" } });
    const context = { organizationId: org, user: { id: "u1", name: "Ana Finanzas", email: "ana@example.com", role: "FINANCE" as const } };
    const budget = await db.budget.create({
      data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Alquiler", status: "DRAFT", subtotal: 1_000_001, total: 1_000_001, securityDeposit: 2_000_000, securityDepositStatus: "PENDING" },
    });
    return { org, context, budget, client };
  }
  const audits = (budgetId: string) => db.auditLog.findMany({ where: { entity: "Budget", entityId: budgetId }, orderBy: { createdAt: "asc" } });

  try {
    await t.test("la migración aplicada dos veces no falla", () => {
      const file = new URL("../prisma/migrations/202610150001_budget_security_deposit/migration.sql", import.meta.url).pathname;
      for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
    });

    await t.test("PENDING → HELD → RETURNED: no cambia el total ni los cobros y se audita", async () => {
      const a = await seed();
      await db.clientPayment.create({ data: { id: randomUUID(), organizationId: a.org, clientId: a.client.id, budgetId: a.budget.id, amount: 400_000, status: "RECEIVED", method: "Transferencia", paidAt: new Date() } });
      await transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "HELD" });
      const done = await transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "RETURNED" });
      assert.equal(done.returned, 2_000_000);
      const row = await db.budget.findUniqueOrThrow({ where: { id: a.budget.id } });
      assert.equal(row.total, 1_000_001);
      assert.equal(row.securityDepositStatus, "RETURNED");
      assert.equal(row.securityDepositRetained, 0);
      const paid = await db.clientPayment.aggregate({ where: { budgetId: a.budget.id }, _sum: { amount: true } });
      assert.equal(paid._sum.amount, 400_000);
      const log = await audits(a.budget.id);
      assert.equal(log.length, 2);
      assert.equal(log[0].action, "status");
      assert.deepEqual((log[1].detail as { changes: { securityDepositStatus: unknown } }).changes.securityDepositStatus, { from: "HELD", to: "RETURNED" });
    });

    await t.test("retención parcial: monto, devuelto y estados finales inmutables", async () => {
      const a = await seed();
      await transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "HELD" });
      await assert.rejects(transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "KEPT_PARTIAL", retainedAmount: 2_000_000 }), (e: unknown) => e instanceof SecurityDepositError && e.status === 409);
      await assert.rejects(transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "KEPT_PARTIAL" }), SecurityDepositError);
      const kept = await transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "KEPT_PARTIAL", retainedAmount: 650_001, reason: "Incidente demo" });
      assert.equal(kept.securityDepositRetained, 650_001);
      assert.equal(kept.returned, 1_349_999);
      await assert.rejects(transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "RETURNED" }), SecurityDepositError);
      await assert.rejects(setBudgetSecurityDeposit(a.context, a.budget.id, 5), (e: unknown) => e instanceof SecurityDepositError && e.status === 409);
      const log = await audits(a.budget.id);
      assert.equal((log.at(-1)!.detail as { fields: { motivo: string } }).fields.motivo, "Incidente demo");
    });

    await t.test("PENDING no se devuelve ni retiene sin recibirse", async () => {
      const a = await seed();
      for (const to of ["RETURNED", "KEPT", "KEPT_PARTIAL"] as const) {
        await assert.rejects(transitionBudgetSecurityDeposit(a.context, a.budget.id, { to, retainedAmount: 10 }), SecurityDepositError, to);
      }
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: a.budget.id } })).securityDepositStatus, "PENDING");
      assert.equal((await audits(a.budget.id)).length, 0, "un cambio rechazado no audita");
    });

    await t.test("definir y quitar el monto mientras está pendiente", async () => {
      const a = await seed();
      const changed = await setBudgetSecurityDeposit(a.context, a.budget.id, 3_000_000);
      assert.equal(changed.securityDeposit, 3_000_000);
      const removed = await setBudgetSecurityDeposit(a.context, a.budget.id, null);
      assert.equal(removed.securityDepositStatus, null);
      const again = await setBudgetSecurityDeposit(a.context, a.budget.id, 1_000_000);
      assert.equal(again.securityDepositStatus, "PENDING");
      await assert.rejects(setBudgetSecurityDeposit(a.context, a.budget.id, 0.5), SecurityDepositError);
      await assert.rejects(setBudgetSecurityDeposit(a.context, a.budget.id, -3), SecurityDepositError);
    });

    await t.test("otra empresa: 404 y no toca nada", async () => {
      const a = await seed();
      const b = await seed();
      await assert.rejects(transitionBudgetSecurityDeposit(b.context, a.budget.id, { to: "HELD" }), (e: unknown) => e instanceof SecurityDepositError && e.status === 404);
      await assert.rejects(setBudgetSecurityDeposit(b.context, a.budget.id, 1), (e: unknown) => e instanceof SecurityDepositError && e.status === 404);
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: a.budget.id } })).securityDepositStatus, "PENDING");
    });

    await t.test("dos cambios simultáneos: gana uno solo", async () => {
      const a = await seed();
      await transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "HELD" });
      const results = await Promise.allSettled([
        transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "RETURNED" }),
        transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "KEPT" }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await audits(a.budget.id)).length, 2);
    });

    await t.test("el constraint de la base rechaza estados y retenciones imposibles", async () => {
      const a = await seed();
      await assert.rejects(db.budget.update({ where: { id: a.budget.id }, data: { securityDepositStatus: "ROTO" } }));
      await assert.rejects(db.budget.update({ where: { id: a.budget.id }, data: { securityDepositRetained: 9_000_000 } }));
    });

    await t.test("el portal muestra la garantía sin notas ni costos internos", async () => {
      const a = await seed();
      await db.budget.update({ where: { id: a.budget.id }, data: { publicToken: `tok-${a.org}`, costEstimate: 777_777, materialCost: 123_456 } });
      await transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "HELD" });
      await transitionBudgetSecurityDeposit(a.context, a.budget.id, { to: "KEPT_PARTIAL", retainedAmount: 500_000, reason: "NOTA-INTERNA-SECRETA" });
      const row = await db.budget.findUniqueOrThrow({ where: { id: a.budget.id }, include: portalInclude });
      const view = portalBudgetView(row as never);
      assert.deepEqual(view.securityDeposit, { amount: 2_000_000, status: "KEPT_PARTIAL", statusLabel: "Retenida parcialmente", retained: 500_000, returned: 1_500_000 });
      assert.equal(view.total, 1_000_001);
      const json = JSON.stringify(view);
      assert.doesNotMatch(json, /NOTA-INTERNA-SECRETA|777777|123456|materialCost|costEstimate/);
    });

    await t.test("devolución de equipos del evento: limpia, con incidentes o pendiente", async () => {
      const a = await seed();
      const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: a.org, name: "Pantalla", category: "Pantallas", quantity: 5 } });
      const mkEvent = async (inv: { checkedIn: boolean; damagedQuantity?: number }) => {
        const ev = await db.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: a.client.id, name: "Ev", startsAt: new Date(), endsAt: new Date() } as never });
        await db.eventInventory.create({ data: { id: randomUUID(), eventId: ev.id, inventoryId: item.id, quantity: 1, organizationId: a.org, ...inv } });
        return ev.id;
      };
      const clean = await mkEvent({ checkedIn: true });
      const bad = await mkEvent({ checkedIn: true, damagedQuantity: 1 });
      const open = await mkEvent({ checkedIn: false });
      const other = await seed();
      const map = await equipmentReturnByEvent(a.org, [clean, bad, open]);
      assert.equal(map.get(clean), "clean");
      assert.equal(map.get(bad), "incidents");
      assert.equal(map.get(open), "pending");
      assert.equal((await equipmentReturnByEvent(other.org, [clean])).size, 0, "otra empresa no ve el evento");
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.$disconnect();
  }
});
