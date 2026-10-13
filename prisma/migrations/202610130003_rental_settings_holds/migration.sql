-- Alquileres fase 2b: ajustes por empresa, tiempos por producto y retenciones.
--
-- Aditiva, idempotente y re-ejecutable (IF NOT EXISTS / duplicate_object). No
-- agrega NOT NULL sin default sobre tablas existentes ni usa los valores nuevos
-- de InventoryUnitStatus (migración anterior).

CREATE TABLE IF NOT EXISTS "OrganizationRentalSettings" (
  "id"                   TEXT NOT NULL,
  "organizationId"       TEXT NOT NULL,
  "depositPercent"       INTEGER,
  "holdTtlMinutes"       INTEGER NOT NULL DEFAULT 2880,
  "deliveryBufferMin"    INTEGER NOT NULL DEFAULT 0,
  "returnBufferMin"      INTEGER NOT NULL DEFAULT 0,
  "prepBufferMin"        INTEGER NOT NULL DEFAULT 0,
  "transportBufferMin"   INTEGER NOT NULL DEFAULT 0,
  "cleaningBufferMin"    INTEGER NOT NULL DEFAULT 0,
  "publicCatalogEnabled" BOOLEAN NOT NULL DEFAULT false,
  "publicShowPrices"     BOOLEAN NOT NULL DEFAULT true,
  "whatsappPhone"        TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationRentalSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationRentalSettings_organizationId_key"
  ON "OrganizationRentalSettings"("organizationId");

DO $$ BEGIN
  ALTER TABLE "OrganizationRentalSettings"
    ADD CONSTRAINT "OrganizationRentalSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "OrganizationRentalSettings"
    ADD CONSTRAINT "OrganizationRentalSettings_depositPercent_check"
    CHECK ("depositPercent" IS NULL OR ("depositPercent" >= 0 AND "depositPercent" <= 100));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "bufferBeforeMin" INTEGER;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "bufferAfterMin" INTEGER;

ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "holdExpiresAt" TIMESTAMP(3);
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "budgetId" TEXT;
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3);
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "returnedQuantity" INTEGER NOT NULL DEFAULT 0;

-- Backfill idempotente: solo las filas todavía sin empresa.
UPDATE "EventInventory" ei
SET "organizationId" = e."organizationId"
FROM "Event" e
WHERE ei."eventId" = e."id" AND ei."organizationId" IS NULL;

CREATE INDEX IF NOT EXISTS "EventInventory_organizationId_inventoryId_idx"
  ON "EventInventory"("organizationId", "inventoryId");
