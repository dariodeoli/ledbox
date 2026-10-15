/**
 * Colecciones con nombre de la tienda («Verde Bosque», «Colección Rayas»). Reglas puras: las usan el panel,
 * el API, la importación y los tests.
 */

export const COLLECTION_NAME_MAX = 60;
export const COLLECTION_DESCRIPTION_MAX = 400;
export const COLLECTIONS_MAX = 40;
export const COLLECTION_ITEMS_MAX = 300;
export const COLLECTION_ORDER_MAX = 9999;

/** Texto → slug de URL: minúsculas, sin tildes, guiones. Vacío si no queda nada usable. */
export function collectionSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " y ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function isCollectionSlug(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

/** Slug libre dentro de `taken` (agrega -2, -3…). */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || "coleccion";
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${root.slice(0, 56)}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, 50)}-${Date.now()}`;
}

export type CollectionInput = { name: string; description: string | null; visible: boolean; sortOrder: number; itemIds: string[] };

/** Valida el cuerpo del panel; los campos ausentes mantienen `current` (si se pasa). */
export function parseCollectionInput(body: unknown, current?: Partial<CollectionInput>): { ok: true; value: CollectionInput } | { ok: false; error: string } {
  const input = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const nameRaw = input.name !== undefined ? input.name : current?.name;
  if (typeof nameRaw !== "string") return { ok: false, error: "Escribí el nombre de la colección." };
  const name = nameRaw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, error: "Escribí el nombre de la colección." };
  if (name.length > COLLECTION_NAME_MAX) return { ok: false, error: `El nombre no puede superar los ${COLLECTION_NAME_MAX} caracteres.` };
  if (!collectionSlug(name)) return { ok: false, error: "El nombre tiene que llevar letras o números." };

  let description = current?.description ?? null;
  if (input.description !== undefined) {
    if (input.description !== null && typeof input.description !== "string") return { ok: false, error: "La descripción tiene que ser un texto." };
    const text = (typeof input.description === "string" ? input.description : "").replace(/\s+/g, " ").trim();
    if (text.length > COLLECTION_DESCRIPTION_MAX) return { ok: false, error: `La descripción no puede superar los ${COLLECTION_DESCRIPTION_MAX} caracteres.` };
    description = text || null;
  }
  let visible = current?.visible ?? true;
  if (input.visible !== undefined) {
    if (typeof input.visible !== "boolean") return { ok: false, error: "«Visible» se enciende o se apaga." };
    visible = input.visible;
  }
  let sortOrder = current?.sortOrder ?? 0;
  if (input.sortOrder !== undefined) {
    const value = Number(input.sortOrder);
    if (!Number.isInteger(value) || value < 0 || value > COLLECTION_ORDER_MAX) return { ok: false, error: `El orden tiene que ser un entero de 0 a ${COLLECTION_ORDER_MAX}.` };
    sortOrder = value;
  }
  let itemIds = current?.itemIds ?? [];
  if (input.itemIds !== undefined) {
    if (!Array.isArray(input.itemIds) || input.itemIds.some((id) => typeof id !== "string" || !id || id.length > 80)) return { ok: false, error: "La lista de productos no es válida." };
    itemIds = [...new Set(input.itemIds as string[])];
    if (itemIds.length > COLLECTION_ITEMS_MAX) return { ok: false, error: `Una colección admite hasta ${COLLECTION_ITEMS_MAX} productos.` };
  }
  return { ok: true, value: { name, description, visible, sortOrder, itemIds } };
}

/** Colecciones en el orden de la tienda: `sortOrder` y, a igual orden, por nombre. */
export function sortCollections<T extends { sortOrder: number; name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"));
}
