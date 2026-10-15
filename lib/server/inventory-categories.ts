import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  CATEGORY_ICONS,
  CATEGORY_NAME_MAX,
  CATEGORY_TONES,
  categoryKey,
  categoryLabel,
  categoryNameValid,
  categoryPathKey,
  parseCategoryInput,
} from "@/lib/inventory-categories";

/**
 * Categorías de inventario (rediseño E1). **Un solo escritor** del texto
 * `InventoryItem.category`: todo alta, edición, edición masiva, importación, IA de carga y demo
 * pasa por `resolveInventoryCategory`, que busca por `key` o crea la categoría (y su padre) y
 * devuelve el `categoryId` junto con el espejo «Categoría › Subcategoría». Renombrar o mover una
 * categoría reescribe el texto de sus productos en la misma transacción.
 *
 * Todo va acotado por empresa: un id ajeno no existe (404 para quien llama).
 */

type Tx = Prisma.TransactionClient;

export type ResolvedCategory = { categoryId: string; text: string; parentName: string; childName: string | null };

export type ResolveCategoryInput = {
  /** Categoría existente por id (se valida contra la empresa). */
  categoryId?: string | null;
  /** Nombre o ruta («Vajilla», «Vajilla / Copas»). */
  category?: unknown;
  subcategory?: unknown;
};

/** Busca o crea una categoría por `key` (sin pisarse con otro proceso: ON CONFLICT DO NOTHING). */
async function findOrCreate(tx: Tx, organizationId: string, name: string, parent: { id: string; name: string } | null) {
  const key = parent ? categoryPathKey(parent.name, name) : categoryKey(name);
  const existing = await tx.inventoryCategory.findFirst({ where: { organizationId, key } });
  if (existing) return existing;
  await tx.inventoryCategory.createMany({
    data: [{ id: `cat_${randomUUID()}`, organizationId, name, parentId: parent?.id ?? null, key }],
    skipDuplicates: true,
  });
  return tx.inventoryCategory.findFirstOrThrow({ where: { organizationId, key } });
}

/** Resuelve (o crea) la categoría de un producto y devuelve el id y el texto espejo. `null` = el id no es de esta empresa. */
export async function resolveInventoryCategory(tx: Tx, organizationId: string, input: ResolveCategoryInput): Promise<ResolvedCategory | null> {
  if (input.categoryId) {
    const found = await tx.inventoryCategory.findFirst({ where: { id: input.categoryId, organizationId }, include: { parent: true } });
    if (!found) return null;
    const parentName = found.parent ? found.parent.name : found.name;
    const childName = found.parent ? found.name : null;
    return { categoryId: found.id, text: categoryLabel(parentName, childName), parentName, childName };
  }
  const path = parseCategoryInput(input.category, input.subcategory);
  const parent = await findOrCreate(tx, organizationId, path.parent, null);
  const leaf = path.child ? await findOrCreate(tx, organizationId, path.child, parent) : parent;
  return { categoryId: leaf.id, text: categoryLabel(parent.name, path.child ? leaf.name : null), parentName: parent.name, childName: path.child ? leaf.name : null };
}

/** Datos de `InventoryItem` que escribe el helper: `categoryId` + espejo `category`. */
export function categoryWriteData(resolved: ResolvedCategory): { categoryId: string; category: string } {
  return { categoryId: resolved.categoryId, category: resolved.text };
}

export type CategoryFailure = { ok: false; status: 400 | 404 | 409; error: string };
const fail = (status: CategoryFailure["status"], error: string): CategoryFailure => ({ ok: false, status, error });

/** Reescribe el texto espejo de los productos de una categoría (y de sus hijas). */
async function rewriteItemTexts(tx: Tx, organizationId: string, rootId: string) {
  const nodes = await tx.inventoryCategory.findMany({
    where: { organizationId, OR: [{ id: rootId }, { parentId: rootId }] },
    include: { parent: true },
  });
  for (const node of nodes) {
    const text = node.parent ? categoryLabel(node.parent.name, node.name) : node.name;
    await tx.inventoryItem.updateMany({ where: { organizationId, categoryId: node.id }, data: { category: text } });
  }
}

/** Reescribe las claves de una categoría y de sus hijas (tras renombrar o mover). */
async function rewriteKeys(tx: Tx, organizationId: string, node: { id: string; name: string; parentId: string | null }, parentName: string | null) {
  await tx.inventoryCategory.update({ where: { id: node.id }, data: { name: node.name, parentId: node.parentId, key: parentName ? categoryPathKey(parentName, node.name) : categoryKey(node.name) } });
  const children = await tx.inventoryCategory.findMany({ where: { organizationId, parentId: node.id } });
  for (const child of children) {
    await tx.inventoryCategory.update({ where: { id: child.id }, data: { key: categoryPathKey(node.name, child.name) } });
  }
}

async function keyTaken(tx: Tx, organizationId: string, key: string, exceptIds: string[]) {
  const clash = await tx.inventoryCategory.findFirst({ where: { organizationId, key, id: { notIn: exceptIds } }, select: { id: true } });
  return Boolean(clash);
}

export async function renameInventoryCategory(tx: Tx, organizationId: string, id: string, rawName: unknown): Promise<{ ok: true; before: string; after: string } | CategoryFailure> {
  const name = typeof rawName === "string" ? rawName.replace(/\s+/g, " ").trim() : "";
  if (!categoryNameValid(name)) return fail(400, `El nombre va de 1 a ${CATEGORY_NAME_MAX} caracteres y no puede llevar «/», «>» ni «›».`);
  const node = await tx.inventoryCategory.findFirst({ where: { id, organizationId }, include: { parent: true } });
  if (!node) return fail(404, "La categoría no existe en esta empresa.");
  const key = node.parent ? categoryPathKey(node.parent.name, name) : categoryKey(name);
  if (await keyTaken(tx, organizationId, key, [node.id])) return fail(409, `Ya existe una categoría llamada «${name}».`);
  await rewriteKeys(tx, organizationId, { id: node.id, name, parentId: node.parentId }, node.parent?.name ?? null);
  await rewriteItemTexts(tx, organizationId, node.id);
  return { ok: true, before: node.name, after: name };
}

/** Mueve una subcategoría bajo otra categoría (o la sube a categoría con `parentId = null`). */
export async function moveInventoryCategory(tx: Tx, organizationId: string, id: string, parentId: string | null): Promise<{ ok: true } | CategoryFailure> {
  const node = await tx.inventoryCategory.findFirst({ where: { id, organizationId } });
  if (!node) return fail(404, "La categoría no existe en esta empresa.");
  let parent: { id: string; name: string } | null = null;
  if (parentId) {
    if (parentId === id) return fail(400, "Una categoría no puede ir dentro de sí misma.");
    const target = await tx.inventoryCategory.findFirst({ where: { id: parentId, organizationId } });
    if (!target) return fail(404, "La categoría de destino no existe en esta empresa.");
    if (target.parentId) return fail(409, "Solo hay un nivel de subcategoría: elegí una categoría principal como destino.");
    const hasChildren = await tx.inventoryCategory.count({ where: { organizationId, parentId: node.id } });
    if (hasChildren > 0) return fail(409, "Esta categoría tiene subcategorías: movelas o unilas antes de ponerla dentro de otra.");
    parent = { id: target.id, name: target.name };
  }
  const key = parent ? categoryPathKey(parent.name, node.name) : categoryKey(node.name);
  if (await keyTaken(tx, organizationId, key, [node.id])) return fail(409, `Ya existe «${node.name}» en ese lugar.`);
  await rewriteKeys(tx, organizationId, { id: node.id, name: node.name, parentId: parent?.id ?? null }, parent?.name ?? null);
  await rewriteItemTexts(tx, organizationId, node.id);
  return { ok: true };
}

/** Une `fromId` dentro de `intoId`: los productos pasan al destino y la categoría de origen se elimina. */
export async function mergeInventoryCategories(tx: Tx, organizationId: string, fromId: string, intoId: string): Promise<{ ok: true; moved: number } | CategoryFailure> {
  if (fromId === intoId) return fail(400, "Elegí dos categorías distintas.");
  const [from, into] = await Promise.all([
    tx.inventoryCategory.findFirst({ where: { id: fromId, organizationId } }),
    tx.inventoryCategory.findFirst({ where: { id: intoId, organizationId }, include: { parent: true } }),
  ]);
  if (!from || !into) return fail(404, "La categoría no existe en esta empresa.");
  if (await tx.inventoryCategory.count({ where: { organizationId, parentId: from.id } })) {
    return fail(409, "La categoría de origen tiene subcategorías: movelas o unilas primero.");
  }
  if (into.parentId === from.id) return fail(409, "No se puede unir una categoría con una de sus subcategorías.");
  const text = into.parent ? categoryLabel(into.parent.name, into.name) : into.name;
  const moved = await tx.inventoryItem.updateMany({ where: { organizationId, categoryId: from.id }, data: { categoryId: into.id, category: text } });
  await tx.inventoryCategory.delete({ where: { id: from.id } });
  return { ok: true, moved: moved.count };
}

export async function archiveInventoryCategory(tx: Tx, organizationId: string, id: string, archive: boolean): Promise<{ ok: true } | CategoryFailure> {
  const node = await tx.inventoryCategory.findFirst({ where: { id, organizationId } });
  if (!node) return fail(404, "La categoría no existe en esta empresa.");
  const archivedAt = archive ? node.archivedAt ?? new Date() : null;
  // Archivar una categoría archiva sus subcategorías; restaurar una subcategoría restaura su categoría.
  const ids = archive ? [node.id, ...(await tx.inventoryCategory.findMany({ where: { organizationId, parentId: node.id }, select: { id: true } })).map((row) => row.id)] : [node.id, ...(node.parentId ? [node.parentId] : [])];
  await tx.inventoryCategory.updateMany({ where: { organizationId, id: { in: ids } }, data: { archivedAt } });
  return { ok: true };
}

export type CategoryStyleInput = { color?: unknown; icon?: unknown; sortOrder?: unknown };

/** Color, ícono y orden de una categoría. `undefined` = no tocar; `null`/vacío = quitar. */
export async function styleInventoryCategory(tx: Tx, organizationId: string, id: string, input: CategoryStyleInput): Promise<{ ok: true } | CategoryFailure> {
  const node = await tx.inventoryCategory.findFirst({ where: { id, organizationId }, select: { id: true } });
  if (!node) return fail(404, "La categoría no existe en esta empresa.");
  const data: Prisma.InventoryCategoryUpdateInput = {};
  if (input.color !== undefined) {
    if (input.color !== null && input.color !== "" && !(CATEGORY_TONES as readonly unknown[]).includes(input.color)) return fail(400, "El color no es válido.");
    data.color = input.color ? String(input.color) : null;
  }
  if (input.icon !== undefined) {
    if (input.icon !== null && input.icon !== "" && !(CATEGORY_ICONS as readonly unknown[]).includes(input.icon)) return fail(400, "El ícono no es válido.");
    data.icon = input.icon ? String(input.icon) : null;
  }
  if (input.sortOrder !== undefined) {
    if (typeof input.sortOrder !== "number" || !Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 9999) return fail(400, "El orden es un entero de 0 a 9999.");
    data.sortOrder = input.sortOrder;
  }
  await tx.inventoryCategory.update({ where: { id }, data });
  return { ok: true };
}

/** Árbol de la empresa con la cantidad de productos de cada categoría (sin la papelera). */
export async function listInventoryCategories(tx: Tx, organizationId: string) {
  const [rows, counts] = await Promise.all([
    tx.inventoryCategory.findMany({ where: { organizationId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    tx.inventoryItem.groupBy({ by: ["categoryId"], where: { organizationId, categoryId: { not: null } }, _count: { _all: true } }),
  ]);
  const byId = new Map(counts.map((row) => [row.categoryId, row._count._all]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    key: row.key,
    sortOrder: row.sortOrder,
    color: row.color,
    icon: row.icon,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    itemCount: byId.get(row.id) ?? 0,
  }));
}
