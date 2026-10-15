-- Perfil de la empresa, apariencia de las superficies del cliente, acceso al catálogo y
-- respuesta de la empresa al pedido (rechazo con motivo / propuesta modificada).
--
-- Aditiva, idempotente y re-ejecutable (IF NOT EXISTS / duplicate_object). Ningún NOT NULL
-- sin default sobre tablas existentes. Los valores cerrados (modo de acceso, tipo de
-- solicitud, estado de línea) se validan en el código.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "profile" JSONB;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "appearance" JSONB;

CREATE TABLE IF NOT EXISTS "OrganizationCover" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "mime" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationCover_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationCover_organizationId_kind_key" ON "OrganizationCover"("organizationId", "kind");
DO $$ BEGIN
  ALTER TABLE "OrganizationCover"
    ADD CONSTRAINT "OrganizationCover_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "catalogAccessMode" TEXT NOT NULL DEFAULT 'OPEN';

ALTER TABLE "CatalogAccessToken" ADD COLUMN IF NOT EXISTS "priceList" TEXT NOT NULL DEFAULT 'WHOLESALE';

CREATE TABLE IF NOT EXISTS "CatalogAccessRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "company" TEXT,
  "phone" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'RETAIL',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "rejectionReason" TEXT,
  "clientId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decidedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogAccessRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CatalogAccessRequest_organizationId_status_createdAt_idx" ON "CatalogAccessRequest"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "CatalogAccessRequest_organizationId_email_idx" ON "CatalogAccessRequest"("organizationId", "email");
DO $$ BEGIN
  ALTER TABLE "CatalogAccessRequest"
    ADD CONSTRAINT "CatalogAccessRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "declineReason" TEXT;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "declinedAt" TIMESTAMP(3);
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "declinedBy" TEXT;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "proposedAt" TIMESTAMP(3);
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "proposalNote" TEXT;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "proposalApprovedAt" TIMESTAMP(3);

ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "state" TEXT NOT NULL DEFAULT 'KEEP';
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "originalName" TEXT;
ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "originalQuantity" INTEGER;

-- Categoría de correo del catálogo (acceso aprobado, pedido rechazado, propuesta). No se usa en esta migración.
ALTER TYPE "MailCategory" ADD VALUE IF NOT EXISTS 'catalog';
