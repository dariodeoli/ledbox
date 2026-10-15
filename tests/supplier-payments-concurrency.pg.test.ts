import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const base = process.env.SUPPLIER_PAYMENT_TEST_BASE_URL ?? process.env.TEST_HTTP_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && process.env.TEST_DATABASE_URL);

test("pagos de proveedores HTTP: saldo exacto frente a pagos, cancelaciones y ediciones concurrentes", { skip: !enabled, timeout: 180000 }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const org = randomUUID(), other = randomUUID(), users: string[] = [];
  await db.organization.createMany({ data: [org, other].map(id => ({ id, slug: `supplier132-${id}`, name: "Empresa de eventos ficticia" })) });
  async function cookie(role: "OWNER" | "VIEWER" | "OPERATIONS", organizationId = org) {
    const user = await db.adminUser.create({ data: { id: randomUUID(), email: `${randomUUID()}@example.invalid`, name: "Auditor ficticio", role, passwordHash: "not-a-login", autoLockEnabled: false } });
    users.push(user.id);
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: user.id, organizationId, role } });
    return `ledbox_session=${(await createSession(user, organizationId)).jwt}`;
  }
  const owner = await cookie("OWNER"), foreign = await cookie("OWNER", other);
  const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: org, name: "Catering ficticio" } });
  const account = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Caja ficticia", openingBalance: 1000000 } });
  async function job() {
    return db.supplierJob.create({ data: { id: randomUUID(), organizationId: org, supplierId: supplier.id, description: "Servicio para evento ficticio", total: 100000, advance: 0 } });
  }
  async function call(path: string, method: string, body: unknown, auth = owner, key = randomUUID()) {
    return fetch(base + path, { method, headers: { "Content-Type": "application/json", Cookie: auth, "Idempotency-Key": key }, body: JSON.stringify(body) });
  }
  const pay = (id: string, amount: number, auth = owner, key = randomUUID()) => call("/api/admin/treasury", "POST", { kind: "supplier-payment", jobId: id, accountId: account.id, amount, method: "Efectivo" }, auth, key);
  const edit = (id: string, fields: Record<string, unknown>, auth = owner) => call("/api/admin/suppliers/jobs", "PATCH", { id, ...fields }, auth);
  async function cashOut(id: string) {
    return db.treasuryMovement.aggregate({ where: { organizationId: org, origin: "supplier_job", sourceId: id }, _sum: { amount: true }, _count: true });
  }
  /** Both requests reach the real row lock before releasing the first writer. */
  async function queued(id: string, first: () => Promise<Response>, second: () => Promise<Response>) {
    let release!: () => void, ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), locked = new Promise<void>(resolve => { ready = resolve; });
    const blocker = db.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "SupplierJob" WHERE id = ${id} FOR UPDATE`; ready(); await gate; }, { timeout: 20000 });
    await locked;
    const waiters = async (count: number) => {
      const deadline = Date.now() + 12000;
      while (true) {
        const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%SupplierJob%'`;
        if (Number(rows[0].count) >= count) return;
        assert.ok(Date.now() < deadline, `se alcanzó el bloqueo real de ${count} operación(es)`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    const a = first();
    let b: Promise<Response> | undefined;
    try { await waiters(1); b = second(); await waiters(2); }
    finally { release(); }
    await blocker;
    return Promise.all([a, b!]);
  }
  try {
    // Compile both routes before holding a transaction open in Next development.
    assert.equal((await edit((await job()).id, { notes: "Preparación local" })).status, 200);
    assert.equal((await pay((await job()).id, 1)).status, 201);
    await t.test("dos pagos que exceden el saldo no generan egreso ni anticipo ficticio", async () => {
      const row = await job();
      const [first, second] = await queued(row.id, () => pay(row.id, 60000), () => pay(row.id, 60000));
      assert.equal(first.status, 201, await first.clone().text());
      assert.equal(second.status, 400, await second.clone().text());
      const saved = await db.supplierJob.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(saved.advance, 60000);
      assert.deepEqual(await cashOut(row.id), { _sum: { amount: 60000 }, _count: 1 });
    });
    await t.test("dos pagos compatibles conservan la suma exacta del anticipo y del egreso", async () => {
      const row = await job();
      const responses = await queued(row.id, () => pay(row.id, 30000), () => pay(row.id, 40000));
      for (const response of responses) assert.equal(response.status, 201, await response.clone().text());
      assert.equal((await db.supplierJob.findUniqueOrThrow({ where: { id: row.id } })).advance, 70000);
      assert.deepEqual(await cashOut(row.id), { _sum: { amount: 70000 }, _count: 2 });
    });
    await t.test("cancelar primero impide un pago que ya esperaba sobre el trabajo", async () => {
      const row = await job();
      const [cancelled, payment] = await queued(row.id, () => edit(row.id, { status: "CANCELLED" }), () => pay(row.id, 60000));
      assert.equal(cancelled.status, 200, await cancelled.clone().text());
      assert.equal(payment.status, 409, await payment.clone().text());
      const saved = await db.supplierJob.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(saved.status, "CANCELLED"); assert.equal(saved.advance, 0);
      assert.deepEqual(await cashOut(row.id), { _sum: { amount: null }, _count: 0 });
    });
    await t.test("editar el total después de un pago no lo reduce por debajo de lo pagado", async () => {
      const row = await job();
      const [payment, changed] = await queued(row.id, () => pay(row.id, 60000), () => edit(row.id, { total: 50000 }));
      assert.equal(payment.status, 201, await payment.clone().text());
      assert.equal(changed.status, 400, await changed.clone().text());
      const saved = await db.supplierJob.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(saved.total, 100000); assert.equal(saved.advance, 60000);
      assert.deepEqual(await cashOut(row.id), { _sum: { amount: 60000 }, _count: 1 });
    });
    await t.test("un pago respeta el total reducido que confirmó otro operador primero", async () => {
      const row = await job();
      const [changed, payment] = await queued(row.id, () => edit(row.id, { total: 50000 }), () => pay(row.id, 60000));
      assert.equal(changed.status, 200, await changed.clone().text());
      assert.equal(payment.status, 400, await payment.clone().text());
      const saved = await db.supplierJob.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(saved.total, 50000); assert.equal(saved.advance, 0);
      assert.deepEqual(await cashOut(row.id), { _sum: { amount: null }, _count: 0 });
    });
    await t.test("repetir el mismo intento conserva un único egreso y anticipo", async () => {
      const row = await job(), key = randomUUID();
      const [first, replay] = await Promise.all([pay(row.id, 60000, owner, key), pay(row.id, 60000, owner, key)]);
      assert.equal(first.status, 201, await first.clone().text()); assert.equal(replay.status, 201, await replay.clone().text());
      assert.deepEqual(await first.json(), await replay.json());
      assert.equal((await db.supplierJob.findUniqueOrThrow({ where: { id: row.id } })).advance, 60000);
      assert.deepEqual(await cashOut(row.id), { _sum: { amount: 60000 }, _count: 1 });
    });
    await t.test("otro tenant y roles sin permiso no pagan ni editan el trabajo", async () => {
      const row = await job();
      assert.equal((await pay(row.id, 100, foreign)).status, 404);
      assert.equal((await edit(row.id, { total: 80000 }, foreign)).status, 404);
      for (const role of ["VIEWER", "OPERATIONS"] as const) {
        const auth = await cookie(role);
        assert.equal((await pay(row.id, 100, auth)).status, 403);
        assert.equal((await edit(row.id, { total: 80000 }, auth)).status, 403);
      }
      assert.equal((await db.supplierJob.findUniqueOrThrow({ where: { id: row.id } })).advance, 0);
      assert.deepEqual(await cashOut(row.id), { _sum: { amount: null }, _count: 0 });
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.adminUser.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
