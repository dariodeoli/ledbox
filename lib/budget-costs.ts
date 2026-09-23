/**
 * Costos internos, margen y precio final de un presupuesto (issue #65).
 *
 * Reglas, todas en PYG enteros:
 *
 * - **Costo interno** = materiales + mano de obra + costo de los ítems
 *   (`Σ cantidad × días × costo unitario`). Los tres son datos internos: nunca
 *   salen al cliente (portal, imprimible ni link enviado).
 * - **Margen** = (precio final − costo interno) / precio final, en porcentaje
 *   del precio (la lectura contable habitual de «margen»). Sin precio o sin
 *   costo no hay margen: `null` en vez de un número inventado.
 * - **Precio sugerido** para un margen: `costo / (1 − margen/100)`.
 * - **Precio final** = lo que ve el cliente (`Budget.total`). Si entra en la
 *   suma de los ítems se aplica como descuento; si la supera, hay que subir los
 *   precios unitarios (`distributePrice` reparte el precio entre los ítems sin
 *   cambiar la suma de cada línea más de lo necesario).
 *
 * El panel usa estas funciones puras y los tests fijan la aritmética
 * (`tests/budget-costs.test.ts`).
 */

export type BudgetCostInput = {
  /** Materiales del presupuesto (interno, PYG). */
  materialCost: number;
  /** Mano de obra del presupuesto (interno, PYG). */
  laborCost: number;
  /** Ítems con su costo unitario (interno, PYG). */
  items: Array<{ quantity: number; days: number; costPrice: number }>;
};

export type BudgetInternalCost = {
  materials: number;
  labor: number;
  items: number;
  total: number;
};

/** Entero ≥ 0 (los montos nunca son negativos ni fraccionarios). */
function money(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** Costo interno del presupuesto, separado por origen. */
export function internalCostOf(input: BudgetCostInput): BudgetInternalCost {
  const materials = money(input.materialCost);
  const labor = money(input.laborCost);
  const items = input.items.reduce((sum, item) => sum + money(item.quantity) * money(item.days) * money(item.costPrice), 0);
  return { materials, labor, items, total: materials + labor + items };
}

export type BudgetMargin = {
  /** Margen en guaraníes (precio − costo). */
  amount: number;
  /** Margen sobre el precio, en porcentaje con dos decimales. */
  percent: number;
};

/**
 * Margen sobre el precio final. `null` cuando no hay precio (no se puede
 * expresar un margen) o cuando el costo es cero (el margen sería 100 % siempre
 * y no dice nada: el dato real es que no hay costo cargado).
 */
export function marginOf(price: number, cost: number): BudgetMargin | null {
  const finalPrice = money(price);
  const totalCost = money(cost);
  if (finalPrice <= 0 || totalCost <= 0) return null;
  const amount = finalPrice - totalCost;
  return { amount, percent: Math.round((amount / finalPrice) * 10_000) / 100 };
}

/**
 * Precio final sugerido para un margen sobre el precio: `costo / (1 − m/100)`.
 * `null` si el margen no está entre 0 y 99,99 % (un 100 % no tiene precio
 * finito) o si no hay costo.
 */
export function priceForMargin(cost: number, marginPercent: number): number | null {
  const totalCost = money(cost);
  if (totalCost <= 0) return null;
  if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent >= 100) return null;
  return Math.round(totalCost / (1 - marginPercent / 100));
}

export type FinalPriceIntent =
  | { ok: true; total: number; discount: number }
  | { ok: false; needed: number };

/**
 * Precio final que entra en la suma de ítems: se aplica como descuento
 * (`descuento = ítems − precio`). Si el precio la supera, no se puede aplicar
 * sin subir los precios unitarios: devuelve cuánto falta (`needed`).
 */
export function discountForPrice(subtotal: number, price: number): FinalPriceIntent {
  const items = money(subtotal);
  const finalPrice = money(price);
  if (finalPrice > items) return { ok: false, needed: finalPrice - items };
  return { ok: true, total: finalPrice, discount: items - finalPrice };
}

export type PriceableItem = { id: string | null; quantity: number; days: number; unitPrice: number };

export type DistributedPrice = {
  /** Precio unitario nuevo por ítem, en el mismo orden de entrada (mismos ids). */
  items: Array<{ id: string | null; unitPrice: number }>;
  /** Suma de las líneas con los precios nuevos (puede diferir por redondeo). */
  subtotal: number;
};

/**
 * Reparte un precio final entre los ítems subiendo (o bajando) sus precios
 * unitarios en proporción al subtotal de cada línea. Los precios unitarios son
 * enteros, así que la suma puede quedar a unos guaraníes del objetivo: la
 * diferencia se corrige en la línea más grande (la que menos distorsiona).
 */
export function distributePrice(items: readonly PriceableItem[], target: number): DistributedPrice {
  const wish = money(target);
  const lines = items.map((item) => {
    const units = Math.max(1, money(item.quantity) * money(item.days));
    return { item, units, current: units * money(item.unitPrice) };
  });
  const currentTotal = lines.reduce((sum, line) => sum + line.current, 0);
  if (currentTotal <= 0 || wish <= 0 || lines.length === 0) {
    return { items: items.map((item) => ({ id: item.id, unitPrice: money(item.unitPrice) })), subtotal: currentTotal };
  }
  const priced = lines.map((line) => {
    const lineTarget = Math.round((wish * line.current) / currentTotal);
    return { ...line, unitPrice: Math.max(1, Math.round(lineTarget / line.units)) };
  });
  // Ajuste fino: la diferencia entre lo logrado y el objetivo se corrige en la
  // línea de mayor subtotal (entera por unidad, así que puede quedar un resto).
  const achieved = priced.reduce((sum, line) => sum + line.units * line.unitPrice, 0);
  let remaining = wish - achieved;
  if (remaining !== 0) {
    const biggest = priced.reduce((best, line) => (line.units * line.unitPrice > best.units * best.unitPrice ? line : best), priced[0]);
    const step = Math.trunc(remaining / biggest.units);
    if (step !== 0) {
      biggest.unitPrice = Math.max(1, biggest.unitPrice + step);
      remaining = wish - priced.reduce((sum, line) => sum + line.units * line.unitPrice, 0);
    }
  }
  return {
    items: priced.map((line) => ({ id: line.item.id, unitPrice: line.unitPrice })),
    subtotal: priced.reduce((sum, line) => sum + line.units * line.unitPrice, 0),
  };
}
