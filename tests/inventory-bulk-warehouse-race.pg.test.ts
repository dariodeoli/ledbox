import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

const url = process.env.TEST_DATABASE_URL;
const local = Boolean(url && /^postgresql:\/\/[^@]*@(localhost|127\.0\.0\.1):\d+\//.test(url));
const base = process.env.INVENTORY_AUDIT_BASE_URL;
const localHttp = Boolean(base && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base));

test("bulk-units no asigna a un depósito si el archivo gana la carrera", { skip: !local || !localHttp }, async () => {
  process.env.DATABASE_URL = url;
  const { db } = await import("../lib/server/db");
  const { createSession } = await import("../lib/server/auth");
  const organizationId = randomUUID();
  const userId = randomUUID();
  const sourceWarehouseId = randomUUID();
  const targetWarehouseId = randomUUID();
  const itemId = randomUUID();
  const unitId = randomUUID();
  let unlock!: () => void;
  let locked!: () => void;
  const release = new Promise<void>((resolve) => { unlock = resolve; });
  const warehouseLocked = new Promise<void>((resolve) => { locked = resolve; });
  let archivePromise: Promise<unknown> | null = null;
  let responsePromise: Promise<Response> | null = null;

  try {
    await db.organization.create({ data: { id: organizationId, name: "QA depósito", slug: `qa-bulk-warehouse-${organizationId}` } });
    await db.warehouse.createMany({ data: [
      { id: sourceWarehouseId, organizationId, name: "Origen QA", code: `Q${organizationId.slice(0, 6)}`, isDefault: true },
      { id: targetWarehouseId, organizationId, name: "Destino QA", code: `R${organizationId.slice(0, 6)}` },
    ] });
    await db.inventoryItem.create({ data: { id: itemId, organizationId, name: "Unidad QA", category: "QA", quantity: 1 } });
    await db.inventoryUnit.create({ data: { id: unitId, organizationId, inventoryId: itemId, warehouseId: sourceWarehouseId, code: `U${organizationId.slice(0, 8)}`, status: "AVAILABLE" } });
    const user = await db.adminUser.create({ data: { id: userId, email: `${userId}@example.invalid`, name: "QA", role: "OWNER", passwordHash: "not-a-login", autoLockEnabled: false } });
    await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: userId, organizationId, role: "OWNER" } });
    const cookie = `ledbox_session=${(await createSession(user, organizationId)).jwt}`;

    archivePromise = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Warehouse" WHERE "id" = ${targetWarehouseId} FOR UPDATE`;
      await tx.warehouse.update({ where: { id: targetWarehouseId }, data: { archivedAt: new Date() } });
      locked();
      await release;
    }, { timeout: 20_000 });
    await warehouseLocked;

    responsePromise = fetch(`${base}/api/admin/inventory`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "bulk-units", ids: [unitId], changes: { warehouseId: targetWarehouseId } }),
    });

    const deadline = Date.now() + 5_000;
    let waiting = false;
    while (Date.now() < deadline) {
      const rows = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'
          AND query LIKE '%"Warehouse"%' AND query LIKE '%FOR SHARE%'
      `;
      if (Number(rows[0]?.count ?? 0) > 0) { waiting = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true, "la solicitud debe esperar el lock de archivado antes de validar el destino");
    unlock();
    await archivePromise;

    const response = await responsePromise;
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /depósito de destino ya no está activo/i);
    assert.equal((await db.inventoryUnit.findUniqueOrThrow({ where: { id: unitId } })).warehouseId, sourceWarehouseId);
  } finally {
    unlock();
    await archivePromise?.catch(() => {});
    await responsePromise?.catch(() => {});
    await db.auditLog.deleteMany({ where: { organizationId } });
    await db.inventoryUnit.deleteMany({ where: { organizationId } });
    await db.inventoryItem.deleteMany({ where: { organizationId } });
    await db.adminMembership.deleteMany({ where: { organizationId } });
    await db.adminUser.deleteMany({ where: { id: userId } });
    await db.warehouse.deleteMany({ where: { id: { in: [sourceWarehouseId, targetWarehouseId] } } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
