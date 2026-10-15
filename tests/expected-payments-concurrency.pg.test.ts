import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Fixtures aisladas; no resetea ni migra la base compartida.
test("cobros y división de saldo: invariantes en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { confirmExpectedPayment, splitExpectedPayment } = await import("../lib/server/expected-payments");
  const org = randomUUID();
  const otherOrg = randomUUID();
  await db.organization.createMany({ data: [org, otherOrg].map((id) => ({ id, slug: `fin131-${id}`, name: "Finanzas ficticias 131" })) });
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente ficticio" } });
  const account = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Caja", type: "CASH" } });
  const actor = { organizationId: org, user: { id: "audit-fin", name: "Auditora", email: "audit@example.test", role: "FINANCE" as const } };
  async function seed(amount = 1000) {
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Evento ficticio", total: amount, subtotal: amount, approvedAt: new Date(), status: "APPROVED" } });
    return db.expectedPayment.create({ data: { id: randomUUID(), organizationId: org, budgetId: budget.id, concept: "balance", slot: "balance", label: "Saldo", amount, expectedAccountId: account.id } });
  }
  const input = (id: string) => ({ organizationId: org, expectedPaymentId: id, actor });
  // Retiene la fila hasta que los contendientes llegaron al UPDATE real.
  async function race<T>(id: string, operations: (() => Promise<T>)[], beforeRelease?: () => Promise<void>) {
    let release!: () => void;
    let locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ExpectedPayment" WHERE id = ${id} FOR UPDATE`;
      locked();
      await gate;
      await beforeRelease?.();
    }, { timeout: 15000 });
    await ready;
    const pending = operations.map((run) => run());
    try {
      const deadline = Date.now() + 8000;
      while (true) {
        const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE%ExpectedPayment%'`;
        if (Number(rows[0].count) >= operations.length) break;
        assert.ok(Date.now() < deadline, "los contendientes deben alcanzar el bloqueo de fila");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally { release(); }
    await blocker;
    return Promise.all(pending);
  }
  try {
    await t.test("seña, saldo y reintento conservan monto y un movimiento por cobro", async () => {
      const row = await seed();
      const first = await confirmExpectedPayment({ ...input(row.id), amount: 300, method: "Efectivo" });
      assert.ok(first.ok && first.remaining === 700 && first.appliedAmount === 300);
      const second = await confirmExpectedPayment(input(row.id));
      assert.ok(second.ok && second.remaining === 0 && second.appliedAmount === 700);
      const replay = await confirmExpectedPayment(input(row.id));
      assert.ok(replay.ok && replay.alreadyConfirmed && replay.appliedAmount === 0);
      const payments = await db.clientPayment.findMany({ where: { expectedPaymentId: row.id } });
      assert.equal(payments.length, 2);
      assert.equal(payments.reduce((sum, p) => sum + p.amount, 0), 1000);
      assert.equal(await db.treasuryMovement.count({ where: { organizationId: org, sourceId: { in: payments.map((p) => p.id) } } }), 2);
    });
    await t.test("la clave de una seña devuelve el mismo resultado y comparte rollback", async () => {
      const { withIdempotency } = await import("../lib/server/idempotency");
      const row = await seed();
      const body = { expectedPaymentId: row.id, amount: 300 };
      const key = randomUUID();
      const run = () => withIdempotency({ organizationId: org, scope: "finance:expected:confirm", body,
        request: new Request("http://localhost/api/admin/finance/expected", { headers: { "Idempotency-Key": key } }),
      }, async (tx) => {
        const afterCommit: Array<() => Promise<void>> = [];
        const result = await confirmExpectedPayment({ ...input(row.id), amount: 300, tx, afterCommit });
        assert.ok(result.ok);
        return { status: 200, body: { appliedAmount: result.appliedAmount, remaining: result.remaining },
          afterCommit: async () => { for (const audit of afterCommit) await audit(); } };
      });
      const first = await run();
      const replay = await run();
      assert.deepEqual(await replay.json(), await first.json());
      assert.equal(replay.headers.get("Idempotent-Replay"), "true");
      assert.equal((await db.expectedPayment.findUniqueOrThrow({ where: { id: row.id } })).paidAmount, 300);
      assert.equal(await db.clientPayment.count({ where: { expectedPaymentId: row.id } }), 1);
      const aborted = await seed();
      const audits: Array<() => Promise<void>> = [];
      await assert.rejects(db.$transaction(async (tx) => {
        const result = await confirmExpectedPayment({ ...input(aborted.id), amount: 300, tx, afterCommit: audits });
        assert.ok(result.ok);
        throw new Error("fallo antes del commit");
      }), /fallo antes del commit/);
      assert.equal((await db.expectedPayment.findUniqueOrThrow({ where: { id: aborted.id } })).paidAmount, 0);
      assert.equal(await db.clientPayment.count({ where: { expectedPaymentId: aborted.id } }), 0);
      assert.equal(await db.auditLog.count({ where: { entityId: aborted.id } }), 0);
    });
    await t.test("dos divisiones simultáneas no duplican deuda", async () => {
      const row = await seed();
      const run = () => splitExpectedPayment({ ...input(row.id), parts: [{ amount: 400 }, { amount: 600 }] });
      const results = await race(row.id, [run, run]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      const debt = await db.expectedPayment.findMany({ where: { budgetId: row.budgetId } });
      assert.equal(debt.length, 2);
      assert.equal(debt.reduce((sum, p) => sum + p.amount, 0), 1000);
    });
    await t.test("dos confirmaciones completas generan una sola entrada", async () => {
      const row = await seed();
      const run = () => confirmExpectedPayment(input(row.id));
      const results = await race(row.id, [run, run]);
      assert.ok(results.every((r) => r.ok));
      assert.equal(results.filter((r) => r.ok && r.appliedAmount > 0).length, 1);
      assert.equal(await db.clientPayment.count({ where: { expectedPaymentId: row.id } }), 1);
    });
    await t.test("cancelación concurrente nunca se informa como cobro confirmado", async () => {
      const row = await seed();
      // UPDATE desde el mismo bloqueo para que cancelar gane antes del cobrador.
      let unblock!: () => void;
      let locked!: () => void;
      const ready = new Promise<void>((r) => { locked = r; });
      const gate = new Promise<void>((r) => { unblock = r; });
      const blocker = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ExpectedPayment" WHERE id = ${row.id} FOR UPDATE`;
        locked(); await gate;
        await tx.expectedPayment.update({ where: { id: row.id }, data: { status: "CANCELLED" } });
      });
      await ready;
      const pending = confirmExpectedPayment(input(row.id));
      try {
        const deadline = Date.now() + 3000;
        while (true) {
          const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%UPDATE%ExpectedPayment%'`;
          if (Number(rows[0].count) > 0) break;
          assert.ok(Date.now() < deadline);
          await new Promise((r) => setTimeout(r, 10));
        }
      } finally { unblock(); }
      await blocker;
      const result = await pending;
      assert.ok(!result.ok && result.status === 409);
      assert.equal(await db.clientPayment.count({ where: { expectedPaymentId: row.id } }), 0);
    });
    await t.test("dos señas concurrentes: el perdedor recibe conflicto, saldo real no ficticio", async () => {
      const row = await seed();
      const run = () => confirmExpectedPayment({ ...input(row.id), amount: 300 });
      const results = await race(row.id, [run, run]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal(results.filter((r) => !r.ok && r.status === 409).length, 1);
      assert.equal((await db.expectedPayment.findUniqueOrThrow({ where: { id: row.id } })).paidAmount, 300);
    });
    await t.test("rechaza fracciones, método Pendiente y método inventado sin escribir", async () => {
      const row = await seed();
      for (const extra of [{ amount: 1.2 }, { method: "Pendiente" }, { method: "inventado" }]) {
        const result = await confirmExpectedPayment({ ...input(row.id), ...extra });
        assert.ok(!result.ok && result.status === 400);
      }
      const split = await splitExpectedPayment({ ...input(row.id), parts: [{ amount: 399.6 }, { amount: 600.4 }] });
      assert.ok(!split.ok && split.status === 400);
      assert.equal(await db.clientPayment.count({ where: { expectedPaymentId: row.id } }), 0);
    });
    await t.test("dividir un cargo extra conserva su origen y no cancela saldo del alquiler", async () => {
      const row = await seed();
      await db.expectedPayment.update({ where: { id: row.id }, data: { concept: "extra", slot: `extra:${row.id}` } });
      const divided = await splitExpectedPayment({ ...input(row.id), parts: [{ amount: 400 }, { amount: 600 }] });
      assert.ok(divided.ok);
      const parts = await db.expectedPayment.findMany({ where: { budgetId: row.budgetId } });
      assert.ok(parts.every((part) => part.concept === "extra"));
      for (const part of parts) assert.ok((await confirmExpectedPayment(input(part.id))).ok);
      const payments = await db.clientPayment.findMany({ where: { budgetId: row.budgetId } });
      assert.equal(payments.length, 2);
      assert.ok(payments.every((payment) => payment.origin === "rental_extra"));
    });
    await t.test("otra empresa no confirma ni divide el concepto", async () => {
      const row = await seed();
      const foreign = { ...input(row.id), organizationId: otherOrg };
      const confirm = await confirmExpectedPayment(foreign);
      const split = await splitExpectedPayment({ ...foreign, parts: [{ amount: 500 }, { amount: 500 }] });
      assert.ok(!confirm.ok && confirm.status === 404);
      assert.ok(!split.ok && split.status === 404);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, otherOrg] } } });
    await db.$disconnect();
  }
});
