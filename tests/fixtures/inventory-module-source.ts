import { readFileSync } from "node:fs";

/**
 * Fuente del módulo Inventario: el rediseño lo reparte en archivos con una sola
 * responsabilidad (módulo, lista, ficha, formularios y piezas compartidas). Los
 * tests de estructura leen el conjunto para fijar el contrato sin depender de en
 * cuál archivo vive cada pieza.
 */
export const INVENTORY_MODULE_FILES = [
  "InventarioModule.tsx",
  "InventoryList.tsx",
  "InventoryFicha.tsx",
  "InventoryItemDialogs.tsx",
  "InventoryParts.tsx",
] as const;

export function inventoryModuleSource(): string {
  return INVENTORY_MODULE_FILES.map((file) => readFileSync(new URL(`../../components/admin/modules/${file}`, import.meta.url), "utf8")).join("\n");
}
