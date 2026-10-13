-- Alquileres fase 2c: combos (kits). Un combo es un InventoryItem con
-- componentes y sin unidades propias; comprometerlo expande sus componentes.
--
-- Aditiva, idempotente y re-ejecutable (IF NOT EXISTS / duplicate_object). No
-- toca datos existentes ni agrega NOT NULL sin default.

CREATE TABLE IF NOT EXISTS "InventoryComponent" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "parentId"       TEXT NOT NULL,
  "componentId"    TEXT NOT NULL,
  "quantity"       INTEGER NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InventoryComponent_parentId_componentId_key"
  ON "InventoryComponent"("parentId", "componentId");
CREATE INDEX IF NOT EXISTS "InventoryComponent_organizationId_parentId_idx"
  ON "InventoryComponent"("organizationId", "parentId");
CREATE INDEX IF NOT EXISTS "InventoryComponent_organizationId_componentId_idx"
  ON "InventoryComponent"("organizationId", "componentId");

DO $$ BEGIN
  ALTER TABLE "InventoryComponent"
    ADD CONSTRAINT "InventoryComponent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryComponent"
    ADD CONSTRAINT "InventoryComponent_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryComponent"
    ADD CONSTRAINT "InventoryComponent_componentId_fkey"
    FOREIGN KEY ("componentId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryComponent"
    ADD CONSTRAINT "InventoryComponent_quantity_check" CHECK ("quantity" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryComponent"
    ADD CONSTRAINT "InventoryComponent_parent_not_component_check" CHECK ("parentId" <> "componentId");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Marca de origen en la asignación: unidades de la fila que vienen de combos
-- (el resto es asignación suelta) y sustituciones autorizadas del combo.
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "comboQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EventInventory" ADD COLUMN IF NOT EXISTS "comboSubstitutions" JSONB;
