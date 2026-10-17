-- Durable phase A requests. They have no stock, reservation, payment or coverage effect.
DO $$ BEGIN
  CREATE TYPE "EventExternalNeedStatus" AS ENUM ('OPEN', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Event_id_organizationId_key" ON "Event"("id", "organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_id_organizationId_key" ON "Supplier"("id", "organizationId");
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_id_organizationId_key" ON "InventoryItem"("id", "organizationId");

CREATE TABLE IF NOT EXISTS "EventExternalNeed" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "requestedQuantity" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "preferredSupplierId" TEXT,
  "status" "EventExternalNeedStatus" NOT NULL DEFAULT 'OPEN',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT NOT NULL,
  CONSTRAINT "EventExternalNeed_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "EventExternalNeed" ADD CONSTRAINT "EventExternalNeed_quantity_check" CHECK ("requestedQuantity" > 0 AND "requestedQuantity" <= 100000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EventExternalNeed" ADD CONSTRAINT "EventExternalNeed_range_check" CHECK ("startsAt" < "endsAt");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EventExternalNeed" ADD CONSTRAINT "EventExternalNeed_revision_check" CHECK ("revision" > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EventExternalNeed" ADD CONSTRAINT "EventExternalNeed_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 1000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EventExternalNeed" ADD CONSTRAINT "EventExternalNeed_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EventExternalNeed" ADD CONSTRAINT "EventExternalNeed_eventId_organizationId_fkey" FOREIGN KEY ("eventId", "organizationId") REFERENCES "Event"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EventExternalNeed" ADD CONSTRAINT "EventExternalNeed_inventoryId_organizationId_fkey" FOREIGN KEY ("inventoryId", "organizationId") REFERENCES "InventoryItem"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EventExternalNeed" ADD CONSTRAINT "EventExternalNeed_preferredSupplierId_organizationId_fkey" FOREIGN KEY ("preferredSupplierId", "organizationId") REFERENCES "Supplier"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "EventExternalNeed_organizationId_eventId_status_startsAt_idx" ON "EventExternalNeed"("organizationId", "eventId", "status", "startsAt");
CREATE INDEX IF NOT EXISTS "EventExternalNeed_organizationId_inventoryId_idx" ON "EventExternalNeed"("organizationId", "inventoryId");
CREATE INDEX IF NOT EXISTS "EventExternalNeed_preferredSupplierId_idx" ON "EventExternalNeed"("preferredSupplierId");
CREATE UNIQUE INDEX IF NOT EXISTS "EventExternalNeed_one_open_per_scope_key" ON "EventExternalNeed"("organizationId", "eventId", "inventoryId", "startsAt", "endsAt") WHERE "status" = 'OPEN';
