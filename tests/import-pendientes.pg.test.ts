import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/import-pendientes.pg.test.ts
test("importación: juego incompleto, unidad → juego, precio a consultar y foto de categoría (PostgreSQL)", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const sharp = (await import("sharp")).default;
  const { applyCatalog, previewCatalog } = await import("../lib/server/import-catalog");
  const { normalizeCatalog } = await import("../lib/import-catalog");
  const { commitInventoryAssignment } = await import("../lib/server/inventory-availability");
  const { checkStockBeforeApproval, decideStockApproval } = await import("../lib/server/approval-stock");
  const { loadComboDefinitions, saveCombo } = await import("../lib/server/inventory-combos");
  const { budgetPriceGate } = await import("../lib/server/budget-price-gate");
  const { setCategoryImage } = await import("../lib/server/category-image");
  const { loadPublicCategories } = await import("../lib/server/catalog-public");
  const { POST: portalApprove } = await import("../app/api/portal/budget/[token]/approve/route");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { BUDGET_CODE_ALPHABET } = await import("../lib/public-config");

  const day = (n: number) => new Date(Date.UTC(2031, 4, n, 12));
  const token = (id: string) => Array.from({ length: 20 }, (_, i) => BUDGET_CODE_ALPHABET[(id.charCodeAt(i) + i) % BUDGET_CODE_ALPHABET.length]).join("").match(/.{4}/g)!.join("-");
  const orgs: string[] = [];
  const newOrg = async () => {
    const id = randomUUID();
    orgs.push(id);
    await db.organization.create({ data: { id, name: "Pendientes QA", slug: `pend-qa-${id}` } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: id, name: "Cliente QA" } });
    return { id, client: client.id };
  };
  const jpeg = async (width: number, height: number, color: string) => new Uint8Array(await sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer());
  const input = async (raw: Record<string, unknown>, photos: Record<string, Uint8Array> | null = null) => {
    const parsed = normalizeCatalog(raw);
    assert.ok(parsed.ok);
    return { products: parsed.value.doc.productos, categories: parsed.value.doc.categorias, parseProblems: parsed.value.problems, photos: photos ? new Map(Object.entries(photos)) : null, photoProblems: [] };
  };
  const bySku = (org: string, sku: string) => db.inventoryItem.findFirstOrThrow({ where: { organizationId: org, sku }, include: { units: true, components: true } });

  try {
    const A = await newOrg();
    const B = await newOrg();
    const ctx = portalAuditContext(A.id, "QA");
    const owner = { organizationId: A.id, user: { id: "u", name: "Dueña", email: "u@x", role: "OWNER" } } as never;

    await t.test("la migración 202610290001 aplicada dos veces no falla", async () => {
      const { execFileSync } = await import("node:child_process");
      const file = new URL("../prisma/migrations/202610290001_import_pendientes/migration.sql", import.meta.url).pathname;
      for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
    });

    await t.test("cantidad null queda pendiente sin inventar unidades; juego vacío se importa como juego incompleto (sin stock, sin precio inventado)", async () => {
      const result = await applyCatalog(ctx, {
        ...(await input({
          productos: [
            { codigo: "U-NULL", nombre: "Plato sin conteo", categoria: "Platos", tipo: "unidad", precio: null, cantidad: null },
            { codigo: "PK-1", nombre: "Juego de mesa", categoria: "Juegos", tipo: "juego", precio: null, cantidad: 8, componentes: [] },
          ],
        })),
        lote: randomUUID(),
      });
      assert.equal(result.fallidos.length, 0, JSON.stringify(result.fallidos));
      assert.equal(result.summary.incompletos, 1);
      const unit = await bySku(A.id, "U-NULL");
      assert.equal(unit.units.length, 0, "cantidad null no crea disponibilidad ficticia");
      assert.equal(unit.quantity, 0);
      assert.equal(unit.stockCountStatus, "PENDING_COUNT");
      assert.equal(unit.listPrice, 0, "precio null queda en 0 = «Consultar»");
      const game = await bySku(A.id, "PK-1");
      assert.equal(game.comboIncomplete, true);
      assert.equal(game.quantity, 0);
      assert.equal(game.units.length, 0);
      assert.equal(game.components.length, 0);
      const definitions = await loadComboDefinitions(A.id, [game.id]);
      assert.equal(definitions.get(game.id)?.components.length, 0, "el inventario lo ve como juego sin piezas");
    });

    await t.test("un juego incompleto no se reserva (mensaje claro) ni se aprueba (ni con «Aprobar igual»)", async () => {
      const game = await bySku(A.id, "PK-1");
      const eventId = randomUUID();
      await db.event.create({ data: { id: eventId, organizationId: A.id, clientId: A.client, name: "Evento", setupAt: day(10), startsAt: day(11), endsAt: day(12), strikeAt: day(13), status: "CONFIRMED" } });
      const manual = await commitInventoryAssignment({ organizationId: A.id, eventId, inventoryId: game.id, quantity: 1 });
      assert.equal(manual.ok, false);
      assert.ok(!manual.ok && manual.reason === "conflict" && /juego incompleto/.test(manual.message), JSON.stringify(manual));
      assert.equal(await db.eventInventory.count({ where: { inventoryId: game.id } }), 0);

      const budgetId = randomUUID();
      await db.budget.create({ data: { id: budgetId, organizationId: A.id, clientId: A.client, eventId, title: "Presu", status: "SENT", subtotal: 100_000, total: 100_000, publicToken: token(budgetId) } as never });
      await db.budgetItem.create({ data: { id: randomUUID(), budgetId, name: "Juego", quantity: 1, days: 1, unitPrice: 100_000, subtotal: 100_000, inventoryId: game.id } });
      const gate = await checkStockBeforeApproval({ organizationId: A.id, budgetId, context: ctx });
      assert.equal(gate.ok, false);
      assert.ok(!gate.ok && gate.incomplete && /es un juego incompleto/.test(gate.message));
      const forced = decideStockApproval(gate, true, "OWNER");
      assert.equal(forced.kind, "blocked");
      assert.equal(forced.kind === "blocked" && forced.canForce, false);
      // Tenencia: el mismo presupuesto visto desde otra empresa no devuelve nada.
      assert.equal((await checkStockBeforeApproval({ organizationId: B.id, budgetId, context: portalAuditContext(B.id, "QA") })).ok, true);
    });

    await t.test("al cargarle piezas (reimportación) deja de ser incompleto; el editor (saveCombo) hace lo mismo", async () => {
      const first = await applyCatalog(ctx, {
        ...(await input({ productos: [{ codigo: "P-1", nombre: "Pieza", cantidad: 10 }, { codigo: "P-2", nombre: "Otra pieza", cantidad: 10 }, { codigo: "PK-1", nombre: "Juego de mesa", tipo: "juego", componentes: [{ codigo: "P-1", cantidad: 2 }] }] })),
        lote: randomUUID(),
      });
      assert.equal(first.fallidos.length, 0, JSON.stringify(first.fallidos));
      const game = await bySku(A.id, "PK-1");
      assert.equal(game.comboIncomplete, false);
      assert.equal(game.components.length, 1);
      assert.equal(game.units.length, 0);
      assert.equal((await loadComboDefinitions(A.id, [game.id])).get(game.id)?.components.length, 1);

      // Editor: otro juego incompleto se completa con saveCombo.
      await applyCatalog(ctx, { ...(await input({ productos: [{ codigo: "PK-ED", nombre: "Juego del editor", tipo: "juego" }] })), lote: randomUUID() });
      const draft = await bySku(A.id, "PK-ED");
      assert.equal(draft.comboIncomplete, true);
      const p2 = await bySku(A.id, "P-2");
      const saved = await saveCombo({ organizationId: A.id, id: draft.id, data: { name: draft.name, category: "Juegos", sku: "PK-ED" }, components: [{ componentId: p2.id, quantity: 1 }] });
      assert.ok(saved.ok, JSON.stringify(saved));
      assert.equal((await bySku(A.id, "PK-ED")).comboIncomplete, false);
    });

    await t.test("reimportar unidad → combo: sin reservas ni historial se convierte; con historial o reservas es bloqueante y no cambia nada", async () => {
      await applyCatalog(ctx, {
        ...(await input({ productos: [{ codigo: "C-1", nombre: "Copa", cantidad: 10 }, { codigo: "U-OK", nombre: "Set limpio sin unidades", cantidad: 0 }, { codigo: "U-META", nombre: "Set con depósito", cantidad: 3 }, { codigo: "U-HIST", nombre: "Set con daño", cantidad: 3 }, { codigo: "U-RES", nombre: "Set reservado", cantidad: 3 }] })),
        lote: randomUUID(),
      });
      const hist = await bySku(A.id, "U-HIST");
      await db.inventoryUnit.update({ where: { id: hist.units[0].id }, data: { status: "MAINTENANCE" } });
      const reserved = await bySku(A.id, "U-RES");
      const eventId = randomUUID();
      await db.event.create({ data: { id: eventId, organizationId: A.id, clientId: A.client, name: "Evento 2", setupAt: day(20), startsAt: day(21), endsAt: day(22), strikeAt: day(23), status: "CONFIRMED" } });
      await db.eventInventory.create({ data: { id: randomUUID(), eventId, inventoryId: reserved.id, quantity: 1 } as never });

      const asGames = await input({ productos: ["U-OK", "U-META", "U-HIST", "U-RES"].map((codigo) => ({ codigo, nombre: codigo, tipo: "juego", componentes: [{ codigo: "C-1", cantidad: 2 }] })) });
      const plan = await previewCatalog(A.id, asGames);
      assert.equal(plan.summary.convertidos, 1);
      assert.equal(plan.problems.filter((p) => p.tipo === "juego-no-convertible" && p.nivel === "error").length, 3);
      assert.ok(plan.problems.some((p) => p.tipo === "juego-convertido"));

      const result = await applyCatalog(ctx, { ...asGames, lote: randomUUID() });
      assert.equal(result.fallidos.length, 0, JSON.stringify(result.fallidos));
      const ok = await bySku(A.id, "U-OK");
      assert.equal(ok.components.length, 1);
      assert.equal(ok.units.length, 0, "sus unidades limpias se retiraron");
      assert.equal(ok.quantity, 0);
      assert.equal(ok.comboIncomplete, false);
      for (const sku of ["U-META", "U-HIST", "U-RES"]) {
        const untouched = await bySku(A.id, sku);
        assert.equal(untouched.components.length, 0);
        assert.equal(untouched.units.length, 3, "sigue siendo una unidad con sus unidades");
      }
      // El motor también lo defiende si la vista previa quedó vieja: saveCombo con convertFromUnit revalida.
      const comp = await bySku(A.id, "C-1");
      const direct = await saveCombo({ organizationId: A.id, id: hist.id, data: { name: "x", category: "Sets", sku: "U-HIST" }, components: [{ componentId: comp.id, quantity: 1 }], convertFromUnit: true });
      assert.equal(direct.ok, false);
      assert.equal((await bySku(A.id, "U-HIST")).units.length, 3);
    });

    await t.test("presupuesto: línea en 0 queda «falta precio» y bloquea aprobar y cobrar hasta cargar el precio o marcarla gratis", async () => {
      const budgetId = randomUUID();
      await db.budget.create({ data: { id: budgetId, organizationId: A.id, clientId: A.client, title: "Sin precio", status: "SENT", subtotal: 0, total: 0, publicToken: token(budgetId) } as never });
      const line = await db.budgetItem.create({ data: { id: randomUUID(), budgetId, name: "Plato sin conteo", quantity: 2, days: 1, unitPrice: 0, subtotal: 0 } });
      const message = await budgetPriceGate(A.id, budgetId, "aprobar");
      assert.match(message ?? "", /Falta precio en esta línea: «Plato sin conteo»/);
      assert.match((await budgetPriceGate(A.id, budgetId, "cobrar")) ?? "", /antes de cobrar/);
      assert.equal(await budgetPriceGate(B.id, budgetId, "aprobar"), null, "otra empresa no ve ni bloquea líneas ajenas");

      const res = await portalApprove(
        new Request("http://localhost/api/portal/budget/x/approve", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.0.1" }, body: JSON.stringify({ name: "Ana Pérez", consent: true }) }),
        { params: Promise.resolve({ token: token(budgetId) }) },
      );
      assert.equal(res.status, 409);
      assert.equal(((await res.json()) as { code?: string }).code, "price_missing");
      assert.equal((await db.budget.findUniqueOrThrow({ where: { id: budgetId } })).approvedAt, null);

      // Un 0 explícito pero confirmado como gratis a propósito es válido.
      await db.budgetItem.update({ where: { id: line.id }, data: { freeOnPurpose: true } });
      assert.equal(await budgetPriceGate(A.id, budgetId, "aprobar"), null);
      // Precio cargado: tampoco bloquea. Una línea excluida en 0 no cuenta.
      await db.budgetItem.update({ where: { id: line.id }, data: { freeOnPurpose: false, unitPrice: 5000, subtotal: 10_000 } });
      await db.budgetItem.create({ data: { id: randomUUID(), budgetId, name: "Retirado", quantity: 1, days: 1, unitPrice: 0, subtotal: 0, excluded: true } });
      assert.equal(await budgetPriceGate(A.id, budgetId, "enviar"), null);
    });

    await t.test("foto de categoría: se crea la categoría, queda con foto y orden, reimportar la reemplaza y una no cuadrada no se guarda", async () => {
      const v1 = await jpeg(1200, 1200, "#c33");
      const first = await applyCatalog(ctx, {
        ...(await input({ productos: [{ codigo: "PL-1", nombre: "Plato llano", categoria: "Platos", cantidad: 5 }], categorias: [{ nombre: "Platos", foto: "cat-platos.jpg", orden: 3 }, { nombre: "Copas", foto: "cat-copas.jpg", orden: 1 }] }, { "cat-platos.jpg": v1, "cat-copas.jpg": await jpeg(1600, 900, "#33c") })),
        lote: randomUUID(),
      });
      assert.equal(first.summary.fotosCategoria, 2, "la vista previa cuenta las fotos de categoría encontradas");
      assert.equal(first.fotosCategoria, 1, "solo la cuadrada se guarda");
      assert.ok(first.fallidos.some((f) => /cuadrada/.test(f.mensaje) && /Copas/.test(f.codigo)));
      const platos = await db.inventoryCategory.findFirstOrThrow({ where: { organizationId: A.id, key: "platos" } });
      assert.equal(platos.sortOrder, 3);
      assert.match(platos.imageUrl ?? "", new RegExp(`^/api/category-images/${platos.id}\\?v=`));
      assert.equal(platos.imageMime, "image/webp");
      assert.ok((platos.imageData?.byteLength ?? 0) > 0 && platos.imageData!.byteLength <= 1024 * 1024);
      const copas = await db.inventoryCategory.findFirstOrThrow({ where: { organizationId: A.id, key: "copas" } });
      assert.equal(copas.imageUrl, null);
      assert.equal(copas.sortOrder, 1, "la categoría se crea aunque la foto no sirva");

      // Reimportar con el nombre escrito distinto (mayúsculas/acentos) actualiza la MISMA categoría.
      const before = platos.imageUrl;
      await new Promise((resolve) => setTimeout(resolve, 5));
      await applyCatalog(ctx, { ...(await input({ productos: [{ codigo: "PL-1", nombre: "Plato llano", categoria: "Platos", cantidad: 5 }], categorias: [{ nombre: " PLATOS ", foto: "cat-platos.jpg" }] }, { "cat-platos.jpg": await jpeg(1200, 1200, "#3c3") })), lote: randomUUID() });
      assert.equal(await db.inventoryCategory.count({ where: { organizationId: A.id, key: "platos" } }), 1);
      const after = await db.inventoryCategory.findFirstOrThrow({ where: { organizationId: A.id, key: "platos" } });
      assert.notEqual(after.imageUrl, before);
      assert.equal(after.sortOrder, 3, "sin «orden» no se toca");

      // La tienda recibe imageUrl; la empresa B no ve nada de A y no puede tocar su categoría.
      const publicRows = await loadPublicCategories(A.id);
      assert.equal(publicRows.find((row) => row.name === "Platos")?.imageUrl, after.imageUrl);
      assert.deepEqual(await loadPublicCategories(B.id), []);
      assert.equal(await db.$transaction((tx) => setCategoryImage(tx, B.id, platos.id, null)), false);
      assert.ok((await db.inventoryCategory.findUniqueOrThrow({ where: { id: platos.id } })).imageUrl);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.$disconnect();
  }
});
