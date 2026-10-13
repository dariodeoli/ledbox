-- Alcance de cada producto en la tienda web de la empresa: HIDDEN, RETAIL
-- (cliente final), WHOLESALE (mayorista) o BOTH. Reemplaza el booleano
-- `visibleOnWeb`, que se conserva sincronizado (= alcance distinto de HIDDEN).
--
-- Aditiva, idempotente y re-ejecutable: la columna se agrega con IF NOT EXISTS y
-- el backfill solo toca filas todavía sin alcance (NULL), así una segunda
-- ejecución no pisa lo que la empresa eligió después.

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "catalogAudience" TEXT;

UPDATE "InventoryItem"
SET "catalogAudience" = CASE WHEN "visibleOnWeb" THEN 'BOTH' ELSE 'HIDDEN' END
WHERE "catalogAudience" IS NULL;
