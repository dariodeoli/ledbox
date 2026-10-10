import assert from "node:assert/strict";
import test from "node:test";
import { loadInventoryServiceConfigurations, saveInventoryServiceConfiguration, archiveInventoryServiceConfiguration } from "../lib/server/budget-service-contract";
import { QuoteComparisonError } from "../lib/server/quote-comparison";
import { persistedConfiguration, serviceConfigurationInput, serviceContext, serviceTransactionFixture } from "./fixtures/inventory-service-consumer";

// Source-only OPS consumer tests. Require a checked PF dependency before admission.
// No production route wiring, Prisma generation, native concurrency or HTTP claim.
const failure = (status: number, message: string) => (error: unknown) => error instanceof QuoteComparisonError && error.status === status && error.message === message;

test("GET includeServices consumer loads scoped DTO, no tenant or inferred unknown amounts", async () => {
  const own = persistedConfiguration();
  const foreign = { ...own, id: "foreign-config", organizationId: "org-b" };
  const fixture = serviceTransactionFixture([own, foreign]);
  const configurations = await loadInventoryServiceConfigurations(fixture.tx, serviceContext(), "item-a");
  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].id, own.id);
  assert.equal(Object.hasOwn(configurations[0], "organizationId"), false);
  assert.equal(configurations[0].minimumPrice, null);
  assert.equal(configurations[0].ivaType, null);
  assert.equal(configurations[0].tariffsJson.FINAL.normalPrice, null);
  assert.deepEqual(fixture.calls, ["product-read", "list"]);
  assert.equal(fixture.audits.length, 0);
});

test("POST upsert consumer creates through the same supplied tx with scoped lock and actor audit", async () => {
  const fixture = serviceTransactionFixture();
  const context = serviceContext();
  const result = await saveInventoryServiceConfiguration(fixture.tx, context, "item-a", serviceConfigurationInput());
  assert.equal(result.revision, 1);
  assert.equal(result.active, true);
  assert.equal(Object.hasOwn(result, "organizationId"), false);
  assert.equal(fixture.rows[0].organizationId, context.organizationId);
  assert.equal(result.minimumPrice, null);
  assert.equal(result.ivaType, null);
  assert.equal(fixture.audits.length, 1);
  assert.equal(fixture.audits[0].actorId, context.user.id);
  assert.equal(fixture.audits[0].actorEmail, context.user.email);
  assert.equal(fixture.audits[0].organizationId, context.organizationId);
  assert.equal(fixture.audits[0].entityId, "item-a");
  assert.equal(fixture.audits[0].action, "create");
  assert.match(fixture.locks[0].sql, /FOR UPDATE/);
  assert.deepEqual(fixture.locks[0].values, ["item-a", "org-a"]);
  assert.deepEqual(fixture.calls, ["lock", "find", "create", "read-result", "audit"]);
});

test("POST upsert CAS rejects stale revision without changing fields or recording success", async () => {
  const fixture = serviceTransactionFixture([persistedConfiguration()]);
  const before = structuredClone(fixture.rows);
  const input = { ...serviceConfigurationInput(), id: "config-a", expectedRevision: 1, publicName: "Changed" };
  await assert.rejects(saveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", input), failure(409, "SERVICE_CONFIGURATION_STALE"));
  assert.deepEqual(fixture.rows, before);
  assert.equal(fixture.audits.length, 0);
  const updated = await saveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", { ...input, expectedRevision: 2 });
  assert.equal(updated.publicName, "Changed"); assert.equal(updated.revision, 3);
  assert.equal(fixture.audits.length, 1);
});

test("cross-company load/save/archive cannot read or mutate the foreign product", async () => {
  for (const action of ["load", "save", "archive"] as const) {
    const fixture = serviceTransactionFixture([persistedConfiguration()]);
    const before = structuredClone(fixture.rows), context = { ...serviceContext(), organizationId: "org-b" };
    const operation = action === "load" ? loadInventoryServiceConfigurations(fixture.tx, context, "item-a")
      : action === "save" ? saveInventoryServiceConfiguration(fixture.tx, context, "item-a", { ...serviceConfigurationInput(), id: "config-a", expectedRevision: 2 })
      : archiveInventoryServiceConfiguration(fixture.tx, context, "item-a", "config-a", 2);
    await assert.rejects(operation, failure(404, "SERVICE_CONFIGURATION_NOT_FOUND"));
    assert.deepEqual(fixture.rows, before); assert.equal(fixture.audits.length, 0);
  }
});

test("same-company foreign configuration ID remains generic404 for edit and archive", async () => {
  for (const action of ["edit", "archive"] as const) {
    const foreign = { ...persistedConfiguration(), organizationId: "org-b" };
    const fixture = serviceTransactionFixture([foreign]);
    const operation = action === "edit" ? saveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", { ...serviceConfigurationInput(), id: "config-a", expectedRevision: 2 })
      : archiveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", "config-a", 2);
    await assert.rejects(operation, failure(404, "SERVICE_CONFIGURATION_NOT_FOUND"));
    assert.deepEqual(fixture.rows, [foreign]); assert.equal(fixture.audits.length, 0);
  }
});

test("strict config rejects server authority/cost/unknown fields before lock or write", async () => {
  for (const extra of [{ organizationId: "org-b" }, { revision: 10 }, { active: true }, { costComplete: true }, { privateCost: 0 }, { documentVersion: 4 }, { unexpected: "value" }]) {
    const fixture = serviceTransactionFixture();
    await assert.rejects(saveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", { ...serviceConfigurationInput(), ...extra }), failure(400, "SERVICE_CONFIGURATION_INVALID"));
    assert.deepEqual(fixture.calls, []); assert.deepEqual(fixture.rows, []); assert.deepEqual(fixture.audits, []);
  }
});

test("inventory permission matrix denies FINANCE/VIEWER and demo before transaction work", async () => {
  for (const context of [serviceContext("FINANCE"), serviceContext("VIEWER"), serviceContext("OWNER", true), serviceContext("OPERATIONS", true)]) {
    for (const action of ["upsert", "archive"] as const) {
      const fixture = serviceTransactionFixture([persistedConfiguration()]);
      const operation = action === "upsert" ? saveInventoryServiceConfiguration(fixture.tx, context, "item-a", serviceConfigurationInput())
        : archiveInventoryServiceConfiguration(fixture.tx, context, "item-a", "config-a", 2);
      await assert.rejects(operation, failure(403, "SERVICE_MUTATION_FORBIDDEN"));
      assert.deepEqual(fixture.calls, []); assert.equal(fixture.rows[0].revision, 2); assert.equal(fixture.audits.length, 0);
    }
  }
  for (const role of ["OWNER", "ADMIN", "OPERATIONS"] as const) {
    const fixture = serviceTransactionFixture();
    await saveInventoryServiceConfiguration(fixture.tx, serviceContext(role), "item-a", serviceConfigurationInput());
    assert.equal(fixture.audits.length, 1);
  }
});

test("archive requires current CAS, preserves configuration and increments revision without delete", async () => {
  const fixture = serviceTransactionFixture([persistedConfiguration()]);
  const before = structuredClone(fixture.rows[0]);
  await assert.rejects(archiveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", "config-a", 1), failure(409, "SERVICE_CONFIGURATION_STALE"));
  assert.deepEqual(fixture.rows, [before]); assert.equal(fixture.audits.length, 0);
  const archived = await archiveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", "config-a", 2);
  const { active: _active, revision: _revision, organizationId: _tenant, ...originalFields } = before;
  assert.deepEqual(archived, { ...originalFields, active: false, revision: 3 });
  assert.equal(fixture.rows.length, 1); assert.equal(fixture.audits.length, 1);
  await assert.rejects(archiveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", "config-a", 2), failure(409, "SERVICE_CONFIGURATION_STALE"));
  assert.equal(fixture.audits.length, 1); assert.equal(fixture.rows[0].revision, 3);
});

test("duplicate class creation and kind rewrite reject without silently replacing existing catalog", async () => {
  const fixture = serviceTransactionFixture([persistedConfiguration()]);
  const before = structuredClone(fixture.rows);
  await assert.rejects(saveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", serviceConfigurationInput()), failure(409, "SERVICE_CONFIGURATION_EXISTS"));
  await assert.rejects(saveInventoryServiceConfiguration(fixture.tx, serviceContext(), "item-a", { ...serviceConfigurationInput(), id: "config-a", expectedRevision: 2, kind: "INSTALLATION" }), failure(400, "SERVICE_CONFIGURATION_KIND_IMMUTABLE"));
  assert.deepEqual(fixture.rows, before); assert.equal(fixture.audits.length, 0);
});
