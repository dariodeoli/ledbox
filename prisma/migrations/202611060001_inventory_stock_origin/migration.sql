-- Additive origin metadata only. Legacy records stay NULL/unreviewed.
DO $$ BEGIN
  CREATE TYPE "InventoryStockOrigin" AS ENUM ('OWNED', 'CONSIGNED', 'EXTERNAL_RENTAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "defaultStockOrigin" "InventoryStockOrigin";
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "defaultSourceSupplierId" TEXT;
ALTER TABLE "InventoryUnit" ADD COLUMN IF NOT EXISTS "stockOrigin" "InventoryStockOrigin";
ALTER TABLE "InventoryUnit" ADD COLUMN IF NOT EXISTS "ownerSupplierId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryItem_defaultSourceSupplierId_fkey') THEN
    ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_defaultSourceSupplierId_fkey" FOREIGN KEY ("defaultSourceSupplierId") REFERENCES "Supplier"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryUnit_ownerSupplierId_fkey') THEN
    ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_ownerSupplierId_fkey" FOREIGN KEY ("ownerSupplierId") REFERENCES "Supplier"("id") ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryItem_stock_origin_pair') THEN
    ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_stock_origin_pair" CHECK (
      ("defaultStockOrigin" IS NOT NULL AND "defaultStockOrigin" IN ('CONSIGNED', 'EXTERNAL_RENTAL') AND "defaultSourceSupplierId" IS NOT NULL)
      OR (("defaultStockOrigin" IS NULL OR "defaultStockOrigin" = 'OWNED') AND "defaultSourceSupplierId" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryUnit_stock_origin_pair') THEN
    ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_stock_origin_pair" CHECK (
      ("stockOrigin" IS NOT NULL AND "stockOrigin" = 'CONSIGNED' AND "ownerSupplierId" IS NOT NULL)
      OR (("stockOrigin" IS NULL OR "stockOrigin" = 'OWNED') AND "ownerSupplierId" IS NULL));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "InventoryItem_defaultSourceSupplierId_idx" ON "InventoryItem"("defaultSourceSupplierId");
CREATE INDEX IF NOT EXISTS "InventoryUnit_ownerSupplierId_idx" ON "InventoryUnit"("ownerSupplierId");
