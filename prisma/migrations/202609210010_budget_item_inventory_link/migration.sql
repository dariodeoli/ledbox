-- Vínculo del ítem de presupuesto con el inventario (issue #18): al aprobar un
-- presupuesto, cada ítem vinculado reserva stock del evento con el rango del
-- evento (montaje → desmontaje). Un ítem sin vínculo no reserva nada.
--
-- Aditiva, idempotente y re-ejecutable: agrega la columna, la FK y el índice
-- solo si faltan. `ON DELETE SET NULL` conserva el ítem del presupuesto si el
-- artículo de inventario se elimina (deja de reservar, no rompe la historia).

ALTER TABLE "BudgetItem" ADD COLUMN IF NOT EXISTS "inventoryId" TEXT;

DO $$ BEGIN
  ALTER TABLE "BudgetItem"
    ADD CONSTRAINT "BudgetItem_inventoryId_fkey"
    FOREIGN KEY ("inventoryId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "BudgetItem_inventoryId_idx" ON "BudgetItem"("inventoryId");
