import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_HTTP_BASE_URL);
test("reprogramar y reabrir eventos conserva disponibilidad y fechas válidas", { skip: !enabled }, async (t) => {
  const database = new URL(process.env.TEST_DATABASE_URL!);
  const base = new URL(process.env.TEST_HTTP_BASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
  process.env.DATABASE_URL = database.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const { commitInventoryAssignment, availabilityForRange } = await import("../lib/server/inventory-availability");
  const org = randomUUID(), userId = randomUUID();
  const at = (day: number) => new Date(Date.UTC(2033, 4, day, 12));
  try {
    await db.organization.create({ data: { id: org, name: "Operación reprogramación QA", slug: `reschedule-${org}` } });
    const user = await db.adminUser.create({ data: { id: userId, email: `${userId}@example.invalid`, name: "Operador QA", passwordHash: "fixture", role: "OPERATIONS", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), organizationId: org, adminUserId: userId, role: "OPERATIONS" } });
    const cookie = `ledbox_session=${(await createSession(user, org)).jwt}`;
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente ficticio" } });
    const patch = async (id: string, data: Record<string, unknown>) => {
      const r = await fetch(new URL("/api/admin/events", base), { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ id, ...data }) });
      const text = await r.text(); assert.match(r.headers.get("content-type") ?? "", /json/, `${r.status}: ${text.slice(0,200)}`);
      return { status: r.status, data: JSON.parse(text) };
    };
    const pair = async () => {
      const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Sillas de ceremonia", category: "Sillas", quantity: 10 } });
      const a = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Boda A", status: "CONFIRMED", startsAt: at(10), endsAt: at(11) } });
      const b = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Boda B", status: "CONFIRMED", startsAt: at(20), endsAt: at(21) } });
      for (const event of [a,b]) assert.ok((await commitInventoryAssignment({ organizationId: org, inventoryId: item.id, eventId: event.id, quantity: 10 })).ok);
      return { item, a, b };
    };
    await t.test("mover una reserva heredada sobre otro evento se rechaza sin cambiar fechas", async () => {
      const { a } = await pair();
      const r = await patch(a.id, { startsAt: at(20).toISOString(), endsAt: at(21).toISOString() });
      assert.equal(r.status, 409, JSON.stringify(r.data));
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: a.id } })).startsAt!.toISOString(), at(10).toISOString());
    });
    await t.test("una cancelación libera la reserva; reabrir con stock ocupado se rechaza", async () => {
      const { item, a } = await pair();
      assert.equal((await patch(a.id, { status: "CANCELLED" })).status, 200);
      const c = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Boda C", status: "CONFIRMED", startsAt: at(10), endsAt: at(11) } });
      assert.ok((await commitInventoryAssignment({ organizationId: org, inventoryId: item.id, eventId: c.id, quantity: 10 })).ok);
      const r = await patch(a.id, { status: "CONFIRMED" });
      assert.equal(r.status, 409, JSON.stringify(r.data));
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: a.id } })).status, "CANCELLED");
    });
    await t.test("reprogramar a fecha libre conserva reserva y actualiza su rango heredado", async () => {
      const { item, a } = await pair();
      assert.equal((await patch(a.id, { startsAt: at(25).toISOString(), endsAt: at(26).toISOString() })).status, 200);
      assert.equal((await availabilityForRange({ organizationId: org, item: { ...item, maintenance: 0 }, startsAt: at(25), endsAt: at(26) })).available, 0);
    });
    await t.test("rangos propios independientes no se mueven con el evento", async () => {
      const { item, a } = await pair();
      await db.eventInventory.update({ where: { eventId_inventoryId: { eventId: a.id, inventoryId: item.id } }, data: { startsAt: at(10), endsAt: at(11) } });
      assert.equal((await patch(a.id, { startsAt: at(20).toISOString(), endsAt: at(21).toISOString() })).status, 200);
    });
    await t.test("reabrir sin conflicto recupera la reserva existente", async () => {
      const { a } = await pair();
      assert.equal((await patch(a.id, { status: "CANCELLED" })).status, 200);
      assert.equal((await patch(a.id, { status: "CONFIRMED" })).status, 200);
    });
    await t.test("dos ediciones parciales concurrentes no dejan inicio posterior al fin", async () => {
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Agenda simultánea", startsAt: at(10), endsAt: at(13) } });
      let release!: () => void, ready!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const locked = new Promise<void>(resolve => { ready = resolve; });
      const holder = db.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${event.id} FOR UPDATE`; ready(); await gate; }, { timeout: 20000 });
      await locked;
      const pending = [patch(event.id, { startsAt: at(12).toISOString() }), patch(event.id, { endsAt: at(11).toISOString() })];
      await new Promise(resolve => setTimeout(resolve, 300)); release(); await holder;
      assert.deepEqual((await Promise.all(pending)).map(r => r.status).sort(), [200, 409]);
      const fresh = await db.event.findUniqueOrThrow({ where: { id: event.id } });
      assert.ok(fresh.startsAt! <= fresh.endsAt!);
    });
    await t.test("la edición de un evento de otra empresa devuelve404", async () => {
      const foreignOrg = randomUUID();
      await db.organization.create({ data: { id: foreignOrg, name: "Ajena", slug: `foreign-${foreignOrg}` } });
      try {
        const foreignClient = await db.client.create({ data: { id: randomUUID(), organizationId: foreignOrg, name: "Ajeno" } });
        const event = await db.event.create({ data: { id: randomUUID(), organizationId: foreignOrg, clientId: foreignClient.id, name: "Evento ajeno", startsAt: at(10), endsAt: at(11) } });
        assert.equal((await patch(event.id, { startsAt: at(20).toISOString(), endsAt: at(21).toISOString() })).status, 404);
        assert.equal((await db.event.findUniqueOrThrow({ where: { id: event.id } })).startsAt!.toISOString(), at(10).toISOString());
      } finally { await dbWithDeleted.organization.delete({ where: { id: foreignOrg } }); }
    });
    await t.test("combo reprogramado valida las piezas y el sustituto real; rollback conserva todo", async () => {
      const { saveCombo, substituteComboComponent } = await import("../lib/server/inventory-combos");
      const { item: original, a, b } = await pair();
      await db.eventInventory.deleteMany({ where: { eventId: a.id } });
      const substitute = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Silla sustituta", category: "Sillas", quantity: 10 } });
      const saved = await saveCombo({ organizationId: org, data: { name: "Kit ceremonia", category: "Combos", sku: null }, components: [{ componentId: original.id, quantity: 10 }] });
      assert.ok(saved.ok, JSON.stringify(saved));
      const reservation = await commitInventoryAssignment({ organizationId: org, eventId: a.id, inventoryId: saved.combo.id, quantity: 1 });
      assert.ok(reservation.ok, JSON.stringify(reservation));
      assert.ok((await substituteComboComponent({ organizationId: org, assignmentId: reservation.assignment.id, componentId: original.id, substituteId: substitute.id })).ok);
      assert.ok((await commitInventoryAssignment({ organizationId: org, eventId: b.id, inventoryId: substitute.id, quantity: 10 })).ok);
      const before = await db.eventInventory.findMany({ where: { eventId: a.id }, orderBy: { id: "asc" } });
      assert.equal((await patch(a.id, { startsAt: at(20).toISOString(), endsAt: at(21).toISOString() })).status, 409);
      assert.deepEqual(await db.eventInventory.findMany({ where: { eventId: a.id }, orderBy: { id: "asc" } }), before);
      assert.equal((await patch(a.id, { startsAt: at(25).toISOString(), endsAt: at(26).toISOString() })).status, 200);
    });
    await t.test("los colchones del producto se respetan al reprogramar", async () => {
      const { item, a } = await pair();
      await db.inventoryItem.update({ where: { id: item.id }, data: { bufferAfterMin: 1440 } });
      assert.equal((await patch(a.id, { startsAt: at(18).toISOString(), endsAt: at(19).toISOString() })).status, 409);
    });
    await t.test("dos eventos que se mueven simultáneamente al último stock: sólo uno entra", async () => {
      const { a, b } = await pair();
      const results = await Promise.all([a,b].map(event => patch(event.id, { startsAt: at(25).toISOString(), endsAt: at(26).toISOString() })));
      assert.deepEqual(results.map(r => r.status).sort(), [200,409]);
    });
    await t.test("cierre bloqueado y forzado conservan motivo y auditoría", async () => {
      const { dispatchAssignment } = await import("../lib/server/inventory-operations");
      const { a, item } = await pair();
      const assignment = await db.eventInventory.findUniqueOrThrow({ where: { eventId_inventoryId: { eventId: a.id, inventoryId: item.id } } });
      assert.ok((await dispatchAssignment({ organizationId: org, assignmentId: assignment.id, at: at(10), condition: "Bueno", actorId: userId })).ok);
      assert.equal((await patch(a.id, { status: "COMPLETED" })).status, 409);
      assert.equal((await patch(a.id, { status: "COMPLETED", forceClose: true })).status, 400);
      assert.equal((await patch(a.id, { status: "COMPLETED", forceClose: true, forceCloseNote: "Historial previo migrado" })).status, 200);
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: a.id } })).status, "COMPLETED");
      const audit = await db.auditLog.findMany({ where: { organizationId: org, entityId: a.id } });
      assert.ok(audit.some(row => JSON.stringify(row.detail).includes("Historial previo migrado")));
    });
    await t.test("una asignación creada mientras se espera el evento exige reintentar sin locks incompletos", async () => {
      const { a } = await pair();
      const extra = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Atril añadido", category: "Sonido", quantity: 1 } });
      let ready!: () => void, release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const locked = new Promise<void>(resolve => { ready = resolve; });
      const holder = db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${extra.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${a.id} FOR UPDATE`;
        ready(); await gate;
        await tx.eventInventory.create({ data: { id: randomUUID(), organizationId: org, eventId: a.id, inventoryId: extra.id, quantity: 1 } });
      }, { timeout: 20000 });
      await locked;
      const pending = patch(a.id, { startsAt: at(25).toISOString(), endsAt: at(26).toISOString() });
      await new Promise(resolve => setTimeout(resolve, 300)); release(); await holder;
      const response = await pending;
      assert.equal(response.status, 409, JSON.stringify(response.data));
      assert.match(response.data.error, /reservas.*cambiaron/);
      assert.equal((await db.event.findUniqueOrThrow({ where: { id: a.id } })).startsAt!.toISOString(), at(10).toISOString());
    });
    await t.test("JSON nulo no causa500 en edición", async () => {
      const r = await fetch(new URL("/api/admin/events", base), { method: "PATCH", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "null" });
      assert.equal(r.status, 400);
    });
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: org } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await dbWithDeleted.$disconnect();
  }
});
