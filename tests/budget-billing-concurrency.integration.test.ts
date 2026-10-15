import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const base = process.env.COMMERCIAL_TEST_BASE_URL;
const local = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(process.env.TEST_DATABASE_URL ?? ""));

test("comercial: duración EVENT canónica y descuento concurrente sin corromper total", { skip: !local, timeout: 120_000 }, async (t) => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const id = randomUUID();
  const organization = await db.organization.create({ data: { id, slug: `qa-billing-${id}`, name: "Empresa ficticia comercial" } });
  const user = await db.adminUser.create({ data: { id: randomUUID(), email: `${id}@fixtures.test`, name: "Operadora QA", role: "OWNER", passwordHash: "no-login", autoLockEnabled: false } });
  await db.adminMembership.create({ data: { id: randomUUID(), organizationId: id, adminUserId: user.id, role: "OWNER" } });
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: "Cliente ficticio" } });
  const cookie = `ledbox_session=${(await createSession(user, id)).jwt}`;
  const call = (body: unknown) => fetch(`${base}/api/admin/budgets`, { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const product = (billingUnit: "EVENT" | "DAILY") => db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: `Producto ${billingUnit}`, category: "QA", quantity: 20, billingUnit, listPrice: 100_000 } });
  const eventProduct = await product("EVENT"), dailyProduct = await product("DAILY");
  const fixture = (inventoryId: string | null = null) => db.budget.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, title: "Evento ficticio", subtotal: 100_000, total: 100_000, items: { create: { id: randomUUID(), name: "Producto QA", inventoryId, quantity: 1, days: 1, unitPrice: 100_000, subtotal: 100_000 } } }, include: { items: true } });
  try {
    for (const kind of ["editor", "items"]) for (const explicit of [true, false]) {
      await t.test(`${kind}: EVENT ${explicit ? "explícito" : "conservado"} cobra una sola duración y costo`, async () => {
        const q = await fixture(eventProduct.id);
        const response = await call({ budgetId: q.id, kind, items: [{ id: q.items[0].id, name: "Servicio por evento", ...(explicit ? { inventoryId: eventProduct.id } : {}), quantity: 2, days: 3, rentalDays: 3, unitPrice: 100_000, costPrice: 20_000 }] });
        assert.equal(response.status, 200, await response.clone().text());
        const saved = await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
        assert.equal(saved.items[0].days, 1); assert.equal(saved.items[0].inventoryId, eventProduct.id);
        assert.equal(saved.subtotal, 200_000); assert.equal(saved.total, 200_000); assert.equal(saved.costEstimate, 40_000);
        assert.equal(saved.items[0].subtotal, 200_000);
        assert.ok(saved.items[0].pricingSnapshot, "conserva el snapshot de duración real de alquiler");
      });
      await t.test(`${kind}: DAILY ${explicit ? "explícito" : "conservado"} mantiene tres días y costo`, async () => {
        const q = await fixture(dailyProduct.id);
        const response = await call({ budgetId: q.id, kind, items: [{ id: q.items[0].id, name: "Alquiler por día", ...(explicit ? { inventoryId: dailyProduct.id } : {}), quantity: 2, days: 3, unitPrice: 100_000, costPrice: 20_000 }] });
        assert.equal(response.status, 200, await response.clone().text());
        const saved = await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
        assert.equal(saved.items[0].days, 3); assert.equal(saved.total, 600_000); assert.equal(saved.costEstimate, 120_000);
      });
    }
    for (const kind of ["editor", "items"]) {
      await t.test(`${kind}: reemplazar DAILY por EVENT usa el producto nuevo; desvincular conserva duración libre`, async () => {
        const q = await fixture(dailyProduct.id);
        const line = { id: q.items[0].id, name: "Servicio", quantity: 2, days: 3, unitPrice: 100_000, costPrice: 20_000 };
        assert.equal((await call({ budgetId: q.id, kind, items: [{ ...line, inventoryId: eventProduct.id }] })).status, 200);
        let saved = await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
        assert.equal(saved.total, 200_000); assert.equal(saved.costEstimate, 40_000); assert.equal(saved.items[0].days, 1);
        assert.equal((await call({ budgetId: q.id, kind, items: [{ ...line, inventoryId: null }] })).status, 200);
        saved = await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
        assert.equal(saved.total, 600_000); assert.equal(saved.items[0].inventoryId, null); assert.equal(saved.items[0].days, 3);
      });
      await t.test(`${kind}: vínculo conservado eliminado no se reutiliza ni modifica el presupuesto`, async () => {
        const removed = await product("EVENT"); const q = await fixture(removed.id);
        await db.inventoryItem.update({ where: { id: removed.id }, data: { deletedAt: new Date() } });
        const response = await call({ budgetId: q.id, kind, items: [{ id: q.items[0].id, name: "Producto eliminado", quantity: 2, days: 3, unitPrice: 100_000, costPrice: 20_000 }] });
        assert.equal(response.status, 400, await response.clone().text());
        const saved = await db.budget.findUniqueOrThrow({ where: { id: q.id }, include: { items: true } });
        assert.equal(saved.total, 100_000); assert.equal(saved.items[0].days, 1);
      });
    }
    await t.test("edición de cantidades gana: descuento con subtotal viejo devuelve409 y conserva el plan; reintento secuencial200", async () => {
      const q = await fixture();
      await db.budget.update({ where: { id: q.id }, data: { installmentsJson: [{ label: "Seña", type: "percent", value: 50, amount: 50_000, moment: "Al confirmar" }, { label: "Saldo", type: "remainder", amount: 50_000, moment: "Contra entrega" }] } });
      // Compile/warm endpoint before holding database locks.
      assert.equal((await call({ budgetId: q.id, kind: "commercial", notes: "QA" })).status, 200);
      async function waitBlocked(count: number) {
        for (let i = 0; i < 160; i++) {
          const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "Budget"%FOR UPDATE%'`;
          if (Number(rows[0].count) >= count) return;
          await delay(25);
        }
        assert.fail(`no llegaron ${count} escrituras al candado del presupuesto`);
      }
      let release!: () => void, ready!: () => void;
      const unlocked = new Promise<void>((resolve) => { release = resolve; });
      const locked = new Promise<void>((resolve) => { ready = resolve; });
      const blocker = db.$transaction(async (tx) => { await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id"=${q.id} FOR UPDATE`; ready(); await unlocked; }, { timeout: 20_000 });
      await locked;
      let edited!: Promise<Response>, discounted!: Promise<Response>;
      try {
        edited = call({ budgetId: q.id, kind: "editor", items: [{ id: q.items[0].id, name: "Mesas", quantity: 2, days: 1, unitPrice: 100_000, costPrice: 0 }] });
        await waitBlocked(1);
        discounted = call({ budgetId: q.id, kind: "commercial", discount: 10_000 });
        await waitBlocked(2);
      } finally { release(); await blocker; }
      const [a, b] = await Promise.all([edited, discounted]);
      assert.equal(a.status, 200, await a.clone().text()); assert.equal(b.status, 409, await b.clone().text());
      let saved = await db.budget.findUniqueOrThrow({ where: { id: q.id } });
      assert.equal(saved.subtotal, 200_000); assert.equal(saved.discount, 0); assert.equal(saved.total, 200_000);
      assert.deepEqual((saved.installmentsJson as Array<{ amount: number }>).map((row) => row.amount), [100_000, 100_000]);
      assert.equal((await call({ budgetId: q.id, kind: "commercial", discount: 10_000 })).status, 200);
      saved = await db.budget.findUniqueOrThrow({ where: { id: q.id } });
      assert.equal(saved.subtotal, 200_000); assert.equal(saved.discount, 10_000); assert.equal(saved.total, 190_000);
      assert.deepEqual((saved.installmentsJson as Array<{ amount: number }>).map((row) => row.amount), [95_000, 95_000]);
    });
  } finally {
    await db.organization.delete({ where: { id: organization.id } });
    await db.adminUser.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
