-- Estados DAÑADA y PERDIDA para las unidades físicas (alquileres fase 2b).
--
-- Va en su propia migración: un valor nuevo de enum no se puede usar en la misma
-- transacción en la que se agrega, así que ninguna otra sentencia lo referencia
-- acá. Aditiva e idempotente (IF NOT EXISTS).

ALTER TYPE "InventoryUnitStatus" ADD VALUE IF NOT EXISTS 'DAMAGED';
ALTER TYPE "InventoryUnitStatus" ADD VALUE IF NOT EXISTS 'LOST';
