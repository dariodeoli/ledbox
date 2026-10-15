-- Tienda editorial: orden de productos que decide la empresa, carrito guardado en el servidor
-- para clientes con acceso y pedidos de mejor precio dentro de un pedido del catálogo.
--
-- Aditiva, idempotente y re-ejecutable: una columna con default y dos tablas con IF NOT EXISTS.
-- No borra ni cambia nada existente.

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "webSortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "capacity" INTEGER;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "dimensions" TEXT;

CREATE TABLE IF NOT EXISTS "StoreCart" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "accessTokenId" TEXT,
  "visitorTokenHash" TEXT,
  "visitorName" TEXT,
  "visitorPhone" TEXT,
  "visitorEmail" TEXT,
  "expiresAt" TIMESTAMP(3),
  "items" JSONB NOT NULL,
  "fromKey" TEXT,
  "toKey" TEXT,
  "zoneChoice" TEXT,
  "seenTotal" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreCart_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StoreCart_accessTokenId_key" ON "StoreCart"("accessTokenId");
CREATE UNIQUE INDEX IF NOT EXISTS "StoreCart_visitorTokenHash_key" ON "StoreCart"("visitorTokenHash");
CREATE INDEX IF NOT EXISTS "StoreCart_organizationId_idx" ON "StoreCart"("organizationId");
DO $$ BEGIN
  ALTER TABLE "StoreCart" ADD CONSTRAINT "StoreCart_accessTokenId_fkey"
    FOREIGN KEY ("accessTokenId") REFERENCES "CatalogAccessToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "QuotePriceRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "quoteRequestId" TEXT NOT NULL,
  "comment" TEXT NOT NULL,
  "desiredAmount" INTEGER,
  "originalTotal" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "offeredAmount" INTEGER,
  "responseNote" TEXT,
  "respondedAt" TIMESTAMP(3),
  "respondedBy" TEXT,
  "clientApprovedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QuotePriceRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "QuotePriceRequest_quoteRequestId_createdAt_idx" ON "QuotePriceRequest"("quoteRequestId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuotePriceRequest_organizationId_status_idx" ON "QuotePriceRequest"("organizationId", "status");
DO $$ BEGIN
  ALTER TABLE "QuotePriceRequest" ADD CONSTRAINT "QuotePriceRequest_quoteRequestId_fkey"
    FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
