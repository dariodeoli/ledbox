import assert from "node:assert/strict";
import test from "node:test";
import { lockUsableWarehouse } from "../lib/server/inventory-warehouses";

test("el destino de un movimiento masivo se valida y bloquea dentro de la transacción", async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const tx = {
    $queryRaw: async (query: { sql: string; values: unknown[] }) => {
      queries.push(query);
      return [{ id: "warehouse-1" }];
    },
  } as never;

  assert.equal(await lockUsableWarehouse(tx, "organization-1", "warehouse-1"), true);
  assert.match(queries[0].sql, /"organizationId".*"archivedAt" IS NULL.*FOR SHARE/);
  assert.deepEqual(queries[0].values, ["warehouse-1", "organization-1"]);
});

test("un destino ajeno o archivado no se considera usable", async () => {
  const tx = { $queryRaw: async () => [] } as never;
  assert.equal(await lockUsableWarehouse(tx, "organization-1", "warehouse-archived"), false);
});
