import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

const base = process.env.PORTAL_STOCK_BASE_URL;
const enabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && process.env.TEST_DATABASE_URL);

test("aprobación pública HTTP: stock serializado y rollback sin reservas huérfanas", { skip: !enabled, timeout: 180000 }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const { generatePublicToken } = await import("../lib/server/budget-portal");
  const { lockInventoryItems } = await import("../lib/server/inventory-availability");
  const org = randomUUID();
  await db.organization.create({ data: { id: org, name: "Pruebas públicas ficticias", slug: `public-stock-${org}` } });
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente ficticio" } });
  await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: org, name: "Caja ficticia" } });
  async function seed(mode: "portal" | "comparison") {
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Evento ficticio", status: "DRAFT", startsAt: new Date("2034-05-10"), endsAt: new Date("2034-05-11"), setupAt: new Date("2034-05-10"), strikeAt: new Date("2034-05-11") } });
    const leaf = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Silla ficticia", category: "Mobiliario", quantity: 1, listPrice: 100 } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, eventId: event.id, title: "Presupuesto ficticio", status: "SENT", publicToken: generatePublicToken(), total: 100, subtotal: 100, items: { create: { id: randomUUID(), name: leaf.name, inventoryId: leaf.id, quantity: 1, days: 1, unitPrice: 100, subtotal: 100 } } } });
    let path = `/api/portal/budget/${budget.publicToken}/approve`, groupId: string | undefined;
    if (mode === "comparison") {
      const group = await db.quoteComparison.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Alternativas ficticias", publicToken: generatePublicToken(), expiresAt: new Date("2035-01-01") } });
      groupId = group.id;
      const other = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, title: "Alternativa ficticia", status: "SENT", total: 100, subtotal: 100, items: { create: { id: randomUUID(), name: "Servicio ficticio", quantity: 1, days: 1, unitPrice: 100, subtotal: 100 } } } });
      await db.budget.updateMany({ where: { id: { in: [budget.id, other.id] } }, data: { comparisonId: group.id } });
      path = `/api/portal/comparison/${group.publicToken}/approve`;
    }
    return { event, leaf, budget, path, groupId };
  }
  const approve = (fixture: Awaited<ReturnType<typeof seed>>) => fetch(base + fixture.path, { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": `stock-${randomUUID()}` }, body: JSON.stringify({ consent: true, name: "Cliente ficticio", budgetId: fixture.budget.id }) });
  async function waitLocked(fragment: string) {
    const deadline = Date.now() + 18000;
    while (true) {
      const rows = await db.$queryRaw<Array<{ query: string }>>`SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      if (rows.some(row => row.query.includes(fragment))) return;
      assert.ok(Date.now() < deadline, `alcanzar lock real ${fragment}`);
      await delay(10);
    }
  }
  try {
    // Compila las rutas antes de abrir las ventanas de bloqueo deterministas.
    await fetch(`${base}/api/portal/budget/${generatePublicToken()}/approve`, { method: "POST" });
    await fetch(`${base}/api/portal/comparison/${generatePublicToken()}/approve`, { method: "POST" });
    for (const mode of ["portal", "comparison"] as const) {
      await t.test(`${mode}: retiro no puede cambiar inventario mientras aprobación espera Budget`, async () => {
        const f = await seed(mode);
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { ready = r; });
        const blocker = db.$transaction(async tx => { await tx.$queryRaw`SELECT id FROM "Budget" WHERE id = ${f.budget.id} FOR UPDATE`; ready(); await gate; }, { timeout: 30000 });
        await locked;
        const approving = approve(f);
        let retired = false, wasBlocked = false, retirement: Promise<unknown> | undefined;
        try {
          await waitLocked('FROM "Budget"');
          retirement = db.$transaction(async tx => { await lockInventoryItems(tx, org, [f.leaf.id]); await tx.inventoryItem.update({ where: { id: f.leaf.id }, data: { quantity: 0, status: "RETIRED" } }); }).then(() => { retired = true; });
          // El retiro debe entrar al mismo lock; una escritura completada revela la carrera anterior.
          const deadline = Date.now() + 1000;
          while (!retired && Date.now() < deadline) {
            const rows = await db.$queryRaw<Array<{ query: string }>>`SELECT query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
            if (rows.some(row => row.query.includes('FROM "InventoryItem"'))) break;
            await delay(10);
          }
          wasBlocked = !retired;
        } finally { release(); await blocker; }
        const response = await approving;
        assert.equal(response.status, 200, await response.clone().text());
        await retirement;
        assert.equal(wasBlocked, true, "el retiro no pasa por delante de la aprobación pendiente");
        const saved = await db.budget.findUniqueOrThrow({ where: { id: f.budget.id } });
        assert.equal(saved.status, "APPROVED"); assert.ok(saved.approvedAt);
        assert.equal(await db.expectedPayment.count({ where: { budgetId: saved.id } }), 1);
      });
      await t.test(`${mode}: retiro que gana devuelve409 sin aprobación ni deuda ni reserva`, async () => {
        const f = await seed(mode);
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { ready = r; });
        const blocker = db.$transaction(async tx => { await lockInventoryItems(tx, org, [f.leaf.id]); await tx.inventoryItem.update({ where: { id: f.leaf.id }, data: { quantity: 0, status: "RETIRED" } }); ready(); await gate; }, { timeout: 30000 });
        await locked;
        const approving = approve(f);
        try { await waitLocked('FROM "InventoryItem"'); } finally { release(); await blocker; }
        const response = await approving;
        assert.equal(response.status, 409, await response.clone().text());
        const saved = await db.budget.findUniqueOrThrow({ where: { id: f.budget.id } });
        assert.notEqual(saved.status, "APPROVED"); assert.equal(saved.approvedAt, null);
        assert.equal(await db.expectedPayment.count({ where: { budgetId: saved.id } }), 0);
        assert.equal(await db.eventInventory.count({ where: { budgetId: saved.id } }), 0);
        if (f.groupId) assert.equal((await db.quoteComparison.findUniqueOrThrow({ where: { id: f.groupId } })).selectedBudgetId, null);
      });
      await t.test(`${mode}: fechas cambiadas durante verificación exigen nueva aceptación`, async () => {
        const f = await seed(mode);
        let release!: () => void, ready!: () => void;
        const gate = new Promise<void>(r => { release = r; }), locked = new Promise<void>(r => { ready = r; });
        const blocker = db.$transaction(async tx => { await lockInventoryItems(tx, org, [f.leaf.id]); ready(); await gate; }, { timeout: 30000 });
        await locked;
        const approving = approve(f);
        try {
          await waitLocked('FROM "InventoryItem"');
          await db.event.update({ where: { id: f.event.id }, data: { setupAt: new Date("2034-05-09") } });
        } finally { release(); await blocker; }
        const response = await approving;
        assert.equal(response.status, 409, await response.clone().text());
        assert.equal((await response.json()).code, "approval_stale");
        const saved = await db.budget.findUniqueOrThrow({ where: { id: f.budget.id } });
        assert.equal(saved.approvedAt, null);
        assert.equal(await db.expectedPayment.count({ where: { budgetId: saved.id } }), 0);
        assert.equal(await db.eventInventory.count({ where: { budgetId: saved.id } }), 0);
        if (f.groupId) assert.equal((await db.quoteComparison.findUniqueOrThrow({ where: { id: f.groupId } })).selectedBudgetId, null);
      });
      await t.test(`${mode}: fallo del plan revierte aprobación, selección y reserva previa`, async () => {
        const f = await seed(mode);
        // Base aislada: fallo real de persistencia después de aceptar, nunca un mock.
        await db.$executeRawUnsafe(`ALTER TABLE "ExpectedPayment" ADD CONSTRAINT audit131_expected_failure CHECK ("organizationId" <> '${org}') NOT VALID`);
        try {
          const response = await approve(f);
          assert.equal(response.status, 500);
          const saved = await db.budget.findUniqueOrThrow({ where: { id: f.budget.id } });
          assert.equal(saved.approvedAt, null); assert.notEqual(saved.status, "APPROVED");
          assert.equal(await db.expectedPayment.count({ where: { budgetId: saved.id } }), 0);
          assert.equal(await db.eventInventory.count({ where: { budgetId: saved.id } }), 0);
          assert.equal((await db.event.findUniqueOrThrow({ where: { id: f.event.id } })).status, "DRAFT");
          if (f.groupId) assert.equal((await db.quoteComparison.findUniqueOrThrow({ where: { id: f.groupId } })).selectedBudgetId, null);
        } finally { await db.$executeRawUnsafe('ALTER TABLE "ExpectedPayment" DROP CONSTRAINT audit131_expected_failure'); }
      });
    }
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: org } });
    await dbWithDeleted.$disconnect();
  }
});
