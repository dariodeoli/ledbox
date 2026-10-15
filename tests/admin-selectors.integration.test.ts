import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const testUrl = process.env.TEST_DATABASE_URL;
const local = Boolean(testUrl && /^postgresql:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//.test(testUrl));
test("selectores: encuentran el registro 305, respetan empresa y conservan selección (PG local)", { skip: !local }, async () => {
  process.env.DATABASE_URL = testUrl;
  const { db, dbWithDeleted } = await import("../lib/server/db");
  const { listClientSelector } = await import("../lib/server/client-selector");
  const { listInventoryGrid } = await import("../lib/server/inventory-grid");
  const org = randomUUID(), foreign = randomUUID();
  const target = randomUUID(), foreignClient = randomUUID(), product = randomUUID();
  try {
    await db.organization.createMany({ data: [org, foreign].map((id) => ({ id, slug: `selector-${id}`, name: "Selector QA" })) });
    await db.client.createMany({ data: Array.from({ length: 304 }, (_, i) => ({ id: randomUUID(), organizationId: org, name: `A cliente ${i.toString().padStart(3, "0")}` })) });
    await db.client.createMany({ data: [{ id: target, organizationId: org, name: "Z cliente fuera del tope", contactName: "Responsable visible QA", notes: "Nota interna excluida", phone: "+595 981765432" }, { id: foreignClient, organizationId: foreign, name: "Z cliente privado" }] });
    await db.clientLogo.create({ data: { id: randomUUID(), clientId: target, mime: "image/png", size: 3, data: Buffer.from([1,2,3]) } });
    const identityDTO = (await listClientSelector(org, "Responsable visible QA"))[0];
    assert.equal(identityDTO.id, target);
    assert.equal(identityDTO.contactName, "Responsable visible QA");
    assert.ok(identityDTO.logoUpdatedAt);
    assert.ok(!("logo" in identityDTO));
    assert.ok(!("data" in identityDTO));
    assert.ok(!("notes" in identityDTO));
    assert.equal((await listClientSelector(org, "")).length, 30);
    assert.equal((await listClientSelector(org, "fuera del tope"))[0].id, target);
    assert.equal((await listClientSelector(org, "981765432"))[0].id, target);
    assert.ok((await listClientSelector(org, "", target)).some((row) => row.id === target));
    assert.ok(!(await listClientSelector(org, "", foreignClient)).some((row) => row.id === foreignClient));
    assert.deepEqual(await listClientSelector(org, "privado"), []);
    await db.inventoryItem.createMany({ data: Array.from({ length: 304 }, (_, i) => ({ id: randomUUID(), organizationId: org, name: `A producto ${i.toString().padStart(3, "0")}`, category: "QA" })) });
    await db.inventoryItem.createMany({ data: [{ id: product, organizationId: org, name: "Z producto único", sku: "SKU-305", category: "Prueba", quantity: 12 }, { id: randomUUID(), organizationId: foreign, name: "Z producto privado", sku: "SKU-305", category: "Prueba" }] });
    const results = await listInventoryGrid({ organizationId: org, query: "sku-305", limit: 6 });
    assert.equal(results.inventory.length, 1);
    assert.equal(results.inventory[0].id, product);
    assert.equal(results.inventory[0].availability.availableNow, 12);
    assert.ok(!("units" in results.inventory[0]), "DTO sin unidades completas");
    assert.ok(!("assignments" in results.inventory[0]), "DTO sin historial de asignaciones");
    assert.equal((await listInventoryGrid({ organizationId: org, query: "privado", limit: 6 })).inventory.length, 0);
    const first = await listInventoryGrid({ organizationId: org, query: "producto", limit: 1 });
    assert.equal(first.total, 305);
    assert.ok(first.nextCursor);
    const second = await listInventoryGrid({ organizationId: org, query: "producto", limit: 1, cursor: first.nextCursor });
    assert.notEqual(first.inventory[0].id, second.inventory[0].id);
    assert.equal(second.inventory[0].name, "A producto 001");
    await db.client.update({ where: { id: target }, data: { deletedAt: new Date() } });
    assert.deepEqual(await listClientSelector(org, "fuera del tope", target), [], "ni búsqueda ni ID rescatan un cliente eliminado");
  } finally {
    await dbWithDeleted.inventoryItem.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await dbWithDeleted.client.deleteMany({ where: { organizationId: { in: [org, foreign] } } });
    await db.organization.deleteMany({ where: { id: { in: [org, foreign] } } });
    await dbWithDeleted.$disconnect();
  }
});
