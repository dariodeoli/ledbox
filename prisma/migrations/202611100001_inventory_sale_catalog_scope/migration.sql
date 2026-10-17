-- Catálogo de venta separado del catálogo de alquiler; no crea ni modifica stock.
ALTER TABLE "InventoryItem"
  ADD COLUMN IF NOT EXISTS "saleCatalogEnabled" BOOLEAN NOT NULL DEFAULT false;
