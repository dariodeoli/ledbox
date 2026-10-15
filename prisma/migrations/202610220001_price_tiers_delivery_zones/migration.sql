-- Alquileres P2: escalones de precio por días, zonas de flete y snapshot de precios en las líneas.
--
-- Aditiva, idempotente y re-ejecutable: no borra ni cambia columnas existentes. Las columnas
-- `listFromDays/listFromPrice/wholesaleFromDays/wholesaleFromPrice` quedan sin uso (no se tocan).
-- Backfill: cada regla «desde X días» vigente pasa a un escalón PER_DAY (el precio «desde» se
-- multiplicaba por los días, así que el modo equivalente es POR DÍA). Los presupuestos ya
-- armados no cambian: sus ítems guardan su propio precio y días.

DO $$ BEGIN
  CREATE TYPE "PriceTierAudience" AS ENUM ('RETAIL', 'WHOLESALE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PriceTierMode" AS ENUM ('PER_DAY', 'TOTAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "InventoryPriceTier" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "audience" "PriceTierAudience" NOT NULL,
  "fromDays" INTEGER NOT NULL,
  "mode" "PriceTierMode" NOT NULL,
  "price" INTEGER NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryPriceTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryPriceTier_inventoryId_audience_fromDays_key"
  ON "InventoryPriceTier"("inventoryId", "audience", "fromDays");
CREATE INDEX IF NOT EXISTS "InventoryPriceTier_organizationId_inventoryId_idx"
  ON "InventoryPriceTier"("organizationId", "inventoryId");

DO $$ BEGIN
  ALTER TABLE "InventoryPriceTier" ADD CONSTRAINT "InventoryPriceTier_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryPriceTier" ADD CONSTRAINT "InventoryPriceTier_inventoryId_fkey"
    FOREIGN KEY ("inventoryId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill (idempotente: ids determinísticos + ON CONFLICT DO NOTHING).
INSERT INTO "InventoryPriceTier" ("id", "organizationId", "inventoryId", "audience", "fromDays", "mode", "price", "sortOrder", "updatedAt")
SELECT 'tier_' || md5("id" || ':RETAIL:' || "listFromDays"::text), "organizationId", "id", 'RETAIL', "listFromDays", 'PER_DAY', "listFromPrice", 0, CURRENT_TIMESTAMP
FROM "InventoryItem"
WHERE "listFromDays" > 0 AND "listFromPrice" > 0
ON CONFLICT DO NOTHING;

INSERT INTO "InventoryPriceTier" ("id", "organizationId", "inventoryId", "audience", "fromDays", "mode", "price", "sortOrder", "updatedAt")
SELECT 'tier_' || md5("id" || ':WHOLESALE:' || "wholesaleFromDays"::text), "organizationId", "id", 'WHOLESALE', "wholesaleFromDays", 'PER_DAY', "wholesaleFromPrice", 0, CURRENT_TIMESTAMP
FROM "InventoryItem"
WHERE "wholesaleFromDays" > 0 AND "wholesaleFromPrice" > 0
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "DeliveryZone" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "basePrice" INTEGER NOT NULL,
  "volumeThreshold" INTEGER,
  "extraPrice" INTEGER,
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryZone_organizationId_name_key" ON "DeliveryZone"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "DeliveryZone_organizationId_archivedAt_idx" ON "DeliveryZone"("organizationId", "archivedAt");

DO $$ BEGIN
  ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "BudgetItem" ADD COLUMN IF NOT EXISTS "pricingSnapshot" JSONB;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "deliveryZoneId" TEXT;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "deliveryZoneName" TEXT;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "deliveryCoordinate" BOOLEAN NOT NULL DEFAULT false;
