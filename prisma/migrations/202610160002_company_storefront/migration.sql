-- Tienda web por empresa: ajustes de la portada (frase, color de marca y correo),
-- lista de precios del pedido y links privados del catálogo mayorista.
--
-- Aditiva, idempotente y re-ejecutable (`IF NOT EXISTS`, FK con guard
-- `duplicate_object`). Los pedidos existentes quedan en la lista RETAIL. El token
-- plano del link mayorista nunca vive acá: solo su hash SHA-256.

ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "storefrontTagline" TEXT;
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "storefrontAccent" TEXT;
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "storefrontEmail" TEXT;

ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "priceList" TEXT NOT NULL DEFAULT 'RETAIL';

CREATE TABLE IF NOT EXISTS "CatalogAccessToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "CatalogAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CatalogAccessToken_tokenHash_key" ON "CatalogAccessToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "CatalogAccessToken_organizationId_clientId_revokedAt_idx" ON "CatalogAccessToken"("organizationId", "clientId", "revokedAt");

DO $$ BEGIN
  ALTER TABLE "CatalogAccessToken" ADD CONSTRAINT "CatalogAccessToken_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CatalogAccessToken" ADD CONSTRAINT "CatalogAccessToken_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
