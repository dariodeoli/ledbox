-- Inventario operativo por evento: rango de fechas por asignación, salida y
-- devolución con fecha/estado, y registro de daños y faltantes.
--
-- Aditiva, idempotente y re-ejecutable: agrega columnas con IF NOT EXISTS y
-- completa el rango de las asignaciones existentes con las fechas del evento
-- (solo cuando faltan: nunca pisa datos ya cargados).
--
-- Los booleanos `checkedOut`/`checkedIn` se mantienen como marca heredada y se
-- siguen actualizando junto a `checkedOutAt`/`checkedInAt`; las filas viejas
-- conservan su estado aunque no tengan fecha exacta (no se inventa).

ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "endsAt" TIMESTAMP(3);
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "checkedOutAt" TIMESTAMP(3);
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "checkedInAt" TIMESTAMP(3);
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "damagedQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "missingQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "damageNotes" TEXT;

-- Backfill del rango desde el evento (montaje → desmontaje) para que las
-- asignaciones viejas cuenten en el cálculo de disponibilidad.
UPDATE "EventInventory" a
SET "startsAt" = COALESCE(a."startsAt", e."setupAt", e."startsAt"),
    "endsAt" = COALESCE(a."endsAt", e."strikeAt", e."endsAt", e."startsAt")
FROM "Event" e
WHERE a."eventId" = e."id"
  AND (a."startsAt" IS NULL OR a."endsAt" IS NULL);

CREATE INDEX IF NOT EXISTS "EventInventory_inventoryId_startsAt_endsAt_idx"
  ON "EventInventory"("inventoryId", "startsAt", "endsAt");
