import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

// Opt-in: necesita un Postgres descartable con las migraciones aplicadas.
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:<puerto>/<base> node --import tsx --test --test-concurrency=1 tests/precios-flete.pg.test.ts
test("precio por días, flete por zona y paquetes en PostgreSQL: tienda → presupuesto, aprobado inmutable, tenencia y motor de combos", { skip: !process.env.TEST_DATABASE_URL }, async (t) => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname), "solo una base local descartable");
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const retailRoute = await import("../app/api/catalog/[orgSlug]/preorder/route");
  const wholesaleRoute = await import("../app/api/catalog/[orgSlug]/mayorista/[token]/preorder/route");
  const catalog = await import("../lib/server/catalog-public");
  const access = await import("../lib/server/catalog-access");
  const { convertQuoteRequest } = await import("../lib/server/catalog-convert");
  const { replacePriceTiers } = await import("../lib/server/price-tier-store");
  const { resolveDeliveryChoice, listDeliveryZones } = await import("../lib/server/delivery-zones");
  const { saveCombo, substituteComboComponent } = await import("../lib/server/inventory-combos");
  const { comboQuote } = await import("../lib/server/combo-quote");
  const { reserveBudgetInventory } = await import("../lib/server/inventory-availability");
  const { checkStockBeforeApproval } = await import("../lib/server/approval-stock");
  const { portalAuditContext } = await import("../lib/server/audit");
  const { selectionLine } = await import("../lib/quote-selection");

  const orgs: string[] = [];
  const future = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  let ipCounter = 0;
  const ip = () => `10.8.0.${++ipCounter}`;
  async function seed() {
    const org = randomUUID();
    orgs.push(org);
    const slug = `precios-${org.slice(0, 8)}`;
    await db.organization.create({ data: { id: org, name: `Empresa ${slug}`, slug } });
    await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: org, publicCatalogEnabled: true, publicShowPrices: true, depositPercent: 50 } });
    const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Diego Mayorista", company: "Agencia", type: "RESELLER", email: "diego@agencia.test", phone: "+595 984 000 111" } });
    const item = (name: string, extra: Record<string, unknown> = {}) =>
      db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category: "Mobiliario", quantity: 200, visibleOnWeb: true, catalogAudience: "BOTH", listPrice: 100_000, wholesalePrice: 70_000, ...extra } });
    const mesa = await item("Mesa");
    const evento = await item("Tótem por evento", { billingUnit: "EVENT", listPrice: 660_000 });
    await replacePriceTiers(db, org, mesa.id, [
      { audience: "RETAIL", fromDays: 5, mode: "TOTAL", price: 300_000 },
      { audience: "WHOLESALE", fromDays: 3, mode: "PER_DAY", price: 50_000 },
    ]);
    await replacePriceTiers(db, org, evento.id, [{ audience: "RETAIL", fromDays: 2, mode: "TOTAL", price: 1 }]);
    return { org, slug, client, mesa, evento };
  }
  const ctx = (org: string) => ({ organizationId: org, user: { id: "u", name: "U", email: "u@x", role: "OWNER" } }) as never;
  const post = (slug: string, body: Record<string, unknown>) =>
    retailRoute.POST(new Request(`http://localhost/api/catalog/${slug}/preorder`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify(body) }), { params: Promise.resolve({ orgSlug: slug }) });
  const form = (items: Array<{ inventoryId: string; quantity: number }>, days: number, extra: Record<string, unknown> = {}) => ({
    name: "Ana Pérez", phone: "+595 981 000 111", email: "ana@example.com", location: "Asunción", from: future(10), to: future(9 + days), items, ...extra,
  });

  try {
    await t.test("migración: el backfill pasa los «desde X días» a escalones por día y re-ejecutarla no duplica", async () => {
      const org = randomUUID();
      orgs.push(org);
      await db.organization.create({ data: { id: org, name: "Backfill", slug: `backfill-${org.slice(0, 8)}` } });
      const old = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Con regla vieja", category: "X", listPrice: 100, listFromDays: 3, listFromPrice: 80, wholesalePrice: 60, wholesaleFromDays: 5, wholesaleFromPrice: 40 } });
      const none = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Sin regla", category: "X", listPrice: 100 } });
      const half = await db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name: "Umbral sin precio", category: "X", listPrice: 100, listFromDays: 3, listFromPrice: 0 } });
      const file = new URL("../prisma/migrations/202610220001_price_tiers_delivery_zones/migration.sql", import.meta.url).pathname;
      for (let i = 0; i < 2; i++) execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-q", "-f", file], { stdio: "pipe" });
      const tiers = await db.inventoryPriceTier.findMany({ where: { inventoryId: old.id }, orderBy: { audience: "asc" } });
      assert.deepEqual(tiers.map((row) => [row.audience, row.fromDays, row.mode, row.price]), [["RETAIL", 3, "PER_DAY", 80], ["WHOLESALE", 5, "PER_DAY", 40]]);
      assert.equal(await db.inventoryPriceTier.count({ where: { inventoryId: { in: [none.id, half.id] } } }), 0, "sin regla completa no se inventa un escalón");
      // Las columnas viejas no se tocan.
      const row = await db.inventoryItem.findUniqueOrThrow({ where: { id: old.id } });
      assert.deepEqual([row.listFromDays, row.listFromPrice], [3, 80]);
    });

    await t.test("pedido de la tienda con escalón y flete → presupuesto con el total correcto", async () => {
      const a = await seed();
      const zone = await db.deliveryZone.create({ data: { id: randomUUID(), organizationId: a.org, name: "Gran Asunción", basePrice: 150_000, volumeThreshold: 50, extraPrice: 80_000 } });
      // 5 días × 2 mesas: escalón TOTAL de 300.000 por mesa → 600.000 + flete 150.000.
      const res = await post(a.slug, form([{ inventoryId: a.mesa.id, quantity: 2 }], 5, { deliveryZoneId: zone.id }));
      assert.equal(res.status, 201, await res.clone().text());
      const { preorder } = (await res.json()) as { preorder: { token: string; subtotal: number } };
      assert.equal(preorder.subtotal, 750_000, "la tienda estima ítems + flete");
      const quote = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: preorder.token }, include: { items: true } });
      assert.deepEqual([quote.deliveryZoneId, quote.deliveryZoneName, quote.deliveryCoordinate], [zone.id, "Gran Asunción", false]);
      assert.deepEqual([quote.items[0].unitPrice, quote.items[0].subtotal], [300_000, 600_000]);
      const out = await convertQuoteRequest(ctx(a.org), quote.id);
      assert.ok(out.ok);
      if (!out.ok) return;
      assert.equal(out.budget.total, 750_000, "mismo total que mostró la tienda");
      const budget = await db.budget.findUniqueOrThrow({ where: { id: out.budget.id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
      const [line, flete] = budget.items;
      assert.deepEqual([line.days, line.unitPrice, line.subtotal, line.quantity], [1, 300_000, 600_000, 2], "el total cerrado se guarda como días = 1");
      assert.equal(line.notes, "Precio total por 5 días");
      assert.equal((line.pricingSnapshot as { rentalDays: number }).rentalDays, 5);
      assert.deepEqual([flete.name, flete.unitPrice, flete.subtotal, flete.inventoryId], ["Flete — Gran Asunción", 150_000, 150_000, null]);
      assert.equal(budget.subtotal, 750_000);
    });

    await t.test("4 días siguen por día; el flete suma el recargo solo al superar el umbral de piezas", async () => {
      const a = await seed();
      const zone = await db.deliveryZone.create({ data: { id: randomUUID(), organizationId: a.org, name: "Interior", basePrice: 150_000, volumeThreshold: 50, extraPrice: 80_000 } });
      const exactly = await post(a.slug, form([{ inventoryId: a.mesa.id, quantity: 50 }], 4, { deliveryZoneId: zone.id }));
      const quoteA = await db.quoteRequest.findFirstOrThrow({ where: { publicToken: ((await exactly.json()) as { preorder: { token: string } }).preorder.token } });
      const outA = await convertQuoteRequest(ctx(a.org), quoteA.id);
      assert.ok(outA.ok);
      if (outA.ok) assert.equal(outA.budget.total, 50 * 4 * 100_000 + 150_000, "50 piezas = umbral: sin recargo; 4 días por día");
      const over = await post(a.slug, form([{ inventoryId: a.mesa.id, quantity: 40 }, { inventoryId: a.evento.id, quantity: 11 }], 4, { deliveryZoneId: zone.id, email: "otra@example.com", phone: "+595 982 111 222" }));
      const quoteB = await db.quoteRequest.findFirstOrThrow({ where: { publicToken: ((await over.json()) as { preorder: { token: string } }).preorder.token } });
      const outB = await convertQuoteRequest(ctx(a.org), quoteB.id);
      assert.ok(outB.ok);
      // 40 mesas × 4 días × 100.000 + 11 tótems por evento (660.000, el escalón de 2 días se ignora) + flete con recargo (51 piezas).
      if (outB.ok) assert.equal(outB.budget.total, 40 * 4 * 100_000 + 11 * 660_000 + 150_000 + 80_000);
    });

    await t.test("mayorista usa sus propios escalones; «a coordinar» no inventa un monto", async () => {
      const a = await seed();
      const issued = (await access.issueCatalogAccess(a.org, a.client.id))!;
      const res = await wholesaleRoute.POST(
        new Request(`http://localhost/api/catalog/${a.slug}/mayorista/${issued.token}/preorder`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify(form([{ inventoryId: a.mesa.id, quantity: 2 }], 5, { deliveryCoordinate: true })) }),
        { params: Promise.resolve({ orgSlug: a.slug, token: issued.token }) },
      );
      assert.equal(res.status, 201, await res.clone().text());
      const { preorder } = (await res.json()) as { preorder: { token: string; subtotal: number; whatsappUrl: string | null } };
      assert.equal(preorder.subtotal, 2 * 5 * 50_000, "5 días × 50.000 por día desde el escalón mayorista (3 días)");
      const quote = await db.quoteRequest.findUniqueOrThrow({ where: { publicToken: preorder.token } });
      assert.deepEqual([quote.deliveryZoneId, quote.deliveryCoordinate], [null, true]);
      const out = await convertQuoteRequest(ctx(a.org), quote.id);
      assert.ok(out.ok);
      if (!out.ok) return;
      assert.equal(out.budget.total, 500_000);
      const budget = await db.budget.findUniqueOrThrow({ where: { id: out.budget.id }, include: { items: true } });
      assert.equal(budget.items.length, 1, "sin zona no hay línea de flete");
      assert.match(budget.notes ?? "", /Flete: a coordinar/);
    });

    await t.test("lo aprobado no cambia al editar un escalón o una zona; una zona archivada o borrada no rompe nada", async () => {
      const a = await seed();
      const zone = await db.deliveryZone.create({ data: { id: randomUUID(), organizationId: a.org, name: "Centro", basePrice: 100_000 } });
      const res = await post(a.slug, form([{ inventoryId: a.mesa.id, quantity: 2 }], 5, { deliveryZoneId: zone.id }));
      const quote = await db.quoteRequest.findFirstOrThrow({ where: { publicToken: ((await res.json()) as { preorder: { token: string } }).preorder.token } });
      const out = await convertQuoteRequest(ctx(a.org), quote.id);
      assert.ok(out.ok);
      if (!out.ok) return;
      await db.budget.update({ where: { id: out.budget.id }, data: { status: "APPROVED", approvedAt: new Date() } });
      const before = await db.budget.findUniqueOrThrow({ where: { id: out.budget.id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
      assert.equal(before.total, 700_000);
      // El dueño sube el escalón, cambia el precio base y la zona, y después archiva la zona.
      await replacePriceTiers(db, a.org, a.mesa.id, [{ audience: "RETAIL", fromDays: 5, mode: "TOTAL", price: 450_000 }]);
      await db.inventoryItem.update({ where: { id: a.mesa.id }, data: { listPrice: 999_999 } });
      await db.deliveryZone.update({ where: { id: zone.id }, data: { basePrice: 777_777, archivedAt: new Date() } });
      const after = await db.budget.findUniqueOrThrow({ where: { id: out.budget.id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
      assert.deepEqual(after.items.map((item) => [item.unitPrice, item.days, item.subtotal]), before.items.map((item) => [item.unitPrice, item.days, item.subtotal]));
      assert.equal(after.total, 700_000);
      // El portal recalcula con el snapshot congelado, no con el escalón nuevo.
      const mesaLine = after.items[0];
      assert.deepEqual(selectionLine(mesaLine, { quantity: 2, days: 5 }), { days: 1, unitPrice: 300_000, subtotal: 600_000 });
      assert.deepEqual(selectionLine(mesaLine, { quantity: 2, days: 2 }), { days: 2, unitPrice: 100_000, subtotal: 400_000 });
      // Un pedido nuevo sí toma lo vigente; la zona archivada ya no se puede elegir.
      const fresh = await post(a.slug, form([{ inventoryId: a.mesa.id, quantity: 1 }], 5, { email: "nueva@example.com", phone: "+595 983 000 000" }));
      assert.equal(((await fresh.json()) as { preorder: { subtotal: number } }).preorder.subtotal, 450_000);
      const archived = await post(a.slug, form([{ inventoryId: a.mesa.id, quantity: 1 }], 5, { deliveryZoneId: zone.id, email: "otra@example.com", phone: "+595 983 000 111" }));
      assert.equal(archived.status, 400, "zona archivada: no se puede elegir");
      // Zona borrada entre el pedido y la conversión: no se inventa un monto, queda para coordinar.
      const second = await db.deliveryZone.create({ data: { id: randomUUID(), organizationId: a.org, name: "Efímera", basePrice: 50_000 } });
      const pedido = await post(a.slug, form([{ inventoryId: a.mesa.id, quantity: 1 }], 1, { deliveryZoneId: second.id, email: "tercera@example.com", phone: "+595 983 000 222" }));
      const q2 = await db.quoteRequest.findFirstOrThrow({ where: { publicToken: ((await pedido.json()) as { preorder: { token: string } }).preorder.token } });
      await db.deliveryZone.delete({ where: { id: second.id } });
      const conv = await convertQuoteRequest(ctx(a.org), q2.id);
      assert.ok(conv.ok);
      if (conv.ok) {
        const budget = await db.budget.findUniqueOrThrow({ where: { id: conv.budget.id }, include: { items: true } });
        assert.equal(budget.items.length, 1);
        assert.match(budget.notes ?? "", /Efímera.*ya no existe/);
      }
    });

    await t.test("tenencia: una zona de otra empresa no se puede elegir ni listar", async () => {
      const a = await seed();
      const b = await seed();
      const foreign = await db.deliveryZone.create({ data: { id: randomUUID(), organizationId: b.org, name: "De la otra", basePrice: 1 } });
      assert.equal((await post(a.slug, form([{ inventoryId: a.mesa.id, quantity: 1 }], 2, { deliveryZoneId: foreign.id }))).status, 400);
      assert.equal(await db.quoteRequest.count({ where: { organizationId: a.org } }), 0);
      const choice = await resolveDeliveryChoice(db, a.org, { deliveryZoneId: foreign.id });
      assert.equal(choice.ok, false);
      assert.deepEqual((await listDeliveryZones(a.org, { includeArchived: true })).map((zone) => zone.name), []);
      assert.deepEqual((await listDeliveryZones(b.org)).map((zone) => zone.name), ["De la otra"]);
      // Nombre único por empresa, pero repetible entre empresas.
      await assert.rejects(() => db.deliveryZone.create({ data: { id: randomUUID(), organizationId: b.org, name: "De la otra", basePrice: 2 } }));
      await db.deliveryZone.create({ data: { id: randomUUID(), organizationId: a.org, name: "De la otra", basePrice: 2 } });
    });

    await t.test("paquete: precio, suma por unidad y ahorro; sin stock de una pieza hay alternativas reales con la diferencia de precio", async () => {
      const org = randomUUID();
      orgs.push(org);
      await db.organization.create({ data: { id: org, name: "Paquetes", slug: `paq-${org.slice(0, 8)}` } });
      const client = await db.client.create({ data: { id: randomUUID(), organizationId: org, name: "Cliente" } });
      const item = (name: string, category: string, quantity: number, listPrice: number) =>
        db.inventoryItem.create({ data: { id: randomUUID(), organizationId: org, name, category, quantity, listPrice } });
      // Categorías MIXTAS: «Evento completo» = tótem + piso + impresión + sillas.
      const totem = await item("Tótem LED", "Pantallas", 2, 200_000);
      const piso = await item("Piso vinílico", "Pisos", 5, 50_000);
      const impresion = await item("Impresión de lona", "Impresión", 5, 30_000);
      const sillas = await item("Silla blanca", "Mobiliario", 10, 5_000);
      const sillaVip = await item("Silla Tiffany", "Mobiliario", 30, 7_000);
      const sillaNegra = await item("Silla negra", "Mobiliario", 30, 4_000);
      const mesa = await item("Mesa redonda", "Mobiliario", 10, 40_000);
      const saved = await saveCombo({
        organizationId: org,
        data: { name: "Evento completo", category: "Combos", sku: null, prices: { listPrice: 380_000 }, priceTiers: [{ audience: "RETAIL", fromDays: 3, mode: "TOTAL", price: 1_000_000 }] },
        components: [
          { componentId: totem.id, quantity: 1 },
          { componentId: piso.id, quantity: 1 },
          { componentId: impresion.id, quantity: 1 },
          { componentId: sillas.id, quantity: 20 },
        ],
      });
      assert.ok(saved.ok, JSON.stringify(saved));
      if (!saved.ok) return;
      const combo = saved.combo;
      assert.equal(await db.inventoryPriceTier.count({ where: { inventoryId: combo.id } }), 1, "el paquete guarda sus propios escalones");
      // 1 día: piezas por separado 200.000 + 50.000 + 30.000 + 20 × 5.000 = 380.000 = paquete → sin ahorro. 2 días: 760.000 vs 760.000.
      const oneDay = await comboQuote({ organizationId: org, comboId: combo.id, quantity: 1, days: 1, audience: "RETAIL" });
      assert.ok(oneDay);
      assert.deepEqual([oneDay!.packageTotal, oneDay!.unitSum, oneDay!.savings, oneDay!.incomplete], [380_000, 380_000, 0, false]);
      assert.equal(oneDay!.components.length, 4);
      // 3 días: el paquete tiene un total cerrado de 1.000.000 vs 1.140.000 por separado → ahorro 140.000.
      const threeDays = await comboQuote({ organizationId: org, comboId: combo.id, quantity: 1, days: 3, audience: "RETAIL" });
      assert.deepEqual([threeDays!.packageTotal, threeDays!.unitSum, threeDays!.savings], [1_000_000, 1_140_000, 140_000]);
      // Sin stock: solo hay 10 sillas blancas y el paquete pide 20. Alternativas reales de la misma categoría.
      const range = { startsAt: new Date(Date.UTC(2031, 0, 10, 12)), endsAt: new Date(Date.UTC(2031, 0, 12, 12)) };
      const short = await comboQuote({ organizationId: org, comboId: combo.id, quantity: 1, days: 3, audience: "RETAIL", range });
      const part = short!.components.find((component) => component.componentId === sillas.id)!;
      assert.equal(part.short, true);
      assert.equal(part.available, 10);
      assert.deepEqual(short!.components.filter((component) => component.short).map((component) => component.name), ["Silla blanca"]);
      const byName = new Map(part.alternatives.map((alternative) => [alternative.name, alternative]));
      assert.deepEqual([...byName.keys()].sort(), ["Mesa redonda", "Silla Tiffany", "Silla negra"]);
      // Diferencia por paquete a 3 días: 20 sillas × (7.000 − 5.000) × 3 = 120.000; nueva sumatoria = paquete + diferencia.
      assert.deepEqual([byName.get("Silla Tiffany")!.priceDelta, byName.get("Silla Tiffany")!.newPackageTotal, byName.get("Silla Tiffany")!.enough], [120_000, 1_120_000, true]);
      assert.equal(byName.get("Silla negra")!.priceDelta, -60_000, "20 × (4.000 − 5.000) × 3");
      assert.equal(byName.get("Silla negra")!.newPackageTotal, 940_000);
      // Nada de inventar stock: una alternativa sin unidades libres no aparece.
      await db.inventoryItem.update({ where: { id: sillaNegra.id }, data: { quantity: 0 } });
      const noStock = await comboQuote({ organizationId: org, comboId: combo.id, quantity: 1, days: 3, audience: "RETAIL", range });
      assert.ok(!noStock!.components.find((component) => component.componentId === sillas.id)!.alternatives.some((alternative) => alternative.name === "Silla negra"));
      await db.inventoryItem.update({ where: { id: sillaNegra.id }, data: { quantity: 30 } });

      // Otro combo de la empresa no se cotiza desde otra empresa.
      const foreign = await comboQuote({ organizationId: randomUUID(), comboId: combo.id, quantity: 1, days: 1, audience: "RETAIL" });
      assert.equal(foreign, null);

      // Aprobar con la faltante: el reporte de reserva trae las piezas que faltan con alternativas y diferencia.
      const event = await db.event.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, name: "Boda", setupAt: range.startsAt, startsAt: range.startsAt, endsAt: range.endsAt, strikeAt: range.endsAt } });
      const budget = await db.budget.create({ data: { id: randomUUID(), organizationId: org, clientId: client.id, eventId: event.id, title: "P", status: "SENT" } });
      await db.budgetItem.create({ data: { id: randomUUID(), budgetId: budget.id, name: "Evento completo", quantity: 1, days: 1, unitPrice: 1_000_000, subtotal: 1_000_000, inventoryId: combo.id } });
      const gate = await checkStockBeforeApproval({ organizationId: org, budgetId: budget.id, context: portalAuditContext(org, "QA") });
      assert.equal(gate.ok, false);
      if (!gate.ok) {
        const parts = gate.reservation.outcomes[0].comboParts;
        assert.ok(parts && parts.length === 1, JSON.stringify(gate.reservation.outcomes));
        assert.equal(parts![0].name, "Silla blanca");
        assert.ok(parts![0].alternatives.some((alternative) => alternative.name === "Silla Tiffany" && alternative.priceDelta === 20 * 2_000 * 3));
        assert.match(gate.lines[0], /falta «Silla blanca»/);
        assert.match(gate.lines[0], /Silla Tiffany/);
      }
      assert.equal(await db.eventInventory.count({ where: { eventId: event.id } }), 0, "el modo estricto no reservó nada");

      // Con stock suficiente se reserva y la sustitución informa la diferencia de precio y el paquete re-precificado.
      await db.inventoryItem.update({ where: { id: sillas.id }, data: { quantity: 25 } });
      const reserved = await reserveBudgetInventory({ organizationId: org, budgetId: budget.id, context: portalAuditContext(org, "QA") });
      assert.equal(reserved.conflicts, 0, JSON.stringify(reserved.outcomes));
      const assignment = await db.eventInventory.findFirstOrThrow({ where: { eventId: event.id, inventoryId: combo.id } });
      const swap = await substituteComboComponent({ organizationId: org, assignmentId: assignment.id, componentId: sillas.id, substituteId: sillaVip.id });
      assert.ok(swap.ok, JSON.stringify(swap));
      if (swap.ok) {
        assert.equal(swap.price.known, true);
        if (swap.price.known) assert.deepEqual([swap.price.days, swap.price.delta, swap.price.packageBefore, swap.price.packageAfter], [3, 120_000, 1_000_000, 1_120_000]);
      }
    });
  } finally {
    for (const org of orgs) {
      await db.organization.delete({ where: { id: org } }).catch(() => undefined);
    }
    await db.$disconnect();
  }
});
