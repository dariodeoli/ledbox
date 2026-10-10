import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const localUrl = process.env.LEDBOX_SERVICES_LOCAL_DATABASE_URL;
test("services migration reruns without changing legacy rows and enforces scoped FK/XOR/commitment", { skip: !localUrl }, () => {
  const url = new URL(localUrl!);
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only explicit local Postgres is admitted");
  assert.ok(url.pathname.startsWith("/ledbox_services_s1_test"), "Use a disposable S1 test database, never DATABASE_URL");
  const schema = `services_s1_${randomUUID().replaceAll("-", "")}`;
  const migration = readFileSync(new URL("../prisma/migrations/202610100005_budget_services_contract/migration.sql", import.meta.url), "utf8");
  // All fixture DDL/data and both applications are rolled back in a private schema.
  const sql = `BEGIN;
CREATE SCHEMA "${schema}";
SET LOCAL search_path TO "${schema}";
CREATE TYPE "BudgetDiscountMode" AS ENUM ('AMOUNT','PERCENT');
CREATE TABLE "Organization" ("id" TEXT PRIMARY KEY);
CREATE TABLE "Budget" ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL,"legacyTotal" INTEGER NOT NULL);
CREATE TABLE "BudgetItem" ("id" TEXT PRIMARY KEY,"budgetId" TEXT NOT NULL,"legacyCost" INTEGER NOT NULL);
CREATE TABLE "InventoryItem" ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL);
CREATE TABLE "SupplierJob" ("id" TEXT PRIMARY KEY,"organizationId" TEXT NOT NULL);
INSERT INTO "Organization" VALUES ('org'),('other');
INSERT INTO "Budget" VALUES ('budget','org',12345),('other-budget','other',67890);
INSERT INTO "BudgetItem" VALUES ('line','budget',444),('foreign-line','other-budget',555);
INSERT INTO "InventoryItem" VALUES ('product','org'),('foreign-product','other');
INSERT INTO "SupplierJob" VALUES ('job','org');
${migration}
${migration}
DO $$ BEGIN
  IF (SELECT "legacyTotal" FROM "Budget" WHERE id='budget')<>12345 OR (SELECT "legacyCost" FROM "BudgetItem" WHERE id='line')<>444 THEN RAISE EXCEPTION 'legacy changed'; END IF;
END $$;
INSERT INTO "InventoryServiceConfiguration" (id,"organizationId","inventoryItemId",kind,"publicName",mode,unit,"tariffsJson","minimumPrice","floorApplicability","ivaType",active,revision,"updatedAt")
VALUES ('config','org','product','TRANSPORT','Traslado','FIXED_EVENT','PYG_PER_EXECUTION','{"version":1,"FINAL":{},"WHOLESALE":{}}',10,'CHARGED_ONLY','GRAVADA_10',true,1,now());
INSERT INTO "BudgetServiceExecution" (id,"organizationId","budgetId") VALUES ('execution','org','budget');
INSERT INTO "BudgetServiceApplication" (id,"organizationId","budgetId","configurationId",kind,scope,"parentLineId","executionId","sortOrder","publicName",inclusion,"reviewState",mode,unit,front,"tariffSnapshot","priceSource","floorApplicability","ivaType","grossAmount","discountAmount","netAmount","globalDiscountAmount","totalAmount","sourceRevision","updatedAt")
VALUES ('service','org','budget','config','TRANSPORT','SHARED_EXECUTION',null,'execution',1,'Traslado','INCLUDED_CHARGED','RESOLVED','FIXED_EVENT','PYG_PER_EXECUTION','FINAL','{"version":1,"front":"FINAL","mode":"FIXED_EVENT","unit":"PYG_PER_EXECUTION"}','TARIFF','CHARGED_ONLY','GRAVADA_10',100,0,100,0,100,1,now());
INSERT INTO "ServiceCostSource" (id,"organizationId","budgetId","sourceKind","sourceKey","supplierJobId","aggregationOwner","executionState","incurredAmount","pendingAmount","incurredComplete","pendingComplete","updatedAt")
VALUES ('source','org','budget','SUPPLIER','obligation','job','SUPPLIER','PARTIAL',10000,null,false,false,now());
DO $$ BEGIN
  BEGIN
    INSERT INTO "ServiceCostAllocation" (id,"organizationId","budgetId","sourceId","applicationId","budgetItemId","incurredAmount","incurredComplete","pendingComplete","updatedAt") VALUES ('xor','org','budget','source','service','line',100,false,false,now());
    RAISE EXCEPTION 'XOR accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO "ServiceCostAllocation" (id,"organizationId","budgetId","sourceId","budgetItemId","incurredAmount","incurredComplete","pendingComplete","updatedAt") VALUES ('foreign','org','budget','source','foreign-line',100,false,false,now());
    RAISE EXCEPTION 'foreign budget accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO "ServiceCostAllocation" (id,"organizationId","budgetId","sourceId","applicationId","incurredComplete","pendingComplete","updatedAt") VALUES ('unknown','org','budget','source','service',true,false,now());
    RAISE EXCEPTION 'unknown complete accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO "ServiceCostSource" (id,"organizationId","budgetId","sourceKind","sourceKey","supplierJobId","aggregationOwner","executionState","incurredComplete","pendingComplete","updatedAt") VALUES ('duplicate','org','budget','SUPPLIER','different-key','job','SUPPLIER','UNKNOWN',false,false,now());
    RAISE EXCEPTION 'duplicate commitment accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
ROLLBACK;`;
  execFileSync(process.env.LEDBOX_SERVICES_PSQL ?? "psql", [localUrl!, "-X", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
});
