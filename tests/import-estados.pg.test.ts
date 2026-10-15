import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/import-estados.pg.test.ts
test("importar estados de unidades en PostgreSQL: alta, reimportación que sube y baja, asignadas intactas y aviso", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { applyCatalog, previewCatalog } = await import("../lib/server/import-catalog");
  const { normalizeCatalog } = await import("../lib/import-catalog");
  const { commitInventoryAssignment } = await import("../lib/server/inventory-availability");
  const { portalAuditContext } = await import("../lib/server/audit");

  const orgs: string[] = [];
  const org = randomUUID();
  orgs.push(org);
  await db.organization.create({ data: { id: org, name: "Estados QA", slug: `estados-qa-${org}` } });
  const ctx = portalAuditContext(org, "Importador QA");
  const input = (productos: Record<string, unknown>[]) => {
    const parsed = normalizeCatalog({ moneda: "PYG", productos });
    assert.ok(parsed.ok);
    return { products: parsed.value.doc.productos, parseProblems: parsed.value.problems, photos: null, photoProblems: [] };
  };
  const run = async (productos: Record<string, unknown>[]) => {
    const result = await applyCatalog(ctx, { ...input(productos), lote: randomUUID() });
    assert.deepEqual(result.fallidos, []);
    return result;
  };
  const statusCount = async (sku: string) => {
    const item = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku } });
    const rows = await db.inventoryUnit.groupBy({ by: ["status"], where: { inventoryId: item.id }, _count: { _all: true } });
    const out: Record<string, number> = { AVAILABLE: 0, MAINTENANCE: 0, DAMAGED: 0, LOST: 0, RETIRED: 0 };
    for (const row of rows) out[row.status] = row._count._all;
    return { item, out };
  };
  const silla = (extra: Record<string, unknown>) => ({ codigo: "S1", nombre: "Silla estados", tipo: "unidad", precio: 10000, cantidad: 10, ...extra });

  try {
    await t.test("la vista previa anuncia los estados y no escribe", async () => {
      const plan = await previewCatalog(org, input([silla({ en_mantenimiento: 2, danadas: 1, perdidas: 1 })]));
      assert.deepEqual([plan.summary.estadosMantenimiento, plan.summary.estadosDanadas, plan.summary.estadosPerdidas, plan.summary.estadosDisponibles], [2, 1, 1, 0]);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: org } }), 0);
    });

    await t.test("alta: N unidades quedan en cada estado y el resto disponible, con incidente y auditoría", async () => {
      await run([silla({ en_mantenimiento: 2, danadas: 1, perdidas: 1 })]);
      const { item, out } = await statusCount("S1");
      assert.deepEqual(out, { AVAILABLE: 6, MAINTENANCE: 2, DAMAGED: 1, LOST: 1, RETIRED: 0 });
      assert.equal(item.quantity, 10);
      const incidents = await db.inventoryIncident.findMany({ where: { organizationId: org, inventoryId: item.id } });
      assert.equal(incidents.length, 4);
      assert.ok(incidents.every((i) => i.notes === "Importación" && i.status === "OPEN" && i.unitId && !i.heldByQuantity));
      assert.deepEqual(incidents.map((i) => i.kind).sort(), ["DAMAGE", "MISSING", "REPAIR", "REPAIR"]);
      const audits = await db.auditLog.findMany({ where: { organizationId: org, entity: "InventoryUnit" } });
      assert.equal(audits.length, 4);
      assert.ok(audits.every((a) => /Importación/.test(a.summary)));
    });

    await t.test("reimportar el mismo archivo no cambia nada", async () => {
      await run([silla({ en_mantenimiento: 2, danadas: 1, perdidas: 1 })]);
      assert.deepEqual((await statusCount("S1")).out, { AVAILABLE: 6, MAINTENANCE: 2, DAMAGED: 1, LOST: 1, RETIRED: 0 });
      assert.equal(await db.inventoryIncident.count({ where: { organizationId: org } }), 4);
    });

    await t.test("reimportación que baja: 0 devuelve a disponible, el campo ausente no se toca y se resuelve el incidente", async () => {
      await run([silla({ en_mantenimiento: 1, danadas: 0 })]);
      const { item, out } = await statusCount("S1");
      assert.deepEqual(out, { AVAILABLE: 8, MAINTENANCE: 1, DAMAGED: 0, LOST: 1, RETIRED: 0 }, "perdidas ausente = sigue igual");
      const resolved = await db.inventoryIncident.count({ where: { inventoryId: item.id, status: "RESOLVED" } });
      assert.equal(resolved, 2, "una de mantenimiento y la dañada");
      assert.equal(await db.inventoryIncident.count({ where: { inventoryId: item.id, status: "OPEN" } }), 2);
    });

    await t.test("reimportación que sube, completando unidades y sin tocar las retiradas", async () => {
      const { item } = await statusCount("S1");
      const retired = await db.inventoryUnit.findFirstOrThrow({ where: { inventoryId: item.id, status: "AVAILABLE" } });
      await db.inventoryUnit.update({ where: { id: retired.id }, data: { status: "RETIRED" } });
      await db.inventoryItem.update({ where: { id: item.id }, data: { quantity: 9 } }); // como lo deja la ficha al retirar
      const result = await run([silla({ cantidad: 12, danadas: 3, perdidas: 1 })]);
      assert.equal(result.problems.filter((p) => p.tipo === "estado-incompleto").length, 0);
      const { out } = await statusCount("S1");
      assert.equal(out.RETIRED, 1);
      assert.equal(out.DAMAGED, 3);
      assert.equal(out.LOST, 1);
      assert.equal(out.MAINTENANCE, 1, "mantenimiento ausente = igual");
      assert.equal(out.AVAILABLE + out.MAINTENANCE + out.DAMAGED + out.LOST + out.RETIRED, 13, "12 activas + 1 retirada");
      assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: retired.id } })).status, "RETIRED");
    });

    await t.test("suma mayor que la cantidad: error bloqueante, no se crea nada", async () => {
      const request = [silla({ codigo: "S4", nombre: "Silla excedida", cantidad: 4, en_mantenimiento: 3, danadas: 2 })];
      const plan = await previewCatalog(org, input(request));
      assert.equal(plan.items[0].accion, "omitir");
      const error = plan.problems.find((p) => p.nivel === "error" && p.tipo === "estado-excede");
      assert.match(error!.mensaje, /suman 5 y el producto tiene 4/);
      const result = await applyCatalog(ctx, { ...input(request), lote: randomUUID() });
      assert.equal(result.omitidos, 1);
      assert.equal(await db.inventoryItem.count({ where: { organizationId: org, sku: "S4" } }), 0);
    });

    await t.test("unidades asignadas a eventos intactas: se ajustan las libres y el aviso dice cuántas", async () => {
      await run([{ codigo: "S2", nombre: "Silla asignada", tipo: "unidad", precio: 5000, cantidad: 10 }]);
      const { item } = await statusCount("S2");
      const client = randomUUID();
      await db.client.create({ data: { id: client, organizationId: org, name: "Cliente QA" } });
      const d = (n: number) => new Date(Date.UTC(2031, 2, n, 12));
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client, name: "Fiesta", setupAt: d(10), startsAt: d(11), endsAt: d(12), strikeAt: d(13) } });
      const reserved = await commitInventoryAssignment({ organizationId: org, eventId: event.id, inventoryId: item.id, quantity: 8, startsAt: d(10), endsAt: d(13) });
      assert.ok(reserved.ok);
      const request = [{ codigo: "S2", nombre: "Silla asignada", tipo: "unidad", precio: 5000, cantidad: 10, danadas: 5 }];
      const plan = await previewCatalog(org, input(request));
      const warning = plan.problems.find((p) => p.tipo === "estado-incompleto");
      assert.equal(warning?.nivel, "aviso");
      assert.match(warning!.mensaje, /solo se pudieron ajustar 2/);
      assert.equal(plan.items[0].accion, "actualizar");
      const result = await run(request);
      assert.ok(result.problems.some((p) => p.tipo === "estado-incompleto"));
      const { out } = await statusCount("S2");
      assert.deepEqual([out.DAMAGED, out.AVAILABLE], [2, 8], "quedan 8 disponibles para cubrir las 8 asignadas");
      const assignment = await db.eventInventory.findFirstOrThrow({ where: { inventoryId: item.id } });
      assert.equal(assignment.quantity, 8, "la asignación no cambia");
    });

    await t.test("juego: los campos de estado se ignoran con aviso y no crean unidades", async () => {
      const result = await run([
        silla({ codigo: "S3", nombre: "Silla B", cantidad: 5 }),
        { codigo: "J1", nombre: "Juego QA", tipo: "juego", precio: 20000, componentes: [{ codigo: "S3", cantidad: 2 }], danadas: 2 },
      ]);
      assert.ok(result.problems.some((p) => p.tipo === "estado-ignorado" && p.codigo === "J1"));
      const juego = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku: "J1" } });
      assert.equal(await db.inventoryUnit.count({ where: { inventoryId: juego.id } }), 0);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.$disconnect();
  }
});
