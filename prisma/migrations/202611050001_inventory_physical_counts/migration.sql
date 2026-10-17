-- Aditiva: guarda conteos físicos como fotografías; no modifica stock ni unidades.
CREATE TABLE IF NOT EXISTS "InventoryCountSession" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "actorEmail" TEXT NOT NULL,
  "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryCountSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryCountSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "InventoryCountSession_organizationId_countedAt_idx" ON "InventoryCountSession"("organizationId", "countedAt");
CREATE INDEX IF NOT EXISTS "InventoryCountSession_organizationId_actorId_idx" ON "InventoryCountSession"("organizationId", "actorId");

CREATE TABLE IF NOT EXISTS "InventoryCountLine" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "expectedQuantity" INTEGER NOT NULL,
  "countedQuantity" INTEGER NOT NULL,
  "discrepancy" INTEGER NOT NULL,
  "productName" TEXT NOT NULL,
  "warehouseName" TEXT NOT NULL,
  "warehouseCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryCountLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryCountLine_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InventoryCountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "InventoryCountLine_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InventoryCountLine_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCountLine_sessionId_inventoryId_warehouseId_key" ON "InventoryCountLine"("sessionId", "inventoryId", "warehouseId");
CREATE INDEX IF NOT EXISTS "InventoryCountLine_organizationId_inventoryId_warehouseId_createdAt_idx" ON "InventoryCountLine"("organizationId", "inventoryId", "warehouseId", "createdAt");
CREATE INDEX IF NOT EXISTS "InventoryCountLine_sessionId_discrepancy_idx" ON "InventoryCountLine"("sessionId", "discrepancy");
