/**
 * Combos (kits) de inventario, alquileres fase 2c. Cálculo puro y sin acceso a la
 * base: lo comparten el servidor (motor de compromiso) y las pantallas.
 *
 * Un combo es un ítem de inventario con componentes y sin unidades propias. Su
 * capacidad en un rango es el mínimo, entre sus componentes, de
 * floor(libres del componente / cantidad por combo): el componente con ese mínimo
 * es el limitante.
 */

export const MAX_COMBO_COMPONENTS = 40;
export const MAX_COMBO_COMPONENT_QUANTITY = 9999;

export type ComboComponentDef = { componentId: string; name: string; quantity: number };

export type ComboComponentCapacity = ComboComponentDef & {
  /** Unidades libres del componente en el rango. */
  available: number;
  /** Cuántos combos alcanza a armar este componente solo. */
  canMake: number;
};

export type ComboCapacity = {
  /** Combos que se pueden armar (0 si no tiene componentes). */
  capacity: number;
  /** Componente que fija el máximo (el primero en empate); null sin componentes. */
  limiting: ComboComponentCapacity | null;
  components: ComboComponentCapacity[];
};

/** Capacidad del combo dados los componentes y las unidades libres de cada uno. */
export function comboCapacity(
  components: ReadonlyArray<ComboComponentDef>,
  availableById: ReadonlyMap<string, number> | Record<string, number>,
): ComboCapacity {
  const lookup = (id: string) => (availableById instanceof Map ? availableById.get(id) : (availableById as Record<string, number>)[id]) ?? 0;
  const rows = components.map((component) => {
    const available = Math.max(0, Math.floor(lookup(component.componentId)));
    return { ...component, available, canMake: Math.floor(available / Math.max(1, component.quantity)) };
  });
  if (rows.length === 0) return { capacity: 0, limiting: null, components: rows };
  const limiting = rows.reduce((min, row) => (row.canMake < min.canMake ? row : min), rows[0]);
  return { capacity: limiting.canMake, limiting, components: rows };
}

/** Texto de la capacidad: «Se pueden armar 2». */
export function comboCapacityLabel(capacity: number): string {
  return capacity === 1 ? "Se puede armar 1" : `Se pueden armar ${capacity}`;
}

export type ComboComponentInput = { componentId: string; quantity: number };

/** Normaliza y valida la lista de componentes que llega de la pantalla o de la API. */
export function readComboComponents(value: unknown): { ok: true; components: ComboComponentInput[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "Un combo necesita al menos un componente." };
  if (value.length > MAX_COMBO_COMPONENTS) return { ok: false, error: `Un combo admite hasta ${MAX_COMBO_COMPONENTS} componentes.` };
  const seen = new Set<string>();
  const components: ComboComponentInput[] = [];
  for (const raw of value) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const componentId = typeof row.componentId === "string" ? row.componentId.trim() : "";
    if (!componentId) return { ok: false, error: "Elegí el ítem de cada componente." };
    if (seen.has(componentId)) return { ok: false, error: "Un componente no puede repetirse en el combo." };
    seen.add(componentId);
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_COMBO_COMPONENT_QUANTITY) {
      return { ok: false, error: `La cantidad de cada componente debe ser un entero entre 1 y ${MAX_COMBO_COMPONENT_QUANTITY}.` };
    }
    components.push({ componentId, quantity });
  }
  return { ok: true, components };
}
