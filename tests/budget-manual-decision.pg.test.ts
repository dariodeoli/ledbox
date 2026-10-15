import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import type { AdminContext } from "../lib/server/tenancy";

test("presupuestos: aprobación manual única, plan atómico y carreras con revisión/cierre", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo PostgreSQL descartable local");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { applyManualBudgetDecision, setBudgetCommercialStatus } = await import("../lib/server/budget-approval");
  const { portalAuditContext } = await import("../lib/server/audit");
  const id = randomUUID();
  const organization = await db.organization.create({ data: { id, name: "QA aprobación 131", slug: `qa-aprobacion-${id}` } });
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: "Cliente eventos QA" } });
  await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: id, name: "Cuenta QA" } });
  const context: AdminContext = {
    ...portalAuditContext(id, "Operadora QA"),
    user: { ...portalAuditContext(id, "Operadora QA").user, name: "Operadora QA", role: "FINANCE" },
    organization, role: "FINANCE", demo: false, sandbox: false,
    session: { id: "qa-local", userId: "portal", activeOrganizationId: id, expiresAt: new Date("2034-01-01"), revokedAt: null, lockedAt: null, lockAttempts: 0, lockReason: null, createdAt: new Date() },
  };
  const fixture = (extra: Record<string, unknown> = {}) => db.budget.create({ data: {
    id: randomUUID(), organizationId: id, clientId: client.id, title: "Producción de evento", status: "SENT", subtotal: 1_000_000, total: 1_000_000,
    advanceAmount: 300_000, items: { create: { id: randomUUID(), name: "Iluminación", quantity: 1, days: 1, unitPrice: 1_000_000, subtotal: 1_000_000 } }, ...extra,
  } as never });
  const approve = (budgetId: string) => applyManualBudgetDecision(context, { budgetId, decision: "approve", note: "Aprobación telefónica" });
  const move = (budgetId: string, status: string) => setBudgetCommercialStatus(context, { budgetId, status });
  const saved = (budgetId: string) => db.budget.findUniqueOrThrow({ where: { id: budgetId }, include: { event: true, expectedPayments: { orderBy: { amount: "asc" } } } });
  const expectApproved = async (budgetId: string) => {
    const budget = await saved(budgetId);
    assert.equal(budget.status, "APPROVED"); assert.ok(budget.approvedAt);
    assert.equal(budget.approvedByName, "Operadora QA"); assert.equal(budget.approvalMethod, "manual");
    assert.equal(budget.event?.status, "CONFIRMED"); assert.equal(budget.event?.organizationId, id);
    assert.deepEqual(budget.expectedPayments.map((p) => [p.amount, p.status]), [[300_000, "AWAITING"], [700_000, "AWAITING"]]);
    return budget;
  };
  // Observe PostgreSQL's actual row-lock queue, rather than hoping a timed race happened.
  async function waitForBlocked(n: number) {
    for (let i = 0; i < 150; i++) {
      const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%FROM "Budget"%FOR UPDATE%'`;
      if (Number(rows[0].count) >= n) return;
      await delay(20);
    }
    assert.fail(`no llegaron ${n} operaciones al candado de Budget`);
  }
  async function queuedRace(budgetId: string, first: () => Promise<Response>, second: () => Promise<Response>) {
    let unlock!: () => void, ready!: () => void;
    const released = new Promise<void>((r) => { unlock = r; });
    const locked = new Promise<void>((r) => { ready = r; });
    const blocker = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${budgetId} FOR UPDATE`;
      ready(); await released;
    }, { timeout: 15_000 });
    await locked;
    let a!: Promise<Response>, b!: Promise<Response>;
    try { a = first(); await waitForBlocked(1); b = second(); await waitForBlocked(2); }
    finally { unlock(); await blocker; }
    return Promise.all([a, b]);
  }
  try {
    await t.test("botón y tablero producen la misma evidencia, evento confirmado y seña/saldo", async () => {
      for (const trigger of [approve, (budgetId: string) => move(budgetId, "APPROVED")]) {
        const budget = await fixture();
        const response = await trigger(budget.id);
        assert.equal(response.status, 200, await response.clone().text());
        await expectApproved(budget.id);
      }
    });
    await t.test("aprobaciones simultáneas no duplican evento/plan ni cambian la evidencia original", async () => {
      const budget = await fixture();
      const responses = await Promise.all([approve(budget.id), move(budget.id, "APPROVED"), approve(budget.id)]);
      for (const r of responses) assert.equal(r.status, 200, await r.clone().text());
      const original = await expectApproved(budget.id);
      const retry = await applyManualBudgetDecision({ ...context, user: { ...context.user, name: "Otro operador" } }, { budgetId: budget.id, decision: "approve", note: "No debe pisar" });
      assert.equal(retry.status, 200);
      const after = await expectApproved(budget.id);
      assert.equal(after.approvedAt?.getTime(), original.approvedAt?.getTime());
      assert.equal(after.approvalNote, original.approvalNote);
      assert.equal(after.eventId, original.eventId);
      assert.equal(await db.event.count({ where: { organizationId: id, budgets: { some: { id: budget.id } } } }), 1);
      assert.equal(await db.auditLog.count({ where: { organizationId: id, entityId: budget.id, summary: { startsWith: "Aprobó manualmente" } } }), 1);
    });
    await t.test("LOST/CANCELLED no se aprueban ni piden cambios desde una pestaña vieja", async () => {
      for (const status of ["LOST", "CANCELLED"] as const) {
        const budget = await fixture({ status });
        for (const trigger of [approve, (budgetId: string) => move(budgetId, "APPROVED"), (budgetId: string) => applyManualBudgetDecision(context, { budgetId, decision: "request_revision", note: "Vieja pestaña" })]) {
          assert.equal((await trigger(budget.id)).status, 409);
        }
        const after = await saved(budget.id);
        assert.equal(after.status, status); assert.equal(after.approvedAt, null); assert.equal(after.eventId, null); assert.equal(after.expectedPayments.length, 0);
      }
    });
    await t.test("aprobación gana a revisión y a arrastre: ningún aceptado vuelve a negociación", async () => {
      for (const second of [(budgetId: string) => applyManualBudgetDecision(context, { budgetId, decision: "request_revision", note: "Cambios concurrentes" }), (budgetId: string) => move(budgetId, "NEGOTIATING")]) {
        const budget = await fixture();
        const results = await queuedRace(budget.id, () => approve(budget.id), () => second(budget.id));
        assert.deepEqual(results.map((r) => r.status), [200, 409]);
        const after = await expectApproved(budget.id); assert.equal(after.revisionRequestedAt, null);
      }
    });
    await t.test("cierre gana a aprobación: ni evento ni pagos ni evidencia huérfana", async () => {
      const budget = await fixture();
      const results = await queuedRace(budget.id, () => move(budget.id, "CANCELLED"), () => approve(budget.id));
      assert.deepEqual(results.map((r) => r.status), [200, 409]);
      const after = await saved(budget.id);
      assert.equal(after.status, "CANCELLED"); assert.equal(after.approvedAt, null); assert.equal(after.eventId, null); assert.equal(after.expectedPayments.length, 0);
    });
    await t.test("falta precio bloquea botón y tablero sin escrituras comerciales", async () => {
      const budget = await fixture();
      await db.budgetItem.updateMany({ where: { budgetId: budget.id }, data: { unitPrice: 0, subtotal: 0 } });
      for (const trigger of [approve, (budgetId: string) => move(budgetId, "APPROVED")]) {
        assert.equal((await trigger(budget.id)).status, 409);
      }
      const after = await saved(budget.id); assert.equal(after.approvedAt, null); assert.equal(after.eventId, null); assert.equal(after.expectedPayments.length, 0);
    });
    await t.test("faltante de stock bloquea FINANCE y no deja reservas huérfanas", async () => {
      const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: "Único proyector", category: "QA", quantity: 0 } });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, name: "Evento sin stock", status: "DRAFT", startsAt: new Date("2034-01-01T12:00:00Z"), endsAt: new Date("2034-01-02T12:00:00Z") } });
      const budget = await fixture({ eventId: event.id });
      await db.budgetItem.updateMany({ where: { budgetId: budget.id }, data: { inventoryId: item.id } });
      assert.equal((await approve(budget.id)).status, 409);
      assert.equal((await move(budget.id, "APPROVED")).status, 409);
      assert.equal((await applyManualBudgetDecision(context, { budgetId: budget.id, decision: "approve", force: true })).status, 403);
      const after = await saved(budget.id); assert.equal(after.approvedAt, null); assert.equal(after.expectedPayments.length, 0);
      assert.equal(await db.eventInventory.count({ where: { eventId: event.id } }), 0);
    });
    await t.test("firma aceptada frena revisión y cambios de estado aunque no haya approvedAt", async () => {
      for (const status of ["SIGNED", "VALIDATED"] as const) {
        const budget = await fixture();
        await db.signatureRequest.create({ data: { id: randomUUID(), organizationId: id, budgetId: budget.id, publicCode: randomUUID(), title: "Firma QA", senderName: "Equipo QA", recipientName: "Cliente QA", status, expiresAt: new Date("2034-01-01"), documentHash: "qa", documentHashCapturedAt: new Date() } });
        assert.equal((await applyManualBudgetDecision(context, { budgetId: budget.id, decision: "request_revision", note: "Cambiar condiciones firmadas" })).status, 409);
        assert.equal((await move(budget.id, "NEGOTIATING")).status, 409);
        const after = await saved(budget.id); assert.equal(after.status, "SENT"); assert.equal(after.revisionRequestedAt, null);
      }
    });
    await t.test("precio cambiado mientras approval espera el candado se revalida antes de aceptar", async () => {
      const budget = await fixture();
      let unlock!: () => void, ready!: () => void;
      const released = new Promise<void>((r) => { unlock = r; });
      const locked = new Promise<void>((r) => { ready = r; });
      const blocker = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${budget.id} FOR UPDATE`;
        ready(); await released;
        await tx.budgetItem.updateMany({ where: { budgetId: budget.id }, data: { unitPrice: 0 } });
      }, { timeout: 15_000 });
      await locked;
      const approval = approve(budget.id);
      try { await waitForBlocked(1); } finally { unlock(); await blocker; }
      assert.equal((await approval).status, 409);
      const after = await saved(budget.id); assert.equal(after.approvedAt, null); assert.equal(after.eventId, null); assert.equal(after.expectedPayments.length, 0);
    });
    await t.test("tenant ajeno y papelera no reciben decisiones ni estados nuevos", async () => {
      const budget = await fixture();
      const foreign = { ...context, organizationId: randomUUID() };
      assert.equal((await applyManualBudgetDecision(foreign, { budgetId: budget.id, decision: "approve" })).status, 404);
      assert.equal((await setBudgetCommercialStatus(foreign, { budgetId: budget.id, status: "NEGOTIATING" })).status, 404);
      await db.budget.update({ where: { id: budget.id }, data: { deletedAt: new Date() } });
      assert.equal((await approve(budget.id)).status, 404);
      assert.equal((await move(budget.id, "NEGOTIATING")).status, 404);
    });
  } finally {
    await db.organization.delete({ where: { id } });
    await db.$disconnect();
  }
});
