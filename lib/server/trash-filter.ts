/**
 * Filtro de la papelera (docs/PAPELERA.md): lo eliminado (`deletedAt` con fecha) no
 * aparece en ninguna lectura de los modelos con papelera. Puro y sin Prisma para
 * poder probarlo sin base. La extensión de `lib/server/db.ts` lo aplica a cada operación.
 */

export const TRASH_MODELS = ["Event", "InventoryItem", "InventoryFamily", "Client", "Lead", "Supplier", "Promoter", "Budget"] as const;
export type TrashModel = (typeof TRASH_MODELS)[number];

/** Operaciones de lectura que reciben `where` y quedan filtradas. */
export const FILTERED_OPERATIONS = [
  "findMany",
  "findFirst",
  "findUnique",
  "findFirstOrThrow",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
] as const;
export type FilteredOperation = (typeof FILTERED_OPERATIONS)[number];

/** Condición para los `include`/`select` anidados (la extensión no los filtra): `include: { client: { where: live } }`. */
export const live = { deletedAt: null } as const;

export function isTrashModel(model: string): model is TrashModel {
  return (TRASH_MODELS as readonly string[]).includes(model);
}

export function isFilteredOperation(operation: string): operation is FilteredOperation {
  return (FILTERED_OPERATIONS as readonly string[]).includes(operation);
}

/**
 * `true` si el `where` ya habla de `deletedAt` en el nivel superior o dentro de un
 * `AND` (se respeta tal cual). Una mención solo dentro de `OR`/`NOT` no cuenta: sería
 * una forma de traer lo eliminado sin querer, así que igual se agrega el filtro.
 */
export function mentionsDeletedAt(where: unknown): boolean {
  if (!where || typeof where !== "object") return false;
  if (Array.isArray(where)) return where.some(mentionsDeletedAt);
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (key === "deletedAt") return true;
    if (key === "AND" && mentionsDeletedAt(value)) return true;
  }
  return false;
}

/**
 * Devuelve los `args` con `deletedAt: null` agregado al `where`. Es un campo más del
 * objeto (equivale a un AND): en `findUnique*` no rompe la unicidad porque Prisma
 * admite filtros no únicos junto a la clave única.
 */
export function withLiveFilter<A extends { where?: unknown } | undefined>(args: A): NonNullable<A> {
  const base = (args ?? {}) as { where?: Record<string, unknown> };
  if (mentionsDeletedAt(base.where)) return base as NonNullable<A>;
  return { ...base, where: { ...(base.where ?? {}), deletedAt: null } } as NonNullable<A>;
}
