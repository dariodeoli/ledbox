/**
 * «Falta precio» en presupuestos. Un producto importado sin precio queda en 0 («Consultar» en la
 * tienda); en un presupuesto esa línea NO puede viajar como si costara 0: bloquea enviar, aprobar y
 * cobrar hasta cargarle el precio. Si el ítem es gratis a propósito, el equipo lo confirma en la
 * línea (`freeOnPurpose`) y recién ahí un 0 es válido.
 */
export type PriceGateLine = { name: string; unitPrice: number; excluded?: boolean | null; freeOnPurpose?: boolean | null };

/** ¿La línea cuenta y tiene precio unitario 0 sin confirmar que es gratis? */
export function lineMissingPrice(line: Pick<PriceGateLine, "unitPrice" | "excluded" | "freeOnPurpose">): boolean {
  return !line.excluded && line.unitPrice === 0 && !line.freeOnPurpose;
}

export function missingPriceNames(lines: ReadonlyArray<PriceGateLine>): string[] {
  return lines.filter(lineMissingPrice).map((line) => line.name);
}

const listed = (names: string[]) => (names.length > 3 ? `${names.slice(0, 3).map((n) => `«${n}»`).join(", ")} y ${names.length - 3} más` : names.map((n) => `«${n}»`).join(", "));

/** Mensaje claro (es-PY) para el panel; `action` es lo que se frena. */
export function missingPriceMessage(names: string[], action: "enviar" | "aprobar" | "cobrar"): string {
  const plural = names.length > 1;
  return `Falta precio en ${plural ? "estas líneas" : "esta línea"}: ${listed(names)}. Cargá ${plural ? "los precios" : "el precio"} (o marcá ${plural ? "las líneas" : "la línea"} como gratis a propósito) antes de ${action} el presupuesto.`;
}

/** Mensaje público (portal): sin nombres internos de líneas. */
export const PORTAL_PRICE_MESSAGE = "Este presupuesto está en revisión de precios; el equipo te contacta.";
