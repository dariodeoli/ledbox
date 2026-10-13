import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/rental-2b.pg.test.ts
test("alquileres 2b en PostgreSQL: tiempos, unidades dañadas, retenciones y ajustes", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { commitInventoryAssignment, confirmHold, releaseAssignment } = await import("../lib/server/inventory-availability");
  const { getRentalSettings, saveRentalSettings } = await import("../lib/server/rental-settings");

  const day = (n: number, hour = 12) => new Date(Date.UTC(2031, 0, n, hour));
  const orgs: string[] = [];
  async function seed(stock = 1, settings: Record<string, number> | null = null, itemExtra: Record<string, unknown> = {}) {
    const org = randomUUID();
    orgs.push(org);
    const client = randomUUID();
    await db.organization.create({ data: { id: org, name: "Alquiler QA", slug: `alq-qa-${org}` } });
    await db.client.create({ data: { id: client, organizationId: org, name: "Cliente" } });
    if (settings) await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: org, ...settings } });
    const item = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Pantalla LED", category: "QA", quantity: stock, ...itemExtra } });
    const event = (name: string, extra: Record<string, unknown> = {}) =>
      db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client, name, setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13), ...extra } });
    return { org, item, event };
  }
  const commit = (org: string, eventId: string, inventoryId: string, quantity: number, range: [Date, Date] = [day(10), day(13)], extra: Record<string, unknown> = {}) =>
    commitInventoryAssignment({ organizationId: org, eventId, inventoryId, quantity, startsAt: range[0], endsAt: range[1], ...extra });
  const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? "ok" : r.reason);

  try {
    await t.test("la migración 2b aplicada dos veces no falla y el backfill es idempotente", () => {
      const psql = (file: string) =>
        execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
      for (const name of ["202610130002_inventory_unit_damaged_lost", "202610130003_rental_settings_holds"]) {
        const file = new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url).pathname;
        psql(file);
        psql(file);
      }
    });

    await t.test("el backfill completa organizationId desde el evento", async () => {
      const { org, item, event } = await seed(5);
      const ev = await event("Legado");
      const row = await db.eventInventory.create({ data: { id: randomUUID(), eventId: ev.id, inventoryId: item.id, quantity: 1 } });
      assert.equal(row.organizationId, null);
      const file = new URL("../prisma/migrations/202610130003_rental_settings_holds/migration.sql", import.meta.url).pathname;
      execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
      assert.equal((await db.eventInventory.findUnique({ where: { id: row.id } }))?.organizationId, org);
    });

    await t.test("un choque que se da solo por el tiempo de limpieza es insufficient", async () => {
      // Sin tiempos: B arranca una hora después de que A termina y entra.
      const free = await seed(1);
      const [a0, b0] = await Promise.all([free.event("A"), free.event("B")]);
      assert.ok((await commit(free.org, a0.id, free.item.id, 1, [day(10), day(13)])).ok);
      assert.ok((await commit(free.org, b0.id, free.item.id, 1, [day(13, 13), day(14)])).ok, "sin limpieza no choca");

      // Con 2 h de limpieza de la empresa: el mismo calendario choca.
      const tight = await seed(1, { cleaningBufferMin: 120 });
      const [a, b] = await Promise.all([tight.event("A"), tight.event("B")]);
      assert.ok((await commit(tight.org, a.id, tight.item.id, 1, [day(10), day(13)])).ok);
      const clash = await commit(tight.org, b.id, tight.item.id, 1, [day(13, 13), day(14)]);
      assert.equal(reasonOf(clash), "insufficient");
      // La limpieza completa (2 h) deja pasar a quien empieza después.
      assert.ok((await commit(tight.org, b.id, tight.item.id, 1, [day(13, 15), day(14)])).ok, "justo al terminar la limpieza ya no choca");

      // El override del producto (0) manda sobre la empresa.
      const override = await seed(1, { cleaningBufferMin: 120 }, { bufferAfterMin: 0 });
      const [c, d] = await Promise.all([override.event("C"), override.event("D")]);
      assert.ok((await commit(override.org, c.id, override.item.id, 1, [day(10), day(13)])).ok);
      assert.ok((await commit(override.org, d.id, override.item.id, 1, [day(13, 13), day(14)])).ok, "override del producto");
    });

    await t.test("una unidad DAMAGED (o LOST) resta 1 a lo libre", async () => {
      for (const status of ["DAMAGED", "LOST"] as const) {
        const { org, item, event } = await seed(3);
        for (let index = 0; index < 3; index++) {
          await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: org, inventoryId: item.id, code: `QA-${index}`, status: index === 0 ? status : "AVAILABLE" } });
        }
        const [a, b] = await Promise.all([event("A"), event("B")]);
        const over = await commit(org, a.id, item.id, 3);
        assert.equal(reasonOf(over), "insufficient", status);
        assert.equal(!over.ok && over.reason === "insufficient" && over.availability.available, 2, status);
        assert.ok((await commit(org, b.id, item.id, 2)).ok, status);
      }
    });

    await t.test("una retención vencida no cuenta y una vigente sí", async () => {
      const { org, item, event } = await seed(2);
      const [a, b, c] = await Promise.all([event("A"), event("B"), event("C")]);
      const held = await commit(org, a.id, item.id, 2, [day(10), day(13)], { hold: true, budgetId: "bud_1" });
      assert.ok(held.ok);
      assert.ok(held.ok && held.assignment.holdExpiresAt && held.assignment.holdExpiresAt.getTime() > Date.now() + 47 * 3_600_000, "vence en 48 h por defecto");
      assert.equal(reasonOf(await commit(org, b.id, item.id, 1)), "insufficient", "la vigente cuenta");
      await db.eventInventory.update({ where: { id: held.ok ? held.assignment.id : "" }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
      assert.ok((await commit(org, c.id, item.id, 2)).ok, "la vencida no cuenta");
      assert.equal((await db.eventInventory.findFirst({ where: { eventId: a.id } }))?.budgetId, "bud_1");
    });

    await t.test("editar una retención vencida la vuelve firme y cuenta en lo comprometido", async () => {
      const { org, item, event } = await seed(1);
      const [a, b] = await Promise.all([event("A"), event("B")]);
      const held = await commit(org, a.id, item.id, 1, [day(10), day(13)], { hold: true });
      assert.ok(held.ok);
      const id = held.ok ? held.assignment.id : "";
      await db.eventInventory.update({ where: { id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
      const edited = await commit(org, a.id, item.id, 1, [day(10), day(13)]);
      assert.ok(edited.ok && edited.assignment.holdExpiresAt === null, "queda firme");
      assert.equal((await db.eventInventory.findUnique({ where: { id } }))?.holdExpiresAt, null);
      assert.equal(reasonOf(await commit(org, b.id, item.id, 1)), "insufficient", "cuenta en lo comprometido");
    });

    await t.test("el vencimiento de la retención sale de los ajustes de la empresa", async () => {
      const { org, item, event } = await seed(2, { holdTtlMinutes: 60 });
      const a = await event("A");
      const held = await commit(org, a.id, item.id, 1, [day(10), day(13)], { hold: true });
      assert.ok(held.ok && held.assignment.holdExpiresAt && held.assignment.holdExpiresAt.getTime() < Date.now() + 61 * 60_000);
    });

    await t.test("confirmHold: vencida sin stock → insufficient; con stock o vigente → firme", async () => {
      const { org, item, event } = await seed(1);
      const [a, b] = await Promise.all([event("A"), event("B")]);
      const held = await commit(org, a.id, item.id, 1, [day(10), day(13)], { hold: true });
      assert.ok(held.ok);
      const holdId = held.ok ? held.assignment.id : "";
      // Vigente: se confirma sin revalidar.
      const live = await confirmHold({ organizationId: org, assignmentId: holdId });
      assert.ok(live.ok && !live.revalidated && live.assignment.holdExpiresAt === null);

      // Vencida y otro evento tomó el lugar: 409.
      const second = await seed(1);
      const [c, d] = await Promise.all([second.event("C"), second.event("D")]);
      const old = await commit(second.org, c.id, second.item.id, 1, [day(10), day(13)], { hold: true });
      assert.ok(old.ok);
      const oldId = old.ok ? old.assignment.id : "";
      await db.eventInventory.update({ where: { id: oldId }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
      assert.ok((await commit(second.org, d.id, second.item.id, 1)).ok, "tomó el lugar de la vencida");
      const refused = await confirmHold({ organizationId: second.org, assignmentId: oldId });
      assert.equal(reasonOf(refused), "insufficient");
      assert.notEqual((await db.eventInventory.findUnique({ where: { id: oldId } }))?.holdExpiresAt, null, "sigue sin confirmar");

      // Vencida pero con lugar: se revalida y queda firme.
      await db.eventInventory.delete({ where: { eventId_inventoryId: { eventId: d.id, inventoryId: second.item.id } } });
      const ok = await confirmHold({ organizationId: second.org, assignmentId: oldId });
      assert.ok(ok.ok && ok.revalidated && ok.assignment.holdExpiresAt === null);
      void b;
    });

    await t.test("dos confirmaciones concurrentes de retenciones vencidas sobre 1 unidad: entra una", async () => {
      for (let round = 0; round < 6; round++) {
        const { org, item, event } = await seed(1);
        const [a, b] = await Promise.all([event("A"), event("B")]);
        const ids: string[] = [];
        for (const ev of [a, b]) {
          const row = await db.eventInventory.create({
            data: { id: randomUUID(), eventId: ev.id, inventoryId: item.id, quantity: 1, startsAt: day(10), endsAt: day(13), organizationId: org, holdExpiresAt: new Date(Date.now() - 1000) },
          });
          ids.push(row.id);
        }
        const results = await Promise.all(ids.map((assignmentId) => confirmHold({ organizationId: org, assignmentId })));
        assert.equal(results.filter((r) => r.ok).length, 1, `ronda ${round}`);
      }
    });

    await t.test("releaseAssignment libera el stock y no cruza empresas", async () => {
      const a = await seed(1);
      const b = await seed(1);
      const [ea, eb] = await Promise.all([a.event("EA"), a.event("EB")]);
      const first = await commit(a.org, ea.id, a.item.id, 1);
      assert.ok(first.ok);
      const id = first.ok ? first.assignment.id : "";
      assert.equal(reasonOf(await commit(a.org, eb.id, a.item.id, 1)), "insufficient");
      assert.equal(reasonOf(await releaseAssignment({ organizationId: b.org, assignmentId: id })), "not-found", "otra empresa");
      assert.equal(reasonOf(await confirmHold({ organizationId: b.org, assignmentId: id })), "not-found", "otra empresa");
      const released = await releaseAssignment({ organizationId: a.org, assignmentId: id });
      assert.ok(released.ok && released.assignment.releasedAt);
      assert.ok((await commit(a.org, eb.id, a.item.id, 1)).ok, "liberada: ya no cuenta");
      assert.equal(reasonOf(await confirmHold({ organizationId: a.org, assignmentId: id })), "released");
    });

    await t.test("un equipo afuera no se libera y sigue contando", async () => {
      const { org, item, event } = await seed(1);
      const [a, b] = await Promise.all([event("A"), event("B")]);
      const first = await commit(org, a.id, item.id, 1);
      assert.ok(first.ok);
      const id = first.ok ? first.assignment.id : "";
      await db.eventInventory.update({ where: { id }, data: { checkedOut: true, checkedOutAt: day(10) } });
      assert.equal(reasonOf(await releaseAssignment({ organizationId: org, assignmentId: id })), "in-movement");
      assert.equal(reasonOf(await commit(org, b.id, item.id, 1)), "insufficient");
    });

    await t.test("los ajustes de una empresa no se ven ni se tocan desde otra", async () => {
      const a = await seed(1);
      const b = await seed(1);
      await saveRentalSettings(a.org, { depositPercent: 30, holdTtlMinutes: 600 });
      const mine = await getRentalSettings(a.org);
      const other = await getRentalSettings(b.org);
      assert.equal(mine.depositPercent, 30);
      assert.equal(other.depositPercent, null, "la otra empresa sigue sin política");
      assert.equal(other.holdTtlMinutes, 2880);
      await saveRentalSettings(b.org, { depositPercent: 0 });
      assert.equal((await getRentalSettings(a.org)).depositPercent, 30);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
