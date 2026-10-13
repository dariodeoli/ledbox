-- Descripción pública del ítem para el catálogo.
--
-- Aditiva, idempotente y re-ejecutable: una columna TEXT nullable, sin default ni backfill.
-- No toca disponibilidad, precios ni las notas internas (`notes`), que nunca se publican.

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "publicDescription" TEXT;
