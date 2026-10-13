import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/trash-ops.pg.test.ts
test("papelera E2: eventos y productos (archivar, eliminar, definitivo, bloqueos, disponibilidad) en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const ops = await import("../lib/server/trash-ops");
  const { TrashError } = await import("../lib/server/trash");
  const { roleCan } = await import("../lib/server/permissions");
  const availability = await import("../lib/server/inventory-availability");
  const combos = await import("../lib/server/inventory-combos");
  const catalog = await import("../lib/server/catalog-public");

  const orgs: string[] = [];
  async function seedOrg() {
    const org = randomUUID();
    orgs.push(org);
    const slug = `pe2-${org.slice(0, 8)}`;
    await db.organization.create({ data: { id: org, name: `Empresa ${slug}`, slug } });
    const ctx = { organizationId: org, user: { id: `u-${org.slice(0, 6)}`, name: "Admin", email: "a@test.dev", role: "ADMIN" as const } };
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente", email: "c@test.dev", phone: "0981" } });
    return { org, slug, ctx, client };
  }
  type Seed = Awaited<ReturnType<typeof seedOrg>>;
  const mkEvent = (a: Seed, extra: Record<string, unknown> = {}) =>
    db.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: a.client.id, name: "Gala Final", status: "COMPLETED", startsAt: new Date(Date.now() + 864e5), endsAt: new Date(Date.now() + 2 * 864e5), responsibleName: "Ana", venueContactPhone: "0981", notes: "n", ...extra } });
  const mkItem = (org: string, extra: Record<string, unknown> = {}) =>
    db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Pantalla P3", category: "LED", quantity: 3, ...extra } });
  const expectError = async (work: Promise<unknown>, status: number) => {
    let caught: unknown;
    await work.catch((error) => (caught = error));
    assert.ok(caught instanceof TrashError, `se esperaba TrashError ${status}, vino ${String(caught)}`);
    assert.equal((caught as InstanceType<typeof TrashError>).status, status);
    return caught as InstanceType<typeof TrashError>;
  };
  const range = { startsAt: new Date(Date.now() + 864e5), endsAt: new Date(Date.now() + 2 * 864e5) };

  try {
    await t.test("permisos: la papelera es solo de OWNER y ADMIN; archivar y eliminar usan la capacidad de escritura", () => {
      for (const role of ["OPERATIONS", "FINANCE", "VIEWER"] as const) assert.equal(roleCan(role, "trash.manage"), false, role);
      for (const role of ["OWNER", "ADMIN"] as const) assert.equal(roleCan(role, "trash.manage"), true, role);
      assert.equal(roleCan("VIEWER", "events.write"), false);
      assert.equal(ops.EVENT_ACTION_CAPABILITY.trash, "events.write");
      assert.equal(ops.EVENT_ACTION_CAPABILITY.purge, "trash.manage");
      assert.equal(ops.INVENTORY_ACTION_CAPABILITY.trash, "inventory.write");
      assert.equal(ops.INVENTORY_ACTION_CAPABILITY.restore, "trash.manage");
    });

    await t.test("evento: archivar solo COMPLETED/CANCELLED/DRAFT; eliminar activo da 409; CONFIRMED y con reservas no se elimina", async () => {
      const a = await seedOrg();
      const done = await mkEvent(a);
      await expectError(ops.trashEvent(done.id, null, a.ctx), 409); // activo
      const confirmed = await mkEvent(a, { status: "CONFIRMED" });
      await expectError(ops.archiveEvent(confirmed.id, a.ctx), 409);
      await ops.archiveEvent(done.id, a.ctx);
      await expectError(ops.archiveEvent(done.id, a.ctx), 409); // ya archivado
      await ops.unarchiveEvent(done.id, a.ctx);
      await ops.archiveEvent(done.id, a.ctx);

      // Pasa a CONFIRMED estando archivado: no se puede eliminar.
      await dbWithDeleted.event.update({ where: { id: done.id }, data: { status: "CONFIRMED" } });
      const blocked = await expectError(ops.trashEvent(done.id, null, a.ctx), 409);
      assert.equal(blocked.blockers?.[0].kind, "status");
      await dbWithDeleted.event.update({ where: { id: done.id }, data: { status: "COMPLETED" } });

      // Reserva sin liberar bloquea; liberada, no.
      const item = await mkItem(a.org);
      const asg = await db.eventInventory.create({ data: { id: randomUUID(), eventId: done.id, inventoryId: item.id, organizationId: a.org, quantity: 1, startsAt: range.startsAt, endsAt: range.endsAt } });
      const open = await expectError(ops.trashEvent(done.id, null, a.ctx), 409);
      assert.equal(open.blockers?.[0].kind, "assignments");
      await db.eventInventory.update({ where: { id: asg.id }, data: { releasedAt: new Date() } });
      await ops.trashEvent(done.id, "duplicado", a.ctx);
      assert.equal(await db.event.findFirst({ where: { id: done.id } }), null, "oculto de las listas");
      assert.equal((await dbWithDeleted.event.findUniqueOrThrow({ where: { id: done.id } })).deleteReason, "duplicado");
      await expectError(ops.trashEvent(done.id, null, a.ctx), 404);
      await expectError(ops.archiveEvent(done.id, a.ctx), 404);
    });

    await t.test("evento: un id eliminado no se puede vincular (asignación, tarea) y una asignación liberada no cuenta", async () => {
      const a = await seedOrg();
      const ev = await mkEvent(a);
      const item = await mkItem(a.org);
      await ops.archiveEvent(ev.id, a.ctx);
      await ops.trashEvent(ev.id, null, a.ctx);
      const result = await availability.commitInventoryAssignment({ organizationId: a.org, eventId: ev.id, inventoryId: item.id, quantity: 1 });
      assert.equal(result.ok, false);
      assert.equal((result as { reason: string }).reason, "event-missing");
    });

    await t.test("evento: restaurar vuelve a archivado, con auditoría; otra empresa recibe 404", async () => {
      const a = await seedOrg();
      const b = await seedOrg();
      const ev = await mkEvent(a);
      await ops.runEventAction("archive", ev.id, {}, a.ctx);
      await ops.runEventAction("trash", ev.id, { reason: "x" }, a.ctx);
      await expectError(ops.runEventAction("restore", ev.id, {}, b.ctx), 404);
      await expectError(ops.runEventAction("trash", ev.id, {}, b.ctx), 404);
      await expectError(ops.runEventAction("archive", ev.id, {}, b.ctx), 404);
      await expectError(ops.runEventAction("purge", ev.id, { confirmName: "Gala Final", reason: "r" }, b.ctx), 404);
      await ops.runEventAction("restore", ev.id, {}, a.ctx);
      const row = await db.event.findUniqueOrThrow({ where: { id: ev.id } });
      assert.ok(row.archivedAt);
      assert.equal(row.deletedAt, null);
      const actions = (await db.auditLog.findMany({ where: { organizationId: a.org, entityId: ev.id } })).map((r) => r.action).sort();
      assert.deepEqual(actions, ["archive", "restore", "trash"]);
    });

    await t.test("evento: purge valida nombre (400), motivo (400) y papelera (409); bloquea con cobros, facturas, gastos, trabajos e incidentes", async () => {
      const a = await seedOrg();
      const ev = await mkEvent(a);
      await expectError(ops.purgeEvent(ev.id, { confirmName: "Gala Final", reason: "r" }, a.ctx), 409); // no está en la papelera
      await ops.archiveEvent(ev.id, a.ctx);
      await ops.trashEvent(ev.id, null, a.ctx);
      await expectError(ops.purgeEvent(ev.id, { confirmName: "otro nombre", reason: "r" }, a.ctx), 400);
      await expectError(ops.purgeEvent(ev.id, { confirmName: "Gala Final", reason: "" }, a.ctx), 400);
      await expectError(ops.purgeEvent(ev.id, { confirmName: "Gala Final", reason: "x".repeat(201) }, a.ctx), 400);

      const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: a.org, clientId: a.client.id, eventId: ev.id, title: "P", status: "APPROVED", total: 1000 } });
      await db.clientPayment.create({ data: { id: randomUUID(), organizationId: a.org, clientId: a.client.id, budgetId: budget.id, amount: 500, method: "CASH", paidAt: new Date() } });
      await db.invoice.create({ data: { id: randomUUID(), organizationId: a.org, number: 1, clientName: "C", clientId: a.client.id, eventId: ev.id, issuedAt: new Date(), total: 1, createdByName: "t" } });
      const err = await expectError(ops.purgeEvent(ev.id, { confirmName: "  gala   FINAL ", reason: "limpieza" }, a.ctx), 409);
      const kinds = (err.blockers ?? []).map((b) => b.kind).sort();
      assert.deepEqual(kinds, ["invoices", "payments"]);
      assert.ok(await dbWithDeleted.event.findUnique({ where: { id: ev.id } }), "no se borró");
      assert.equal(await dbWithDeleted.clientPayment.count({ where: { organizationId: a.org } }), 1, "los cobros siguen");

      // Anonimizar: responsable, contacto del lugar y notas.
      await ops.anonymizeEvent(ev.id, { confirmName: "Gala Final", reason: "pedido del cliente" }, a.ctx);
      const anon = await dbWithDeleted.event.findUniqueOrThrow({ where: { id: ev.id } });
      assert.equal(anon.responsibleName, null);
      assert.equal(anon.venueContactPhone, null);
      assert.equal(anon.notes, null);
      assert.ok(anon.anonymizedAt);
      await expectError(ops.runEventAction("restore", ev.id, {}, a.ctx), 409);
    });

    await t.test("evento: purge sin bloqueos borra tareas y asignaciones liberadas; presupuestos DRAFT quedan sueltos; auditado", async () => {
      const a = await seedOrg();
      const ev = await mkEvent(a);
      const item = await mkItem(a.org);
      await db.eventTask.create({ data: { id: randomUUID(), eventId: ev.id, type: "SETUP", title: "t" } });
      await db.eventInventory.create({ data: { id: randomUUID(), eventId: ev.id, inventoryId: item.id, organizationId: a.org, quantity: 1, startsAt: range.startsAt, endsAt: range.endsAt, releasedAt: new Date() } });
      const draft = await db.budget.create({ data: { id: randomUUID(), organizationId: a.org, clientId: a.client.id, eventId: ev.id, title: "D", status: "DRAFT", total: 10 } });
      await ops.archiveEvent(ev.id, a.ctx);
      await ops.trashEvent(ev.id, null, a.ctx);
      await ops.purgeEvent(ev.id, { confirmName: "gala final", reason: "prueba" }, a.ctx);
      assert.equal(await dbWithDeleted.event.findUnique({ where: { id: ev.id } }), null);
      assert.equal(await dbWithDeleted.eventTask.count({ where: { eventId: ev.id } }), 0);
      assert.equal(await dbWithDeleted.eventInventory.count({ where: { eventId: ev.id } }), 0);
      assert.equal((await dbWithDeleted.budget.findUniqueOrThrow({ where: { id: draft.id } })).eventId, null);
      const purge = await db.auditLog.findFirst({ where: { organizationId: a.org, action: "purge", entityId: ev.id } });
      assert.ok(purge);
    });

    await t.test("producto: eliminar activo da 409; con asignación futura, incidente abierto o combo vivo se bloquea; libre se elimina", async () => {
      const a = await seedOrg();
      const item = await mkItem(a.org);
      await expectError(ops.trashInventoryItem(item.id, null, a.ctx), 409);
      const { archive } = await import("../lib/server/trash");
      await archive("InventoryItem", item.id, a.ctx);

      const ev = await mkEvent(a, { status: "CONFIRMED" });
      const asg = await db.eventInventory.create({ data: { id: randomUUID(), eventId: ev.id, inventoryId: item.id, organizationId: a.org, quantity: 1, startsAt: range.startsAt, endsAt: range.endsAt } });
      assert.equal((await expectError(ops.trashInventoryItem(item.id, null, a.ctx), 409)).blockers?.[0].kind, "assignments");
      await db.eventInventory.update({ where: { id: asg.id }, data: { releasedAt: new Date() } });

      const incident = await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: a.org, inventoryId: item.id, kind: "DAMAGE", quantity: 1 } as never });
      assert.equal((await expectError(ops.trashInventoryItem(item.id, null, a.ctx), 409)).blockers?.[0].kind, "incidents");
      await db.inventoryIncident.update({ where: { id: incident.id }, data: { status: "RESOLVED" } });

      const saved = await combos.saveCombo({ organizationId: a.org, data: { name: "Combo X", category: "Combos", sku: null }, components: [{ componentId: item.id, quantity: 1 }] });
      assert.equal(saved.ok, true);
      assert.equal((await expectError(ops.trashInventoryItem(item.id, null, a.ctx), 409)).blockers?.[0].kind, "usedInCombos");

      // Con el combo eliminado, el componente deja de estar bloqueado por él.
      const comboId = (saved as { combo: { id: string } }).combo.id;
      await archive("InventoryItem", comboId, a.ctx);
      await ops.trashInventoryItem(comboId, null, a.ctx);
      await ops.trashInventoryItem(item.id, "baja", a.ctx);
      assert.equal(await db.inventoryItem.findFirst({ where: { id: item.id } }), null);
    });

    await t.test("producto eliminado no aparece en listas, búsqueda, catálogo público, disponibilidad ni capacidad de combos", async () => {
      const a = await seedOrg();
      await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: a.org, publicCatalogEnabled: true, publicShowPrices: true } });
      const keep = await mkItem(a.org, { name: "Visible", visibleOnWeb: true, catalogAudience: "BOTH", listPrice: 1000 });
      const gone = await mkItem(a.org, { name: "Pantalla Borrada", visibleOnWeb: true, catalogAudience: "BOTH", listPrice: 1000 });
      const comp = await mkItem(a.org, { name: "Componente" });
      const saved = await combos.saveCombo({ organizationId: a.org, data: { name: "Combo Borrado", category: "Combos", sku: null }, components: [{ componentId: comp.id, quantity: 1 }] });
      const comboId = (saved as { combo: { id: string } }).combo.id;
      const { archive } = await import("../lib/server/trash");
      assert.ok((await combos.comboCapacitiesForRange({ organizationId: a.org, ...range })).has(comboId));
      for (const id of [gone.id, comboId]) {
        await archive("InventoryItem", id, a.ctx);
        await ops.trashInventoryItem(id, null, a.ctx);
      }
      assert.deepEqual((await db.inventoryItem.findMany({ where: { organizationId: a.org } })).map((r) => r.id).sort(), [keep.id, comp.id].sort());
      assert.equal((await db.inventoryItem.findMany({ where: { organizationId: a.org, name: { contains: "Borrad", mode: "insensitive" } } })).length, 0, "búsqueda");
      const context = await catalog.resolvePublicCatalog(a.slug);
      assert.ok(context);
      assert.deepEqual((await catalog.loadPublicCatalogItems(context!, null)).map((i: { name: string }) => i.name), ["Visible"]);
      const caps = await combos.comboCapacitiesForRange({ organizationId: a.org, ...range });
      assert.equal(caps.has(comboId), false, "capacidad de combos");
      assert.equal((await combos.loadComboDefinitions(a.org)).has(comboId), false);
      // Un evento eliminado deja de contar como comprometido.
      const where = availability.committedEventWhere(a.org);
      assert.equal((where as { deletedAt?: null }).deletedAt, null);
    });

    await t.test("producto: purge valida nombre (400), bloquea con asignaciones (409 blockers), libera SKU y deja snapshot en presupuestos", async () => {
      const a = await seedOrg();
      const { archive } = await import("../lib/server/trash");
      const item = await mkItem(a.org, { name: "Truss", sku: "TRS-1" });
      await expectError(ops.purgeInventoryItem(item.id, { confirmName: "Truss", reason: "r" }, a.ctx), 409); // no está en la papelera
      await archive("InventoryItem", item.id, a.ctx);
      await ops.trashInventoryItem(item.id, null, a.ctx);
      await expectError(ops.purgeInventoryItem(item.id, { confirmName: "equivocado", reason: "r" }, a.ctx), 400);

      // SKU ocupado por un producto de la papelera: aviso específico.
      assert.equal(await ops.skuConflictMessage(a.org, "TRS-1"), "Hay un producto con ese SKU en la papelera: restaurálo o eliminálo definitivamente");
      assert.match(await ops.skuConflictMessage(a.org, "OTRO"), /Ya hay un ítem con el SKU/);

      const ev = await mkEvent(a);
      await db.eventInventory.create({ data: { id: randomUUID(), eventId: ev.id, inventoryId: item.id, organizationId: a.org, quantity: 1, startsAt: range.startsAt, endsAt: range.endsAt, releasedAt: new Date() } });
      const err = await expectError(ops.purgeInventoryItem(item.id, { confirmName: "truss", reason: "r" }, a.ctx), 409);
      assert.deepEqual(err.blockers, [{ kind: "assignments", count: 1 }]);
      await dbWithDeleted.eventInventory.deleteMany({ where: { inventoryId: item.id } });

      const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: a.org, clientId: a.client.id, title: "B", status: "DRAFT", total: 10 } });
      const line = await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, inventoryId: item.id, name: "Truss", quantity: 1, unitPrice: 10, subtotal: 10 } });
      await ops.purgeInventoryItem(item.id, { confirmName: "Truss", reason: "baja definitiva" }, a.ctx);
      assert.equal(await dbWithDeleted.inventoryItem.findUnique({ where: { id: item.id } }), null);
      const kept = await dbWithDeleted.budgetItem.findUniqueOrThrow({ where: { id: line.id } });
      assert.equal(kept.inventoryId, null);
      assert.equal(kept.name, "Truss");
      const reused = await mkItem(a.org, { name: "Truss nuevo", sku: "TRS-1" });
      assert.ok(reused, "el SKU quedó libre");
      assert.ok(await db.auditLog.findFirst({ where: { organizationId: a.org, action: "purge", entityId: item.id } }));
    });

    await t.test("ia/anular: un producto en un combo o con incidentes da 409 (no 500) y no borra nada; uno libre se anula", async () => {
      const a = await seedOrg();
      const b = await seedOrg();
      const comp = await mkItem(a.org, { name: "En combo" });
      await combos.saveCombo({ organizationId: a.org, data: { name: "Combo", category: "Combos", sku: null }, components: [{ componentId: comp.id, quantity: 1 }] });
      const inCombo = await ops.annulInventoryItem(comp.id, "lote-1", a.ctx);
      assert.equal(inCombo.status, 409);
      assert.deepEqual((inCombo as { blockers: unknown }).blockers, [{ kind: "usedInCombos", count: 1 }]);
      const withIncident = await mkItem(a.org, { name: "Con incidente" });
      await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: a.org, inventoryId: withIncident.id, kind: "DAMAGE", quantity: 1 } as never });
      assert.equal((await ops.annulInventoryItem(withIncident.id, "", a.ctx)).status, 409);
      assert.equal(await dbWithDeleted.inventoryIncident.count({ where: { inventoryId: withIncident.id } }), 1, "el incidente no se borra en cascada");
      assert.equal((await ops.annulInventoryItem(comp.id, "", b.ctx)).status, 404, "otra empresa");
      const free = await mkItem(a.org, { name: "Libre" });
      assert.equal((await ops.annulInventoryItem(free.id, "", a.ctx)).status, 200);
      assert.equal(await dbWithDeleted.inventoryItem.findUnique({ where: { id: free.id } }), null);
    });

    await t.test("producto: otra empresa recibe 404 en eliminar, restaurar y purge", async () => {
      const a = await seedOrg();
      const b = await seedOrg();
      const { archive } = await import("../lib/server/trash");
      const item = await mkItem(a.org);
      await archive("InventoryItem", item.id, a.ctx);
      await ops.trashInventoryItem(item.id, null, a.ctx);
      for (const action of ["trash", "restore", "purge"]) await expectError(ops.runInventoryAction(action, item.id, { confirmName: "Pantalla P3", reason: "r" }, b.ctx), 404);
      await ops.runInventoryAction("restore", item.id, {}, a.ctx);
      const row = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
      assert.ok(row.archivedAt, "vuelve a archivado");
    });

    await t.test("listado de la papelera: tipo, nombre, quién, cuándo, motivo y bloqueos; acotado a la empresa", async () => {
      const a = await seedOrg();
      const b = await seedOrg();
      const { archive } = await import("../lib/server/trash");
      const ev = await mkEvent(a);
      await db.invoice.create({ data: { id: randomUUID(), organizationId: a.org, number: 7, clientName: "C", clientId: a.client.id, eventId: ev.id, issuedAt: new Date(), total: 1, createdByName: "t" } });
      await ops.archiveEvent(ev.id, a.ctx);
      await ops.trashEvent(ev.id, "viejo", a.ctx);
      const item = await mkItem(a.org, { name: "Eliminado P" });
      await archive("InventoryItem", item.id, a.ctx);
      await ops.trashInventoryItem(item.id, null, a.ctx);
      const other = await mkItem(b.org);
      await archive("InventoryItem", other.id, b.ctx);
      await ops.trashInventoryItem(other.id, null, b.ctx);
      const rows = await ops.listTrash(a.org);
      assert.deepEqual(rows.map((r) => `${r.type}:${r.name}`).sort(), ["Event:Gala Final", "InventoryItem:Eliminado P"]);
      const evRow = rows.find((r) => r.type === "Event")!;
      assert.equal(evRow.reason, "viejo");
      assert.equal(evRow.deletedById, a.ctx.user.id);
      assert.deepEqual(evRow.blockers, [{ kind: "invoices", count: 1 }]);
      assert.deepEqual(rows.find((r) => r.type === "InventoryItem")!.blockers, []);
    });
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: { in: orgs } } }).catch(() => undefined);
    await dbWithDeleted.$disconnect();
  }
});
