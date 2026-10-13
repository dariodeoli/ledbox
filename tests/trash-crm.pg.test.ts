import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/trash-crm.pg.test.ts
test("papelera E3: Cliente, Oportunidad, Proveedor, Promotora y Presupuesto en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const crm = await import("../lib/server/trash-crm");
  const ops = await import("../lib/server/trash-ops");
  const { TrashError } = await import("../lib/server/trash");
  const { resolveCatalogAccess, catalogTokenHash } = await import("../lib/server/catalog-access");
  const { loadPublicBudget, generatePublicToken } = await import("../lib/server/budget-portal");

  const orgs: string[] = [];
  async function seedOrg() {
    const org = randomUUID();
    orgs.push(org);
    const slug = `pe3-${org.slice(0, 8)}`;
    await db.organization.create({ data: { id: org, name: `Empresa ${slug}`, slug } });
    const ctx = { organizationId: org, user: { id: `u-${org.slice(0, 6)}`, name: "Admin", email: "a@test.dev", role: "ADMIN" as const } };
    return { org, slug, ctx };
  }
  type Seed = Awaited<ReturnType<typeof seedOrg>>;
  const mkClient = (a: Seed, extra: Record<string, unknown> = {}) =>
    db.client.create({ data: { id: randomUUID(), organizationId: a.org, name: "Cliente Uno", email: "c@test.dev", phone: "0981", ...extra } });
  const mkBudget = (a: Seed, clientId: string, extra: Record<string, unknown> = {}) =>
    db.budget.create({ data: { id: randomUUID(), organizationId: a.org, clientId, title: "Pres Uno", ...extra } });
  const expectError = async (work: Promise<unknown>, status: number) => {
    let caught: unknown;
    await work.catch((error) => (caught = error));
    assert.ok(caught instanceof TrashError, `se esperaba TrashError ${status}, vino ${String(caught)}`);
    assert.equal((caught as InstanceType<typeof TrashError>).status, status);
    return caught as InstanceType<typeof TrashError>;
  };
  const input = (name: string) => ({ confirmName: name, reason: "pedido del titular" });

  try {
    await t.test("cross-org: toda acción sobre un id ajeno da 404", async () => {
      const a = await seedOrg();
      const b = await seedOrg();
      const client = await mkClient(b);
      const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: b.org, name: "Prov" } });
      const promoter = await db.promoter.create({ data: { id: randomUUID(), organizationId: b.org, name: "Pro" } });
      const lead = await db.lead.create({ data: { id: randomUUID(), organizationId: b.org, name: "L", phone: "1", email: "l@t.dev", consentAt: new Date(), status: "LOST" } });
      const budget = await mkBudget(b, client.id);
      const ids = { Client: client.id, Supplier: supplier.id, Promoter: promoter.id, Lead: lead.id, Budget: budget.id } as const;
      for (const model of crm.CRM_MODELS) {
        for (const action of ["archive", "unarchive", "trash", "restore", "purge", "anonymize"]) {
          await expectError(crm.runCrmAction(model, action, ids[model], { confirmName: "x", reason: "r" }, a.ctx), 404);
        }
      }
      // Nada cambió en la empresa dueña.
      assert.equal((await db.client.findUniqueOrThrow({ where: { id: client.id } })).archivedAt, null);
    });

    await t.test("sincronización active↔archivedAt en Cliente, Proveedor y Promotora", async () => {
      const a = await seedOrg();
      const client = await mkClient(a);
      const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: a.org, name: "Prov" } });
      const promoter = await db.promoter.create({ data: { id: randomUUID(), organizationId: a.org, name: "Pro" } });
      const rows = [["Client", client.id, db.client], ["Supplier", supplier.id, db.supplier], ["Promoter", promoter.id, db.promoter]] as const;
      for (const [model, id, delegate] of rows) {
        await crm.archiveCrm(model, id, a.ctx);
        const archived = await (delegate as unknown as { findUniqueOrThrow(a: unknown): Promise<{ active: boolean; archivedAt: Date | null; archivedById: string | null }> }).findUniqueOrThrow({ where: { id } });
        assert.equal(archived.active, false, `${model} archivado → active=false`);
        assert.ok(archived.archivedAt);
        assert.equal(archived.archivedById, a.ctx.user.id);
        await expectError(crm.archiveCrm(model, id, a.ctx), 409);
        await crm.unarchiveCrm(model, id, a.ctx);
        const back = await (delegate as unknown as { findUniqueOrThrow(a: unknown): Promise<{ active: boolean; archivedAt: Date | null }> }).findUniqueOrThrow({ where: { id } });
        assert.equal(back.active, true, `${model} desarchivado → active=true`);
        assert.equal(back.archivedAt, null);
      }
      // Restaurar desde la papelera vuelve a ARCHIVADO (active sigue en false).
      await crm.archiveCrm("Supplier", supplier.id, a.ctx);
      await crm.trashCrm("Supplier", supplier.id, "duplicado", a.ctx);
      await crm.runCrmAction("Supplier", "restore", supplier.id, {}, a.ctx);
      const restored = await db.supplier.findUniqueOrThrow({ where: { id: supplier.id } });
      assert.ok(restored.archivedAt);
      assert.equal(restored.active, false);
      assert.equal(restored.deletedAt, null);
    });

    await t.test("reglas de archivar: Presupuesto solo DRAFT/LOST/CANCELLED; Oportunidad ganada, perdida o inactiva", async () => {
      const a = await seedOrg();
      const client = await mkClient(a);
      const sent = await mkBudget(a, client.id, { status: "SENT" });
      await expectError(crm.archiveCrm("Budget", sent.id, a.ctx), 409);
      const approved = await mkBudget(a, client.id, { status: "APPROVED" });
      await expectError(crm.archiveCrm("Budget", approved.id, a.ctx), 409);
      for (const status of ["DRAFT", "LOST", "CANCELLED"] as const) await crm.archiveCrm("Budget", (await mkBudget(a, client.id, { status })).id, a.ctx);
      const mkLead = (extra: Record<string, unknown>) => db.lead.create({ data: { id: randomUUID(), organizationId: a.org, name: "L", phone: "1", email: "l@t.dev", consentAt: new Date(), ...extra } });
      await expectError(crm.archiveCrm("Lead", (await mkLead({ status: "NEW" })).id, a.ctx), 409);
      await crm.archiveCrm("Lead", (await mkLead({ status: "WON" })).id, a.ctx);
      await crm.archiveCrm("Lead", (await mkLead({ status: "LOST" })).id, a.ctx);
      const old = await mkLead({ status: "CONTACTED" });
      await db.$executeRaw`UPDATE "Lead" SET "updatedAt" = now() - interval '45 days' WHERE "id" = ${old.id}`;
      await crm.archiveCrm("Lead", old.id, a.ctx);
    });

    await t.test("eliminar: solo archivado y sin vivos que dependan; con bloqueo da 409 con blockers", async () => {
      const a = await seedOrg();
      const client = await mkClient(a);
      await expectError(crm.trashCrm("Client", client.id, null, a.ctx), 409); // sin archivar
      const budget = await mkBudget(a, client.id);
      await crm.archiveCrm("Client", client.id, a.ctx);
      const blocked = await expectError(crm.trashCrm("Client", client.id, null, a.ctx), 409);
      assert.deepEqual(blocked.blockers, [{ kind: "budgets", count: 1 }]);
      // Presupuesto eliminado ya no bloquea (solo cuentan los vivos).
      await crm.archiveCrm("Budget", budget.id, a.ctx);
      await crm.trashCrm("Budget", budget.id, "duplicado", a.ctx);
      await crm.trashCrm("Client", client.id, "cliente de prueba", a.ctx);
      assert.equal(await db.client.count({ where: { id: client.id } }), 0);
      assert.equal(await db.budget.count({ where: { id: budget.id } }), 0);

      const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: a.org, name: "Prov" } });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: (await mkClient(a)).id, name: "Ev", status: "COMPLETED", startsAt: new Date(Date.now() + 864e5), endsAt: new Date(Date.now() + 2 * 864e5) } });
      await db.supplierJob.create({ data: { id: randomUUID(), organizationId: a.org, supplierId: supplier.id, eventId: event.id, description: "Flete", total: 1000 } });
      await crm.archiveCrm("Supplier", supplier.id, a.ctx);
      assert.deepEqual((await expectError(crm.trashCrm("Supplier", supplier.id, null, a.ctx), 409)).blockers, [{ kind: "pendingJobs", count: 1 }]);

      const promoter = await db.promoter.create({ data: { id: randomUUID(), organizationId: a.org, name: "Pro" } });
      await db.eventTask.create({ data: { id: randomUUID(), eventId: event.id, promoterId: promoter.id, type: "EVENT", title: "T" } });
      await crm.archiveCrm("Promoter", promoter.id, a.ctx);
      assert.deepEqual((await expectError(crm.trashCrm("Promoter", promoter.id, null, a.ctx), 409)).blockers, [{ kind: "futureTasks", count: 1 }]);

      const lead = await db.lead.create({ data: { id: randomUUID(), organizationId: a.org, name: "L", phone: "1", email: "l@t.dev", consentAt: new Date(), status: "WON" } });
      await mkBudget(a, (await mkClient(a)).id, { leadId: lead.id });
      await crm.archiveCrm("Lead", lead.id, a.ctx);
      assert.deepEqual((await expectError(crm.trashCrm("Lead", lead.id, null, a.ctx), 409)).blockers, [{ kind: "budgets", count: 1 }]);

      const signed = await mkBudget(a, (await mkClient(a)).id, { status: "CANCELLED" });
      await db.clientPayment.create({ data: { id: randomUUID(), organizationId: a.org, clientId: signed.clientId, budgetId: signed.id, amount: 5000 } });
      await crm.archiveCrm("Budget", signed.id, a.ctx);
      assert.deepEqual((await expectError(crm.trashCrm("Budget", signed.id, null, a.ctx), 409)).blockers, [{ kind: "payments", count: 1 }]);
    });

    await t.test("definitivo de un cliente con cobros da 409 con blockers; anonimizar conserva el historial", async () => {
      const a = await seedOrg();
      const client = await mkClient(a, { company: "ACME SA", legalName: "ACME S.A.", ruc: "80000001-1", contactName: "Ana", instagram: "@acme", notes: "vip" });
      const budget = await mkBudget(a, client.id, { status: "CANCELLED" });
      const payment = await db.clientPayment.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, budgetId: budget.id, amount: 250_000 } });
      await db.clientLogo.create({ data: { id: randomUUID(), clientId: client.id, mime: "image/png", size: 1, data: Buffer.from("x") } });
      const tokenId = randomUUID();
      await db.catalogAccessToken.create({ data: { id: tokenId, organizationId: a.org, clientId: client.id, tokenHash: randomUUID() } });
      await crm.archiveCrm("Budget", budget.id, a.ctx);
      await crm.archiveCrm("Client", client.id, a.ctx);
      // Con el presupuesto vivo no se puede eliminar: lo mandamos a la papelera por SQL (el cobro lo bloquea por API).
      await dbWithDeleted.budget.update({ where: { id: budget.id }, data: { deletedAt: new Date(), archivedAt: new Date() } });
      await crm.trashCrm("Client", client.id, "pedido del cliente", a.ctx);

      await expectError(crm.purgeCrm("Client", client.id, { confirmName: "otro nombre", reason: "x" }, a.ctx), 400);
      const blocked = await expectError(crm.purgeCrm("Client", client.id, input("Cliente Uno"), a.ctx), 409);
      assert.ok(blocked.blockers?.some((b) => b.kind === "payments" && b.count === 1));
      assert.match(blocked.message, /anonimizarlo/);
      assert.equal(await db.clientPayment.count({ where: { id: payment.id } }), 1, "el cobro sigue en los libros");
      assert.equal(await dbWithDeleted.client.count({ where: { id: client.id } }), 1);

      // La papelera lo lista con sus bloqueos.
      const listed = (await ops.listTrash(a.org)).find((row) => row.id === client.id);
      assert.equal(listed?.type, "Client");
      assert.ok(listed?.blockers.some((b) => b.kind === "payments"));

      await expectError(crm.anonymizeCrm("Client", client.id, { confirmName: "nombre mal", reason: "x" }, a.ctx), 400);
      await crm.anonymizeCrm("Client", client.id, input("Cliente Uno"), a.ctx);
      const row = await dbWithDeleted.client.findUniqueOrThrow({ where: { id: client.id } });
      assert.match(row.name, /^Cliente eliminado ·#[0-9a-f]{4}$/);
      for (const field of ["company", "email", "phone", "contactName", "instagram", "notes"] as const) assert.equal(row[field], null, field);
      assert.ok(row.anonymizedAt);
      assert.equal(await db.clientLogo.count({ where: { clientId: client.id } }), 0);
      assert.ok((await db.catalogAccessToken.findUniqueOrThrow({ where: { id: tokenId } })).revokedAt);
      assert.equal(await db.clientPayment.count({ where: { id: payment.id } }), 1);
      await expectError(crm.runCrmAction("Client", "restore", client.id, {}, a.ctx), 409);
      assert.equal(await db.auditLog.count({ where: { organizationId: a.org, action: "anonymize", entity: "Client" } }), 1);
    });

    await t.test("definitivo sin historial borra de verdad; Proveedor y Promotora con historial se anonimizan; Presupuesto no", async () => {
      const a = await seedOrg();
      const client = await mkClient(a);
      await crm.archiveCrm("Client", client.id, a.ctx);
      await crm.trashCrm("Client", client.id, null, a.ctx);
      await crm.purgeCrm("Client", client.id, input("Cliente Uno"), a.ctx);
      assert.equal(await dbWithDeleted.client.count({ where: { id: client.id } }), 0);
      assert.equal(await db.auditLog.count({ where: { organizationId: a.org, action: "purge", entity: "Client" } }), 1);

      const event = await db.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: (await mkClient(a)).id, name: "Ev", status: "COMPLETED", startsAt: new Date(Date.now() - 2 * 864e5), endsAt: new Date(Date.now() - 864e5) } });
      const supplier = await db.supplier.create({ data: { id: randomUUID(), organizationId: a.org, name: "Prov SA", phone: "0991", email: "p@t.dev", notes: "n" } });
      const job = await db.supplierJob.create({ data: { id: randomUUID(), organizationId: a.org, supplierId: supplier.id, eventId: event.id, description: "Flete", total: 1000, status: "DELIVERED" } });
      await crm.archiveCrm("Supplier", supplier.id, a.ctx);
      await crm.trashCrm("Supplier", supplier.id, null, a.ctx);
      assert.ok((await expectError(crm.purgeCrm("Supplier", supplier.id, input("Prov SA"), a.ctx), 409)).blockers?.some((b) => b.kind === "supplierJobs"));
      await crm.anonymizeCrm("Supplier", supplier.id, input("Prov SA"), a.ctx);
      const s = await dbWithDeleted.supplier.findUniqueOrThrow({ where: { id: supplier.id } });
      assert.match(s.name, /^Proveedor eliminado ·#/);
      assert.equal(s.phone, null);
      assert.equal(await db.supplierJob.count({ where: { id: job.id } }), 1, "el trabajo del proveedor sigue");

      const promoter = await db.promoter.create({ data: { id: randomUUID(), organizationId: a.org, name: "Pro Uno", phone: "0981", email: "p@t.dev" } });
      await db.eventTask.create({ data: { id: randomUUID(), eventId: event.id, promoterId: promoter.id, type: "EVENT", title: "T", completedAt: new Date() } });
      await crm.archiveCrm("Promoter", promoter.id, a.ctx);
      await crm.trashCrm("Promoter", promoter.id, null, a.ctx);
      assert.ok((await expectError(crm.purgeCrm("Promoter", promoter.id, input("Pro Uno"), a.ctx), 409)).blockers?.some((b) => b.kind === "tasks"));
      await crm.anonymizeCrm("Promoter", promoter.id, input("Pro Uno"), a.ctx);
      assert.equal((await dbWithDeleted.promoter.findUniqueOrThrow({ where: { id: promoter.id } })).phone, null);

      const lead = await db.lead.create({ data: { id: randomUUID(), organizationId: a.org, name: "Ana", phone: "1", email: "a@t.dev", consentAt: new Date(), status: "LOST" } });
      await crm.archiveCrm("Lead", lead.id, a.ctx);
      await crm.trashCrm("Lead", lead.id, null, a.ctx);
      await crm.purgeCrm("Lead", lead.id, input("Ana"), a.ctx);
      assert.equal(await dbWithDeleted.lead.count({ where: { id: lead.id } }), 0);

      // Presupuesto: borrador sin nada se borra; uno que no es borrador queda conservado y no se anonimiza.
      const owner = await mkClient(a);
      const draft = await mkBudget(a, owner.id);
      await crm.archiveCrm("Budget", draft.id, a.ctx);
      await crm.trashCrm("Budget", draft.id, null, a.ctx);
      await crm.purgeCrm("Budget", draft.id, input("Pres Uno"), a.ctx);
      assert.equal(await dbWithDeleted.budget.count({ where: { id: draft.id } }), 0);
      const lost = await mkBudget(a, owner.id, { status: "LOST" });
      await crm.archiveCrm("Budget", lost.id, a.ctx);
      await crm.trashCrm("Budget", lost.id, null, a.ctx);
      assert.ok((await expectError(crm.purgeCrm("Budget", lost.id, input("Pres Uno"), a.ctx), 409)).blockers?.some((b) => b.kind === "notDraft"));
      await expectError(crm.anonymizeCrm("Budget", lost.id, input("Pres Uno"), a.ctx), 409);
    });

    await t.test("definitivo de un cliente con un evento eliminado que tiene un gasto da 409 y el gasto conserva su evento; anonimizar borra ciudad y departamento", async () => {
      const a = await seedOrg();
      const client = await mkClient(a, { city: "Asunción", department: "Central" });
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, name: "Ev", status: "COMPLETED", startsAt: new Date(Date.now() - 2 * 864e5), endsAt: new Date(Date.now() - 864e5), archivedAt: new Date(), deletedAt: new Date() } });
      const account = await db.treasuryAccount.create({ data: { id: randomUUID(), organizationId: a.org, name: "Caja" } });
      const expense = await db.expense.create({ data: { id: randomUUID(), organizationId: a.org, accountId: account.id, eventId: event.id, date: new Date(), amount: 1000, description: "g", createdByName: "t" } });
      await crm.archiveCrm("Client", client.id, a.ctx);
      await crm.trashCrm("Client", client.id, null, a.ctx);
      const blocked = await expectError(crm.purgeCrm("Client", client.id, input("Cliente Uno"), a.ctx), 409);
      assert.ok(blocked.blockers?.some((b) => b.kind === "eventExpenses" && b.count === 1));
      assert.equal((await db.expense.findUniqueOrThrow({ where: { id: expense.id } })).eventId, event.id, "el gasto conserva su evento");
      assert.equal(await dbWithDeleted.event.count({ where: { id: event.id } }), 1);
      await crm.anonymizeCrm("Client", client.id, input("Cliente Uno"), a.ctx);
      const row = await dbWithDeleted.client.findUniqueOrThrow({ where: { id: client.id } });
      assert.equal(row.city, null);
      assert.equal(row.department, null);
    });

    await t.test("portal y catálogo con token de un cliente o presupuesto eliminado dan 404", async () => {
      const a = await seedOrg();
      const client = await mkClient(a);
      const code = generatePublicToken();
      const budget = await mkBudget(a, client.id, { publicToken: code });
      assert.ok(await loadPublicBudget(code), "vivo: el portal responde");
      const catalogToken = `lbxw_${"c".repeat(32)}`;
      await db.catalogAccessToken.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, tokenHash: catalogTokenHash(catalogToken) } });
      assert.ok(await resolveCatalogAccess(a.slug, catalogToken), "vivo: el catálogo responde");

      // Presupuesto eliminado → 404 en el portal.
      await crm.archiveCrm("Budget", budget.id, a.ctx);
      await crm.trashCrm("Budget", budget.id, null, a.ctx);
      assert.equal(await loadPublicBudget(code), null);
      await crm.runCrmAction("Budget", "restore", budget.id, {}, a.ctx);
      await crm.unarchiveCrm("Budget", budget.id, a.ctx);
      assert.ok(await loadPublicBudget(code), "restaurado y desarchivado vuelve a verse");

      // Cliente eliminado → 404 en el portal (aunque el presupuesto exista) y en el catálogo.
      await dbWithDeleted.client.update({ where: { id: client.id }, data: { deletedAt: new Date() } });
      assert.equal(await loadPublicBudget(code), null);
      assert.equal(await resolveCatalogAccess(a.slug, catalogToken), null);
    });

    await t.test("listTrash devuelve las 7 entidades y nada de otra empresa", async () => {
      const a = await seedOrg();
      const b = await seedOrg();
      const gone = { archivedAt: new Date(), deletedAt: new Date(), deletedById: a.ctx.user.id };
      const client = await mkClient(a, gone);
      await db.lead.create({ data: { id: randomUUID(), organizationId: a.org, name: "L", phone: "1", email: "l@t.dev", consentAt: new Date(), ...gone } });
      await db.supplier.create({ data: { id: randomUUID(), organizationId: a.org, name: "S", ...gone } });
      await db.promoter.create({ data: { id: randomUUID(), organizationId: a.org, name: "P", ...gone } });
      await dbWithDeleted.budget.create({ data: { id: randomUUID(), organizationId: a.org, clientId: client.id, title: "B", ...gone } });
      await mkClient(b, gone);
      const types = (await ops.listTrash(a.org)).map((row) => row.type).sort();
      assert.deepEqual(types, ["Budget", "Client", "Lead", "Promoter", "Supplier"]);
      assert.equal((await ops.listTrash(b.org)).length, 1);
    });
  } finally {
    await dbWithDeleted.organization.deleteMany({ where: { id: { in: orgs } } }).catch((error) => console.error("limpieza", error));
    await dbWithDeleted.$disconnect();
  }
});
