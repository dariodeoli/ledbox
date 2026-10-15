-- Tienda, parte 2: varias fotos por producto, colecciones con nombre, productos destacados y estilos.
--
-- Aditiva, idempotente y re-ejecutable: columnas con default, tablas con IF NOT EXISTS y
-- restricciones protegidas. No borra ni cambia nada existente (la foto actual de cada producto
-- sigue en InventoryItem y es la primera de la galería).

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "featured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "InventoryImage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "alt" TEXT,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryImage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "InventoryImage_itemId_position_idx" ON "InventoryImage"("itemId", "position");
CREATE INDEX IF NOT EXISTS "InventoryImage_organizationId_idx" ON "InventoryImage"("organizationId");
DO $$ BEGIN
  ALTER TABLE "InventoryImage" ADD CONSTRAINT "InventoryImage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryImage" ADD CONSTRAINT "InventoryImage_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "Collection" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "visible" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "imageMime" TEXT,
  "imageData" BYTEA,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Collection_organizationId_slug_key" ON "Collection"("organizationId", "slug");
CREATE INDEX IF NOT EXISTS "Collection_organizationId_sortOrder_idx" ON "Collection"("organizationId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "Collection" ADD CONSTRAINT "Collection_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CollectionItem" (
  "collectionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CollectionItem_pkey" PRIMARY KEY ("collectionId", "itemId")
);
CREATE INDEX IF NOT EXISTS "CollectionItem_itemId_idx" ON "CollectionItem"("itemId");
CREATE INDEX IF NOT EXISTS "CollectionItem_organizationId_idx" ON "CollectionItem"("organizationId");
DO $$ BEGIN
  ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CollectionItem" ADD CONSTRAINT "CollectionItem_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
