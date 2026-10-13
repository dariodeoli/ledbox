-- Alquileres fase 3: catálogo público por empresa y preórdenes.
--
-- Aditiva, idempotente y re-ejecutable (IF NOT EXISTS / duplicate_object). Ningún
-- NOT NULL sin default sobre tablas existentes. El estado del pedido
-- (NEW, REVIEWING, QUOTED, CONVERTED, DECLINED, EXPIRED) se valida en el código.

ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'NEW';
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "endsAt" TIMESTAMP(3);
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "respondBy" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteRequest_publicToken_key" ON "QuoteRequest"("publicToken");
CREATE INDEX IF NOT EXISTS "QuoteRequest_organizationId_status_idx" ON "QuoteRequest"("organizationId", "status");

DO $$ BEGIN
  ALTER TABLE "QuoteRequest"
    ADD CONSTRAINT "QuoteRequest_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "inventoryId" TEXT;
CREATE INDEX IF NOT EXISTS "QuoteItem_inventoryId_idx" ON "QuoteItem"("inventoryId");

DO $$ BEGIN
  ALTER TABLE "QuoteItem"
    ADD CONSTRAINT "QuoteItem_inventoryId_fkey"
    FOREIGN KEY ("inventoryId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "quoteRequestId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Budget_quoteRequestId_key" ON "Budget"("quoteRequestId");

DO $$ BEGIN
  ALTER TABLE "Budget"
    ADD CONSTRAINT "Budget_quoteRequestId_fkey"
    FOREIGN KEY ("quoteRequestId") REFERENCES "QuoteRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
