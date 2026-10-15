-- Importación (pendientes): juego incompleto, línea «gratis a propósito» y foto de categoría.
-- Aditiva e idempotente; los datos existentes no cambian de significado (todo queda en false).
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "comboIncomplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BudgetItem" ADD COLUMN IF NOT EXISTS "freeOnPurpose" BOOLEAN NOT NULL DEFAULT false;

-- Foto propia por categoría (cuadrada): binario + MIME + ruta pública que usa la tienda.
ALTER TABLE "InventoryCategory" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "InventoryCategory" ADD COLUMN IF NOT EXISTS "imageData" BYTEA;
ALTER TABLE "InventoryCategory" ADD COLUMN IF NOT EXISTS "imageMime" TEXT;
