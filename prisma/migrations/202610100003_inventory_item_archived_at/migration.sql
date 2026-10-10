-- Archivo organizativo, independiente del estado operativo y del historial.
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
