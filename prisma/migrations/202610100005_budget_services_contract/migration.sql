-- S1 #173/#164. Aditiva, re-ejecutable, sin backfill ni SQL sobre producción.
DO $$ BEGIN CREATE TYPE "BudgetServiceKind" AS ENUM ('TRANSPORT','INSTALLATION','GUARD','PROMOTER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BudgetServiceMode" AS ENUM ('PERSON_DAY','FIXED_EVENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BudgetServiceUnit" AS ENUM ('PYG_PER_PERSON_DAY','PYG_PER_EXECUTION','PYG_PER_EVENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BudgetServiceScope" AS ENUM ('LINE','SHARED_EXECUTION'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BudgetServiceInclusion" AS ENUM ('NOT_INCLUDED','INCLUDED_FREE','INCLUDED_CHARGED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BudgetServiceReviewState" AS ENUM ('RESOLVED','NEEDS_REVIEW'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BudgetServicePriceSource" AS ENUM ('TARIFF','OVERRIDE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BudgetServiceFloorApplicability" AS ENUM ('CHARGED_ONLY'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "BudgetServiceIvaType" AS ENUM ('GRAVADA_10','GRAVADA_5','EXENTA'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ServiceCostOrigin" AS ENUM ('SERVICE','LABOR','SUPPLIER','EQUIPMENT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ServiceExecutionState" AS ENUM ('NOT_EXECUTED','COMMITTED','PARTIAL','EXECUTED','UNKNOWN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Budget_org_id_key" ON "Budget" ("organizationId","id");
CREATE UNIQUE INDEX IF NOT EXISTS "BudgetItem_budget_id_key" ON "BudgetItem" ("budgetId","id");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_org_id_key" ON "InventoryItem" ("organizationId","id");
CREATE UNIQUE INDEX IF NOT EXISTS "SupplierJob_org_id_key" ON "SupplierJob" ("organizationId","id");

CREATE TABLE IF NOT EXISTS "InventoryServiceConfiguration" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "inventoryItemId" TEXT NOT NULL,
  "kind" "BudgetServiceKind" NOT NULL, "publicName" TEXT NOT NULL,
  "mode" "BudgetServiceMode" NOT NULL, "unit" "BudgetServiceUnit" NOT NULL,
  "tariffsJson" JSONB NOT NULL, "minimumPrice" INTEGER,
  "floorApplicability" "BudgetServiceFloorApplicability" NOT NULL,
  "ivaType" "BudgetServiceIvaType", "active" BOOLEAN NOT NULL, "revision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "BudgetServiceExecution" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "budgetId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "BudgetServiceApplication" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "budgetId" TEXT NOT NULL,
  "configurationId" TEXT NOT NULL, "kind" "BudgetServiceKind" NOT NULL,
  "scope" "BudgetServiceScope" NOT NULL, "parentLineId" TEXT, "executionId" TEXT,
  "sortOrder" INTEGER NOT NULL, "publicName" TEXT NOT NULL,
  "inclusion" "BudgetServiceInclusion" NOT NULL, "reviewState" "BudgetServiceReviewState" NOT NULL,
  "mode" "BudgetServiceMode" NOT NULL, "unit" "BudgetServiceUnit" NOT NULL,
  "people" INTEGER, "serviceDays" INTEGER, "contextualServiceDays" INTEGER,
  "front" TEXT NOT NULL, "tariffSnapshot" JSONB NOT NULL,
  "priceSource" "BudgetServicePriceSource" NOT NULL, "overridePrice" INTEGER,
  "floorApplicability" "BudgetServiceFloorApplicability" NOT NULL, "ivaType" "BudgetServiceIvaType",
  "discountMode" "BudgetDiscountMode", "discountValue" INTEGER,
  "grossAmount" INTEGER NOT NULL, "discountAmount" INTEGER NOT NULL, "netAmount" INTEGER NOT NULL,
  "globalDiscountAmount" INTEGER NOT NULL, "totalAmount" INTEGER NOT NULL, "sourceRevision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "BudgetServiceCoverage" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "budgetId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL, "parentLineId" TEXT NOT NULL, "active" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "removedAt" TIMESTAMP(3)
);
CREATE TABLE IF NOT EXISTS "ServiceCostSource" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "budgetId" TEXT NOT NULL,
  "sourceKind" "ServiceCostOrigin" NOT NULL, "sourceKey" TEXT NOT NULL, "supplierJobId" TEXT,
  "aggregationOwner" "ServiceCostOrigin" NOT NULL, "executionState" "ServiceExecutionState" NOT NULL,
  "incurredAmount" INTEGER, "pendingAmount" INTEGER, "incurredComplete" BOOLEAN NOT NULL, "pendingComplete" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "ServiceCostAllocation" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "budgetId" TEXT NOT NULL, "sourceId" TEXT NOT NULL,
  "applicationId" TEXT, "budgetItemId" TEXT, "incurredAmount" INTEGER, "pendingAmount" INTEGER,
  "incurredComplete" BOOLEAN NOT NULL, "pendingComplete" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "SvcCfg_item_kind_key" ON "InventoryServiceConfiguration" ("organizationId","inventoryItemId","kind");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcCfg_org_id_kind_key" ON "InventoryServiceConfiguration" ("organizationId","id","kind");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcExec_org_budget_id_key" ON "BudgetServiceExecution" ("organizationId","budgetId","id");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcApp_org_budget_id_key" ON "BudgetServiceApplication" ("organizationId","budgetId","id");
-- Los brazos no nulos son mutuamente excluyentes por CHECK. Índices parciales
-- explícitos documentan cardinalidad; Prisma declara los uniques equivalentes.
CREATE UNIQUE INDEX IF NOT EXISTS "SvcApp_execution_key" ON "BudgetServiceApplication" ("organizationId","budgetId","configurationId","executionId") WHERE "scope" = 'SHARED_EXECUTION';
CREATE UNIQUE INDEX IF NOT EXISTS "SvcApp_parent_key" ON "BudgetServiceApplication" ("organizationId","budgetId","configurationId","parentLineId") WHERE "scope" = 'LINE';
CREATE UNIQUE INDEX IF NOT EXISTS "SvcCoverage_parent_key" ON "BudgetServiceCoverage" ("organizationId","budgetId","applicationId","parentLineId");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcCost_org_budget_id_key" ON "ServiceCostSource" ("organizationId","budgetId","id");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcCost_origin_key" ON "ServiceCostSource" ("organizationId","budgetId","sourceKind","sourceKey");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcCost_commitment_key" ON "ServiceCostSource" ("organizationId","budgetId","supplierJobId") WHERE "supplierJobId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "SvcAlloc_application_key" ON "ServiceCostAllocation" ("sourceId","applicationId");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcAlloc_item_key" ON "ServiceCostAllocation" ("sourceId","budgetItemId");

-- Todas las FKs históricas son RESTRICT. Repetir el archivo no duplica constraints.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('InventoryServiceConfiguration','SvcCfg_org_fkey','FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")'),
    ('InventoryServiceConfiguration','SvcCfg_item_fkey','FOREIGN KEY ("organizationId","inventoryItemId") REFERENCES "InventoryItem"("organizationId","id")'),
    ('BudgetServiceExecution','SvcExec_org_fkey','FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")'),
    ('BudgetServiceExecution','SvcExec_budget_fkey','FOREIGN KEY ("organizationId","budgetId") REFERENCES "Budget"("organizationId","id")'),
    ('BudgetServiceApplication','SvcApp_org_fkey','FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")'),
    ('BudgetServiceApplication','SvcApp_budget_fkey','FOREIGN KEY ("organizationId","budgetId") REFERENCES "Budget"("organizationId","id")'),
    ('BudgetServiceApplication','SvcApp_config_fkey','FOREIGN KEY ("organizationId","configurationId","kind") REFERENCES "InventoryServiceConfiguration"("organizationId","id","kind")'),
    ('BudgetServiceApplication','SvcApp_execution_fkey','FOREIGN KEY ("organizationId","budgetId","executionId") REFERENCES "BudgetServiceExecution"("organizationId","budgetId","id")'),
    ('BudgetServiceApplication','SvcApp_parent_fkey','FOREIGN KEY ("budgetId","parentLineId") REFERENCES "BudgetItem"("budgetId","id")'),
    ('BudgetServiceCoverage','SvcCoverage_org_fkey','FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")'),
    ('BudgetServiceCoverage','SvcCoverage_budget_fkey','FOREIGN KEY ("organizationId","budgetId") REFERENCES "Budget"("organizationId","id")'),
    ('BudgetServiceCoverage','SvcCoverage_app_fkey','FOREIGN KEY ("organizationId","budgetId","applicationId") REFERENCES "BudgetServiceApplication"("organizationId","budgetId","id")'),
    ('BudgetServiceCoverage','SvcCoverage_parent_fkey','FOREIGN KEY ("budgetId","parentLineId") REFERENCES "BudgetItem"("budgetId","id")'),
    ('ServiceCostSource','SvcCost_org_fkey','FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")'),
    ('ServiceCostSource','SvcCost_budget_fkey','FOREIGN KEY ("organizationId","budgetId") REFERENCES "Budget"("organizationId","id")'),
    ('ServiceCostSource','SvcCost_supplier_fkey','FOREIGN KEY ("organizationId","supplierJobId") REFERENCES "SupplierJob"("organizationId","id")'),
    ('ServiceCostAllocation','SvcAlloc_org_fkey','FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")'),
    ('ServiceCostAllocation','SvcAlloc_budget_fkey','FOREIGN KEY ("organizationId","budgetId") REFERENCES "Budget"("organizationId","id")'),
    ('ServiceCostAllocation','SvcAlloc_source_fkey','FOREIGN KEY ("organizationId","budgetId","sourceId") REFERENCES "ServiceCostSource"("organizationId","budgetId","id")'),
    ('ServiceCostAllocation','SvcAlloc_app_fkey','FOREIGN KEY ("organizationId","budgetId","applicationId") REFERENCES "BudgetServiceApplication"("organizationId","budgetId","id")'),
    ('ServiceCostAllocation','SvcAlloc_item_fkey','FOREIGN KEY ("budgetId","budgetItemId") REFERENCES "BudgetItem"("budgetId","id")')
  ) AS constraints(table_name, constraint_name, definition)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=c.constraint_name AND conrelid=to_regclass(format('%I',c.table_name))) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s ON DELETE RESTRICT ON UPDATE RESTRICT',c.table_name,c.constraint_name,c.definition);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('InventoryServiceConfiguration','SvcCfg_domain_check',$c$length(btrim("publicName")) BETWEEN 1 AND 120 AND "revision">=1 AND ("minimumPrice" IS NULL OR "minimumPrice">=0) AND (("kind" IN ('TRANSPORT','INSTALLATION') AND "mode"='FIXED_EVENT' AND "unit"='PYG_PER_EXECUTION') OR ("kind" IN ('GUARD','PROMOTER') AND (("mode"='PERSON_DAY' AND "unit"='PYG_PER_PERSON_DAY') OR ("mode"='FIXED_EVENT' AND "unit"='PYG_PER_EVENT'))))$c$),
    ('InventoryServiceConfiguration','SvcCfg_json_check',$c$jsonb_typeof("tariffsJson")='object' AND "tariffsJson"->>'version'='1' AND jsonb_typeof("tariffsJson"->'FINAL')='object' AND jsonb_typeof("tariffsJson"->'WHOLESALE')='object'$c$),
    ('BudgetServiceApplication','SvcApp_scope_check',$c$("scope"='LINE' AND "parentLineId" IS NOT NULL AND "executionId" IS NULL) OR ("scope"='SHARED_EXECUTION' AND "executionId" IS NOT NULL AND "parentLineId" IS NULL)$c$),
    ('BudgetServiceApplication','SvcApp_domain_check',$c$length(btrim("publicName")) BETWEEN 1 AND 120 AND "sortOrder">=0 AND "sourceRevision">=1 AND "front" IN ('FINAL','WHOLESALE') AND (("kind" IN ('TRANSPORT','INSTALLATION') AND "scope"='SHARED_EXECUTION' AND "mode"='FIXED_EVENT' AND "unit"='PYG_PER_EXECUTION') OR ("kind" IN ('GUARD','PROMOTER') AND (("mode"='PERSON_DAY' AND "unit"='PYG_PER_PERSON_DAY') OR ("mode"='FIXED_EVENT' AND "unit"='PYG_PER_EVENT'))))$c$),
    ('BudgetServiceApplication','SvcApp_parameters_check',$c$("mode"='PERSON_DAY' AND "people" IS NOT NULL AND "people" BETWEEN 1 AND 9999 AND "serviceDays" IS NOT NULL AND "serviceDays" BETWEEN 1 AND 9999 AND "contextualServiceDays" IS NULL) OR ("mode"='FIXED_EVENT' AND "people" IS NULL AND "serviceDays" IS NULL AND ("contextualServiceDays" IS NULL OR "contextualServiceDays" BETWEEN 1 AND 9999))$c$),
    ('BudgetServiceApplication','SvcApp_discount_check',$c$("discountMode" IS NULL AND "discountValue" IS NULL) OR ("discountMode" IS NOT NULL AND "discountValue" IS NOT NULL AND "discountValue">=0 AND ("discountMode"<>'PERCENT' OR "discountValue"<=10000))$c$),
    ('BudgetServiceApplication','SvcApp_amounts_check',$c$("overridePrice" IS NULL OR "overridePrice">=0) AND "grossAmount">=0 AND "discountAmount">=0 AND "netAmount">=0 AND "globalDiscountAmount">=0 AND "totalAmount">=0 AND ("inclusion"='INCLUDED_CHARGED' OR ("grossAmount"=0 AND "discountAmount"=0 AND "netAmount"=0 AND "globalDiscountAmount"=0 AND "totalAmount"=0)) AND ("inclusion"='NOT_INCLUDED' OR "ivaType" IS NOT NULL)$c$),
    ('BudgetServiceApplication','SvcApp_snapshot_check',$c$jsonb_typeof("tariffSnapshot")='object' AND "tariffSnapshot"->>'version'='1' AND "tariffSnapshot"->>'front'="front" AND "tariffSnapshot"->>'mode'="mode"::text AND "tariffSnapshot"->>'unit'="unit"::text$c$),
    ('BudgetServiceCoverage','SvcCoverage_active_check',$c$"active"=("removedAt" IS NULL)$c$),
    ('ServiceCostSource','SvcCost_amounts_check',$c$("incurredAmount" IS NULL OR "incurredAmount">=0) AND ("pendingAmount" IS NULL OR "pendingAmount">=0) AND (NOT "incurredComplete" OR "incurredAmount" IS NOT NULL) AND (NOT "pendingComplete" OR "pendingAmount" IS NOT NULL) AND (("sourceKind"='SUPPLIER')=("supplierJobId" IS NOT NULL)) AND length("sourceKey") BETWEEN 1 AND 200$c$),
    ('ServiceCostAllocation','SvcAlloc_destination_check',$c$("applicationId" IS NULL)<>("budgetItemId" IS NULL)$c$),
    ('ServiceCostAllocation','SvcAlloc_amounts_check',$c$("incurredAmount" IS NULL OR "incurredAmount">=0) AND ("pendingAmount" IS NULL OR "pendingAmount">=0) AND (NOT "incurredComplete" OR "incurredAmount" IS NOT NULL) AND (NOT "pendingComplete" OR "pendingAmount" IS NOT NULL)$c$)
  ) AS constraints(table_name, constraint_name, expression)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=c.constraint_name AND conrelid=to_regclass(format('%I',c.table_name))) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) IS TRUE)',c.table_name,c.constraint_name,c.expression);
    END IF;
  END LOOP;
END $$;
