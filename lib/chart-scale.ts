/**
 * Escalas de los gráficos del panel (funciones puras, sin DOM). Un eje siempre
 * parte de 0: una barra truncada exagera las diferencias.
 */

const STEPS = [1, 2, 2.5, 5, 10];

/** Paso «lindo» (1, 2, 2,5, 5 × 10^k) para cubrir `max` con a lo sumo `maxTicks` intervalos. */
export function niceStep(max: number, maxTicks = 4): number {
  if (!(max > 0)) return 1;
  const raw = max / Math.max(1, maxTicks);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const step of STEPS) {
    if (step * magnitude >= raw - 1e-9) return step * magnitude;
  }
  return 10 * magnitude;
}

/** Marcas del eje Y: `[0, paso, 2·paso, … ≥ max]`. Con `max ≤ 0` devuelve `[0, 1]`. */
export function niceTicks(max: number, maxTicks = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const step = niceStep(max, maxTicks);
  const count = Math.ceil(max / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, index) => Math.round(index * step * 1e6) / 1e6);
}

/** Posición `0..1` de `value` en un dominio `[0, domainMax]`, acotada. */
export function scaleLinear(value: number, domainMax: number): number {
  if (!(domainMax > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / domainMax));
}

const es = (value: number, digits: number) =>
  new Intl.NumberFormat("es-PY", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);

/** Eje de montos PYG: millones con coma decimal («1,5 M»), miles bajo el millón («500 mil»). */
export function formatAxisMoney(value: number): string {
  const amount = Math.abs(Number(value));
  if (!Number.isFinite(amount) || amount === 0) return "0";
  if (amount >= 1_000_000) return `${es(amount / 1_000_000, 1)} M`;
  if (amount >= 1_000) return `${es(amount / 1_000, 0)} mil`;
  return es(amount, 0);
}

/** Eje de cantidades: enteros con separador de miles. */
export function formatAxisCount(value: number): string {
  return es(Math.round(Number(value) || 0), 0);
}
