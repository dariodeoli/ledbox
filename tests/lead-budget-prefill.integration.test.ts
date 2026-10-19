import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";

const base = process.env.CRM_TEST_BASE_URL;
const local = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base) && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(process.env.DATABASE_URL ?? ""));

test("lead → budget editor prefill is tenant-scoped and read-only", { skip: !local }, async () => {
  const db = new PrismaClient();
  const org = randomUUID(), foreignOrg = randomUUID(), ownerId = randomUUID(), viewerId = randomUUID();
  try {
    await db.organization.createMany({ data: [
      { id: org, name: "Prefill QA", slug: `prefill-${org}` },
      { id: foreignOrg, name: "Other Prefill QA", slug: `prefill-${foreignOrg}` },
    ] });
    const owner = await db.adminUser.create({ data: { id: ownerId, name: "Owner Prefill QA", email: `${ownerId}@example.invalid`, role: "OWNER", passwordHash: "fixture-local", autoLockEnabled: false } });
    const viewer = await db.adminUser.create({ data: { id: viewerId, name: "Viewer Prefill QA", email: `${viewerId}@example.invalid`, role: "VIEWER", passwordHash: "fixture-local", autoLockEnabled: false } });
    await db.adminMembership.createMany({ data: [
      { id: randomUUID(), adminUserId: ownerId, organizationId: org, role: "OWNER" },
      { id: randomUUID(), adminUserId: viewerId, organizationId: org, role: "VIEWER" },
    ] });
    const { createSession } = await import("../lib/server/auth");
    let cookie = `ledbox_session=${(await createSession(owner, org)).jwt}`;
    const call = (path: string) => fetch(`${base}${path}`, { headers: { Cookie: cookie } });
    const ownLeadId = randomUUID(), foreignLeadId = randomUUID();
    await db.lead.createMany({ data: [
      { id: ownLeadId, organizationId: org, name: "Cliente QA", phone: "0981123456", email: "", source: "test-local", consentAt: new Date() },
      { id: foreignLeadId, organizationId: foreignOrg, name: "Privado de otra empresa", phone: "0981123457", email: "", source: "test-local", consentAt: new Date() },
    ] });
    const ownInventoryId = randomUUID(), foreignInventoryId = randomUUID();
    await db.inventoryItem.createMany({ data: [
      { id: ownInventoryId, organizationId: org, name: "Pantalla de la empresa activa", category: "Pantallas", sku: "OWN-01", quantity: 3, listPrice: 150000 },
      { id: foreignInventoryId, organizationId: foreignOrg, name: "Producto privado de otra empresa", category: "Privado", sku: "SECRET-01", quantity: 99, listPrice: 999999 },
    ] });
    const quoteId = randomUUID();
    await db.quoteRequest.create({ data: {
      id: quoteId, organizationId: org, leadId: ownLeadId, status: "NEW", durationDays: 2,
      items: { create: [
        { id: "a-own", productSlug: "pantalla", productName: "Pantalla solicitada", quantity: 2, duration: 4, billingUnit: "DAILY", unitPrice: 120000, notes: "Instalar de mañana", inventoryId: ownInventoryId, state: "KEEP" },
        { id: "b-foreign", productSlug: "legacy", productName: "Línea histórica", quantity: 1, duration: 1, billingUnit: "EVENT", unitPrice: 90000, notes: "Conservar snapshot", inventoryId: foreignInventoryId, state: "CHANGED" },
        { id: "c-removed", productSlug: "removed", productName: "Línea quitada", quantity: 1, duration: 1, billingUnit: "EVENT", unitPrice: 50000, state: "REMOVED" },
        { id: "d-pending", productSlug: "pending", productName: "Precio pendiente", quantity: 1, duration: 1, billingUnit: "EVENT", unitPrice: null, notes: null, state: "KEEP" },
      ] },
    } });
    const beforeQuantity = await db.inventoryItem.findMany({ where: { id: { in: [ownInventoryId, foreignInventoryId] } }, select: { id: true, quantity: true } });
    const beforeAssignments = await db.eventInventory.count({ where: { inventoryId: ownInventoryId } });

    const response = await call(`/api/admin/budgets/lead-draft?leadId=${ownLeadId}`);
    assert.equal(response.status, 200, await response.clone().text());
    const payload = await response.json();
    assert.equal(payload.items.length, 3, "solo copia líneas activas de la preorden más reciente");
    const ownLine = payload.items.find((item: { inventory: { id: string } | null }) => item.inventory?.id === ownInventoryId);
    const historicalLine = payload.items.find((item: { name: string }) => item.name === "Línea histórica");
    const pendingLine = payload.items.find((item: { name: string }) => item.name === "Precio pendiente");
    assert.ok(ownLine);
    assert.equal(ownLine.quantity, "2");
    assert.equal(ownLine.days, "4", "conserva los días de la línea, no los reemplaza por los días generales del pedido");
    assert.equal(ownLine.unitPrice, "150000", "precio vigente de catálogo prevalece como sugerencia revisable");
    assert.equal(ownLine.notes, "Instalar de mañana");
    assert.equal(historicalLine.unitPrice, "90000", "mantiene el precio de la solicitud si el artículo no pertenece a este tenant");
    assert.equal(historicalLine.inventory, null, "no enlaza inventario de otra empresa");
    assert.equal(pendingLine.unitPrice, "", "un importe desconocido sigue pendiente, no se transforma en cero");
    assert.equal(payload.pricing.pending, 1);
    assert.equal(JSON.stringify(payload).includes("Producto privado de otra empresa"), false);
    assert.equal(JSON.stringify(payload).includes("SECRET-01"), false);
    assert.equal(JSON.stringify(payload).includes("dailyCost"), false, "no expone costos internos");
    assert.equal((await call(`/api/admin/budgets/lead-draft?leadId=${foreignLeadId}`)).status, 404);
    cookie = `ledbox_session=${(await createSession(viewer, org)).jwt}`;
    assert.equal((await call(`/api/admin/budgets/lead-draft?leadId=${ownLeadId}`)).status, 403);
    assert.deepEqual(await db.inventoryItem.findMany({ where: { id: { in: [ownInventoryId, foreignInventoryId] } }, select: { id: true, quantity: true } }), beforeQuantity);
    assert.equal(await db.eventInventory.count({ where: { inventoryId: ownInventoryId } }), beforeAssignments, "abrir el editor no crea reservas");
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [org, foreignOrg] } } });
    await db.adminUser.deleteMany({ where: { id: { in: [ownerId, viewerId] } } });
    await db.$disconnect();
  }
});
