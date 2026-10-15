import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/rental-coherencia.pg.test.ts
test("coherencia del saldo con la garantía (alquileres P1-4) en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const settlement = await import("../lib/server/rental-settlement");
  const { transitionBudgetSecurityDeposit } = await import("../lib/server/security-deposit");
  const { syncBudgetExpectedPayments, confirmExpectedPayment } = await import("../lib/server/expected-payments");
  const { getResumen } = await import("../lib/server/resumen");
  const { collectedAmount, receivedAmount } = await import("../lib/admin-types");
  const { countsTowardBudgetBalance } = await import("../lib/payment-origin");

  /** Presupuesto de 1.000.000 con seña de 500.000 (50 %) y garantía; el plan ya sincronizado. */
  async function seed(purpose: "RESERVE" | "DAMAGES", deposit: number) {
    const org = randomUUID();
    await db.organization.create({ data: { id: org, name: "Coherencia QA", slug: `coh-${org}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente" } });
    await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Caja", type: "CASH" } });
    const budget = await db.budget.create({
      data: {
        id: randomUUID(),
        organizationId: org,
        clientId: client.id,
        title: "Alquiler",
        status: "APPROVED",
        approvedAt: new Date(),
        subtotal: 1_000_000,
        total: 1_000_000,
        advanceAmount: 500_000,
        securityDeposit: deposit,
        securityDepositStatus: "PENDING",
        securityDepositPurpose: purpose,
      },
    });
    const context = { organizationId: org, user: { id: "u-fin", name: "Ana Finanzas", email: "ana@example.com", role: "FINANCE" as const } };
    await syncBudgetExpectedPayments({ organizationId: org, budgetId: budget.id });
    return { org, client, budget, context };
  }
  const expectedRow = (budgetId: string, concept: string) => db.expectedPayment.findFirstOrThrow({ where: { budgetId, concept: concept as never } });
  const confirm = async (s: Awaited<ReturnType<typeof seed>>, concept: string, amount?: number) => {
    const row = await expectedRow(s.budget.id, concept);
    const result = await confirmExpectedPayment({ organizationId: s.org, expectedPaymentId: row.id, amount, actor: s.context });
    assert.ok(result.ok, JSON.stringify(result));
  };
  const porCobrar = async (org: string) => (await getResumen(org)).money.receivable;
  /** Lo que falta cobrar según el plan (sin los cargos extra). */
  const planPending = async (budgetId: string) =>
    (await db.expectedPayment.findMany({ where: { budgetId, concept: { not: "extra" }, status: { not: "CANCELLED" } } })).reduce((sum, row) => sum + Math.max(0, row.amount - row.paidAmount), 0);
  const balanceOf = async (budgetId: string, total: number) => total - collectedAmount(await db.clientPayment.findMany({ where: { budgetId } }));

  await t.test("garantía de daños: retener 200.000 deja el «por cobrar» en 500.000 (no 300.000) y al pagar el saldo queda en 0, no negativo", async () => {
    const s = await seed("DAMAGES", 300_000);
    await confirm(s, "advance");
    assert.equal(await porCobrar(s.org), 500_000);
    await transitionBudgetSecurityDeposit(s.context, s.budget.id, { to: "HELD" });
    assert.equal(await porCobrar(s.org), 500_000, "la garantía en custodia no es un pago del alquiler");
    await db.rentalCharge.create({ data: { id: randomUUID(), organizationId: s.org, budgetId: s.budget.id, kind: "OTHER", status: "APPLIED", label: "Cargo", quantity: 1, unitAmount: 200_000, amount: 200_000, dedupeKey: "custom:t1" } });
    const settled = await settlement.settleBudgetRental(s.context, s.budget.id);
    assert.equal(settled.retained, 200_000);
    const retained = await db.clientPayment.findFirstOrThrow({ where: { budgetId: s.budget.id, method: "Garantía retenida" } });
    assert.equal(retained.origin, "deposit_retained");
    assert.equal(retained.status, "RECEIVED");
    assert.equal(await porCobrar(s.org), 500_000, "lo retenido es ingreso por cargos, no baja el saldo");
    assert.equal(await balanceOf(s.budget.id, 1_000_000), 500_000);
    assert.equal(await planPending(s.budget.id), 500_000, "las dos vistas coinciden");
    await confirm(s, "balance");
    assert.equal(await porCobrar(s.org), 0);
    assert.equal(await balanceOf(s.budget.id, 1_000_000), 0, "no queda negativo (−200.000) por la retención");
    assert.equal(await planPending(s.budget.id), 0);
    const all = await db.clientPayment.findMany({ where: { budgetId: s.budget.id } });
    assert.equal(receivedAmount(all), 1_200_000, "tesorería e ingresos sí cuentan la retención");
    const income = await db.treasuryMovement.findMany({ where: { organizationId: s.org, direction: "IN" } });
    assert.equal(income.reduce((sum, m) => sum + m.amount, 0), 1_200_000);
    assert.equal(all.filter((p) => !countsTowardBudgetBalance(p)).length, 1);
  });

  await t.test("el cobro de un cargo extra tampoco baja el saldo del alquiler", async () => {
    const s = await seed("DAMAGES", 100_000);
    await transitionBudgetSecurityDeposit(s.context, s.budget.id, { to: "HELD" });
    await db.rentalCharge.create({ data: { id: randomUUID(), organizationId: s.org, budgetId: s.budget.id, kind: "OTHER", status: "APPLIED", label: "Cargo", quantity: 1, unitAmount: 180_000, amount: 180_000, dedupeKey: "custom:t2" } });
    const settled = await settlement.settleBudgetRental(s.context, s.budget.id);
    assert.deepEqual([settled.retained, settled.extra], [100_000, 80_000]);
    await confirm(s, "extra");
    const extraPayment = await db.clientPayment.findFirstOrThrow({ where: { budgetId: s.budget.id, expectedPaymentId: { not: null } } });
    assert.equal(extraPayment.origin, "rental_extra");
    assert.equal(await porCobrar(s.org), 1_000_000, "el alquiler sigue debiendo el total");
    assert.equal(await balanceOf(s.budget.id, 1_000_000), 1_000_000);
  });

  await t.test("garantía de reserva 300.000: se imputa a la seña del plan; el saldo esperado baja y las dos vistas coinciden", async () => {
    const s = await seed("RESERVE", 300_000);
    assert.equal(await planPending(s.budget.id), 1_000_000);
    await transitionBudgetSecurityDeposit(s.context, s.budget.id, { to: "HELD" });
    const payments = await db.clientPayment.findMany({ where: { budgetId: s.budget.id } });
    assert.equal(payments.length, 1);
    assert.equal(payments[0].origin, "deposit_reserve");
    assert.equal(payments[0].method, "Garantía de reserva");
    const advance = await expectedRow(s.budget.id, "advance");
    assert.deepEqual([advance.status, advance.paidAmount], ["PARTIAL", 300_000]);
    assert.equal(payments[0].expectedPaymentId, advance.id);
    assert.equal((await expectedRow(s.budget.id, "balance")).paidAmount, 0);
    assert.equal(await planPending(s.budget.id), 700_000);
    assert.equal(await porCobrar(s.org), 700_000);
    assert.equal(await balanceOf(s.budget.id, 1_000_000), 700_000);
    assert.equal(await db.treasuryMovement.count({ where: { organizationId: s.org, direction: "IN", amount: 300_000 } }), 1);
    // Se completa la seña (200.000) y el saldo: queda en 0 en ambas vistas.
    await confirm(s, "advance");
    await confirm(s, "balance");
    assert.equal(await planPending(s.budget.id), 0);
    assert.equal(await porCobrar(s.org), 0);
  });

  await t.test("garantía de reserva mayor que la seña: cubre la seña y sigue en el saldo; recibirla dos veces no duplica", async () => {
    const s = await seed("RESERVE", 600_000);
    await transitionBudgetSecurityDeposit(s.context, s.budget.id, { to: "HELD" });
    const advance = await expectedRow(s.budget.id, "advance");
    const balance = await expectedRow(s.budget.id, "balance");
    assert.deepEqual([advance.status, advance.paidAmount], ["CONFIRMED", 500_000]);
    assert.deepEqual([balance.status, balance.paidAmount], ["PARTIAL", 100_000]);
    const payments = await db.clientPayment.findMany({ where: { budgetId: s.budget.id } });
    assert.equal(payments.length, 2);
    assert.equal(payments.reduce((sum, p) => sum + p.amount, 0), 600_000);
    assert.equal(await planPending(s.budget.id), 400_000);
    assert.equal(await porCobrar(s.org), 400_000);
    await assert.rejects(transitionBudgetSecurityDeposit(s.context, s.budget.id, { to: "HELD" }));
    assert.equal(await db.clientPayment.count({ where: { budgetId: s.budget.id } }), 2);
  });

  await t.test("garantía de reserva sin plan (presupuesto sin aprobar): queda como cobro libre que baja el saldo", async () => {
    const s = await seed("RESERVE", 300_000);
    await db.expectedPayment.deleteMany({ where: { budgetId: s.budget.id } });
    await db.budget.update({ where: { id: s.budget.id }, data: { status: "DRAFT", approvedAt: null } });
    await transitionBudgetSecurityDeposit(s.context, s.budget.id, { to: "HELD" });
    const payments = await db.clientPayment.findMany({ where: { budgetId: s.budget.id } });
    assert.equal(payments.length, 1);
    assert.equal(payments[0].expectedPaymentId, null);
    assert.equal(await balanceOf(s.budget.id, 1_000_000), 700_000);
  });
});
