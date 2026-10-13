import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test tests/inventory-combos.pg.test.ts
test("combos en PostgreSQL: capacidad, expansión bajo lock, liberación, sustitución y tenencia", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { commitInventoryAssignment, releaseAssignment, confirmHold, reserveBudgetInventory, committedAssignmentWhere } = await import("../lib/server/inventory-availability");
  const { comboCapacitiesForRange, saveCombo, substituteComboComponent, releaseComboAssignment } = await import("../lib/server/inventory-combos");
  const { portalAuditContext } = await import("../lib/server/audit");

  const day = (n: number, hour = 12) => new Date(Date.UTC(2031, 0, n, hour));
  const orgs: string[] = [];
  async function seed(chairs = 25, tables = 3) {
    const org = randomUUID();
    orgs.push(org);
    const client = randomUUID();
    await db.organization.create({ data: { id: org, name: "Combos QA", slug: `combos-qa-${org}` } });
    await db.client.create({ data: { id: client, organizationId: org, name: "Cliente" } });
    const item = (name: string, quantity: number, category = "Mobiliario") =>
      db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category, quantity } });
    const chair = await item("Silla", chairs);
    const table = await item("Mesa", tables);
    const saved = await saveCombo({
      organizationId: org,
      data: { name: "Kit mesa con 10 sillas", category: "Combos", sku: null },
      components: [
        { componentId: chair.id, quantity: 10 },
        { componentId: table.id, quantity: 1 },
      ],
    });
    assert.ok(saved.ok);
    const combo = saved.combo;
    const event = (name: string, extra: Record<string, unknown> = {}) =>
      db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client, name, setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13), ...extra } });
    const commit = (eventId: string, inventoryId: string, quantity: number, extra: Record<string, unknown> = {}) =>
      commitInventoryAssignment({ organizationId: org, eventId, inventoryId, quantity, startsAt: day(10), endsAt: day(13), ...extra });
    const capacity = async () => (await comboCapacitiesForRange({ organizationId: org, comboIds: [combo.id], startsAt: day(10), endsAt: day(13) })).get(combo.id)!;
    const committed = async (inventoryId: string) =>
      (await db.eventInventory.aggregate({ where: { inventoryId, ...committedAssignmentWhere(org) }, _sum: { quantity: true } }))._sum.quantity ?? 0;
    return { org, client, chair, table, combo, event, commit, capacity, committed };
  }
  const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? "ok" : r.reason);

  try {
    await t.test("la migración de combos aplicada dos veces no falla", () => {
      const file = new URL("../prisma/migrations/202610130004_inventory_combos/migration.sql", import.meta.url).pathname;
      for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
    });

    await t.test("combo de 10 sillas + 1 mesa con 25 sillas y 3 mesas: capacidad 2 y limitante la silla", async () => {
      const { capacity } = await seed(25, 3);
      const result = await capacity();
      assert.equal(result.capacity, 2);
      assert.equal(result.limiting?.name, "Silla");
      assert.deepEqual(result.components.map((c) => [c.name, c.available, c.canMake]).sort(), [["Mesa", 3, 3], ["Silla", 25, 2]]);
    });

    await t.test("reservar 2 combos deja 5 sillas libres para el suelto y el tercer combo no entra", async () => {
      const { chair, table, combo, event, commit, capacity, committed } = await seed(25, 3);
      const [a, b] = await Promise.all([event("A"), event("B")]);
      const reserved = await commit(a.id, combo.id, 2);
      assert.ok(reserved.ok, JSON.stringify(reserved));
      assert.equal(await committed(chair.id), 20);
      assert.equal(await committed(table.id), 2);
      assert.equal((await capacity()).capacity, 0);
      assert.equal(reasonOf(await commit(b.id, combo.id, 1)), "insufficient");
      assert.equal(reasonOf(await commit(b.id, chair.id, 6)), "insufficient");
      assert.ok((await commit(b.id, chair.id, 5)).ok, "las 5 sillas restantes quedan para el suelto");
    });

    await t.test("un combo y un suelto concurrentes nunca superan el stock (10 rondas)", async () => {
      for (let round = 0; round < 10; round++) {
        const { chair, table, combo, event, commit, committed } = await seed(25, 3);
        const [a, b, c] = await Promise.all([event("Combo"), event("Suelto 1"), event("Suelto 2")]);
        const results = await Promise.all([commit(a.id, combo.id, 2), commit(b.id, chair.id, 4), commit(c.id, chair.id, 4)]);
        const chairs = await committed(chair.id);
        assert.ok(chairs <= 25, `ronda ${round}: ${chairs} sillas comprometidas de 25`);
        assert.ok((await committed(table.id)) <= 3);
        // Lo que dijo «ok» es exactamente lo comprometido (sin dobles ni faltantes).
        const expected = (results[0].ok ? 20 : 0) + (results[1].ok ? 4 : 0) + (results[2].ok ? 4 : 0);
        assert.equal(chairs, expected, `ronda ${round}`);
        for (const r of results) if (!r.ok) assert.ok(["insufficient"].includes(r.reason), `ronda ${round}: ${r.reason}`);
      }
    });

    await t.test("dos combos concurrentes sobre los mismos componentes: entra uno solo cuando solo alcanza para uno", async () => {
      for (let round = 0; round < 6; round++) {
        const { chair, combo, event, commit, committed } = await seed(15, 3);
        const [a, b] = await Promise.all([event("A"), event("B")]);
        const results = await Promise.all([commit(a.id, combo.id, 1), commit(b.id, combo.id, 1)]);
        assert.equal(results.filter((r) => r.ok).length, 1, `ronda ${round}`);
        assert.equal(await committed(chair.id), 10);
      }
    });

    await t.test("cancelar el evento del combo libera exactamente sus componentes (y no los sueltos de otro evento)", async () => {
      const { chair, table, combo, event, commit, capacity, committed } = await seed(25, 3);
      const [a, b] = await Promise.all([event("Con combo"), event("Con sillas sueltas")]);
      assert.ok((await commit(a.id, combo.id, 2)).ok);
      assert.ok((await commit(b.id, chair.id, 3)).ok);
      assert.equal(await committed(chair.id), 23);
      await db.event.update({ where: { id: a.id }, data: { status: "CANCELLED" } });
      assert.equal(await committed(chair.id), 3, "quedan solo las 3 sueltas");
      assert.equal(await committed(table.id), 0);
      assert.equal((await capacity()).capacity, 2);
    });

    await t.test("liberar un combo resta solo su parte: la asignación suelta del mismo evento se conserva", async () => {
      const { org, chair, table, combo, event, commit, committed } = await seed(25, 3);
      const a = await event("Mixto");
      assert.ok((await commit(a.id, chair.id, 3)).ok);
      const placed = await commit(a.id, combo.id, 1);
      assert.ok(placed.ok);
      const row = await db.eventInventory.findUniqueOrThrow({ where: { eventId_inventoryId: { eventId: a.id, inventoryId: chair.id } } });
      assert.equal(row.quantity, 13);
      assert.equal(row.comboQuantity, 10);
      // El suelto no puede pisar la parte del combo, ni liberar o quitar el componente.
      assert.equal(reasonOf(await commit(a.id, chair.id, 5)), "conflict");
      const blocked = await releaseAssignment({ organizationId: org, assignmentId: row.id });
      assert.equal(!blocked.ok && blocked.reason, "conflict");
      assert.ok((await commit(a.id, chair.id, 15)).ok, "subir lo suelto sí se puede");
      const released = await releaseAssignment({ organizationId: org, assignmentId: placed.ok ? placed.assignment.id : "" });
      assert.ok(released.ok);
      const after = await db.eventInventory.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(after.quantity, 5, "15 - 10 del combo");
      assert.equal(after.comboQuantity, 0);
      assert.equal(await committed(chair.id), 5);
      assert.equal(await committed(table.id), 0);
      assert.equal(await db.eventInventory.count({ where: { eventId: a.id, inventoryId: table.id } }), 0, "la fila que era solo del combo se borra");
      // Liberar dos veces no resta dos veces.
      const again = await releaseAssignment({ organizationId: org, assignmentId: placed.ok ? placed.assignment.id : "" });
      assert.ok(again.ok && again.unchanged);
      assert.equal(await committed(chair.id), 5);
    });

    await t.test("retención de combo: confirmar revalida todos los componentes", async () => {
      const { org, chair, combo, event, commit, committed } = await seed(25, 3);
      const [a, b] = await Promise.all([event("A"), event("B")]);
      const held = await commit(a.id, combo.id, 2, { hold: true });
      assert.ok(held.ok);
      assert.equal(await committed(chair.id), 20);
      // Vence la retención: las sillas vuelven y otro evento las toma.
      await db.eventInventory.updateMany({ where: { eventId: a.id }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
      assert.equal(await committed(chair.id), 0);
      assert.ok((await commit(b.id, chair.id, 10)).ok);
      const confirm = await confirmHold({ organizationId: org, assignmentId: held.ok ? held.assignment.id : "" });
      assert.equal(!confirm.ok && confirm.reason, "insufficient", "ya no alcanza para 2 combos");
      assert.equal(await committed(chair.id), 10);
    });

    await t.test("un combo dentro de otro combo es rechazado (ambos sentidos)", async () => {
      const { org, chair, table, combo } = await seed(25, 3);
      const asComponent = await saveCombo({
        organizationId: org,
        data: { name: "Mega combo", category: "Combos", sku: null },
        components: [
          { componentId: combo.id, quantity: 1 },
          { componentId: table.id, quantity: 1 },
        ],
      });
      assert.equal(!asComponent.ok && asComponent.reason, "nested");
      // El componente suelto que ya forma parte de un combo no puede volverse combo.
      const becomes = await saveCombo({ organizationId: org, id: chair.id, data: { name: "Silla", category: "Mobiliario", sku: null }, components: [{ componentId: table.id, quantity: 1 }] });
      assert.equal(!becomes.ok && becomes.reason, "invalid", "la silla no es un combo (no tiene componentes)");
      const self = await saveCombo({ organizationId: org, id: combo.id, data: { name: "Kit", category: "Combos", sku: null }, components: [{ componentId: combo.id, quantity: 1 }] });
      assert.equal(!self.ok && self.reason, "nested");
      // La base también lo impide: padre = componente viola el CHECK.
      await assert.rejects(db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: org, parentId: combo.id, componentId: combo.id, quantity: 1 } }));
      await assert.rejects(db.inventoryComponent.create({ data: { id: randomUUID(), organizationId: org, parentId: combo.id, componentId: table.id, quantity: 0 } }));
    });

    await t.test("otra empresa: 404 en componentes, asignación, liberación y sustitución", async () => {
      const a = await seed(25, 3);
      const b = await seed(25, 3);
      const eventB = await b.event("EB");
      // Combo y componente ajenos.
      const foreignComponent = await saveCombo({ organizationId: b.org, data: { name: "Kit ajeno", category: "Combos", sku: null }, components: [{ componentId: a.chair.id, quantity: 1 }] });
      assert.equal(!foreignComponent.ok && foreignComponent.reason, "component-missing");
      const foreignEdit = await saveCombo({ organizationId: b.org, id: a.combo.id, data: { name: "X", category: "Combos", sku: null }, components: [{ componentId: b.chair.id, quantity: 1 }] });
      assert.equal(!foreignEdit.ok && foreignEdit.reason, "not-found");
      assert.equal(reasonOf(await b.commit(eventB.id, a.combo.id, 1)), "item-missing");
      const placed = await a.commit((await a.event("EA")).id, a.combo.id, 1);
      assert.ok(placed.ok);
      const assignmentId = placed.ok ? placed.assignment.id : "";
      const released = await releaseComboAssignment({ organizationId: b.org, assignmentId });
      assert.equal(!released.ok && released.reason, "not-found");
      const sub = await substituteComboComponent({ organizationId: b.org, assignmentId, componentId: a.chair.id, substituteId: b.chair.id });
      assert.equal(!sub.ok && sub.reason, "not-found");
      assert.equal(await a.committed(a.chair.id), 10, "la empresa ajena no tocó nada");
      assert.equal((await comboCapacitiesForRange({ organizationId: b.org, comboIds: [a.combo.id], startsAt: day(10), endsAt: day(13) })).size, 0);
    });

    await t.test("sustitución autorizada: misma categoría, con stock y registrada en el combo", async () => {
      const { org, chair, combo, event, commit, committed } = await seed(25, 3);
      const spare = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Silla tiffany", category: "Mobiliario", quantity: 12 } });
      const other = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Parlante", category: "Sonido", quantity: 20 } });
      const small = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Silla corta", category: "Mobiliario", quantity: 4 } });
      const a = await event("A");
      const placed = await commit(a.id, combo.id, 1);
      assert.ok(placed.ok);
      const assignmentId = placed.ok ? placed.assignment.id : "";
      const base = { organizationId: org, assignmentId, componentId: chair.id };
      assert.equal((await substituteComboComponent({ ...base, substituteId: other.id })).ok, false, "otra categoría");
      const noStock = await substituteComboComponent({ ...base, substituteId: small.id });
      assert.equal(!noStock.ok && noStock.reason, "insufficient");
      const done = await substituteComboComponent({ ...base, substituteId: spare.id });
      assert.ok(done.ok, JSON.stringify(done));
      assert.equal(await committed(chair.id), 0, "las sillas originales quedan libres");
      assert.equal(await committed(spare.id), 10);
      const row = await db.eventInventory.findUniqueOrThrow({ where: { id: assignmentId } });
      assert.deepEqual(row.comboSubstitutions, { [chair.id]: spare.id });
      // Liberar el combo devuelve el sustituto, no el original.
      const released = await releaseComboAssignment({ organizationId: org, assignmentId });
      assert.ok(released.ok);
      assert.equal(await committed(spare.id), 0);
      assert.equal(await committed(chair.id), 0);
    });

    await t.test("combo con retención vencida sobre una fila compartida con 2 sueltas firmes: liberar, quitar o recomprometer devuelve exactamente su aporte", async () => {
      for (const action of ["release", "remove", "recommit"] as const) {
        const { org, chair, table, combo, event, commit, committed } = await seed(25, 3);
        const a = await event(`Mixto ${action}`);
        assert.ok((await commit(a.id, chair.id, 2)).ok);
        const placed = await commit(a.id, combo.id, 1, { hold: true });
        assert.ok(placed.ok);
        const comboId = placed.ok ? placed.assignment.id : "";
        const chairRow = () => db.eventInventory.findUniqueOrThrow({ where: { eventId_inventoryId: { eventId: a.id, inventoryId: chair.id } } });
        assert.equal((await chairRow()).quantity, 12);
        assert.equal((await chairRow()).holdExpiresAt, null, "la suelta firme mantiene firme la fila compartida");
        await db.eventInventory.update({ where: { id: comboId }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });

        if (action === "release") {
          assert.ok((await releaseComboAssignment({ organizationId: org, assignmentId: comboId })).ok);
        } else if (action === "remove") {
          assert.ok((await releaseComboAssignment({ organizationId: org, assignmentId: comboId, remove: true })).ok);
        } else {
          const again = await commit(a.id, combo.id, 1, { hold: false });
          assert.ok(again.ok, JSON.stringify(again));
          assert.equal(await committed(chair.id), 12, "recomprometer no suma otra vez el aporte viejo");
          assert.equal(await committed(table.id), 1);
          const row = await chairRow();
          assert.equal(row.quantity, 12);
          assert.equal(row.comboQuantity, 10);
          // Liberar ahora devuelve exactamente lo suyo.
          assert.ok((await releaseComboAssignment({ organizationId: org, assignmentId: comboId })).ok);
        }
        const row = await chairRow();
        assert.equal(row.quantity, 2, `${action}: la suelta queda en 2`);
        assert.equal(row.comboQuantity, 0, action);
        assert.equal(await committed(chair.id), 2, action);
        assert.equal(await committed(table.id), 0, action);
        // La suelta se puede liberar: no quedan unidades trabadas por el combo.
        const freed = await releaseAssignment({ organizationId: org, assignmentId: row.id });
        assert.ok(freed.ok, `${action}: ${JSON.stringify(freed)}`);
        assert.equal(await committed(chair.id), 0, action);
      }
    });

    await t.test("la suelta de una fila compartida con un combo vencido se libera directo (el lock descuenta el aporte vencido)", async () => {
      const { org, chair, combo, event, commit, committed } = await seed(25, 3);
      const a = await event("Mixto");
      assert.ok((await commit(a.id, chair.id, 2)).ok);
      const placed = await commit(a.id, combo.id, 1, { hold: true });
      assert.ok(placed.ok);
      await db.eventInventory.update({ where: { id: placed.ok ? placed.assignment.id : "" }, data: { holdExpiresAt: new Date(Date.now() - 60_000) } });
      const row = await db.eventInventory.findUniqueOrThrow({ where: { eventId_inventoryId: { eventId: a.id, inventoryId: chair.id } } });
      const freed = await releaseAssignment({ organizationId: org, assignmentId: row.id });
      assert.ok(freed.ok, JSON.stringify(freed));
      assert.equal(await committed(chair.id), 0);
    });

    await t.test("sustitución: si el sustituto ya está asignado en el evento con otro rango, es conflict", async () => {
      const { org, combo, chair, event, commit, committed } = await seed(25, 3);
      const spare = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Silla tiffany", category: "Mobiliario", quantity: 30 } });
      const a = await event("A");
      const placed = await commit(a.id, combo.id, 1);
      assert.ok(placed.ok);
      const loose = await commitInventoryAssignment({ organizationId: org, eventId: a.id, inventoryId: spare.id, quantity: 2, startsAt: day(11), endsAt: day(12) });
      assert.ok(loose.ok);
      const result = await substituteComboComponent({ organizationId: org, assignmentId: placed.ok ? placed.assignment.id : "", componentId: chair.id, substituteId: spare.id });
      assert.equal(!result.ok && result.reason, "conflict", JSON.stringify(result));
      assert.equal(await committed(chair.id), 10, "nada cambió");
      assert.equal(await committed(spare.id), 2);
    });

    await t.test("una unidad dañada de un componente limita el combo", async () => {
      const { org, table, combo, capacity } = await seed(25, 3);
      for (let i = 0; i < 2; i++) {
        await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: org, inventoryId: table.id, code: `MESA-${i}-${randomUUID().slice(0, 4)}`, status: i === 0 ? "DAMAGED" : "AVAILABLE" } });
      }
      // La mesa tiene 3 de stock y 1 unidad dañada: quedan 2 libres, igual que las sillas permiten.
      assert.equal((await capacity()).components.find((c) => c.name === "Mesa")?.available, 2);
      await db.inventoryUnit.create({ data: { id: randomUUID(), organizationId: org, inventoryId: table.id, code: `MESA-L-${randomUUID().slice(0, 4)}`, status: "LOST" } });
      assert.equal((await capacity()).limiting?.name, "Mesa");
      assert.equal((await capacity()).capacity, 1);
    });

    await t.test("reservar al aprobar un presupuesto con un combo expande sus componentes, sin duplicar y sin pisar lo suelto", async () => {
      const { org, client, chair, table, combo, event, committed } = await seed(25, 3);
      const approved = await event("Aprobado");
      const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client, eventId: approved.id, title: "P", status: "APPROVED" } });
      await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Kit mesa", quantity: 2, days: 1, unitPrice: 1000, subtotal: 2000, inventoryId: combo.id } });
      await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Sillas extra", quantity: 5, days: 1, unitPrice: 100, subtotal: 500, inventoryId: chair.id } });
      const context = portalAuditContext(org, "QA");
      const first = await reserveBudgetInventory({ organizationId: org, budgetId: budget.id, context });
      assert.equal(first.failed, false);
      assert.equal(first.conflicts, 0, JSON.stringify(first.outcomes.map((o) => [o.inventoryName, o.status, o.reason])));
      assert.equal(await committed(chair.id), 25, "20 del combo + 5 sueltas");
      assert.equal(await committed(table.id), 2);
      // Idempotente: reaprobar no suma otra vez.
      const second = await reserveBudgetInventory({ organizationId: org, budgetId: budget.id, context });
      assert.equal(second.failed, false);
      assert.equal(await committed(chair.id), 25);
      assert.equal(await committed(table.id), 2);
      const row = await db.eventInventory.findUniqueOrThrow({ where: { eventId_inventoryId: { eventId: approved.id, inventoryId: chair.id } } });
      assert.equal(row.comboQuantity, 20);
    });

    await t.test("presupuesto con más combos de los que hay: reserva lo que entra y reporta el faltante", async () => {
      const { org, client, chair, combo, event, committed } = await seed(25, 3);
      const approved = await event("Aprobado");
      const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client, eventId: approved.id, title: "P", status: "APPROVED" } });
      await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Kit mesa", quantity: 3, days: 1, unitPrice: 1000, subtotal: 3000, inventoryId: combo.id } });
      const result = await reserveBudgetInventory({ organizationId: org, budgetId: budget.id, context: portalAuditContext(org, "QA") });
      assert.equal(result.reserved, 2);
      assert.equal(result.conflicts, 1);
      assert.equal(await committed(chair.id), 20);
    });

    await t.test("reserva de presupuesto con combo y asignación suelta concurrentes no sobrevende (6 rondas)", async () => {
      for (let round = 0; round < 6; round++) {
        const { org, client, chair, table, combo, event, commit, committed } = await seed(25, 3);
        const [manual, approved] = await Promise.all([event("Manual"), event("Aprobado")]);
        const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client, eventId: approved.id, title: "P", status: "APPROVED" } });
        await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Kit", quantity: 2, days: 1, unitPrice: 1000, subtotal: 2000, inventoryId: combo.id } });
        await Promise.all([commit(manual.id, chair.id, 10), reserveBudgetInventory({ organizationId: org, budgetId: budget.id, context: portalAuditContext(org, "QA") })]);
        assert.ok((await committed(chair.id)) <= 25, `ronda ${round}`);
        assert.ok((await committed(table.id)) <= 3);
      }
    });

    await t.test("editar la composición de un combo con reservas activas es 409", async () => {
      const { org, chair, table, combo, event, commit } = await seed(25, 3);
      const a = await event("A");
      assert.ok((await commit(a.id, combo.id, 1)).ok);
      const edit = await saveCombo({ organizationId: org, id: combo.id, data: { name: "Kit", category: "Combos", sku: null }, components: [{ componentId: chair.id, quantity: 5 }, { componentId: table.id, quantity: 1 }] });
      assert.equal(!edit.ok && edit.reason, "has-reservations");
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } }).catch(() => undefined);
    await db.$disconnect();
  }
});
