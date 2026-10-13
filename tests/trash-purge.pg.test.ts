import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/trash-purge.pg.test.ts
test("papelera E5: vaciado automático perezoso en PostgreSQL", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const purge = await import("../lib/server/trash-purge");
  const ops = await import("../lib/server/trash-ops");
  const settings = await import("../lib/server/rental-settings");

  const orgs: string[] = [];
  async function seedOrg() {
    const org = randomUUID();
    orgs.push(org);
    await db.organization.create({ data: { id: org, name: `Empresa ${org.slice(0, 6)}`, slug: `pe5-${org.slice(0, 8)}` } });
    return org;
  }
  const old = () => new Date(Date.now() - 100 * 864e5);
  const fresh = () => new Date(Date.now() - 5 * 864e5);
  const dead = (deletedAt: Date) => ({ archivedAt: deletedAt, deletedAt, deletedById: "u1", deleteReason: "prueba" });
  const mkClient = (org: string, name: string, deletedAt: Date) =>
    dbWithDeleted.client.create({ data: { id: randomUUID(), organizationId: org, name, email: "c@test.dev", phone: "0981", ...dead(deletedAt) } });
  const mkItem = (org: string, name: string, deletedAt: Date) =>
    dbWithDeleted.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category: "LED", quantity: 1, ...dead(deletedAt) } });
  const exists = async (model: "client" | "inventoryItem", id: string) =>
    (await (dbWithDeleted[model] as unknown as { count(a: unknown): Promise<number> }).count({ where: { id } })) === 1;

  try {
    await t.test("purga lo vencido sin bloqueos, deja lo reciente y audita como sistema", async () => {
      const org = await seedOrg();
      const expiredClient = await mkClient(org, "Cliente Viejo", old());
      const expiredItem = await mkItem(org, "Pantalla Vieja", old());
      const recent = await mkClient(org, "Cliente Nuevo", fresh());
      const result = await purge.purgeExpiredTrash(org, 90);
      assert.deepEqual(result, { skipped: false, purged: 2, retained: 0, failed: 0 });
      assert.equal(await exists("client", expiredClient.id), false);
      assert.equal(await exists("inventoryItem", expiredItem.id), false);
      assert.equal(await exists("client", recent.id), true);
      const audits = await db.auditLog.findMany({ where: { organizationId: org, action: "purge" } });
      assert.equal(audits.length, 2);
      for (const audit of audits) {
        assert.equal(audit.actorId, "system");
        assert.equal(audit.actorName, "Sistema");
        assert.equal((audit.detail as { fields: { reason: string } }).fields.reason, "Vaciado automático a 90 días");
      }
    });

    await t.test("conserva lo bloqueado (contable) y lo marca en el listado", async () => {
      const org = await seedOrg();
      const blocked = await mkClient(org, "Cliente Con Cobro", old());
      const budget = await dbWithDeleted.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: blocked.id, title: "Pres", status: "APPROVED" } });
      await db.clientPayment.create({ data: { id: randomUUID(), organizationId: org, clientId: blocked.id, budgetId: budget.id, amount: 100_000 } });
      const free = await mkClient(org, "Cliente Libre", old());
      const result = await purge.purgeExpiredTrash(org, 30);
      assert.equal(result.purged, 1);
      assert.equal(result.retained, 1);
      assert.equal(await exists("client", blocked.id), true, "el cliente con cobros sigue");
      assert.equal(await db.clientPayment.count({ where: { organizationId: org } }), 1, "el cobro sigue en los libros");
      assert.equal(await exists("client", free.id), false);
      const rows = await ops.listTrash(org, 30);
      const row = rows.find((r) => r.id === blocked.id)!;
      assert.equal(row.retained, true);
      assert.equal(row.purgeInDays, null);
      assert.ok(row.blockers.length > 0);
    });

    await t.test("no toca otra empresa", async () => {
      const a = await seedOrg();
      const b = await seedOrg();
      const mine = await mkClient(a, "Mío", old());
      const theirs = await mkClient(b, "Ajeno", old());
      await purge.purgeExpiredTrash(a, 30);
      assert.equal(await exists("client", mine.id), false);
      assert.equal(await exists("client", theirs.id), true);
    });

    await t.test("sin configuración (NULL) no purga nada", async () => {
      const org = await seedOrg();
      const row = await mkClient(org, "Viejo", old());
      assert.equal((await settings.getRentalSettings(org)).trashPurgeDays, null);
      assert.deepEqual(await purge.purgeExpiredTrash(org, null), { skipped: true, purged: 0, retained: 0, failed: 0 });
      assert.equal(await exists("client", row.id), true);
      const listed = await ops.listTrash(org, null);
      assert.equal(listed[0].purgeInDays, null);
      assert.equal(listed[0].retained, false);
    });

    await t.test("el listado calcula los días que faltan", async () => {
      const org = await seedOrg();
      await mkClient(org, "Hace cinco días", fresh());
      const [row] = await ops.listTrash(org, 30);
      assert.equal(row.purgeInDays, 25);
    });

    await t.test("la configuración se guarda y se lee por empresa", async () => {
      const org = await seedOrg();
      const other = await seedOrg();
      await settings.saveRentalSettings(org, { trashPurgeDays: 60 });
      assert.equal((await settings.getRentalSettings(org)).trashPurgeDays, 60);
      assert.equal((await settings.getRentalSettings(other)).trashPurgeDays, null);
      await settings.saveRentalSettings(org, { trashPurgeDays: null });
      assert.equal((await settings.getRentalSettings(org)).trashPurgeDays, null);
    });

    await t.test("dos llamadas concurrentes no se pisan: una purga y la otra sigue sin purgar o no encuentra nada", async () => {
      const org = await seedOrg();
      const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => mkClient(org, `Viejo ${i}`, old())));
      const [r1, r2] = await Promise.all([purge.purgeExpiredTrash(org, 30), purge.purgeExpiredTrash(org, 30)]);
      assert.equal(r1.failed + r2.failed, 0);
      assert.equal(r1.purged + r2.purged, 6, "cada registro se borra exactamente una vez");
      for (const row of ids) assert.equal(await exists("client", row.id), false);
      assert.equal(await db.auditLog.count({ where: { organizationId: org, action: "purge" } }), 6, "una auditoría por borrado");
    });

    await t.test("respeta el tope por pasada", async () => {
      const org = await seedOrg();
      const total = purge.PURGE_BATCH_LIMIT + 3;
      await dbWithDeleted.client.createMany({
        data: Array.from({ length: total }, (_, i) => ({ id: randomUUID(), organizationId: org, name: `Viejo ${i}`, email: "c@test.dev", phone: "0981", ...dead(old()) })),
      });
      const first = await purge.purgeExpiredTrash(org, 30);
      assert.equal(first.purged, purge.PURGE_BATCH_LIMIT);
      const second = await purge.purgeExpiredTrash(org, 30);
      assert.equal(second.purged, 3);
    });
  } finally {
    for (const org of orgs) {
      await dbWithDeleted.auditLog.deleteMany({ where: { organizationId: org } }).catch(() => undefined);
      await dbWithDeleted.organization.delete({ where: { id: org } }).catch(() => undefined);
    }
    await dbWithDeleted.$disconnect();
  }
});
