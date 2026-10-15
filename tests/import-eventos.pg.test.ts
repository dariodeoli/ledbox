import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/import-eventos.pg.test.ts
test("importación de eventos: reservas, reimportación, sin stock, cancelado y aislamiento (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { applyCatalog } = await import("../lib/server/import-catalog");
  const { normalizeCatalog } = await import("../lib/import-catalog");
  const { normalizeEventos } = await import("../lib/import-eventos");
  const { applyEventos, planEventos } = await import("../lib/server/import-eventos");
  const { committedAssignmentWhere } = await import("../lib/server/inventory-availability");

  const orgs: string[] = [];
  const newOrg = async (label: string) => {
    const id = randomUUID();
    orgs.push(id);
    await db.organization.create({ data: { id, name: `Eventos QA ${label}`, slug: `ev-qa-${id}` } });
    const context = {
      organizationId: id,
      organization: { id, name: label, slug: id, planId: null },
      user: { id: "u", name: "Dueña", email: "u@x", role: "OWNER" },
      role: "OWNER",
      demo: false,
      sandbox: false,
    } as never;
    return { id, context };
  };
  const catalog = async (org: { id: string; context: never }, productos: Array<Record<string, unknown>>) => {
    const parsed = normalizeCatalog({ productos });
    assert.ok(parsed.ok);
    const result = await applyCatalog(org.context, { products: parsed.value.doc.productos, categories: parsed.value.doc.categorias, parseProblems: parsed.value.problems, photos: null, photoProblems: [], lote: randomUUID() });
    assert.equal(result.fallidos.length, 0, JSON.stringify(result.fallidos));
  };
  const docs = (eventos: Array<Record<string, unknown>>) => {
    const parsed = normalizeEventos({ eventos });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.problems.filter((p) => p.nivel === "error").length, 0, JSON.stringify(parsed.value.problems));
    return parsed.value.eventos;
  };
  const apply = (org: { context: never }, eventos: Array<Record<string, unknown>>) => applyEventos(org.context, { eventos: docs(eventos), lote: randomUUID() });
  const ev = (codigo: string, extra: Record<string, unknown> = {}) => ({
    codigo,
    nombre: `Evento ${codigo}`,
    cliente: { nombre: "Ana Pérez", telefono: "+595981000111", correo: "ana@ejemplo.com" },
    desde: "2031-05-10",
    hasta: "2031-05-11",
    lugar: "Salón X",
    estado: "confirmado",
    productos: [],
    notas: null,
    ...extra,
  });
  const committed = async (orgId: string, sku: string) => {
    const item = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: orgId, sku } });
    const rows = await db.eventInventory.findMany({ where: { inventoryId: item.id, ...committedAssignmentWhere(orgId) } });
    return { item, rows, total: rows.reduce((sum, row) => sum + row.quantity, 0) };
  };
  const eventByCode = async (orgId: string, codigo: string) => {
    const key = await db.idempotencyKey.findFirst({ where: { organizationId: orgId, scope: "import:evento", key: codigo.toLowerCase() } });
    const id = (key?.response as { eventId?: string } | null)?.eventId;
    return id ? db.event.findFirst({ where: { id, organizationId: orgId } }) : null;
  };

  try {
    const A = await newOrg("A");
    const B = await newOrg("B");
    const stock = [
      { codigo: "S-1", nombre: "Silla Tiffany", categoria: "Sillas", tipo: "unidad", precio: 10000, cantidad: 5 },
      { codigo: "L-1", nombre: "Lounge Oslo", categoria: "Living", tipo: "unidad", precio: 600000, cantidad: 1 },
      { codigo: "PK-1", nombre: "Juego de 2 sillas", categoria: "Juegos", tipo: "juego", precio: 20000, componentes: [{ codigo: "S-1", cantidad: 2 }] },
      { codigo: "PK-0", nombre: "Juego sin piezas", categoria: "Juegos", tipo: "juego", precio: null, componentes: [] },
    ];
    await catalog(A, stock);
    await catalog(B, [{ codigo: "S-1", nombre: "Silla B", categoria: "Sillas", tipo: "unidad", precio: 1, cantidad: 3 }, { codigo: "B-ONLY", nombre: "Solo de B", categoria: "Otros", tipo: "unidad", precio: 1, cantidad: 2 }]);

    await t.test("vista previa: no escribe nada y estima reservas, sin stock y clientes nuevos (con el propio archivo compitiendo)", async () => {
      const plan = await planEventos(A.context, docs([ev("EV-P1", { productos: [{ codigo: "L-1", cantidad: 1 }] }), ev("EV-P2", { cliente: { nombre: "Ana P.", telefono: "0981 000 111" }, productos: [{ codigo: "L-1", cantidad: 1 }] })]), [], { estimate: true });
      assert.equal(plan.summary.crear, 2);
      assert.equal(plan.summary.clientesNuevos, 1, "el mismo teléfono en dos eventos es un solo cliente nuevo");
      assert.equal(plan.summary.lineasReservadas, 1);
      assert.equal(plan.summary.lineasSinStock, 1, "el segundo evento pide el único Lounge que el primero ya se lleva");
      assert.ok(plan.problems.some((p) => p.tipo === "stock" && p.mensaje.startsWith("Lounge Oslo: piden 1, hay 0 libres en esas fechas")), JSON.stringify(plan.problems));
      assert.equal(await db.event.count({ where: { organizationId: A.id } }), 0);
      assert.equal(await db.client.count({ where: { organizationId: A.id } }), 0);
    });

    await t.test("crear con reservas: evento confirmado, fechas en la zona de la empresa, cliente nuevo, juego reserva sus componentes", async () => {
      const result = await apply(A, [ev("EV-1", { productos: [{ codigo: "S-1", cantidad: 3 }, { codigo: "PK-1", cantidad: 1 }, { codigo: "L-1", cantidad: 1 }] })]);
      assert.equal(result.fallidos.length, 0, JSON.stringify(result.fallidos));
      assert.equal(result.creados.length, 1);
      assert.equal(result.summary.lineasReservadas, 3);
      assert.equal(result.summary.clientesNuevos, 1);
      const event = await eventByCode(A.id, "EV-1");
      assert.ok(event);
      assert.equal(event.status, "CONFIRMED");
      assert.equal(event.startsAt?.toISOString(), "2031-05-10T03:00:00.000Z", "00:00 de Asunción (UTC-3)");
      assert.equal(event.endsAt?.toISOString(), "2031-05-12T02:59:00.000Z", "23:59 del último día");
      const client = await db.client.findFirstOrThrow({ where: { organizationId: A.id } });
      assert.equal(event.clientId, client.id);
      assert.equal(client.phone, "+595 981000111");
      assert.equal(client.email, "ana@ejemplo.com");
      assert.equal(await db.eventTask.count({ where: { eventId: event.id } }), 4);
      const chairs = await committed(A.id, "S-1");
      assert.equal(chairs.total, 5, "3 sueltas + 2 del juego");
      assert.ok(chairs.total <= chairs.item.quantity);
      assert.equal((await committed(A.id, "PK-1")).total, 1);
      assert.equal((await committed(A.id, "L-1")).total, 1);
    });

    await t.test("reimportar el mismo código actualiza y no duplica (eventos, clientes ni reservas)", async () => {
      const before = await db.eventInventory.count({ where: { event: { organizationId: A.id } } });
      const result = await apply(A, [ev("EV-1", { nombre: "Boda Pérez (corregido)", lugar: "Salón Y", cliente: { nombre: "Ana Pérez", telefono: "0981 000 111", correo: null }, productos: [{ codigo: "S-1", cantidad: 3 }, { codigo: "PK-1", cantidad: 1 }, { codigo: "L-1", cantidad: 1 }] })]);
      assert.equal(result.creados.length, 0);
      assert.equal(result.actualizados, 1);
      assert.equal(result.summary.clientesNuevos, 0, "el teléfono con otro formato encuentra al mismo cliente");
      assert.equal(await db.event.count({ where: { organizationId: A.id } }), 1);
      assert.equal(await db.client.count({ where: { organizationId: A.id } }), 1);
      assert.equal(await db.eventInventory.count({ where: { event: { organizationId: A.id } } }), before);
      const event = await eventByCode(A.id, "EV-1");
      assert.equal(event?.name, "Boda Pérez (corregido)");
      assert.equal(event?.location, "Salón Y");
      assert.equal((await committed(A.id, "S-1")).total, 5, "las sillas no se duplican");
    });

    await t.test("sin stock: nunca se sobrevende; el evento se crea con las líneas que entran y la que falta queda avisada", async () => {
      const result = await apply(A, [ev("EV-2", { cliente: { nombre: "Luis Gómez", telefono: "+595971222333" }, productos: [{ codigo: "S-1", cantidad: 1 }, { codigo: "L-1", cantidad: 2 }] })]);
      assert.equal(result.fallidos.length, 0, JSON.stringify(result.fallidos));
      assert.equal(result.creados.length, 1);
      assert.equal(result.summary.lineasReservadas, 0);
      assert.equal(result.summary.lineasSinStock, 2);
      assert.ok(result.avisos.some((a) => a.codigo === "EV-2" && a.mensaje.startsWith("Lounge Oslo: piden 2, hay 0 libres en esas fechas")), JSON.stringify(result.avisos));
      const event = await eventByCode(A.id, "EV-2");
      assert.ok(event);
      assert.match(event.notes ?? "", /Sin stock al importar: Lounge Oslo: piden 2/);
      assert.equal((await committed(A.id, "S-1")).total, 5);
      assert.equal((await committed(A.id, "L-1")).total, 1);
      // Fechas libres: el mismo pedido sí entra.
      const later = await apply(A, [ev("EV-2B", { desde: "2031-07-01", hasta: "2031-07-02", productos: [{ codigo: "S-1", cantidad: 5 }, { codigo: "L-1", cantidad: 2 }] })]);
      assert.equal(later.summary.lineasReservadas, 1, "5 sillas entran, 2 Lounge no (hay 1)");
      assert.equal(later.summary.lineasSinStock, 1);
      assert.ok(later.avisos.some((a) => a.mensaje.startsWith("Lounge Oslo: piden 2, hay 1 libre en esas fechas")), JSON.stringify(later.avisos));
    });

    await t.test("dos importaciones simultáneas por el último Lounge: solo una lo reserva", async () => {
      const [x, y] = await Promise.all([
        apply(A, [ev("EV-C1", { desde: "2031-09-01", hasta: "2031-09-01", productos: [{ codigo: "L-1", cantidad: 1 }] })]),
        apply(A, [ev("EV-C2", { desde: "2031-09-01", hasta: "2031-09-01", productos: [{ codigo: "L-1", cantidad: 1 }] })]),
      ]);
      assert.equal(x.summary.lineasReservadas + y.summary.lineasReservadas, 1);
      assert.equal(x.summary.lineasSinStock + y.summary.lineasSinStock, 1);
      const lounge = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: A.id, sku: "L-1" } });
      const onDay = await db.eventInventory.findMany({ where: { inventoryId: lounge.id, ...committedAssignmentWhere(A.id), event: { organizationId: A.id, startsAt: { gte: new Date("2031-08-30") }, endsAt: { lte: new Date("2031-09-03") } } } });
      assert.equal(onDay.reduce((s, r) => s + r.quantity, 0), 1);
    });

    await t.test("errores de fila: SKU inexistente y juego incompleto bloquean ese evento (nada se escribe)", async () => {
      const result = await apply(A, [
        ev("EV-E1", { productos: [{ codigo: "NO-EXISTE", cantidad: 1 }] }),
        ev("EV-E2", { productos: [{ codigo: "PK-0", cantidad: 1 }] }),
        ev("EV-OK", { desde: "2031-10-01", hasta: "2031-10-01", productos: [{ codigo: "S-1", cantidad: 1 }] }),
      ]);
      assert.equal(result.creados.length, 1, "solo el evento sano");
      assert.equal(result.omitidos, 2);
      assert.ok(result.fallidos.some((f) => f.codigo === "EV-E1" && /no existe en el inventario/.test(f.mensaje)));
      assert.ok(result.fallidos.some((f) => f.codigo === "EV-E2" && /juego incompleto/.test(f.mensaje)));
      assert.equal(await eventByCode(A.id, "EV-E1"), null);
      assert.equal(await eventByCode(A.id, "EV-E2"), null);
    });

    await t.test("borrador no reserva (anota los productos) y tentativo retiene con vencimiento", async () => {
      const result = await apply(A, [
        ev("EV-D", { estado: "borrador", desde: "2031-11-01", hasta: "2031-11-01", productos: [{ codigo: "S-1", cantidad: 5 }] }),
        ev("EV-T", { estado: "tentativo", desde: "2031-12-01", hasta: "2031-12-01", productos: [{ codigo: "S-1", cantidad: 2 }] }),
      ]);
      assert.equal(result.fallidos.length, 0, JSON.stringify(result.fallidos));
      const draft = await eventByCode(A.id, "EV-D");
      assert.equal(draft?.status, "DRAFT");
      assert.equal(await db.eventInventory.count({ where: { eventId: draft!.id } }), 0);
      assert.match(draft?.notes ?? "", /Productos pedidos \(sin reservar\): Silla Tiffany ×5/);
      const tentative = await eventByCode(A.id, "EV-T");
      assert.equal(tentative?.status, "DRAFT");
      const hold = await db.eventInventory.findFirstOrThrow({ where: { eventId: tentative!.id } });
      assert.ok(hold.holdExpiresAt && hold.holdExpiresAt > new Date(), "bloqueo tentativo con vencimiento");
    });

    await t.test("cancelado libera las reservas y el stock vuelve a estar disponible", async () => {
      const result = await apply(A, [ev("EV-1", { estado: "cancelado", productos: [{ codigo: "S-1", cantidad: 3 }, { codigo: "PK-1", cantidad: 1 }, { codigo: "L-1", cantidad: 1 }] })]);
      assert.equal(result.actualizados, 1);
      assert.ok(result.summary.lineasLiberadas >= 3, String(result.summary.lineasLiberadas));
      const event = await eventByCode(A.id, "EV-1");
      assert.equal(event?.status, "CANCELLED");
      assert.equal(await db.eventInventory.count({ where: { eventId: event!.id, releasedAt: null } }), 0);
      assert.equal((await committed(A.id, "L-1")).rows.filter((r) => r.eventId === event!.id).length, 0);
      // Lo liberado se puede volver a reservar en esas fechas.
      const again = await apply(A, [ev("EV-3", { productos: [{ codigo: "S-1", cantidad: 5 }, { codigo: "L-1", cantidad: 1 }] })]);
      assert.equal(again.summary.lineasReservadas, 2, JSON.stringify(again.avisos));
      assert.equal(again.summary.lineasSinStock, 0);
    });

    await t.test("reimportar con el stock agotado no sobrevende ni duplica filas; un cancelado se reactiva cuando hay lugar", async () => {
      const event = await eventByCode(A.id, "EV-2");
      const rowsBefore = await db.eventInventory.count({ where: { eventId: event!.id } });
      const may = async () => {
        const chairs = await db.inventoryItem.findFirstOrThrow({ where: { organizationId: A.id, sku: "S-1" } });
        const rows = await db.eventInventory.findMany({ where: { inventoryId: chairs.id, ...committedAssignmentWhere(A.id), event: { organizationId: A.id, startsAt: { gte: new Date("2031-05-01") }, endsAt: { lte: new Date("2031-05-31") } } } });
        return rows.reduce((sum, row) => sum + row.quantity, 0);
      };
      // EV-3 se llevó las 5 sillas de esos días: reimportar EV-2 no puede sobrevender.
      const result = await apply(A, [ev("EV-2", { cliente: { nombre: "Luis Gómez", telefono: "+595971222333" }, productos: [{ codigo: "S-1", cantidad: 1 }] })]);
      assert.equal(result.actualizados, 1);
      assert.equal(result.summary.lineasSinStock, 1);
      assert.equal(await db.eventInventory.count({ where: { eventId: event!.id } }), rowsBefore);
      assert.equal(await may(), 5);
      // EV-3 se cancela; EV-1 (cancelado) se reactiva como confirmado y reutiliza su fila liberada.
      await apply(A, [ev("EV-3", { estado: "cancelado", productos: [{ codigo: "S-1", cantidad: 5 }, { codigo: "L-1", cantidad: 1 }] })]);
      assert.equal(await may(), 0);
      const first = await eventByCode(A.id, "EV-1");
      const rowsFirst = await db.eventInventory.count({ where: { eventId: first!.id } });
      const back = await apply(A, [ev("EV-1", { productos: [{ codigo: "S-1", cantidad: 4 }] })]);
      assert.equal(back.summary.lineasReservadas, 1, JSON.stringify(back.avisos));
      assert.equal((await eventByCode(A.id, "EV-1"))?.status, "CONFIRMED");
      assert.equal(await db.eventInventory.count({ where: { eventId: first!.id } }), rowsFirst, "no se duplican filas");
      assert.equal(await may(), 4);
    });

    await t.test("ruta: vista previa desde un JSON y aplicar el mismo documento (NDJSON, lote idempotente)", async () => {
      const { importarEventos } = await import("../lib/server/import-eventos-http");
      const { importModule } = await import("../lib/import-modules");
      const module = importModule("eventos")!;
      const json = JSON.stringify({ eventos: [ev("EV-H1", { desde: "2032-02-01", hasta: "2032-02-02", productos: [{ codigo: "S-1", cantidad: 2 }] })] });
      const form = new FormData();
      form.set("accion", "preview");
      form.set("fuente", "json");
      form.set("json", new File([json], "eventos.json", { type: "application/json" }));
      const preview = await importarEventos(module, A.context, form, "preview");
      assert.equal(preview.status, 200);
      const body = (await preview.json()) as { catalogo: unknown; tarjetas: Array<{ clave: string; valor: number }>; filas: Array<{ codigo: string; accion: string }> };
      assert.deepEqual(body.tarjetas.map((c) => c.clave), ["crear", "actualizar", "clientesNuevos", "lineasReservadas", "lineasSinStock", "errores"]);
      assert.equal(body.tarjetas.find((c) => c.clave === "crear")?.valor, 1);
      assert.deepEqual(body.filas.map((f) => `${f.codigo}:${f.accion}`), ["EV-H1:crear"]);
      assert.equal(await eventByCode(A.id, "EV-H1"), null, "la vista previa no escribe");

      const lote = randomUUID();
      const apply = new FormData();
      apply.set("accion", "apply");
      apply.set("catalogo", JSON.stringify(body.catalogo));
      apply.set("lote", lote);
      const applied = await importarEventos(module, A.context, apply, "apply");
      assert.equal(applied.status, 200);
      const lines = (await applied.text()).trim().split("\n").map((line) => JSON.parse(line) as { resultado?: { creados: unknown[]; tarjetas: unknown[] }; error?: string });
      assert.ok(lines.at(-1)?.resultado, JSON.stringify(lines));
      assert.equal(lines.at(-1)!.resultado!.creados.length, 1);
      assert.ok(await eventByCode(A.id, "EV-H1"));
      const again = await importarEventos(module, A.context, apply, "apply");
      assert.equal(again.status, 409, "el mismo lote no se aplica dos veces");
      // Un documento manipulado se vuelve a validar.
      const bad = new FormData();
      bad.set("accion", "apply");
      bad.set("catalogo", JSON.stringify({ eventos: [{ codigo: "", nombre: "x" }] }));
      const rejected = await importarEventos(module, A.context, bad, "apply");
      assert.equal(rejected.status, 200);
      const rejectedLines = (await rejected.text()).trim().split("\n").map((line) => JSON.parse(line) as { resultado?: { creados: unknown[] } });
      assert.equal(rejectedLines.at(-1)?.resultado?.creados.length, 0);
    });

    await t.test("aislamiento entre empresas: mismo código de evento, SKU ajeno y clientes ajenos", async () => {
      const resultB = await apply(B, [ev("EV-1", { productos: [{ codigo: "S-1", cantidad: 3 }, { codigo: "B-ONLY", cantidad: 1 }] })]);
      assert.equal(resultB.creados.length, 1, "el mismo código en otra empresa es otro evento");
      assert.equal(resultB.summary.clientesNuevos, 1, "el teléfono de A no matchea clientes de B");
      const eventA = await eventByCode(A.id, "EV-1");
      const eventB = await eventByCode(B.id, "EV-1");
      assert.ok(eventA && eventB && eventA.id !== eventB.id);
      assert.equal(eventA.status, "CONFIRMED", "el evento de A no se tocó");
      assert.equal(eventB.status, "CONFIRMED");
      assert.equal(eventA.clientId === eventB.clientId, false);
      const itemsB = await db.inventoryItem.findMany({ where: { organizationId: B.id } });
      assert.equal(await db.eventInventory.count({ where: { eventId: eventB.id, inventoryId: { in: itemsB.map((i) => i.id) } } }), 2);
      assert.equal(await db.eventInventory.count({ where: { eventId: eventB.id, inventoryId: { notIn: itemsB.map((i) => i.id) } } }), 0);
      // Un SKU que solo existe en B es un error en A.
      const resultA = await apply(A, [ev("EV-X", { productos: [{ codigo: "B-ONLY", cantidad: 1 }] })]);
      assert.equal(resultA.creados.length, 0);
      assert.ok(resultA.fallidos.some((f) => /B-ONLY/.test(f.mensaje)));
      assert.equal(await eventByCode(A.id, "EV-X"), null);
      // Los clientes de A siguen siendo de A.
      assert.equal(await db.client.count({ where: { organizationId: B.id } }), 1);
    });
  } finally {
    for (const id of orgs) await db.organization.delete({ where: { id } }).catch(() => undefined);
    await db.$disconnect();
  }
});
