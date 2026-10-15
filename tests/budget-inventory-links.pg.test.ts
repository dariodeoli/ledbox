import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import type { AdminContext } from "../lib/server/tenancy";

const base = process.env.BUDGET_LINK_TEST_BASE_URL;
const httpEnabled = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base));

test("vínculos y preflight: documento aceptado inmutable y stock de la versión exacta", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const { applyManualBudgetDecision } = await import("../lib/server/budget-approval");
  const { lockInventoryItems } = await import("../lib/server/inventory-availability");
  const { commitComboAssignment, substituteComboComponent } = await import("../lib/server/inventory-combos");
  const id = randomUUID();
  const organization = await db.organization.create({ data: { id, name: "QA vínculos seguros", slug: `qa-vinculos-${id}` } });
  const user = await db.adminUser.create({ data: { id: randomUUID(), name: "Operadora QA", email: `${id}@example.invalid`, role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
  await db.adminMembership.create({ data: { id: randomUUID(), organizationId: id, adminUserId: user.id, role: "OWNER" } });
  const auth = await createSession(user, id);
  const session = await db.adminSession.findUniqueOrThrow({ where: { id: auth.sessionId } });
  const context: AdminContext = { user, session, organization, organizationId: id, role: "OWNER", demo: false, sandbox: false };
  const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: "Cliente QA" } });
  const a = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: "Equipo disponible", category: "QA", quantity: 1 } });
  const b = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: "Equipo agotado", category: "QA", quantity: 0 } });
  let serial = 0;
  async function fixture() {
    serial += 3;
    const startsAt = new Date(Date.UTC(2038, 0, serial, 12)), endsAt = new Date(Date.UTC(2038, 0, serial + 1, 12));
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, name: "Producción QA", status: "DRAFT", startsAt, endsAt } });
    return db.budget.create({ data: { id: randomUUID(), organizationId: id, clientId: client.id, eventId: event.id, title: "Presupuesto QA", status: "SENT", subtotal: 100, total: 100, items: { create: { id: randomUUID(), name: "Equipo", quantity: 1, days: 1, unitPrice: 100, subtotal: 100, inventoryId: a.id } } }, include: { items: true, event: true } });
  }
  const approve = (budgetId: string) => applyManualBudgetDecision(context, { budgetId, decision: "approve" });
  const read = (budgetId: string) => db.budget.findUniqueOrThrow({ where: { id: budgetId }, include: { items: true, expectedPayments: true, event: { include: { assignments: true } } } });
  const patch = (budgetId: string, itemId: string, inventoryId: string | null) => fetch(`${base}/api/admin/budgets`, { method: "PATCH", headers: { Cookie: `ledbox_session=${auth.jwt}`, "Content-Type": "application/json" }, body: JSON.stringify({ budgetId, kind: "item-link", itemId, inventoryId }) });
  async function waitBlocked(queryFragment: string) {
    for (let i = 0; i < 200; i++) {
      const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE ${`%${queryFragment}%`} AND query LIKE '%FOR UPDATE%'`;
      if (Number(rows[0].count)) return;
      await delay(15);
    }
    assert.fail(`la operación no llegó al lock de ${queryFragment}`);
  }
  // Pausar el motor de stock por su lock real deja editar la versión antes de
  // la transacción de aprobación, sin fabricar un orden Budget → Event inverso.
  async function duringPreflight(budgetId: string, mutate: (tx: Prisma.TransactionClient) => Promise<unknown>, extraIds: string[] = []) {
    let unlock!: () => void, ready!: () => void;
    const release = new Promise<void>((r) => { unlock = r; }), locked = new Promise<void>((r) => { ready = r; });
    const block = db.$transaction(async (tx) => {
      await lockInventoryItems(tx, id, [a.id, ...extraIds]);
      ready(); await release; await mutate(tx);
    }, { timeout: 15_000 });
    await locked;
    const pending = approve(budgetId);
    try { await waitBlocked('FROM "InventoryItem"'); } finally { unlock(); await block; }
    return pending;
  }
  const expectStale = async (budgetId: string, response: Response, selectionInvalid = false) => {
    assert.equal(response.status, 409, await response.clone().text());
    const body = await response.json();
    if (selectionInvalid) assert.match(body.error, /al menos un producto o servicio/);
    else assert.equal(body.code, "approval_stale");
    const after = await read(budgetId);
    assert.equal(after.status, "SENT"); assert.equal(after.approvedAt, null); assert.equal(after.expectedPayments.length, 0);
    assert.equal(after.event?.assignments.length, 0, "sin reserva huérfana del preflight anterior");
    assert.equal(after.event?.status, "DRAFT");
  };
  try {
    await t.test("HTTP: aprobado conserva vínculo y reserva originales; edición responde409", { skip: !httpEnabled }, async () => {
      const q = await fixture(); assert.equal((await approve(q.id)).status, 200);
      assert.equal((await patch(q.id, q.items[0].id, b.id)).status, 409);
      const after = await read(q.id);
      assert.equal(after.items[0].inventoryId, a.id);
      assert.deepEqual(after.event?.assignments.map((row) => row.inventoryId), [a.id]);
    });
    await t.test("HTTP: firmas aceptadas y cerrados bloquean cambios, incluidos quitar vínculo", { skip: !httpEnabled }, async () => {
      for (const status of ["SIGNED", "VALIDATED"] as const) {
        const q = await fixture();
        await db.signatureRequest.create({ data: { id: randomUUID(), organizationId: id, budgetId: q.id, publicCode: randomUUID(), title: "Firma QA", senderName: user.name, recipientName: client.name, status, expiresAt: new Date("2040-01-01"), documentHash: "qa", documentHashCapturedAt: new Date() } });
        assert.equal((await patch(q.id, q.items[0].id, null)).status, 409);
        assert.equal((await read(q.id)).items[0].inventoryId, a.id);
      }
      const closed = await fixture(); await db.budget.update({ where: { id: closed.id }, data: { status: "CANCELLED" } });
      assert.equal((await patch(closed.id, closed.items[0].id, b.id)).status, 409);
    });
    await t.test("HTTP: vínculo editable toca revisión y valida inventario vivo/tenant dentrotx", { skip: !httpEnabled }, async () => {
      const q = await fixture();
      await db.budget.update({ where: { id: q.id }, data: { updatedAt: new Date("2020-01-01") } });
      const response = await patch(q.id, q.items[0].id, b.id);
      assert.equal(response.status, 200, await response.clone().text());
      const after = await read(q.id); assert.equal(after.items[0].inventoryId, b.id); assert.ok(after.updatedAt > new Date("2020-01-01"));
      const removed = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: "Eliminado", category: "QA", deletedAt: new Date() } });
      assert.equal((await patch(q.id, q.items[0].id, removed.id)).status, 404);
      assert.equal((await patch(q.id, q.items[0].id, randomUUID())).status, 404);
      const foreignId = randomUUID();
      await db.organization.create({ data: { id: foreignId, name: "Otro tenant QA", slug: `qa-foreign-${foreignId}` } });
      try {
        const foreignItem = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: foreignId, name: "Ajeno", category: "QA" } });
        assert.equal((await patch(q.id, q.items[0].id, foreignItem.id)).status, 404);
      } finally { await db.organization.delete({ where: { id: foreignId } }); }
      const otherBudget = await fixture();
      assert.equal((await patch(q.id, otherBudget.items[0].id, a.id)).status, 404);
      const list = await fetch(`${base}/api/admin/budgets`, { headers: { Cookie: `ledbox_session=${auth.jwt}` } });
      assert.equal(list.status, 200);
      const payload = await list.json();
      assert.ok(payload.budgets.some((row: { inventoryLinksLocked?: boolean }) => row.inventoryLinksLocked), "la UI conoce la firma aceptada aunque approvedAt esté vacío");
    });
    await t.test("vínculo cambiado durante gate no aprueba stock distinto y libera reserva vieja", async () => {
      const q = await fixture();
      const response = await duringPreflight(q.id, async (tx) => {
        await tx.budgetItem.update({ where: { id: q.items[0].id }, data: { inventoryId: b.id } });
        await tx.budget.update({ where: { id: q.id }, data: { updatedAt: new Date() } });
      });
      await expectStale(q.id, response);
      assert.equal((await read(q.id)).items[0].inventoryId, b.id);
    });
    await t.test("cantidad, días y exclusión cambiados durante gate invalidan la versión", async () => {
      for (const data of [{ quantity: 2 }, { days: 3 }, { excluded: true }]) {
        const q = await fixture();
        const response = await duringPreflight(q.id, (tx) => tx.budgetItem.update({ where: { id: q.items[0].id }, data }));
        await expectStale(q.id, response, "excluded" in data);
      }
    });
    await t.test("fechas del evento cambiadas durante gate impiden aprobar el rango anterior", async () => {
      const q = await fixture();
      const response = await duringPreflight(q.id, (tx) => tx.event.update({ where: { id: q.eventId! }, data: { startsAt: new Date("2039-01-01T12:00:00Z"), endsAt: new Date("2039-01-02T12:00:00Z") } }));
      await expectStale(q.id, response);
    });
    await t.test("componentes del combo cambiados durante gate invalidan stock anterior", async () => {
      const part = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: "Pieza QA", category: "QA", quantity: 10 } });
      await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: id, parentId: a.id, componentId: part.id, quantity: 1 } });
      const q = await fixture();
      const response = await duringPreflight(q.id, (tx) => tx.inventoryComponent.updateMany({ where: { parentId: a.id }, data: { quantity: 2 } }));
      await expectStale(q.id, response);
      await db.inventoryComponent.deleteMany({ where: { parentId: a.id } });
    });
    await t.test("asociación a otro evento durante gate se rechaza sin tomar lock en orden inverso", async () => {
      const q = await fixture(), other = await fixture();
      const response = await duringPreflight(q.id, (tx) => tx.budget.update({ where: { id: q.id }, data: { eventId: other.eventId } }));
      await expectStale(q.id, response);
      assert.equal(await db.eventInventory.count({ where: { eventId: q.eventId! } }), 0);
    });
    await t.test("Event queda bloqueado hasta commit de aprobación: no cambia entre fingerprint y escritura", async () => {
      const q = await fixture();
      let unlock!: () => void, ready!: () => void;
      const release = new Promise<void>((r) => { unlock = r; }), locked = new Promise<void>((r) => { ready = r; });
      const block = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id"=${q.id} FOR UPDATE`;
        ready(); await release;
      }, { timeout: 15_000 });
      await locked;
      const pending = approve(q.id);
      let edit!: Promise<boolean>;
      try {
        await waitBlocked('FROM "Budget"');
        edit = db.$transaction(async (tx) => {
          await tx.event.update({ where: { id: q.eventId! }, data: { endsAt: new Date("2039-02-03T12:00:00Z") } });
          return Boolean((await tx.budget.findUniqueOrThrow({ where: { id: q.id } })).approvedAt);
        });
        let queued = false;
        for (let i = 0; i < 200; i++) {
          const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%UPDATE%Event%'`;
          if (Number(rows[0].count)) { queued = true; break; }
          await delay(15);
        }
        assert.ok(queued, "la edición de fechas esperó el lock Event que protege la aprobación");
      } finally { unlock(); await block; }
      assert.equal((await pending).status, 200);
      assert.equal(await edit, true, "la fecha sólo se editó después de commit de approvedAt");
      await db.eventInventory.deleteMany({ where: { eventId: q.eventId! } });
    });
    await t.test("stock de una pieza cambiado entre snapshot y gate invalida la versión del combo", async () => {
      const part = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: "Pieza snapshot", category: "QA", quantity: 1 } });
      await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: id, parentId: a.id, componentId: part.id, quantity: 1 } });
      const q = await fixture();
      const response = await duringPreflight(q.id, (tx) => tx.inventoryItem.update({ where: { id: part.id }, data: { quantity: 2 } }), [part.id]);
      await expectStale(q.id, response);
      await db.inventoryComponent.deleteMany({ where: { parentId: a.id } });
    });
    await t.test("piezas originales y sustitutos quedan bloqueados hasta commit de aprobación", async () => {
      const part = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: "Pieza original", category: "QA", quantity: 1 } });
      const substitute = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: id, name: "Sustituto autorizado", category: "QA", quantity: 1 } });
      await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: id, parentId: a.id, componentId: part.id, quantity: 1 } });
      const q = await fixture();
      assert.equal((await commitComboAssignment({ organizationId: id, eventId: q.eventId!, inventoryId: a.id, quantity: 1, budgetId: q.id })).ok, true);
      const comboRow = await db.eventInventory.findUniqueOrThrow({ where: { eventId_inventoryId: { eventId: q.eventId!, inventoryId: a.id } } });
      assert.equal((await substituteComboComponent({ organizationId: id, assignmentId: comboRow.id, componentId: part.id, substituteId: substitute.id })).ok, true);
      let unlock!: () => void, ready!: () => void;
      const release = new Promise<void>((r) => { unlock = r; }), locked = new Promise<void>((r) => { ready = r; });
      const block = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id"=${q.id} FOR UPDATE`;
        ready(); await release;
      }, { timeout: 15_000 });
      await locked;
      const pending = approve(q.id);
      const retirements: Promise<boolean>[] = [];
      try {
        await waitBlocked('FROM "Budget"');
        for (const inventoryId of [part.id, substitute.id]) retirements.push(db.$transaction(async (tx) => {
          await lockInventoryItems(tx, id, [inventoryId]);
          await tx.inventoryItem.update({ where: { id: inventoryId }, data: { quantity: 0, status: "RETIRED" } });
          return Boolean((await tx.budget.findUniqueOrThrow({ where: { id: q.id } })).approvedAt);
        }));
        let queued = false;
        for (let i = 0; i < 200; i++) {
          const rows = await db.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM "InventoryItem"%FOR UPDATE%'`;
          if (Number(rows[0].count) >= 2) { queued = true; break; }
          await delay(15);
        }
        assert.ok(queued, "retiros de la pieza y sustituto esperaron los locks de aprobación");
      } finally { unlock(); await block; }
      assert.equal((await pending).status, 200);
      assert.deepEqual(await Promise.all(retirements), [true, true], "ninguna pieza cambió entre verificación final y commit");
      await db.eventInventory.deleteMany({ where: { eventId: q.eventId! } });
      await db.inventoryComponent.deleteMany({ where: { parentId: a.id } });
    });
    await t.test("FK de un editor con Budget no se cruza con locks de aprobación", async () => {
      const q = await fixture();
      let unlock!: () => void, ready!: () => void;
      const release = new Promise<void>((r) => { unlock = r; }), locked = new Promise<void>((r) => { ready = r; });
      const editor = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id"=${q.id} FOR UPDATE`;
        ready(); await release;
        // INSERT comprueba FK con KEY SHARE sobre InventoryItem: debe poder
        // terminar aunque la aprobación retenga NO KEY UPDATE y espere Budget.
        await tx.budgetItem.create({ data: { id: randomUUID(), budgetId: q.id, inventoryId: a.id, name: "Línea nueva", quantity: 1, days: 1, unitPrice: 100, subtotal: 100 } });
        await tx.budget.update({ where: { id: q.id }, data: { subtotal: 200, total: 200 } });
      }, { timeout: 15_000 });
      await locked;
      const pending = approve(q.id);
      try { await waitBlocked('FROM "Budget"'); } finally { unlock(); await editor; }
      await expectStale(q.id, await pending);
      assert.equal((await read(q.id)).items.length, 2, "la edición legítima se guardó sin deadlock");
    });
    await t.test("dos aprobaciones válidas preservan ganador, evento, evidencia y reserva", async () => {
      const q = await fixture();
      const responses = await Promise.all([approve(q.id), approve(q.id)]);
      for (const response of responses) assert.equal(response.status, 200, await response.clone().text());
      const after = await read(q.id); assert.equal(after.status, "APPROVED"); assert.ok(after.approvedAt);
      assert.equal(after.event?.assignments.length, 1); assert.equal(after.event?.assignments[0].inventoryId, a.id);
      assert.equal(after.expectedPayments.length, 1);
      assert.equal(await db.auditLog.count({ where: { organizationId: id, entityId: q.id, summary: { startsWith: "Aprobó manualmente" } } }), 1);
    });
  } finally {
    await db.adminSession.deleteMany({ where: { userId: user.id } });
    await db.organization.delete({ where: { id } });
    await db.adminUser.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
