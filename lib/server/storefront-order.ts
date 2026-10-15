import { Prisma } from "@prisma/client";
import { catalogAudienceWhere } from "@/lib/catalog-audience";
import { compareStorefrontItems, parseStorefrontOrder, sortValueAt } from "@/lib/storefront-order";
import { db } from "./db";
import { inventoryImageUrl } from "./inventory-images";

/**
 * Orden de la tienda web que decide la empresa (Ajustes → Tienda). Secciones = categorías del
 * árbol (`InventoryCategory.sortOrder`); productos = `InventoryItem.webSortOrder` dentro de su
 * sección. Todo scopeado a la empresa activa: un id de otra empresa responde 404 y no escribe nada.
 */

export type StorefrontOrderSection = {
  categoryId: string;
  /** «Categoría › Subcategoría» como se ve en la tienda. */
  name: string;
  sortOrder: number;
  items: Array<{ id: string; name: string; sku: string | null; imageUrl: string | null; webSortOrder: number }>;
};

export type StorefrontOrderView = {
  sections: StorefrontOrderSection[];
  /** Productos publicados sin categoría del árbol: salen al final, por nombre (no se pueden mover). */
  unassigned: Array<{ id: string; name: string; category: string }>;
};

/** Lo que se publica en alguna de las dos tiendas (cliente final o mayorista), sin archivados ni retirados. */
const PUBLISHED = {
  archivedAt: null,
  status: { not: "RETIRED" as const },
  OR: [{ AND: [catalogAudienceWhere("RETAIL")] }, { AND: [catalogAudienceWhere("WHOLESALE")] }],
};

export async function loadStorefrontOrder(organizationId: string): Promise<StorefrontOrderView> {
  const rows = await db.inventoryItem.findMany({
    where: { organizationId, ...PUBLISHED },
    orderBy: { name: "asc" },
    take: 2000,
    select: { id: true, name: true, sku: true, category: true, categoryId: true, imageUrl: true, imageMime: true, updatedAt: true, webSortOrder: true, categoryRef: { select: { id: true, sortOrder: true } } },
  });
  const sections = new Map<string, StorefrontOrderSection>();
  const unassigned: StorefrontOrderView["unassigned"] = [];
  const sorted = [...rows].sort((a, b) =>
    compareStorefrontItems(
      { name: a.name, category: a.category, categorySort: a.categoryRef?.sortOrder ?? null, webSortOrder: a.webSortOrder },
      { name: b.name, category: b.category, categorySort: b.categoryRef?.sortOrder ?? null, webSortOrder: b.webSortOrder },
    ),
  );
  for (const row of sorted) {
    if (!row.categoryRef) {
      unassigned.push({ id: row.id, name: row.name, category: row.category });
      continue;
    }
    const section = sections.get(row.categoryRef.id) ?? { categoryId: row.categoryRef.id, name: row.category, sortOrder: row.categoryRef.sortOrder, items: [] };
    section.items.push({ id: row.id, name: row.name, sku: row.sku, imageUrl: inventoryImageUrl(row), webSortOrder: row.webSortOrder });
    sections.set(row.categoryRef.id, section);
  }
  return { sections: [...sections.values()], unassigned };
}

export type SaveOrderResult = { ok: true; sections: number; items: number } | { ok: false; status: number; error: string };

/** Guarda el orden: secciones (`sortOrder` de la categoría) y productos (`webSortOrder`) de la empresa. */
export async function saveStorefrontOrder(organizationId: string, body: unknown): Promise<SaveOrderResult> {
  const parsed = parseStorefrontOrder(body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { sections } = parsed.value;
  const categoryIds = sections.map((section) => section.categoryId);
  const itemIds = sections.flatMap((section) => section.itemIds);

  return db.$transaction(async (tx) => {
    // Todo id tiene que ser de ESTA empresa: uno ajeno (o inexistente) corta antes de escribir.
    const [categories, items] = await Promise.all([
      tx.inventoryCategory.count({ where: { organizationId, id: { in: categoryIds } } }),
      itemIds.length ? tx.inventoryItem.count({ where: { organizationId, id: { in: itemIds } } }) : Promise.resolve(0),
    ]);
    if (categories !== categoryIds.length || items !== itemIds.length) {
      return { ok: false as const, status: 404, error: "Alguna sección o producto no existe en esta empresa." };
    }
    const categoryOrders = categoryIds.map((_, index) => sortValueAt(index));
    await tx.$executeRaw(Prisma.sql`
      UPDATE "InventoryCategory" AS c SET "sortOrder" = v."ord"
      FROM (SELECT unnest(${categoryIds}::text[]) AS "id", unnest(${categoryOrders}::int[]) AS "ord") AS v
      WHERE c."id" = v."id" AND c."organizationId" = ${organizationId}`);
    for (const section of sections) {
      if (section.itemIds.length === 0) continue;
      const orders = section.itemIds.map((_, index) => sortValueAt(index));
      await tx.$executeRaw(Prisma.sql`
        UPDATE "InventoryItem" AS i SET "webSortOrder" = v."ord"
        FROM (SELECT unnest(${section.itemIds}::text[]) AS "id", unnest(${orders}::int[]) AS "ord") AS v
        WHERE i."id" = v."id" AND i."organizationId" = ${organizationId}`);
    }
    return { ok: true as const, sections: categoryIds.length, items: itemIds.length };
  }, { timeout: 30_000 });
}
