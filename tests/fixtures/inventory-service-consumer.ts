import type { z } from "zod";
import type { inventoryServiceConfigurationInputSchema, persistedInventoryServiceConfigurationSchema } from "../../lib/budget-service-contract";
import type { saveInventoryServiceConfiguration } from "../../lib/server/budget-service-contract";

// These types belong to PF. No local DTO/schema/validator implementation.
type Configuration = z.infer<typeof persistedInventoryServiceConfigurationSchema>;
type ConfigurationInput = z.input<typeof inventoryServiceConfigurationInputSchema>;
type Context = Parameters<typeof saveInventoryServiceConfiguration>[1];
type Transaction = Parameters<typeof saveInventoryServiceConfiguration>[0];
type Where = Partial<Pick<Configuration, "id" | "organizationId" | "inventoryItemId" | "kind" | "revision">>;
type Audit = { organizationId: string; actorId: string; actorName: string; actorEmail: string; entityId: string; action: string };

export function serviceContext(role: Context["role"] = "OPERATIONS", demo = false): Context {
  return { organizationId: "org-a", role, demo, user: { id: "actor-a", name: "Operator", email: "operator@example.test", role } };
}

export function serviceConfigurationInput(): ConfigurationInput {
  return { version: 1, id: null, expectedRevision: null, kind: "TRANSPORT", publicName: "Traslado",
    mode: "FIXED_EVENT", unit: "PYG_PER_EXECUTION", minimumPrice: null, floorApplicability: "CHARGED_ONLY", ivaType: null,
    tariffsJson: { version: 1, FINAL: { normalPrice: null, fromDays: null, fromPrice: null }, WHOLESALE: { normalPrice: 2000, fromDays: 3, fromPrice: 1500 } } };
}

export function persistedConfiguration(): Configuration {
  const { version: _version, expectedRevision: _revision, id: _id, ...fields } = serviceConfigurationInput();
  return { ...fields, id: "config-a", organizationId: "org-a", inventoryItemId: "item-a", active: true, revision: 2 };
}

/** Narrow transaction double: exercises real PF exports, NOT native PG/HTTP/auth middleware.
 * Only the Prisma transaction boundary is cast; fixtures/inputs use PF-inferred types.
 * The double filters and performs storage writes, never implements PF validation.
 */
export function serviceTransactionFixture(initial: Configuration[] = []) {
  const rows = structuredClone(initial);
  const audits: Audit[] = [];
  const calls: string[] = [];
  const locks: { sql: string; values: unknown[] }[] = [];
  const matches = (row: Configuration, where: Where) => Object.entries(where).every(([key, value]) => row[key as keyof Configuration] === value);
  const transaction = {
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      calls.push("lock"); locks.push({ sql: sql.join("?"), values });
      return values[0] === "item-a" && values[1] === "org-a" ? [{ id: "item-a" }] : [];
    },
    inventoryItem: { findFirst: async ({ where }: { where: { id: string; organizationId: string } }) => {
      calls.push("product-read"); return where.id === "item-a" && where.organizationId === "org-a" ? { id: "item-a" } : null;
    } },
    inventoryServiceConfiguration: {
      findMany: async ({ where }: { where: Where }) => { calls.push("list"); return rows.filter(row => matches(row, where)); },
      findFirst: async ({ where }: { where: Where }) => { calls.push("find"); return rows.find(row => matches(row, where)) ?? null; },
      findFirstOrThrow: async ({ where }: { where: Where }) => {
        calls.push("read-result"); const row = rows.find(row => matches(row, where));
        if (!row) throw new Error("FIXTURE_CONFIGURATION_NOT_FOUND"); return row;
      },
      create: async ({ data }: { data: Configuration }) => { calls.push("create"); rows.push(structuredClone(data)); return data; },
      updateMany: async ({ where, data }: { where: Where; data: Partial<Omit<Configuration, "revision">> & { revision: { increment: number } } }) => {
        calls.push("update"); const selected = rows.filter(row => matches(row, where));
        for (const row of selected) { const { revision, ...fields } = data; Object.assign(row, structuredClone(fields)); row.revision += revision.increment; }
        return { count: selected.length };
      },
    },
    auditLog: { create: async ({ data }: { data: Audit }) => { calls.push("audit"); audits.push(structuredClone(data)); return data; } },
  };
  return { tx: transaction as unknown as Transaction, rows, audits, calls, locks };
}
