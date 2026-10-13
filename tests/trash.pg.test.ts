import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/trash.pg.test.ts
test("papelera: filtro de lo eliminado, archivar/eliminar/restaurar, bloqueos y anonimización en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const trashLib = await import("../lib/server/trash");
  const { live } = await import("../lib/server/trash-filter");
  const catalog = await import("../lib/server/catalog-public");
  const access = await import("../lib/server/catalog-access");
  const { anonymize, archive, assertLive, blockersFor, restore, trash, unarchive, TrashError } = trashLib;

  const orgs: string[] = [];
  async function seedOrg() {
    const org = randomUUID();
    orgs.push(org);
    const slug = `papelera-${org.slice(0, 8)}`;
    await db.organization.create({ data: { id: org, name: `Empresa ${slug}`, slug } });
    const ctx = { organizationId: org, user: { id: `u-${org.slice(0, 6)}`, name: "Admin", email: "a@test.dev", role: "ADMIN" as const } };
    return { org, slug, ctx };
  }
  const mkClient = (org: string, extra: Record<string, unknown> = {}) =>
    db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente Prueba", email: "c@test.dev", phone: "0981", ...extra } });
  const mkItem = (org: string, extra: Record<string, unknown> = {}) =>
    db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Pantalla", category: "LED", quantity: 3, ...extra } });
  const inTx = <T>(work: (tx: Parameters<Parameters<typeof dbWithDeleted.$transaction>[0]>[0]) => Promise<T>) => dbWithDeleted.$transaction(work);
  const expectError = async (work: Promise<unknown>, status: number) => {
    await assert.rejects(work, (error: unknown) => error instanceof TrashError && error.status === status, `se esperaba TrashError ${status}`);
  };

  try {
    await t.test("la migración aplicada otra vez no falla y el backfill no pisa lo archivado", async () => {
      const a = await seedOrg();
      const inactive = await mkClient(a.org, { active: false });
      const archivedAt = new Date("2026-01-02T03:04:05Z");
      const pre = await mkClient(a.org, { active: false, archivedAt });
      const file = new URL("../prisma/migrations/202610170001_trash_archive_delete/migration.sql", import.meta.url).pathname;
      for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
      assert.ok((await db.client.findUniqueOrThrow({ where: { id: inactive.id } })).archivedAt, "active=false con archivedAt nulo queda archivado");
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: pre.id } })).archivedAt?.toISOString(), archivedAt.toISOString(), "no pisa el archivedAt existente");
      const active = await mkClient(a.org);
      assert.equal(active.archivedAt, null);
    });

    await t.test("lo eliminado no aparece en findMany, count, aggregate, groupBy ni findUnique; dbWithDeleted sí lo ve", async () => {
      const a = await seedOrg();
      const keep = await mkItem(a.org, { name: "Visible" });
      const gone = await mkItem(a.org, { name: "Eliminado", archivedAt: new Date(), deletedAt: new Date() });
      assert.deepEqual((await db.inventoryItem.findMany({ where: { organizationId: a.org } })).map((r) => r.id), [keep.id]);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: a.org } }), 1);
      assert.equal((await db.inventoryItem.aggregate({ where: { organizationId: a.org }, _sum: { quantity: true } }))._sum.quantity, 3);
      const groups = await db.inventoryItem.groupBy({ by: ["category"], where: { organizationId: a.org }, _count: { _all: true } });
      assert.equal(groups[0]._count._all, 1);
      assert.equal(await db.inventoryItem.findFirst({ where: { id: gone.id } }), null);
      assert.equal(await db.inventoryItem.findUnique({ where: { id: gone.id } }), null);
      await assert.rejects(db.inventoryItem.findUniqueOrThrow({ where: { id: gone.id } }));
      await assert.rejects(db.inventoryItem.findFirstOrThrow({ where: { id: gone.id } }));
      assert.ok(await db.inventoryItem.findUnique({ where: { id: keep.id } }));
      assert.equal(await dbWithDeleted.inventoryItem.count({ where: { organizationId: a.org } }), 2);
      assert.ok(await dbWithDeleted.inventoryItem.findUnique({ where: { id: gone.id } }));
      // where explícito: se respeta (papelera ve lo eliminado a propósito).
      assert.equal(await db.inventoryItem.count({ where: { organizationId: a.org, deletedAt: { not: null } } }), 1);
      // Dentro de $transaction el cliente también filtra.
      const inside = await db.$transaction((tx) => tx.inventoryItem.count({ where: { organizationId: a.org } }));
      assert.equal(inside, 1);
      // Los modelos sin papelera no cambian.
      assert.equal(await db.organization.count({ where: { id: a.org } }), 1);
    });

    await t.test("filtra los 7 modelos y los include anidados usan live", async () => {
      const a = await seedOrg();
      const client = await mkClient(a.org);
      const goneClient = await mkClient(a.org, { archivedAt: new Date(), deletedAt: new Date() });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, name: "Evento" } });
      const goneEvent = await db.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, name: "Evento eliminado", archivedAt: new Date(), deletedAt: new Date() } });
      const gone = { archivedAt: new Date(), deletedAt: new Date() };
      await db.lead.create({ data: { id: randomUUID(), organizationId: a.org, name: "L", phone: "1", email: "l@t.dev", consentAt: new Date(), ...gone } });
      await db.supplier.create({ data: { id: randomUUID(), organizationId: a.org, name: "S", ...gone } });
      await db.promoter.create({ data: { id: randomUUID(), organizationId: a.org, name: "P", ...gone } });
      await db.budget.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, title: "B", ...gone } });
      for (const model of ["lead", "supplier", "promoter", "budget"] as const) {
        assert.equal(await (db[model] as unknown as { count(a: unknown): Promise<number> }).count({ where: { organizationId: a.org } }), 0, model);
      }
      assert.equal(await db.client.count({ where: { organizationId: a.org } }), 1);
      assert.ok(goneClient && goneEvent && event);
      const withKids = await db.client.findFirstOrThrow({ where: { id: client.id }, include: { events: { where: live }, budgets: { where: live }, _count: { select: { events: { where: live } } } } });
      assert.deepEqual(withKids.events.map((e) => e.id), [event.id]);
      assert.equal(withKids.budgets.length, 0);
      assert.equal(withKids._count.events, 1);
    });

    await t.test("eliminar sin archivar devuelve count 0 / 409; el ciclo archivar -> eliminar -> restaurar vuelve a archivado", async () => {
      const a = await seedOrg();
      const item = await mkItem(a.org);
      const direct = await dbWithDeleted.inventoryItem.updateMany({ where: { id: item.id, organizationId: a.org, archivedAt: { not: null }, deletedAt: null }, data: { deletedAt: new Date() } });
      assert.equal(direct.count, 0, "trash sin archivar previo no toca nada");
      await expectError(trash("InventoryItem", item.id, "x", a.ctx), 409);
      await archive("InventoryItem", item.id, a.ctx);
      await expectError(archive("InventoryItem", item.id, a.ctx), 409);
      await trash("InventoryItem", item.id, "  duplicado  ", a.ctx);
      const trashed = await dbWithDeleted.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
      assert.ok(trashed.deletedAt && trashed.archivedAt);
      assert.equal(trashed.deletedById, a.ctx.user.id);
      assert.equal(trashed.deleteReason, "duplicado");
      await expectError(trash("InventoryItem", item.id, null, a.ctx), 409);
      await expectError(assertLive("InventoryItem", item.id, a.org), 404);
      await restore("InventoryItem", item.id, a.ctx);
      const restored = await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(restored.deletedAt, null);
      assert.equal(restored.deleteReason, null);
      assert.ok(restored.archivedAt, "restaurar vuelve a ARCHIVADO");
      await expectError(restore("InventoryItem", item.id, a.ctx), 409);
      await unarchive("InventoryItem", item.id, a.ctx);
      assert.equal((await db.inventoryItem.findUniqueOrThrow({ where: { id: item.id } })).archivedAt, null);
      await assertLive("InventoryItem", item.id, a.org);
      // Auditoría de cada paso.
      const audits = await db.auditLog.findMany({ where: { organizationId: a.org, entityId: item.id }, select: { action: true } });
      assert.deepEqual(audits.map((r) => r.action).sort(), ["archive", "restore", "restore", "trash"]);
    });

    await t.test("multiempresa: un id ajeno responde 404/409 y no se toca", async () => {
      const a = await seedOrg();
      const b = await seedOrg();
      const foreign = await mkItem(b.org, { archivedAt: new Date() });
      await expectError(assertLive("InventoryItem", foreign.id, a.org), 404);
      await expectError(archive("InventoryItem", foreign.id, a.ctx), 404);
      await expectError(trash("InventoryItem", foreign.id, null, a.ctx), 409);
      await expectError(restore("InventoryItem", foreign.id, a.ctx), 404);
      await assert.rejects(inTx((tx) => blockersFor("InventoryItem", foreign.id, a.org, tx)), (e: unknown) => e instanceof TrashError && e.status === 404);
      assert.equal((await dbWithDeleted.inventoryItem.findUniqueOrThrow({ where: { id: foreign.id } })).deletedAt, null);
    });

    await t.test("blockersFor detecta cada FK con datos reales (y [] si no hay nada)", async () => {
      const a = await seedOrg();
      const blockers = (model: Parameters<typeof blockersFor>[0], id: string) => inTx((tx) => blockersFor(model, id, a.org, tx));

      // InventoryItem: asignación, incidente y combo.
      const client = await mkClient(a.org);
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, name: "Ev" } });
      const item = await mkItem(a.org);
      const combo = await mkItem(a.org, { name: "Combo" });
      assert.deepEqual(await blockers("InventoryItem", item.id), []);
      await db.eventInventory.create({ data: { id: randomUUID(), eventId: event.id, inventoryId: item.id, organizationId: a.org } });
      await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: a.org, inventoryId: item.id, kind: "DAMAGE", quantity: 1 } });
      await db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: a.org, parentId: combo.id, componentId: item.id, quantity: 1 } });
      assert.deepEqual(await blockers("InventoryItem", item.id), [{ kind: "assignments", count: 1 }, { kind: "incidents", count: 1 }, { kind: "usedInCombos", count: 1 }]);

      // Supplier: trabajo, gasto y factura de compra.
      const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: a.org, name: "Prov" } });
      assert.deepEqual(await blockers("Supplier", supplier.id), []);
      await db.supplierJob.create({ data: { id: randomUUID(), organizationId: a.org, supplierId: supplier.id, eventId: event.id, description: "Flete", total: 100_000 } });
      const account = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: a.org, name: "Caja" } });
      await db.expense.create({ data: { id: randomUUID(), organizationId: a.org, accountId: account.id, supplierId: supplier.id, eventId: event.id, date: new Date(), amount: 1000, description: "g", createdByName: "t" } });
      await db.purchaseInvoice.create({ data: { id: randomUUID(), organizationId: a.org, supplierId: supplier.id, date: new Date(), reason: "r", total: 1000, createdByName: "t" } });
      assert.deepEqual(await blockers("Supplier", supplier.id), [{ kind: "supplierJobs", count: 1 }, { kind: "expenses", count: 1 }, { kind: "purchaseInvoices", count: 1 }]);

      // Promoter: tarea.
      const promoter = await db.promoter.create({ data: { id: randomUUID(), organizationId: a.org, name: "Pro" } });
      assert.deepEqual(await blockers("Promoter", promoter.id), []);
      await db.eventTask.create({ data: { id: randomUUID(), eventId: event.id, promoterId: promoter.id, type: "EVENT", title: "T" } });
      assert.deepEqual(await blockers("Promoter", promoter.id), [{ kind: "tasks", count: 1 }]);

      // Lead: presupuesto.
      const lead = await db.lead.create({ data: { id: randomUUID(), organizationId: a.org, name: "L", phone: "1", email: "l@t.dev", consentAt: new Date() } });
      assert.deepEqual(await blockers("Lead", lead.id), []);
      const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, eventId: event.id, leadId: lead.id, title: "Pres" } });
      assert.deepEqual(await blockers("Lead", lead.id), [{ kind: "budgets", count: 1 }]);

      // Budget: sin nada es borrable; luego firma, cobro, comprobante, plan confirmado y factura.
      assert.deepEqual(await blockers("Budget", budget.id), []);
      await db.signatureRequest.create({
        data: { id: randomUUID(), organizationId: a.org, budgetId: budget.id, publicCode: randomUUID(), title: "F", senderName: "s", recipientName: "r", expiresAt: new Date(Date.now() + 1e9), documentHash: "h", documentHashCapturedAt: new Date() },
      });
      const payment = await db.clientPayment.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, budgetId: budget.id, amount: 5000 } });
      await db.budgetPaymentProof.create({ data: { id: randomUUID(), organizationId: a.org, budgetId: budget.id, uploadedByName: "x", mime: "image/png", size: 1, data: Buffer.from("x") } });
      await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: a.org, budgetId: budget.id, concept: "advance", slot: "advance", label: "Anticipo", amount: 5000, status: "CONFIRMED" } });
      await db.expectedPayment.create({ data: { id: randomUUID(), organizationId: a.org, budgetId: budget.id, concept: "balance", slot: "balance", label: "Saldo", amount: 1, status: "AWAITING" } });
      await db.invoice.create({ data: { id: randomUUID(), organizationId: a.org, number: 1, clientName: "C", clientId: client.id, budgetId: budget.id, eventId: event.id, issuedAt: new Date(), total: 5000, createdByName: "t" } });
      assert.deepEqual(await blockers("Budget", budget.id), [
        { kind: "signatureRequests", count: 1 }, { kind: "payments", count: 1 }, { kind: "paymentProofs", count: 1 }, { kind: "confirmedExpectedPayments", count: 1 }, { kind: "invoices", count: 1 },
      ]);

      // Event: factura, gasto, trabajo, incidente y cobros por presupuesto.
      await db.inventoryIncident.create({ data: { id: randomUUID(), organizationId: a.org, inventoryId: item.id, eventId: event.id, kind: "MISSING", quantity: 1 } });
      assert.deepEqual(await blockers("Event", event.id), [
        { kind: "invoices", count: 1 }, { kind: "expenses", count: 1 }, { kind: "supplierJobs", count: 1 }, { kind: "incidents", count: 1 }, { kind: "payments", count: 1 },
      ]);
      const empty = await db.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, name: "Vacío" } });
      assert.deepEqual(await blockers("Event", empty.id), []);

      // Client: presupuesto aprobado/firmado, cobros, facturas, eventos con cobros.
      await db.budget.update({ where: { id: budget.id }, data: { status: "APPROVED" } });
      await db.signatureRequest.updateMany({ where: { budgetId: budget.id }, data: { status: "SIGNED" } });
      assert.deepEqual(await blockers("Client", client.id), [
        { kind: "approvedBudgets", count: 1 }, { kind: "signedBudgets", count: 1 }, { kind: "payments", count: 1 }, { kind: "invoices", count: 1 }, { kind: "eventsWithPayments", count: 1 },
      ]);
      const lonely = await mkClient(a.org);
      assert.deepEqual(await blockers("Client", lonely.id), []);
      // Los bloqueos ven también lo eliminado (el historial sigue existiendo).
      await dbWithDeleted.budget.update({ where: { id: budget.id }, data: { archivedAt: new Date(), deletedAt: new Date() } });
      assert.equal((await blockers("Client", client.id)).find((b) => b.kind === "approvedBudgets")?.count, 1);
      assert.ok(payment);
    });

    await t.test("anonimizar Client quita datos personales, borra el logo, revoca el link y no se restaura; Lead queda sin contacto", async () => {
      const a = await seedOrg();
      await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: a.org } });
      const client = await mkClient(a.org, { company: "Acme", tradeName: "Acme SA", ruc: "800-1", legalName: "Acme Sociedad", instagram: "acme", whatsapp: "0981", address: "Calle 1", notes: "VIP", contactEmail: "x@acme.dev", archivedAt: new Date(), deletedAt: new Date() });
      await db.clientLogo.create({ data: { id: randomUUID(), clientId: client.id, mime: "image/png", size: 1, data: Buffer.from("x") } });
      await db.catalogAccessToken.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, tokenHash: randomUUID() } });
      await anonymize("Client", client.id, a.ctx);
      const row = await dbWithDeleted.client.findUniqueOrThrow({ where: { id: client.id } });
      assert.match(row.name, /^Cliente eliminado ·#[0-9a-f]{4}$/);
      for (const field of ["company", "tradeName", "email", "phone", "instagram", "whatsapp", "address", "notes", "contactEmail", "ruc", "legalName"] as const) assert.equal(row[field], null, field);
      assert.ok(row.anonymizedAt);
      assert.equal(await dbWithDeleted.clientLogo.count({ where: { clientId: client.id } }), 0);
      assert.equal(await dbWithDeleted.catalogAccessToken.count({ where: { clientId: client.id, revokedAt: null } }), 0);
      await expectError(anonymize("Client", client.id, a.ctx), 409);
      await expectError(restore("Client", client.id, a.ctx), 409);

      // Con factura, legalName/ruc se conservan.
      const billed = await mkClient(a.org, { ruc: "800-2", legalName: "Billed SA", archivedAt: new Date(), deletedAt: new Date() });
      await db.invoice.create({ data: { id: randomUUID(), organizationId: a.org, number: 2, clientName: "Billed", clientId: billed.id, issuedAt: new Date(), total: 1, createdByName: "t" } });
      await anonymize("Client", billed.id, a.ctx);
      const kept = await dbWithDeleted.client.findUniqueOrThrow({ where: { id: billed.id } });
      assert.equal(kept.ruc, "800-2");
      assert.equal(kept.legalName, "Billed SA");

      const lead = await db.lead.create({ data: { id: randomUUID(), organizationId: a.org, name: "Ana", phone: "0981", email: "ana@t.dev", message: "hola", internalNotes: "n", consentAt: new Date(), archivedAt: new Date(), deletedAt: new Date() } });
      await anonymize("Lead", lead.id, a.ctx);
      const l = await dbWithDeleted.lead.findUniqueOrThrow({ where: { id: lead.id } });
      assert.equal(l.email, "");
      assert.equal(l.message, null);
      assert.ok(l.anonymizedAt);
      await expectError(anonymize("Supplier", randomUUID(), a.ctx), 501);
      assert.equal((await db.auditLog.count({ where: { organizationId: a.org, action: "anonymize" } })), 3);
    });

    await t.test("catálogo y tienda: ítem eliminado y cliente eliminado dan 404", async () => {
      const a = await seedOrg();
      await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: a.org, publicCatalogEnabled: true, publicShowPrices: true } });
      const visible = await mkItem(a.org, { name: "Visible web", visibleOnWeb: true, catalogAudience: "BOTH", listPrice: 1000, wholesalePrice: 800 });
      const hidden = await mkItem(a.org, { name: "Eliminado web", visibleOnWeb: true, catalogAudience: "BOTH", listPrice: 1000, wholesalePrice: 800 });
      const client = await mkClient(a.org, { type: "RESELLER" });
      const issued = await access.issueCatalogAccess(a.org, client.id);
      assert.ok(issued);
      let ctx = await catalog.resolveWholesaleCatalog(a.slug, issued!.token);
      assert.ok(ctx);
      let names = (await catalog.loadPublicCatalogItems(ctx!, null)).map((i: { name: string }) => i.name).sort();
      assert.deepEqual(names, ["Eliminado web", "Visible web"]);
      await archive("InventoryItem", hidden.id, a.ctx);
      await trash("InventoryItem", hidden.id, null, a.ctx);
      names = (await catalog.loadPublicCatalogItems(ctx!, null)).map((i: { name: string }) => i.name);
      assert.deepEqual(names, ["Visible web"]);
      // Cliente eliminado: su link mayorista deja de abrir.
      await archive("Client", client.id, a.ctx);
      await trash("Client", client.id, null, a.ctx);
      assert.equal(await catalog.resolveWholesaleCatalog(a.slug, issued!.token), null);
      assert.ok(visible);
      ctx = null;
    });
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: { in: orgs } } }).catch(() => undefined);
    await dbWithDeleted.$disconnect();
  }
});
