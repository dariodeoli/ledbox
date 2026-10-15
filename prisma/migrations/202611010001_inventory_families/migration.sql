-- Variantes de producto (familias), etapa A de docs/VARIANTES.md.
--
-- Aditiva, idempotente y re-ejecutable: tabla e índices con IF NOT EXISTS, columnas con
-- ADD COLUMN IF NOT EXISTS y las FKs en DO $$ con chequeo en pg_constraint. Sin backfill:
-- nadie tiene familias todavía. Cada variante sigue siendo un InventoryItem completo; la
-- familia solo las agrupa (el motor de stock no la conoce).

CREATE TABLE IF NOT EXISTS "InventoryFamily" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "code"              TEXT NOT NULL,
  "categoryId"        TEXT,
  "publicDescription" TEXT,
  "coverItemId"       TEXT,
  "axes"              JSONB NOT NULL,
  "webSortOrder"      INTEGER NOT NULL DEFAULT 0,
  "archivedAt"        TIMESTAMP(3),
  "deletedAt"         TIMESTAMP(3),
  "deletedById"       TEXT,
  "deleteReason"      TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryFamily_pkey" PRIMARY KEY ("id")
);

-- El código de una familia es único por empresa mientras la familia esté viva (una en la papelera lo libera).
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryFamily_organizationId_code_live_key"
  ON "InventoryFamily"("organizationId", "code") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "InventoryFamily_organizationId_code_idx" ON "InventoryFamily"("organizationId", "code");
CREATE INDEX IF NOT EXISTS "InventoryFamily_organizationId_deletedAt_idx" ON "InventoryFamily"("organizationId", "deletedAt");

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "familyId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "variantOptions" JSONB;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "variantKey" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "variantOwnPrice" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "variantSortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "InventoryItem_organizationId_familyId_idx" ON "InventoryItem"("organizationId", "familyId");

-- Una combinación (color, talle…) por familia: dos altas simultáneas de «Verde» → una gana y la otra recibe 409.
-- Parcial: una variante en la papelera libera su combinación.
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_familyId_variantKey_live_key"
  ON "InventoryItem"("familyId", "variantKey") WHERE "familyId" IS NOT NULL AND "deletedAt" IS NULL;

ALTER TABLE "InventoryComponent" ADD COLUMN IF NOT EXISTS "anyVariant" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryFamily_organizationId_fkey') THEN
    ALTER TABLE "InventoryFamily" ADD CONSTRAINT "InventoryFamily_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryFamily_categoryId_fkey') THEN
    ALTER TABLE "InventoryFamily" ADD CONSTRAINT "InventoryFamily_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "InventoryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InventoryItem_familyId_fkey') THEN
    ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_familyId_fkey"
      FOREIGN KEY ("familyId") REFERENCES "InventoryFamily"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
