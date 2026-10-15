import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { catalogLine, catalogPriceFor, catalogTierHints, listLine } from "../lib/catalog-public";
import { deliveryExtraApplies, deliveryFee, deliveryLineName, orderPieces, readDeliveryZoneInput } from "../lib/delivery-zones";
import { normalizeCatalog } from "../lib/import-catalog";
import {
  packageSummary,
  pickTier,
  priceLine,
  readAudienceTiers,
  readPriceTiers,
  readPricingSnapshot,
  repriceFromSnapshot,
  repricedPackageTotal,
  snapshotFromProduct,
  substitutionPrice,
  tierLabel,
  tierPreview,
  type AudiencePriceTier,
  type PackageComponentSnapshot,
  type PriceTier,
} from "../lib/price-tiers";
import { portalItemLine, repriceableSnapshot, rentalDaysOf, resolveQuoteSelection, selectionLine } from "../lib/quote-selection";
import { quoteProductLine, quoteProductPrice } from "../lib/quote-sharing";

/**
 * Precio por días, flete por zona y paquetes (alquileres P2). Todo es cálculo puro en guaraníes
 * enteros: la tienda, el presupuesto, la conversión, el mayorista y el portal usan la misma regla.
 */

const DIA = 100_000;
const total5: PriceTier = { fromDays: 5, mode: "TOTAL", price: 300_000 };
const perDay3: PriceTier = { fromDays: 3, mode: "PER_DAY", price: 90_000 };

test("escalón TOTAL: 100.000 por día, pero 5 días por 300.000 en total (1, 4, 5 y 10 días)", () => {
  const product = { basePrice: DIA, tiers: [total5] };
  const at = (days: number) => priceLine(product, days);
  assert.deepEqual([at(1).total, at(1).days, at(1).unitPrice], [100_000, 1, 100_000], "1 día: precio base");
  assert.equal(at(4).total, 400_000, "4 días: todavía por día");
  assert.deepEqual([at(4).mode, at(4).days, at(4).unitPrice], ["BASE", 4, 100_000]);
  // 5 días y más: el total fijo; la línea guarda días = 1 y el total como precio unitario (exacto al guaraní).
  assert.deepEqual([at(5).total, at(5).days, at(5).unitPrice, at(5).mode], [300_000, 1, 300_000, "TOTAL"]);
  assert.equal(at(10).total, 300_000, "10 días: sigue rigiendo el escalón de 5 (TOTAL no se multiplica)");
});

test("escalón PER_DAY: 80.000 por día desde 5 días (1, 4, 5 y 10 días)", () => {
  const product = { basePrice: DIA, tiers: [{ fromDays: 5, mode: "PER_DAY" as const, price: 80_000 }] };
  assert.equal(priceLine(product, 1).total, 100_000);
  assert.equal(priceLine(product, 4).total, 400_000);
  const five = priceLine(product, 5);
  assert.deepEqual([five.total, five.days, five.unitPrice, five.mode], [400_000, 5, 80_000, "PER_DAY"]);
  assert.equal(priceLine(product, 10).total, 800_000);
});

test("gana el escalón con el mayor «desde» que no supera los días; sin escalón, precio base × días", () => {
  const tiers = [total5, perDay3];
  assert.equal(pickTier(tiers, 2), null);
  assert.deepEqual(pickTier(tiers, 3), perDay3);
  assert.deepEqual(pickTier(tiers, 4), perDay3);
  assert.deepEqual(pickTier(tiers, 5), total5);
  assert.deepEqual(pickTier([perDay3, total5], 9), total5, "el orden de entrada no importa");
  const product = { basePrice: DIA, tiers };
  assert.equal(priceLine(product, 2).total, 200_000);
  assert.equal(priceLine(product, 3).total, 270_000);
  assert.equal(priceLine(product, 4).total, 360_000);
  assert.equal(priceLine(product, 5).total, 300_000, "5 días por 300.000 conviene más que 4 por 360.000");
  // Un escalón sin precio no existe (no se inventa).
  assert.equal(pickTier([{ fromDays: 2, mode: "TOTAL", price: 0 }], 5), null);
});

test("EVENT ignora los escalones de días y se cobra una sola vez", () => {
  const product = { basePrice: 660_000, billingUnit: "EVENT", tiers: [total5, perDay3] };
  for (const days of [1, 4, 5, 10]) {
    const line = priceLine(product, days);
    assert.deepEqual([line.total, line.days, line.unitPrice, line.mode], [660_000, 1, 660_000, "EVENT"], `${days} días`);
  }
});

test("mayorista: sus escalones son los suyos y no se cruzan con los del cliente final", () => {
  const priceTiers: AudiencePriceTier[] = [
    { audience: "RETAIL", fromDays: 5, mode: "TOTAL", price: 300_000 },
    { audience: "WHOLESALE", fromDays: 3, mode: "PER_DAY", price: 50_000 },
  ];
  const product = { listPrice: 100_000, wholesalePrice: 60_000, priceTiers };
  assert.equal(quoteProductLine(product, 5, "FINAL").total, 300_000);
  assert.equal(quoteProductLine(product, 5, "WHOLESALE").total, 250_000, "5 días × 50.000 desde el escalón mayorista");
  assert.equal(quoteProductLine(product, 2, "WHOLESALE").total, 120_000, "sin escalón: precio mayorista × días");
  assert.equal(quoteProductLine(product, 3, "FINAL").total, 300_000, "el escalón mayorista no baja el precio del cliente final");
  assert.equal(quoteProductPrice({ ...product, wholesalePrice: 0 }, 9, "WHOLESALE"), 50_000, "sin precio base mayorista el escalón igual rige (como antes)");
  assert.equal(quoteProductLine({ listPrice: 100_000, priceTiers }, 1, "WHOLESALE").total, 0, "sin precio mayorista cargado: Consultar");
});

test("el piso de venta aplica al precio por día y no al total cerrado de un paquete", () => {
  assert.equal(priceLine({ basePrice: 90_000, minimumPrice: 95_000 }, 2).unitPrice, 95_000);
  assert.equal(priceLine({ basePrice: 100_000, minimumPrice: 95_000, tiers: [{ fromDays: 3, mode: "PER_DAY", price: 80_000 }] }, 3).unitPrice, 95_000);
  assert.equal(priceLine({ basePrice: 100_000, minimumPrice: 95_000, tiers: [total5] }, 5).total, 300_000);
  assert.equal(priceLine({ basePrice: 0, minimumPrice: 95_000 }, 2).total, 0, "el piso no fabrica un precio no cargado");
});

test("tienda, presupuesto, conversión, mayorista y portal dan el MISMO total", () => {
  const row = {
    billingUnit: "DAILY",
    listPrice: 100_000,
    wholesalePrice: 70_000,
    priceTiers: [
      { audience: "RETAIL" as const, fromDays: 3, mode: "PER_DAY" as const, price: 90_000 },
      { audience: "RETAIL" as const, fromDays: 5, mode: "TOTAL" as const, price: 300_000 },
      { audience: "WHOLESALE" as const, fromDays: 4, mode: "TOTAL" as const, price: 200_000 },
    ],
  };
  const retailTiers = row.priceTiers.filter((tier) => tier.audience === "RETAIL");
  for (const days of [1, 2, 3, 4, 5, 6, 10]) {
    const store = catalogLine(catalogPriceFor(row, "RETAIL"), days);
    const conversion = listLine(row, "RETAIL", days);
    const budget = quoteProductLine(row, days, "FINAL");
    const snapshot = snapshotFromProduct({ basePrice: 100_000, tiers: retailTiers.map(({ fromDays, mode, price }) => ({ fromDays, mode, price })) }, "RETAIL", days);
    const portal = repriceFromSnapshot(snapshot, days);
    assert.deepEqual([conversion.total, budget.total, portal.total], [store.total, store.total, store.total], `${days} días`);
    assert.deepEqual([budget.unitPrice, budget.days], [store.unitPrice, store.days]);
    const wholesale = catalogLine(catalogPriceFor(row, "WHOLESALE"), days);
    assert.equal(quoteProductLine(row, days, "WHOLESALE").total, wholesale.total, `mayorista ${days} días`);
  }
  assert.equal(catalogLine(catalogPriceFor(row, "WHOLESALE"), 4).total, 200_000);
  // «desde 5 días: 300.000 total» en la tienda (y el escalón por día de 3).
  assert.deepEqual(catalogTierHints(catalogPriceFor(row, "RETAIL")), ["desde 3 días: 90.000 por día", "desde 5 días: 300.000 total"]);
  assert.deepEqual(catalogTierHints(catalogPriceFor({ ...row, billingUnit: "EVENT" }, "RETAIL")), [], "por evento no hay escalones que mostrar");
  assert.ok(!JSON.stringify(catalogPriceFor(row, "RETAIL")).includes("200000"), "el DTO del cliente final no lleva escalones mayoristas");
});

test("los «desde X días» viejos siguen valiendo como escalón por día (compatibilidad y backfill)", () => {
  assert.equal(quoteProductPrice({ listPrice: 100, listFromDays: 3, listFromPrice: 80 }, 3), 80);
  assert.equal(quoteProductPrice({ listPrice: 100, listFromDays: 3, listFromPrice: 80 }, 2), 100);
  assert.deepEqual(catalogPriceFor({ listPrice: 100, listFromDays: 3, listFromPrice: 80 }, "RETAIL"), { unit: 100, fromDays: 3, fromPrice: 80 });
  // Con tiers presentes (aunque vacíos) las columnas viejas ya no se leen.
  assert.equal(quoteProductPrice({ listPrice: 100, listFromDays: 3, listFromPrice: 80, priceTiers: [] }, 3), 100);
});

test("textos: «desde 5 días: 300.000 total» y la vista previa «3 días = …, 5 días = …»", () => {
  assert.equal(tierLabel(total5), "desde 5 días: 300.000 total");
  assert.equal(tierLabel({ fromDays: 1, mode: "PER_DAY", price: 50_000 }), "desde 1 día: 50.000 por día");
  assert.equal(tierPreview({ basePrice: DIA, tiers: [total5] }, [3, 5]), "3 días = Gs. 300.000, 5 días = Gs. 300.000");
  assert.equal(tierPreview({ basePrice: DIA, tiers: [perDay3, total5] }, [3, 5]), "3 días = Gs. 270.000, 5 días = Gs. 300.000");
  assert.equal(tierPreview({ basePrice: 0, tiers: [] }, [2]), "2 días = Consultar");
});

test("validación de escalones: enteros, sin repetir «desde», modo y precio válidos", () => {
  const ok = readPriceTiers([{ fromDays: "5", mode: "TOTAL", price: "300000" }, { fromDays: 3, mode: "PER_DAY", price: 90_000 }]);
  assert.ok(ok.ok && ok.tiers.map((tier) => tier.fromDays).join() === "3,5", "ordena por días");
  for (const bad of [
    [{ fromDays: 0, mode: "TOTAL", price: 1 }],
    [{ fromDays: 1.5, mode: "TOTAL", price: 1 }],
    [{ fromDays: 5, mode: "MENSUAL", price: 1 }],
    [{ fromDays: 5, mode: "TOTAL", price: 0 }],
    [{ fromDays: 5, mode: "TOTAL", price: -1 }],
    [{ fromDays: 5, mode: "TOTAL", price: 1 }, { fromDays: 5, mode: "PER_DAY", price: 2 }],
    "no es lista",
  ]) assert.equal(readPriceTiers(bad).ok, false, JSON.stringify(bad));
  assert.equal(readAudienceTiers([{ audience: "RETAIL", fromDays: 5, mode: "TOTAL", price: 1 }, { audience: "WHOLESALE", fromDays: 5, mode: "TOTAL", price: 1 }]).ok, true, "el mismo «desde» en cada frente es válido");
  assert.equal(readAudienceTiers([{ audience: "OTRO", fromDays: 5, mode: "TOTAL", price: 1 }]).ok, false);
});

test("portal: al cambiar los días la línea se recalcula con los escalones congelados; un precio manual queda fijo", () => {
  const snapshot = snapshotFromProduct({ basePrice: DIA, tiers: [total5] }, "RETAIL", 5);
  // Línea guardada de un escalón TOTAL: días = 1, precio = total, y el cliente ve 5 días.
  const stored = { id: "a", name: "Mesa", quantity: 2, days: 1, unitPrice: 300_000, pricingSnapshot: snapshot };
  assert.equal(rentalDaysOf(stored), 5);
  assert.ok(repriceableSnapshot(stored));
  assert.deepEqual(selectionLine(stored, { quantity: 2, days: 5 }), { days: 1, unitPrice: 300_000, subtotal: 600_000 });
  assert.deepEqual(selectionLine(stored, { quantity: 2, days: 3 }), { days: 3, unitPrice: 100_000, subtotal: 600_000 }, "con 3 días vuelve al precio por día");
  assert.deepEqual(selectionLine(stored, { quantity: 1, days: 10 }), { days: 1, unitPrice: 300_000, subtotal: 300_000 });
  // Precio editado a mano: ya no coincide con el snapshot, el precio unitario es fijo.
  const manual = { ...stored, unitPrice: 250_000 };
  assert.equal(repriceableSnapshot(manual), null);
  assert.equal(rentalDaysOf(manual), 1);
  assert.deepEqual(selectionLine(manual, { quantity: 2, days: 3 }), { days: 3, unitPrice: 250_000, subtotal: 1_500_000 });
  // Sin snapshot: comportamiento de siempre.
  assert.deepEqual(selectionLine({ days: 2, unitPrice: 100, pricingSnapshot: null }, { quantity: 3, days: 4 }), { days: 4, unitPrice: 100, subtotal: 1200 });
  // La validación de la propuesta compara con los días del alquiler, no con el 1 guardado.
  const same = resolveQuoteSelection([stored], [{ id: "a", quantity: 2, days: 5 }]);
  assert.deepEqual(same, { ok: false, error: "La propuesta es igual al presupuesto actual." });
  const changed = resolveQuoteSelection([stored], [{ id: "a", quantity: 2, days: 3 }]);
  assert.ok(changed.ok && changed.changed);
  // El navegador del cliente recalcula igual que el servidor.
  const pricing = { billingUnit: "DAILY" as const, base: DIA, tiers: [total5], package: null };
  assert.equal(portalItemLine({ unitPrice: 300_000, pricing }, { quantity: 2, days: 5 }).total, 600_000);
  assert.equal(portalItemLine({ unitPrice: 300_000, pricing }, { quantity: 2, days: 3 }).total, 600_000);
  assert.equal(portalItemLine({ unitPrice: 300_000, pricing }, { quantity: 1, days: 7 }).periodTotal, true);
  assert.equal(portalItemLine({ unitPrice: 5, pricing: null }, { quantity: 2, days: 3 }).total, 30);
  assert.equal(readPricingSnapshot({ v: 2 }), null, "un snapshot de otra versión se ignora");
});

test("flete por zona: base, y recargo SOLO si las piezas superan el umbral", () => {
  const sinVolumen = { basePrice: 150_000, volumeThreshold: null, extraPrice: null };
  const conVolumen = { basePrice: 150_000, volumeThreshold: 50, extraPrice: 80_000 };
  for (const pieces of [0, 1, 500]) assert.equal(deliveryFee(sinVolumen, pieces), 150_000, "sin volumen configurado nunca hay recargo");
  assert.equal(deliveryFee(conVolumen, 1), 150_000);
  assert.equal(deliveryFee(conVolumen, 50), 150_000, "justo en el umbral no paga recargo");
  assert.equal(deliveryFee(conVolumen, 51), 230_000, "una pieza más y se suma el recargo");
  assert.equal(deliveryExtraApplies(conVolumen, 51), true);
  assert.equal(deliveryExtraApplies(conVolumen, 50), false);
  assert.equal(deliveryFee({ basePrice: 0, volumeThreshold: 10, extraPrice: 5_000 }, 11), 5_000);
  assert.equal(deliveryLineName("Asunción"), "Flete — Asunción");
  // Piezas = cantidades de líneas de inventario; el flete y las líneas libres no cuentan.
  assert.equal(orderPieces([{ quantity: 30, inventoryId: "a" }, { quantity: 21, inventoryId: "b" }, { quantity: 1, inventoryId: null }, { quantity: 9, inventoryId: "c", excluded: true }]), 51);
});

test("zona: validación de montos enteros y de la pareja umbral/recargo", () => {
  const ok = readDeliveryZoneInput({ name: "  Gran   Asunción ", basePrice: "150000", volumeThreshold: "50", extraPrice: 80_000, notes: " en el día " });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value, { name: "Gran Asunción", basePrice: 150_000, volumeThreshold: 50, extraPrice: 80_000, notes: "en el día" });
  const plain = readDeliveryZoneInput({ name: "Centro", basePrice: 0 });
  assert.ok(plain.ok && plain.value.volumeThreshold === null && plain.value.extraPrice === null);
  for (const bad of [
    { name: "A", basePrice: 1 },
    { name: "Centro", basePrice: -1 },
    { name: "Centro", basePrice: 1.5 },
    { name: "Centro", basePrice: "mucho" },
    { name: "Centro", basePrice: 1, volumeThreshold: 10 },
    { name: "Centro", basePrice: 1, extraPrice: 10 },
    { name: "Centro", basePrice: 1, volumeThreshold: 0, extraPrice: 10 },
  ]) assert.equal(readDeliveryZoneInput(bad).ok, false, JSON.stringify(bad));
});

const silla: PackageComponentSnapshot = { name: "Silla", quantity: 8, base: 10_000, minimum: 0, billingUnit: "DAILY", tiers: [] };
const mesa: PackageComponentSnapshot = { name: "Mesa", quantity: 1, base: 40_000, minimum: 0, billingUnit: "DAILY", tiers: [] };
const tótem: PackageComponentSnapshot = { name: "Tótem", quantity: 1, base: 150_000, minimum: 0, billingUnit: "EVENT", tiers: [] };

test("paquete: precio del paquete, suma por unidad (misma regla de días) y ahorro", () => {
  const pack = { basePrice: 100_000 };
  const one = packageSummary(pack, [silla, mesa], 1);
  assert.deepEqual(one, { packageTotal: 100_000, unitSum: 120_000, savings: 20_000, incomplete: false });
  const three = packageSummary(pack, [silla, mesa], 3);
  assert.deepEqual([three.packageTotal, three.unitSum, three.savings], [300_000, 360_000, 60_000]);
  // Una pieza por evento suma una sola vez y una con escalón usa el suyo.
  const mixed = packageSummary({ basePrice: 200_000 }, [silla, { ...mesa, tiers: [{ fromDays: 2, mode: "TOTAL", price: 70_000 }] }, tótem], 3);
  assert.equal(mixed.unitSum, 240_000 + 70_000 + 150_000);
  assert.equal(mixed.packageTotal, 600_000);
  assert.equal(mixed.savings, 0, "si el paquete no conviene, no hay ahorro (nunca negativo)");
  // Sin precio en una pieza o en el paquete no se inventa un ahorro.
  assert.equal(packageSummary(pack, [silla, { ...mesa, base: 0 }], 1).incomplete, true);
  assert.equal(packageSummary(pack, [silla, { ...mesa, base: 0 }], 1).savings, 0);
  assert.equal(packageSummary({ basePrice: 0 }, [silla, mesa], 1).savings, 0);
  assert.equal(packageSummary(pack, [], 1).incomplete, true);
  // El precio del paquete también puede tener escalones por días (paquete de 5 días por 450.000).
  assert.equal(packageSummary({ basePrice: 100_000, tiers: [{ fromDays: 5, mode: "TOTAL", price: 450_000 }] }, [silla, mesa], 5).savings, 600_000 - 450_000);
});

test("sustitución: diferencia de precio de reemplazar una pieza y re-precio del paquete", () => {
  const original = { basePrice: 10_000 };
  const caro = { basePrice: 12_500 };
  const barato = { basePrice: 8_000 };
  // 8 sillas por paquete, 3 días: (12.500 − 10.000) × 3 × 8.
  const up = substitutionPrice(original, caro, 8, 3);
  assert.deepEqual(up, { known: true, delta: 60_000, fromTotal: 240_000, toTotal: 300_000 });
  assert.equal(repricedPackageTotal(300_000, up.known ? up.delta : 0), 360_000, "precio del paquete + diferencia");
  const down = substitutionPrice(original, barato, 8, 3);
  assert.equal(down.known && down.delta, -48_000);
  assert.equal(repricedPackageTotal(300_000, -48_000), 252_000);
  assert.equal(repricedPackageTotal(10_000, -48_000), 0, "nunca por debajo de 0");
  // La regla de días de cada pieza cuenta: el sustituto con escalón total de 5 días.
  const tier = substitutionPrice(original, { basePrice: 12_000, tiers: [total5] }, 1, 5);
  assert.equal(tier.known && tier.delta, 300_000 - 50_000);
  // Sin precio en alguna de las dos no se inventa la diferencia.
  assert.deepEqual(substitutionPrice(original, { basePrice: 0 }, 8, 3), { known: false, delta: null });
  assert.deepEqual(substitutionPrice({ basePrice: 0 }, caro, 8, 3), { known: false, delta: null });
});

test("importar: «precios_dias» en JSON y en planilla; inválido no entra", () => {
  const fromJson = normalizeCatalog({ productos: [{ codigo: "10", nombre: "Mesa", precio: 100_000, cobro: "dia", precios_dias: [{ desde_dias: 5, modo: "total", precio: 300_000 }, { desde_dias: 3, modo: "día", precio: "90.000" }] }] });
  assert.ok(fromJson.ok);
  if (fromJson.ok) assert.deepEqual(fromJson.value.doc.productos[0].preciosDias, [perDay3, total5]);
  const fromSheet = normalizeCatalog({ productos: [{ codigo: "11", nombre: "Silla", precio: 10_000, precios_dias: "5:total:300000; 3:dia:90000" }] });
  assert.ok(fromSheet.ok);
  if (fromSheet.ok) assert.deepEqual(fromSheet.value.doc.productos[0].preciosDias, [perDay3, total5]);
  const none = normalizeCatalog({ productos: [{ codigo: "12", nombre: "Banco" }] });
  assert.ok(none.ok);
  if (none.ok) assert.deepEqual(none.value.doc.productos[0].preciosDias, [], "sin dato no se toca nada");
  for (const bad of [[{ desde_dias: 5, modo: "mes", precio: 1 }], [{ desde_dias: 0, modo: "total", precio: 1 }], [{ desde_dias: 5, modo: "total", precio: 0 }], [{ desde_dias: 5, modo: "total", precio: 1 }, { desde_dias: 5, modo: "dia", precio: 2 }], "x:y"]) {
    const result = normalizeCatalog({ productos: [{ codigo: "13", nombre: "Mala", precios_dias: bad }] });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.doc.productos.length, 0, JSON.stringify(bad));
      assert.equal(result.value.problems[0].tipo, "precios-dias-invalido");
    }
  }
});

test("estructura: las rutas de zonas piden budgets.write, el combo-quote usa el motor real y el import documenta el campo", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const zones = read("app/api/admin/delivery-zones/route.ts");
  assert.equal((zones.match(/requireAdminContext\("budgets\.write"\)/g) ?? []).length, 2, "alta y edición exigen el permiso de presupuestos");
  assert.match(zones, /organizationId/, "toda consulta va con la empresa activa");
  const quote = read("lib/server/combo-quote.ts");
  assert.match(quote, /findSubstitutes/);
  assert.match(quote, /buildAvailability/);
  const modules = read("lib/import-modules.ts");
  assert.match(modules, /precios_dias/);
  assert.match(read("prisma/migrations/202610220001_price_tiers_delivery_zones/migration.sql"), /ON CONFLICT DO NOTHING/);
});
