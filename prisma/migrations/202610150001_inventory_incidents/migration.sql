-- Alquileres fase 4: operaciones (salida, devolución parcial e incidentes).
--
-- Aditiva, idempotente y re-ejecutable (IF NOT EXISTS / duplicate_object). Ningún
-- NOT NULL sin default sobre tablas existentes.

DO $$ BEGIN
  CREATE TYPE "InventoryIncidentKind" AS ENUM ('DAMAGE', 'MISSING', 'REPAIR', 'CLEANING');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InventoryIncidentStatus" AS ENUM ('OPEN', 'IN_REPAIR', 'RESOLVED', 'WRITTEN_OFF');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Salidas parciales: unidades despachadas, quién y la nota de la salida/devolución.
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "checkoutQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "checkedOutById" TEXT;
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "checkoutNote" TEXT;
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "checkedInById" TEXT;

-- Cantidad retenida por incidentes abiertos de ítems sin unidades con código.
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "incidentHold" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "InventoryIncident" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "eventId" TEXT,
  "unitId" TEXT,
  "kind" "InventoryIncidentKind" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "status" "InventoryIncidentStatus" NOT NULL DEFAULT 'OPEN',
  "cost" INTEGER,
  "notes" TEXT,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "openedById" TEXT,
  "resolvedById" TEXT,
  CONSTRAINT "InventoryIncident_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "InventoryIncident"
    ADD CONSTRAINT "InventoryIncident_quantity_positive" CHECK ("quantity" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryIncident"
    ADD CONSTRAINT "InventoryIncident_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryIncident"
    ADD CONSTRAINT "InventoryIncident_inventoryId_fkey"
    FOREIGN KEY ("inventoryId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryIncident"
    ADD CONSTRAINT "InventoryIncident_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "EventInventory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryIncident"
    ADD CONSTRAINT "InventoryIncident_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryIncident"
    ADD CONSTRAINT "InventoryIncident_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "InventoryUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "InventoryIncident_organizationId_idx" ON "InventoryIncident"("organizationId");
CREATE INDEX IF NOT EXISTS "InventoryIncident_status_idx" ON "InventoryIncident"("status");
CREATE INDEX IF NOT EXISTS "InventoryIncident_eventId_idx" ON "InventoryIncident"("eventId");
CREATE INDEX IF NOT EXISTS "InventoryIncident_organizationId_status_idx" ON "InventoryIncident"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "InventoryIncident_inventoryId_status_idx" ON "InventoryIncident"("inventoryId", "status");

-- Backfill de las filas viejas, con el movimiento de una sola vez que hacían antes:
-- lo que salió es toda la asignación y lo devuelto, lo que no quedó faltante.
UPDATE "EventInventory" SET "checkoutQuantity" = "quantity"
  WHERE ("checkedOut" = true OR "checkedOutAt" IS NOT NULL) AND "checkoutQuantity" = 0;
UPDATE "EventInventory" SET "returnedQuantity" = GREATEST("quantity" - "missingQuantity", 0)
  WHERE ("checkedIn" = true OR "checkedInAt" IS NOT NULL) AND "returnedQuantity" = 0 AND "quantity" > "missingQuantity";
