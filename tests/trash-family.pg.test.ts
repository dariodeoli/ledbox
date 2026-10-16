import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("papelera de familias: recuperación aislada, códigos, variantes conservadas y vaciado seguro", { skip: !process.env.TEST_DATABASE_URL }, async t => {
 const url = new URL(process.env.TEST_DATABASE_URL!); assert(["127.0.0.1", "localhost"].includes(url.hostname)); process.env.DATABASE_URL = url.toString();
 const { db, dbWithDeleted: raw } = await import("../lib/server/db");
 const { trashFamily } = await import("../lib/server/inventory-families");
 const { restore, TrashError, archive, unarchive, anonymize } = await import("../lib/server/trash");
 const { listTrash, purgeInventoryFamily } = await import("../lib/server/trash-ops");
 const { purgeExpiredTrash } = await import("../lib/server/trash-purge");
 const org = randomUUID(), foreign = randomUUID(); const context = { organizationId: org, user: { id: randomUUID(), name: "QA familia", email: "family@example.invalid", role: "OWNER" as const } };
 const family = randomUUID(), item = randomUUID();
 const createFamily = async (id: string, organizationId = org, extra: Record<string, unknown> = {}) => raw.inventoryFamily.create({ data: { id, organizationId, name: "Familia QA", code: `F-${id}`, axes: [], ...extra } });
 const rejects = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (e: any) => e instanceof TrashError && e.status === status);
 try {
  for (const id of [org, foreign]) await raw.organization.create({ data: { id, name: "Papelera QA", slug: `trash-family-${id}` } });
  await createFamily(family);
  await raw.inventoryItem.create({ data: { id: item, organizationId: org, name: "Producto Azul", category: "QA", sku: "SKU-QA", familyId: family, variantOptions: { color: "Azul" }, variantKey: "color=azul", variantOwnPrice: true, listPrice: 5000, wholesalePrice: 4000, quantity: 1 } });
  await raw.inventoryUnit.create({ data: { id: randomUUID(), organizationId: org, inventoryId: item, code: "UNIT-QA", notes: "Conservar", status: "MAINTENANCE" } });
  const before = await raw.inventoryItem.findUniqueOrThrow({ where: { id: item } });
  await t.test("eliminar existente lista la familia y conserva productos y unidades", async () => {
   const result = await db.$transaction(tx => trashFamily(tx, org, family, context.user.id, "No se usa")); assert(result.ok); assert.equal(result.unlinked, 1);
   assert.equal(await db.inventoryFamily.findUnique({ where: { id: family } }), null, "filtro común oculta la familia eliminada");
   const rows = await listTrash(org); const row = rows.find(r => r.id === family); assert(row); assert.equal(row.type, "InventoryFamily"); assert.equal(row.reason, "No se usa"); assert.equal(row.anonymized, false); assert.deepEqual(row.blockers, []);
   const after = await raw.inventoryItem.findUniqueOrThrow({ where: { id: item } }); assert.equal(after.familyId, null); assert.deepEqual([after.name, after.quantity, after.listPrice, after.wholesalePrice], [before.name, before.quantity, before.listPrice, before.wholesalePrice]); assert.equal(await raw.inventoryUnit.count({ where: { inventoryId: item } }), 1);
  });
  await t.test("restaurar queda archivada, no revincula ni pierde datos, rechaza repetición/tenant ajeno", async () => {
   await rejects(restore("InventoryFamily", family, { ...context, organizationId: foreign }), 404);
   const results = await Promise.allSettled([restore("InventoryFamily", family, context), restore("InventoryFamily", family, context)]); assert.equal(results.filter(r => r.status === "fulfilled").length, 1); const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult; assert.equal(rejected.reason.status, 409);
   const restored = await raw.inventoryFamily.findUniqueOrThrow({ where: { id: family } }); assert(restored.archivedAt); assert.equal(restored.deletedAt, null); assert.equal(restored.deletedById, null); assert.equal(restored.deleteReason, null); assert.equal(restored.coverItemId, null);
   assert.equal((await raw.inventoryItem.findUniqueOrThrow({ where: { id: item } })).familyId, null);
   await unarchive("InventoryFamily", family, context); await archive("InventoryFamily", family, context); assert((await raw.inventoryFamily.findUniqueOrThrow({ where: { id: family } })).archivedAt);
  });
  await t.test("código reutilizado impide restaurar sin sobrescribir otra familia o SKU", async () => {
   const stamp = new Date("2020-01-01T00:00:00Z"); await raw.inventoryFamily.update({ where: { id: family }, data: { deletedAt: new Date(), archivedAt: stamp } });
   const other = randomUUID(); const code = `F-${family}`; await createFamily(other, org, { code }); await rejects(restore("InventoryFamily", family, context), 409); await raw.inventoryFamily.delete({ where: { id: other } });
   const sku = randomUUID(); await raw.inventoryItem.create({ data: { id: sku, organizationId: org, name: "Código ocupado", category: "QA", sku: code, quantity: 0 } }); await rejects(restore("InventoryFamily", family, context), 409);
   await raw.inventoryItem.update({ where: { id: sku }, data: { deletedAt: new Date(), archivedAt: new Date() } });
   await restore("InventoryFamily", family, context); assert.equal((await raw.inventoryFamily.findUniqueOrThrow({ where: { id: family } })).archivedAt!.toISOString(), stamp.toISOString());
  });
  await t.test("definitivo no desvincula variantes vivas ni eliminadas y valida confirmación", async () => {
   await raw.inventoryFamily.update({ where: { id: family }, data: { deletedAt: new Date() } });
   await raw.inventoryItem.update({ where: { id: item }, data: { familyId: family, deletedAt: new Date() } });
   await rejects(purgeInventoryFamily(family, { confirmName: "Familia QA", reason: "" }, context), 400);
   await rejects(purgeInventoryFamily(family, { confirmName: "Otro", reason: "QA" }, context), 400);
   await rejects(purgeInventoryFamily(family, { confirmName: "Familia QA", reason: "QA" }, { ...context, organizationId: foreign }), 404);
   await assert.rejects(purgeInventoryFamily(family, { confirmName: "Familia QA", reason: "QA" }, context), (e: any) => e.status === 409 && e.blockers[0].kind === "familyVariants");
   assert.equal((await raw.inventoryItem.findUniqueOrThrow({ where: { id: item } })).familyId, family); assert.equal(await raw.inventoryUnit.count({ where: { inventoryId: item } }), 1);
   await rejects(anonymize("InventoryFamily", family, context), 409);
   await raw.inventoryItem.update({ where: { id: item }, data: { familyId: null } }); await purgeInventoryFamily(family, { confirmName: "Familia QA", reason: "QA" }, context); assert.equal(await raw.inventoryFamily.findUnique({ where: { id: family } }), null); assert(await raw.inventoryItem.findUnique({ where: { id: item } }));
  });
  await t.test("vaciado automático borra sólo familia vacía vencida de la empresa", async () => {
   const old = new Date("2020-01-01"); const empty = randomUUID(), linked = randomUUID(), alien = randomUUID();
   await createFamily(empty, org, { deletedAt: old }); await createFamily(linked, org, { deletedAt: old }); await createFamily(alien, foreign, { deletedAt: old }); await raw.inventoryItem.update({ where: { id: item }, data: { familyId: linked } });
   const sweep = await purgeExpiredTrash(org, 30, { shared: false }); assert.equal(sweep.failed, 0); assert(sweep.purged >= 1); assert(sweep.retained >= 1); assert.equal(await raw.inventoryFamily.findUnique({ where: { id: empty } }), null); assert(await raw.inventoryFamily.findUnique({ where: { id: linked } })); assert(await raw.inventoryFamily.findUnique({ where: { id: alien } }));
  });
 } finally { await raw.organization.deleteMany({ where: { id: { in: [org, foreign] } } }); await raw.$disconnect(); }
});
