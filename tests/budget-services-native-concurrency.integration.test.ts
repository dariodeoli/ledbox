import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";

const localUrl = process.env.LEDBOX_SERVICES_NATIVE_DATABASE_URL;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("native Budget lock serializes competing 6000 allocations against recognized 10000", { skip: !localUrl, timeout: 30000 }, async () => {
  const url = new URL(localUrl!);
  const schema = process.env.LEDBOX_SERVICES_NATIVE_SCHEMA;
  const sourceSHA = process.env.LEDBOX_SERVICES_NATIVE_SOURCE_SHA;
  const custodyPath = process.env.LEDBOX_SERVICES_NATIVE_CUSTODY_PATH;
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
  assert.match(url.pathname, /^\/ledbox_services_s1_test[a-z0-9_]*$/);
  assert.equal(schema, "services_s1_native_pf_163164173");
  assert.equal(url.searchParams.get("schema"), schema);
  assert.equal(process.env.LEDBOX_SERVICES_NATIVE_CUSTODIAN, "ses_f01b823bbffeW5qXtCFTZNBD8k");
  assert.match(sourceSHA ?? "", /^[a-f0-9]{40}$/);
  assert.ok(custodyPath && path.isAbsolute(custodyPath));
  assert.equal(path.basename(custodyPath!), "native-race-custody.json");
  // The issuer-bound runner supplies this owned results directory, not a request body.
  assert.ok(path.dirname(custodyPath!).startsWith("/Users/fredd/.herdr/worktrees/ledbox/evidencia/ronda-al/plataforma/services-s1-native-"));
  const { PrismaClient } = await import("@prisma/client");
  const { validateLockedServiceCostAllocation } = await import("../lib/server/budget-service-contract");
  const first = new PrismaClient({ datasourceUrl: localUrl });
  const second = new PrismaClient({ datasourceUrl: localUrl });
  const events: Record<string, unknown>[] = [];
  let schemaCreated = false;
  let schemaDropped = false;
  let schemaCleanupVerified = false;
  let firstResult: Promise<unknown> | undefined;
  let secondResult: Promise<unknown> | undefined;
  const releaseWinner = deferred<void>();
  const holding = deferred<{ tx: Prisma.TransactionClient; pid: number }>();
  const competing = deferred<number>();
  try {
    // No IF NOT EXISTS: refuse to adopt any preexisting schema or other custodian's data.
    await first.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const migration = readFileSync(new URL("../prisma/migrations/202610100005_budget_services_contract/migration.sql", import.meta.url), "utf8");
    const fixture = `BEGIN; SET LOCAL search_path TO "${schema}";
CREATE TYPE "BudgetDiscountMode" AS ENUM ('AMOUNT','PERCENT');
CREATE TABLE "Organization" (id TEXT PRIMARY KEY);
CREATE TABLE "Budget" (id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"ivaType" TEXT,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "BudgetItem" (id TEXT PRIMARY KEY,"budgetId" TEXT NOT NULL,excluded BOOLEAN NOT NULL);
CREATE TABLE "InventoryItem" (id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL);
CREATE TABLE "SupplierJob" (id TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL);
INSERT INTO "Organization" VALUES ('race-org');
INSERT INTO "Budget" VALUES ('race-budget','race-org','GRAVADA_10',now());
INSERT INTO "BudgetItem" VALUES ('winner-line','race-budget',false),('loser-line','race-budget',false);
${migration}
INSERT INTO "ServiceCostSource" (id,"organizationId","budgetId","sourceKind","sourceKey","aggregationOwner","executionState","incurredAmount","pendingAmount","incurredComplete","pendingComplete","updatedAt")
VALUES ('race-source','race-org','race-budget','SERVICE','race-obligation','SERVICE','PARTIAL',10000,0,true,true,now()); COMMIT;`;
    // psql does not understand Prisma's schema query parameter; search_path is explicit above.
    const psqlUrl = new URL(localUrl!);
    psqlUrl.searchParams.delete("schema");
    execFileSync(process.env.LEDBOX_SERVICES_PSQL ?? "psql", [psqlUrl.toString(), "-X", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: fixture, timeout: 10000, stdio: ["pipe", "pipe", "pipe"] });
    const context = { organizationId: "race-org", role: "FINANCE" as const, demo: false };
    const input = (lineId: string) => ({ version: 1, id: null, sourceId: "race-source", applicationId: null,
      budgetItemId: lineId, incurredAmount: 6000, pendingAmount: 0, incurredComplete: true, pendingComplete: true });
    firstResult = first.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const validated = await validateLockedServiceCostAllocation(tx, context, "race-budget", input("winner-line"));
      await tx.serviceCostAllocation.create({ data: validated.allocation });
      events.push({ event: "winner-inserted-uncommitted", pid, allocationId: validated.allocation.id });
      holding.resolve({ tx, pid });
      await releaseWinner.promise;
      return validated.allocation.id;
    }, { isolationLevel: "ReadCommitted", timeout: 15000, maxWait: 2000 });
    // Convert failures immediately so a rejected transaction never becomes unhandled.
    const winnerSettled = firstResult.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    const owner = await Promise.race([holding.promise, winnerSettled.then(result => { throw result.ok ? new Error("winner did not hold lock") : result.error; })]);
    secondResult = second.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      competing.resolve(pid);
      const validated = await validateLockedServiceCostAllocation(tx, context, "race-budget", input("loser-line"));
      await tx.serviceCostAllocation.create({ data: validated.allocation });
      return validated.allocation.id;
    }, { isolationLevel: "ReadCommitted", timeout: 15000, maxWait: 2000 });
    const loserSettled = secondResult.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    const loserPid = await Promise.race([competing.promise, loserSettled.then(result => { throw result.ok ? new Error("loser bypassed lock") : result.error; })]);
    assert.notEqual(owner.pid, loserPid, "Two distinct PostgreSQL connections are required");
    let blocked = false;
    const observationDeadline = Date.now() + 5000;
    while (Date.now() < observationDeadline) {
      const [state] = await owner.tx.$queryRaw<{ blocked: boolean }[]>`SELECT ${owner.pid} = ANY(pg_blocking_pids(${loserPid}::int)) AS blocked`;
      if (state.blocked) { blocked = true; break; }
      await new Promise(done => setTimeout(done, 25));
    }
    assert.equal(blocked, true, "Native server must observe the loser blocked by the winner, not just concurrent promises");
    events.push({ event: "postgres-lock-contention-observed", winnerPid: owner.pid, loserPid });
    releaseWinner.resolve();
    const winner = await winnerSettled;
    const loser = await loserSettled;
    assert.equal(winner.ok, true);
    assert.equal(loser.ok, false);
    if (loser.ok) assert.fail("Both allocations committed");
    assert.match(String(loser.error), /SERVICE_COST_OVERALLOCATED/);
    const allocations = await first.serviceCostAllocation.findMany({ where: { organizationId: "race-org", budgetId: "race-budget", sourceId: "race-source" } });
    const source = await first.serviceCostSource.findUniqueOrThrow({ where: { id: "race-source" } });
    assert.equal(allocations.length, 1);
    assert.equal(allocations[0].budgetItemId, "winner-line");
    const committed = allocations.reduce((sum, row) => sum + (row.incurredAmount ?? 0), 0);
    assert.equal(committed, 6000);
    assert.equal(source.incurredAmount, 10000);
    assert.ok(committed <= source.incurredAmount!);
    events.push({ event: "commit-assertions-passed", commits: 1, rejected: 1, committed, recognized: source.incurredAmount });
  } finally {
    releaseWinner.resolve();
    await Promise.allSettled([firstResult, secondResult].filter((value): value is Promise<unknown> => value !== undefined));
    try {
      if (schemaCreated) {
        await first.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        schemaDropped = true;
        const rows = await first.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_namespace WHERE nspname = ${schema!}`;
        assert.equal(Number(rows[0].count), 0);
        schemaCleanupVerified = true;
      }
    } finally {
      const disconnected = await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      const ownClientsDisconnected = disconnected.every(result => result.status === "fulfilled");
      writeFileSync(custodyPath!, JSON.stringify({ sourceSHA, custodian: process.env.LEDBOX_SERVICES_NATIVE_CUSTODIAN,
        host: url.hostname, port: url.port, database: url.pathname.slice(1), schema, events,
        schemaCreated, schemaDropped, schemaCleanupVerified, ownClientsDisconnected,
        claimsPass: schemaCleanupVerified && ownClientsDisconnected && events.some(row => row.event === "commit-assertions-passed") }, null, 2));
      assert.equal(ownClientsDisconnected, true, "Both owned clients must disconnect successfully");
    }
  }
});
