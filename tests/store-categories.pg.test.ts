import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("categorías públicas: solo OPEN, productos publicados RETAIL/BOTH y empresa actual, sin costos ni notas", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  process.env.DATABASE_URL = url.toString();
  const { db } = await import("../lib/server/db");
  const { loadPublicCategory } = await import("../lib/server/store-categories");
  const { storeCategories } = await import("../lib/store-categories");
  const orgs: string[] = [];
  async function company(mode: "OPEN" | "REQUEST" | "PRIVATE" = "OPEN", enabled = true) {
    const id = randomUUID(); orgs.push(id); const slug = `cat130-${id}`;
    await db.organization.create({ data: { id, slug, name: `QA ${id}` } });
    await db.organizationRentalSettings.create({ data: { id: randomUUID(), organizationId: id, publicCatalogEnabled: enabled, publicShowPrices: true, catalogAccessMode: mode } });
    return { id, slug };
  }
  async function product(organizationId: string, category: string, catalogAudience: string = "RETAIL", other: Record<string, unknown> = {}) {
    return db.inventoryItem.create({ data: { id: randomUUID(), organizationId, name: `${category} de prueba`, category, quantity: 4, catalogAudience, visibleOnWeb: catalogAudience !== "HIDDEN", listPrice: 100_000, dailyCost: 987_654, notes: "NOTA-INTERNA-130", ...other } });
  }
  try {
    const a = await company(); const b = await company();
    const retail = await product(a.id, "Tótems"); const both = await product(a.id, "Tótems", "BOTH");
    const otherCategory = await product(a.id, "Vajilla");
    const hidden = await product(a.id, "Oculta", "HIDDEN");
    const wholesale = await product(a.id, "Solo mayoristas", "WHOLESALE");
    const retired = await product(a.id, "Retirados", "BOTH", { status: "RETIRED" });
    const archived = await product(a.id, "Archivados", "BOTH", { archivedAt: new Date() });
    const foreign = await product(b.id, "Ajena");
    const data = await loadPublicCategory(a.slug, "totems", null);
    assert.ok(data);
    assert.equal(data.category.name, "Tótems");
    assert.deepEqual(data.items.filter((item) => item.category === data.category.name).map((item) => item.id).sort(), [retail.id, both.id].sort());
    assert.ok(data.items.some((item) => item.id === otherCategory.id), "carrito conserva las líneas públicas de otras categorías");
    const json = JSON.stringify(data.items);
    for (const secret of [hidden.id, wholesale.id, retired.id, archived.id, foreign.id, "NOTA-INTERNA-130", "dailyCost", "987654"]) assert.ok(!json.includes(secret), secret);
    for (const category of ["oculta", "solo-mayoristas", "retirados", "archivados", "ajena"]) assert.equal(await loadPublicCategory(a.slug, category, null), null);
    for (const mode of ["REQUEST", "PRIVATE"] as const) {
      const restricted = await company(mode); await product(restricted.id, "Tótems");
      assert.equal(await loadPublicCategory(restricted.slug, "totems", null), null);
    }
    const off = await company("OPEN", false); await product(off.id, "Tótems");
    assert.equal(await loadPublicCategory(off.slug, "totems", null), null);
    await db.organizationRentalSettings.update({ where: { organizationId: a.id }, data: { publicShowPrices: false } });
    const withoutPrices = await loadPublicCategory(a.slug, "totems", null);
    assert.ok(withoutPrices?.items.some((item) => item.id === otherCategory.id), "sin precios el carrito sigue conociendo otras categorías");
    assert.ok(withoutPrices?.items.every((item) => item.price === null));
    const collision = await product(a.id, "Totems");
    const nameSlug = storeCategories([{ category: "Tótems" }, { category: "Totems" }]).find((entry) => entry.name === "Tótems")!.slug;
    assert.equal((await loadPublicCategory(a.slug, nameSlug, null))?.category.name, "Tótems");
    await db.inventoryItem.update({ where: { id: collision.id }, data: { catalogAudience: "HIDDEN", visibleOnWeb: false } });
    assert.equal((await loadPublicCategory(a.slug, nameSlug, null))?.category.slug, "totems", "enlace con huella anterior se puede canonicalizar");
  } finally {
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
  }
});
