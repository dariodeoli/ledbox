import assert from "node:assert/strict";
import { test } from "node:test";
import { readInventoryProductHistory } from "../lib/server/inventory-product-history";

test("product history combines tenant-scoped events, incidents, audits, and count verification", async () => {
  const seen: Record<string, any> = {};
  const at = new Date("2026-10-20T12:00:00.000Z");
  const tx: any = {
    inventoryItem: { findFirst: async (query: any) => { seen.item = query; return { id: "item-a" }; } },
    eventInventory: { findMany: async (query: any) => { seen.assignments = query; return [{
      id: "assignment-a", quantity: 2, startsAt: at, endsAt: at, checkedOutAt: at, checkedInAt: at,
      checkoutQuantity: 2, returnedQuantity: 2, damagedQuantity: 0, missingQuantity: 0, releasedAt: null,
      event: { id: "event-a", name: "Evento QA", startsAt: at, endsAt: at },
    }]; } },
    inventoryCountSession: { findMany: async (query: any) => { seen.counts = query; return [{
      id: "count-a", countedAt: at, actorName: "Operador QA", lines: [{ id: "line-a", productName: "Silla QA", warehouseName: "Depósito QA", warehouseCode: "D1", expectedQuantity: 3, countedQuantity: 2, discrepancy: -1 }],
    }]; } },
    inventoryIncident: { findMany: async (query: any) => { seen.incidents = query; return [{
      id: "incident-a", kind: "DAMAGE", quantity: 1, status: "RESOLVED", openedAt: at, resolvedAt: at,
      unit: { code: "SILLA-01" }, event: { name: "Evento QA" },
    }]; } },
    inventoryUnit: { findMany: async (query: any) => { seen.units = query; return [{ id: "unit-a" }]; } },
    auditLog: { findMany: async (query: any) => { seen.audit = query; return [{ id: "audit-a", createdAt: at, summary: "Cambió el estado de SILLA-01", actorName: "Operador QA" }]; } },
  };

  const result = await readInventoryProductHistory(tx, { organizationId: "tenant-a", inventoryId: "item-a", take: 500 });
  assert.ok(result);
  assert.deepEqual(seen.item.where, { id: "item-a", organizationId: "tenant-a" });
  assert.deepEqual(seen.assignments.where, { inventoryId: "item-a", event: { organizationId: "tenant-a" } });
  assert.deepEqual(seen.counts.where, { organizationId: "tenant-a", lines: { some: { organizationId: "tenant-a", inventoryId: "item-a" } } });
  assert.deepEqual(seen.incidents.where, { organizationId: "tenant-a", inventoryId: "item-a" });
  assert.deepEqual(seen.audit.where, { organizationId: "tenant-a", OR: [
    { entity: "EventInventory", entityId: { in: ["assignment-a"] } },
    { entity: "InventoryUnit", entityId: { in: ["unit-a"] } },
  ] });
  assert.equal(result.verification?.actorName, "Operador QA");
  assert.equal(result.verification?.lines[0].discrepancy, -1);
  assert.deepEqual(new Set(result.entries.map((entry) => entry.kind)), new Set(["event", "activity", "incident", "count"]));
  assert.equal(result.entries.length, 5, "returns assignment, count, incident open/resolution, and audit entries");
  assert.equal(result.entries[0].kind, "activity", "chronology sorts newest first with stable tie ordering");
});

test("product history returns no data for a product outside the active tenant", async () => {
  let queriedOtherSources = false;
  const tx: any = {
    inventoryItem: { findFirst: async ({ where }: any) => { assert.equal(where.organizationId, "tenant-a"); return null; } },
    eventInventory: { findMany: async () => { queriedOtherSources = true; return []; } },
  };
  assert.equal(await readInventoryProductHistory(tx, { organizationId: "tenant-a", inventoryId: "foreign-item" }), null);
  assert.equal(queriedOtherSources, false);
});
