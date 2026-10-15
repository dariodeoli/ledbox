/**
 * Precio por días (alquileres P2). Cálculo PURO y sin base: lo comparten la tienda, el
 * presupuesto, la conversión del catálogo, el mayorista, el portal y los paquetes.
 *
 * Regla única:
 *  - Producto «por evento» (EVENT): ignora los escalones; se cobra el precio base UNA vez.
 *  - Para N días rige el escalón con el MAYOR `fromDays` <= N.
 *      · PER_DAY → total = precio × N.
 *      · TOTAL   → total = precio fijo (no se multiplica por los días).
 *  - Sin escalón aplicable: precio base × N.
 *
 * Una línea de presupuesto es `cantidad × días × precioUnitario`. Para que el total sea EXACTO
 * al guaraní, un escalón TOTAL se guarda como `días = 1` y `precioUnitario = total del período`
 * (igual que EVENT); los días reales del alquiler quedan en el snapshot de la línea.
 */

export type PriceTierMode = "PER_DAY" | "TOTAL";
export type PriceTierAudience = "RETAIL" | "WHOLESALE";
export type PriceTier = { fromDays: number; mode: PriceTierMode; price: number };
export type AudiencePriceTier = PriceTier & { audience: PriceTierAudience };

export const PRICE_TIER_MAX_DAYS = 365;
export const PRICE_TIER_MAX_ROWS = 20;
export const PRICE_TIER_PRICE_MAX = 2_147_483_647;

/** Lo mínimo de un producto para calcular su precio. */
export type TierPricedProduct = {
  basePrice: number;
  minimumPrice?: number;
  billingUnit?: string | null;
  tiers?: ReadonlyArray<PriceTier>;
};

export type LinePricing = {
  /** Precio por unidad de la línea (por día en PER_DAY/BASE; total del período en TOTAL/EVENT). */
  unitPrice: number;
  /** Días a guardar en la línea: los del alquiler, o 1 si es TOTAL o EVENT. */
  days: number;
  /** Total de UNA unidad para todo el período. */
  total: number;
  mode: "BASE" | "PER_DAY" | "TOTAL" | "EVENT";
  tier: PriceTier | null;
};

const wholeDays = (days: number): number => Math.max(1, Math.trunc(Number(days)) || 1);

/** Escalón válido que corresponde a `days` (el de mayor `fromDays` <= days) o `null`. */
export function pickTier(tiers: ReadonlyArray<PriceTier> | undefined, days: number): PriceTier | null {
  const n = wholeDays(days);
  let best: PriceTier | null = null;
  for (const tier of tiers ?? []) {
    if (!(tier.price > 0) || !(tier.fromDays >= 1) || tier.fromDays > n) continue;
    if (!best || tier.fromDays > best.fromDays) best = tier;
  }
  return best;
}

/** Precio de una línea de producto para `rentalDays` días. 0 = sin precio cargado («Consultar»). */
export function priceLine(product: TierPricedProduct, rentalDays: number): LinePricing {
  const n = wholeDays(rentalDays);
  const minimum = Math.max(0, product.minimumPrice ?? 0);
  const floor = (price: number) => (price > 0 ? Math.max(price, minimum) : 0);
  if (product.billingUnit === "EVENT") {
    const unitPrice = floor(product.basePrice);
    return { unitPrice, days: 1, total: unitPrice, mode: "EVENT", tier: null };
  }
  const tier = pickTier(product.tiers, n);
  if (tier?.mode === "TOTAL") {
    // Precio de paquete cerrado por el dueño: no se le aplica el piso por día.
    return { unitPrice: tier.price, days: 1, total: tier.price, mode: "TOTAL", tier };
  }
  if (tier) {
    const unitPrice = floor(tier.price);
    return { unitPrice, days: n, total: unitPrice * n, mode: "PER_DAY", tier };
  }
  const unitPrice = floor(product.basePrice);
  return { unitPrice, days: n, total: unitPrice * n, mode: "BASE", tier: null };
}

/** Total de la línea: cantidad × días guardados × precio unitario. */
export const linePricingTotal = (pricing: Pick<LinePricing, "unitPrice" | "days">, quantity: number): number =>
  Math.max(0, Math.trunc(quantity)) * pricing.days * pricing.unitPrice;

/** Los «desde X días» viejos (una regla por frente) como escalón POR DÍA, igual que el backfill. */
export function legacyTier(fromDays: number | null | undefined, fromPrice: number | null | undefined): PriceTier[] {
  return fromDays && fromDays > 0 && fromPrice && fromPrice > 0 ? [{ fromDays, mode: "PER_DAY", price: fromPrice }] : [];
}

/** Escalones del frente pedido a partir de la lista completa del producto. */
export function tiersForAudience(all: ReadonlyArray<AudiencePriceTier> | undefined, audience: PriceTierAudience): PriceTier[] {
  return (all ?? [])
    .filter((tier) => tier.audience === audience)
    .map(({ fromDays, mode, price }) => ({ fromDays, mode, price }))
    .sort((a, b) => a.fromDays - b.fromDays);
}

/** Ordena por días ascendentes (copia). */
export const sortTiers = <T extends PriceTier>(tiers: ReadonlyArray<T>): T[] => [...tiers].sort((a, b) => a.fromDays - b.fromDays);

const gs = new Intl.NumberFormat("es-PY", { maximumFractionDigits: 0 });
const money = (value: number) => `Gs. ${gs.format(value)}`;
const daysText = (days: number) => `${days} ${days === 1 ? "día" : "días"}`;

/** «desde 5 días: 300.000 total» / «desde 3 días: 90.000 por día». */
export function tierLabel(tier: PriceTier): string {
  return `desde ${daysText(tier.fromDays)}: ${gs.format(tier.price)} ${tier.mode === "TOTAL" ? "total" : "por día"}`;
}

/** Vista previa «3 días = Gs. 270.000, 5 días = Gs. 300.000» para los días indicados. */
export function tierPreview(product: TierPricedProduct, days: ReadonlyArray<number>): string {
  return days
    .map((n) => {
      const pricing = priceLine(product, n);
      return `${daysText(n)} = ${pricing.total > 0 ? money(pricing.total) : "Consultar"}`;
    })
    .join(", ");
}

/** Días que conviene mostrar en la vista previa: 1, los de cada escalón y el anterior, sin repetir. */
export function previewDays(tiers: ReadonlyArray<PriceTier>): number[] {
  const set = new Set<number>([1]);
  for (const tier of tiers) {
    if (tier.fromDays > 1) set.add(tier.fromDays - 1);
    set.add(tier.fromDays);
  }
  return [...set].sort((a, b) => a - b).slice(0, 8);
}

export type TierInput = { fromDays: unknown; mode: unknown; price: unknown };

/** Valida los escalones que llegan del panel o de la importación (sin duplicar `fromDays`). */
export function readPriceTiers(raw: unknown): { ok: true; tiers: PriceTier[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, tiers: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Los precios por días deben ser una lista." };
  if (raw.length > PRICE_TIER_MAX_ROWS) return { ok: false, error: `Hasta ${PRICE_TIER_MAX_ROWS} escalones por frente.` };
  const seen = new Set<number>();
  const tiers: PriceTier[] = [];
  for (const entry of raw) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const fromDays = Number(row.fromDays);
    const price = Number(row.price);
    if (!Number.isInteger(fromDays) || fromDays < 1 || fromDays > PRICE_TIER_MAX_DAYS) {
      return { ok: false, error: `«Desde días» debe ser un entero de 1 a ${PRICE_TIER_MAX_DAYS}.` };
    }
    if (row.mode !== "PER_DAY" && row.mode !== "TOTAL") return { ok: false, error: "El escalón debe ser «por día» o «total»." };
    if (!Number.isInteger(price) || price < 1 || price > PRICE_TIER_PRICE_MAX) return { ok: false, error: "El precio del escalón debe ser un entero en guaraníes mayor a 0." };
    if (seen.has(fromDays)) return { ok: false, error: `Hay dos escalones desde ${daysText(fromDays)}.` };
    seen.add(fromDays);
    tiers.push({ fromDays, mode: row.mode, price });
  }
  return { ok: true, tiers: sortTiers(tiers) };
}

/** Aviso (no error) cuando un escalón no conviene: sale más caro que el precio base. */
export function tierWarnings(basePrice: number, tiers: ReadonlyArray<PriceTier>): string | null {
  if (basePrice <= 0) return null;
  const messages: string[] = [];
  for (const tier of tiers) {
    const perDay = tier.mode === "TOTAL" ? tier.price / tier.fromDays : tier.price;
    if (perDay > basePrice) messages.push(`El escalón desde ${daysText(tier.fromDays)} sale más caro que el precio normal.`);
  }
  return messages.length ? messages.join(" ") : null;
}

// ── Snapshot de la línea de presupuesto ──────────────────────────────────────

/** Componente de un paquete, con sus propios precios congelados. */
export type PackageComponentSnapshot = {
  name: string;
  quantity: number;
  base: number;
  minimum: number;
  billingUnit: "DAILY" | "EVENT";
  tiers: PriceTier[];
};

/**
 * Precios congelados de una línea al crearla: el portal y el cambio de días recalculan con esto
 * (nunca con el inventario vivo), así que editar un escalón no toca un presupuesto armado o aprobado.
 */
export type PricingSnapshot = {
  v: 1;
  audience: PriceTierAudience;
  billingUnit: "DAILY" | "EVENT";
  base: number;
  minimum: number;
  tiers: PriceTier[];
  /** Días reales del alquiler con que se calculó (una línea TOTAL guarda `days = 1`). */
  rentalDays: number;
  /** Solo en combos: sus componentes con precio, para «suma por unidad» y «ahorro». */
  package?: { components: PackageComponentSnapshot[] };
};

export function snapshotFromProduct(
  product: TierPricedProduct,
  audience: PriceTierAudience,
  rentalDays: number,
  components?: PackageComponentSnapshot[],
): PricingSnapshot {
  return {
    v: 1,
    audience,
    billingUnit: product.billingUnit === "EVENT" ? "EVENT" : "DAILY",
    base: product.basePrice,
    minimum: product.minimumPrice ?? 0,
    tiers: sortTiers(product.tiers ?? []),
    rentalDays: wholeDays(rentalDays),
    ...(components && components.length ? { package: { components } } : {}),
  };
}

/** Lee un snapshot guardado; `null` si no existe o es de otra versión (la línea queda con su precio fijo). */
export function readPricingSnapshot(value: unknown): PricingSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.v !== 1 || typeof raw.base !== "number" || !Array.isArray(raw.tiers)) return null;
  const tiers = readPriceTiers(raw.tiers);
  if (!tiers.ok) return null;
  const components: PackageComponentSnapshot[] = [];
  const pkg = raw.package as { components?: unknown } | undefined;
  if (pkg && Array.isArray(pkg.components)) {
    for (const entry of pkg.components) {
      const c = entry as Record<string, unknown>;
      const t = readPriceTiers(c.tiers);
      if (typeof c.name !== "string" || typeof c.quantity !== "number" || typeof c.base !== "number" || !t.ok) return null;
      components.push({ name: c.name, quantity: c.quantity, base: c.base, minimum: Number(c.minimum) || 0, billingUnit: c.billingUnit === "EVENT" ? "EVENT" : "DAILY", tiers: t.tiers });
    }
  }
  return {
    v: 1,
    audience: raw.audience === "WHOLESALE" ? "WHOLESALE" : "RETAIL",
    billingUnit: raw.billingUnit === "EVENT" ? "EVENT" : "DAILY",
    base: raw.base,
    minimum: Number(raw.minimum) || 0,
    tiers: tiers.tiers,
    rentalDays: wholeDays(Number(raw.rentalDays)),
    ...(components.length ? { package: { components } } : {}),
  };
}

/** Recalcula la línea con los precios congelados para otra cantidad de días. */
export function repriceFromSnapshot(snapshot: PricingSnapshot, rentalDays: number): LinePricing {
  return priceLine({ basePrice: snapshot.base, minimumPrice: snapshot.minimum, billingUnit: snapshot.billingUnit, tiers: snapshot.tiers }, rentalDays);
}

// ── Paquetes (combos con precio) ─────────────────────────────────────────────

export type PackageSummary = {
  /** Precio del paquete por UNA unidad para todo el período (el precio del combo). */
  packageTotal: number;
  /** Suma de cada pieza (precio × cantidad, con la misma regla de días). */
  unitSum: number;
  /** `unitSum − packageTotal` si es positivo; 0 si el paquete no ahorra. */
  savings: number;
  /** Alguna pieza no tiene precio: la suma está incompleta y NO se muestra ahorro inventado. */
  incomplete: boolean;
};

/**
 * Precio del paquete vs. suma por unidad. `unitSum` usa la regla de días de cada pieza
 * (escalones incluidos). Si el combo o una pieza no tienen precio, no se inventa ahorro.
 */
export function packageSummary(pack: TierPricedProduct, components: ReadonlyArray<PackageComponentSnapshot>, rentalDays: number): PackageSummary {
  const packageTotal = priceLine(pack, rentalDays).total;
  let unitSum = 0;
  let incomplete = components.length === 0;
  for (const component of components) {
    const line = priceLine({ basePrice: component.base, minimumPrice: component.minimum, billingUnit: component.billingUnit, tiers: component.tiers }, rentalDays);
    if (line.total <= 0) incomplete = true;
    unitSum += line.total * component.quantity;
  }
  const savings = !incomplete && packageTotal > 0 ? Math.max(0, unitSum - packageTotal) : 0;
  return { packageTotal, unitSum, savings, incomplete };
}

/** Resumen del paquete de una línea desde su snapshot (la que muestran presupuesto y portal). */
export function packageSummaryFromSnapshot(snapshot: PricingSnapshot, rentalDays: number): PackageSummary | null {
  if (!snapshot.package) return null;
  return packageSummary({ basePrice: snapshot.base, minimumPrice: snapshot.minimum, billingUnit: snapshot.billingUnit, tiers: snapshot.tiers }, snapshot.package.components, rentalDays);
}

export type SubstitutionPrice =
  | { known: true; delta: number; fromTotal: number; toTotal: number }
  | { known: false; delta: null };

/**
 * Diferencia de precio de reemplazar una pieza de un paquete: `cantidad × (total del sustituto −
 * total de la pieza)` para todo el período, con la regla de días de cada una. Si alguna no tiene
 * precio no se inventa la diferencia (`known: false`).
 *
 * Regla de re-precio del paquete: precio del paquete + diferencia (nunca por debajo de 0).
 */
export function substitutionPrice(
  from: TierPricedProduct,
  to: TierPricedProduct,
  quantity: number,
  rentalDays: number,
): SubstitutionPrice {
  const a = priceLine(from, rentalDays).total;
  const b = priceLine(to, rentalDays).total;
  if (a <= 0 || b <= 0) return { known: false, delta: null };
  return { known: true, delta: quantity * (b - a), fromTotal: a * quantity, toTotal: b * quantity };
}

export const repricedPackageTotal = (packageTotal: number, delta: number): number => Math.max(0, packageTotal + delta);

/** Escalones de los dos frentes que llegan del panel o de la importación: `[{ audience, fromDays, mode, price }]`. */
export function readAudienceTiers(raw: unknown): { ok: true; tiers: AudiencePriceTier[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, tiers: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Los precios por días deben ser una lista." };
  const out: AudiencePriceTier[] = [];
  for (const audience of ["RETAIL", "WHOLESALE"] as const) {
    const rows = raw.filter((entry) => (entry as Record<string, unknown> | null)?.audience === audience);
    const parsed = readPriceTiers(rows);
    if (!parsed.ok) return parsed;
    out.push(...parsed.tiers.map((tier) => ({ ...tier, audience })));
  }
  if (out.length !== raw.length) return { ok: false, error: "Cada escalón debe indicar si es de cliente final o mayorista." };
  return { ok: true, tiers: out };
}
