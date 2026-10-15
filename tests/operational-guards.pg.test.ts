import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Sin resets ni migraciones: crea y elimina exclusivamente sus propias empresas.
test("operación: retiros y altas concurrentes mantienen cantidad; nombre aceptado permanece inmutable", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const { lockInventoryItems } = await import("../lib/server/inventory-availability");
  const { createInventoryUnits, syncInventoryQuantity } = await import("../lib/server/inventory-units");
  const { guardEventNameChange } = await import("../lib/server/event-name");
  const { createEventForBudget } = await import("../lib/server/budget-event");
  const org = randomUUID(), other = randomUUID();
  try {
    await db.organization.createMany({ data: [org, other].map(id => ({ id, name: "Operación QA", slug: `ops-qa-${id}` })) });
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: `OPS${randomUUID().slice(0, 5)}`, category: "Equipos", quantity: 0 } });
    const run = <T>(fn: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<T>) => db.$transaction(fn, { timeout: 15000 });
    const active = async () => {
      const saved = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(saved.quantity, await db.inventoryUnit.count({ where: { inventoryId: item.id, status: { not: "RETIRED" } } }));
      return saved.quantity;
    };
    const add = () => run(tx => createInventoryUnits(tx, { organizationId: org, inventoryId: item.id, name: item.name, quantity: 1 }));
    const retire = (id: string) => run(async tx => {
      await lockInventoryItems(tx, org, [item.id]);
      await tx.inventoryUnit.update({ where: { id }, data: { status: "RETIRED" } });
      return syncInventoryQuantity(tx, item.id);
    });
    await t.test("dos retiros concurrentes; alta/retiro; compra/retiro", async () => {
      await Promise.all([add(), add()]);
      const units = await db.inventoryUnit.findMany({ where: { inventoryId: item.id } });
      await Promise.all(units.map(unit => retire(unit.id)));
      assert.equal(await active(), 0);
      for (let i = 0; i < 5; i++) {
        await add();
        const unit = await db.inventoryUnit.findFirstOrThrow({ where: { inventoryId: item.id, status: "AVAILABLE" } });
        await Promise.all([retire(unit.id), add()]);
        assert.equal(await active(), i + 1);
      }
    });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente QA" } });
    const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Evento original" } });
    const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, eventId: event.id, title: "Boda", total: 100, subtotal: 100 } });
    const rename = (name: string, originalName: string, organizationId = org) => run(async tx => {
      await guardEventNameChange(tx, organizationId, event.id, name, originalName);
      return tx.event.update({ where: { id: event.id }, data: { name } });
    });
    await t.test("renombre sin aceptación funciona; evita stale write y tenant ajeno", async () => {
      await rename("Nombre nuevo", "Evento original");
      await assert.rejects(rename("Stale", "Evento original"), /El evento cambió/);
      await assert.rejects(rename("Ajeno", "Nombre nuevo", other), /Evento no encontrado/);
    });
    await t.test("APPROVED y approvedAt bloquean nombre, no notas operativas", async () => {
      for (const data of [{ status: "APPROVED" as const, approvedAt: null }, { status: "SENT" as const, approvedAt: new Date() }]) {
        await db.budget.update({ where: { id: budget.id }, data });
        await assert.rejects(rename("No permitido", "Nombre nuevo"), /versión aceptada o firmada/);
      }
      await db.event.update({ where: { id: event.id }, data: { notes: "Montaje a las 10", status: "IN_PROGRESS" } });
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: event.id } })).name, "Nombre nuevo");
    });
    await t.test("SIGNED/VALIDATED bloquean aunque presupuesto no figure aprobado", async () => {
      await db.budget.update({ where: { id: budget.id }, data: { status: "SENT", approvedAt: null } });
      const signature = await db.signatureRequest.create({ data: { id: randomUUID(), organizationId: org, budgetId: budget.id, publicCode: randomUUID(), title: "Contrato", senderName: "QA", recipientName: "Cliente", expiresAt: new Date("2035-01-01"), documentHash: "qa", documentHashCapturedAt: new Date(), status: "SIGNED" } });
      for (const status of ["SIGNED", "VALIDATED"] as const) {
        await db.signatureRequest.update({ where: { id: signature.id }, data: { status } });
        await assert.rejects(rename("No permitido", "Nombre nuevo"), /versión aceptada o firmada/);
      }
    });
    await t.test("si una aprobación gana mientras renombre espera Budget, se revalida aceptación", async () => {
      await db.signatureRequest.deleteMany({ where: { budgetId: budget.id } });
      await db.budget.update({ where: { id: budget.id }, data: { status: "SENT", approvedAt: null } });
      let ready!: () => void, release!: () => void;
      const locked = new Promise<void>(r => { ready = r; });
      const gate = new Promise<void>(r => { release = r; });
      const approving = run(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Budget" WHERE "id" = ${budget.id} FOR UPDATE`;
        ready(); await gate;
        await tx.budget.update({ where: { id: budget.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      });
      await locked;
      const pending = rename("No permitido", "Nombre nuevo");
      const rejected = assert.rejects(pending, /versión aceptada o firmada/);
      await new Promise(r => setTimeout(r, 100));
      release(); await approving; await rejected;
    });
    await t.test("confirmación de borrador y guarda concurrentes no invierten Event/Budget", async () => {
      await db.budget.update({ where: { id: budget.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      await db.event.update({ where: { id: event.id }, data: { status: "DRAFT" } });
      const results = await Promise.allSettled([
        run(tx => createEventForBudget(tx, { organizationId: org, organization: { id: org, name: "QA", slug: "qa", planId: null } }, budget.id)),
        rename("No permitido", "Nombre nuevo"),
      ]);
      assert.equal(results[0].status, "fulfilled");
      assert.equal(results[1].status, "rejected");
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: event.id } })).status, "CONFIRMED");
    });
    await t.test("empresa de eventos: reserva, entrega, devolución parcial, faltante y cierre operativo", async () => {
      const { commitInventoryAssignment } = await import("../lib/server/inventory-availability");
      const ops = await import("../lib/server/inventory-operations");
      const startsAt = new Date("2034-05-10T12:00:00Z"), endsAt = new Date("2034-05-12T12:00:00Z");
      await db.event.update({ where: { id: event.id }, data: { startsAt, endsAt, status: "CONFIRMED" } });
      const assignment = await commitInventoryAssignment({ organizationId: org, eventId: event.id, inventoryId: item.id, quantity: 5, startsAt, endsAt });
      assert.ok(assignment.ok, JSON.stringify(assignment));
      const out = await ops.dispatchAssignment({ organizationId: org, assignmentId: assignment.assignment.id, at: startsAt, actorId: "qa", condition: "Bueno" });
      assert.ok(out.ok, JSON.stringify(out));
      const first = await ops.returnAssignment({ organizationId: org, assignmentId: assignment.assignment.id, at: endsAt, actorId: "qa", quantity: 3, condition: "Bueno" });
      assert.ok(first.ok && first.pending === 2 && !first.closed);
      assert.equal((await ops.eventClosureBlockers(org, event.id)).pendingReturns[0].pending, 2);
      const physical = await db.inventoryUnit.findFirstOrThrow({ where: { inventoryId: item.id, status: "AVAILABLE" } });
      const rest = await ops.returnAssignment({ organizationId: org, assignmentId: assignment.assignment.id, at: endsAt, actorId: "qa", quantity: 1, missing: 1, missingUnitIds: [physical.id], condition: "Bueno" });
      assert.ok(rest.ok && rest.closed && rest.pending === 0, JSON.stringify(rest));
      assert.equal((await ops.eventClosureBlockers(org, event.id)).openMissing.length, 1);
      assert.match(ops.closureBlockMessage(await ops.eventClosureBlockers(org, event.id))!, /faltantes abiertos/);
      assert.ok((await ops.transitionIncident({ organizationId: org, incidentId: rest.incidents[0].id, to: "WRITTEN_OFF" })).ok);
      assert.equal(ops.closureBlockMessage(await ops.eventClosureBlockers(org, event.id)), null);
      await db.event.update({ where: { id: event.id }, data: { status: "COMPLETED" } });
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: event.id } })).status, "COMPLETED");
      await active();
    });
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await dbWithDeleted.$disconnect();
  }
});
