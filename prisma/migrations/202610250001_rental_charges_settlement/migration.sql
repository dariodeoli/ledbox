-- Alquileres P1-2 / P1-4: ajustes de garantía, recargo, roturas, cargos personalizados,
-- política de cancelación y condiciones; cargos de la devolución (RentalCharge) y su
-- liquidación contra la garantía.
--
-- Aditiva, idempotente y re-ejecutable: solo columnas nuevas con default, tablas e
-- índices con IF NOT EXISTS y un valor de enum agregado. No borra ni cambia nada existente.
-- Las empresas que ya tenían un monto de garantía por defecto pasan a la política
-- «siempre» (mismo comportamiento que antes).

ALTER TYPE "ExpectedPaymentConcept" ADD VALUE IF NOT EXISTS 'extra';

DO $$ BEGIN
  CREATE TYPE "RentalChargeKind" AS ENUM ('LATE', 'DAMAGE', 'MISSING', 'CLEANING', 'STAIN', 'CUSTOM', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RentalChargeStatus" AS ENUM ('PROPOSED', 'APPLIED', 'WAIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "securityDepositMode" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "securityDepositPurpose" TEXT NOT NULL DEFAULT 'DAMAGES';
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "securityDepositCalc" TEXT NOT NULL DEFAULT 'FIXED';
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "securityDepositPercent" INTEGER;
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "securityDepositRules" JSONB;
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "lateFeeKind" TEXT NOT NULL DEFAULT 'PERCENT';
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "lateFeeUnit" TEXT NOT NULL DEFAULT 'DAY';
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "lateFeeValue" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "lateGraceMinutes" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "damageChargePercent" INTEGER NOT NULL DEFAULT 100;
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "customCharges" JSONB;
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "cancellationPolicy" JSONB;
ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "rentalTerms" TEXT;

-- Empresas con garantía por defecto cargada: mantienen el comportamiento («siempre»).
UPDATE "OrganizationRentalSettings" SET "securityDepositMode" = 'ALWAYS'
  WHERE "securityDepositDefault" IS NOT NULL AND "securityDepositMode" = 'NONE';

ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "securityDepositPurpose" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "rentalSettledAt" TIMESTAMP(3);
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "rentalSettlement" JSONB;

CREATE TABLE IF NOT EXISTS "RentalCharge" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "budgetId"       TEXT NOT NULL,
  "eventId"        TEXT,
  "assignmentId"   TEXT,
  "incidentId"     TEXT,
  "inventoryId"    TEXT,
  "kind"           "RentalChargeKind" NOT NULL,
  "status"         "RentalChargeStatus" NOT NULL DEFAULT 'PROPOSED',
  "label"          TEXT NOT NULL,
  "quantity"       INTEGER NOT NULL DEFAULT 1,
  "unitAmount"     INTEGER NOT NULL,
  "amount"         INTEGER NOT NULL,
  "dedupeKey"      TEXT NOT NULL,
  "reason"         TEXT,
  "note"           TEXT,
  "decidedAt"      TIMESTAMP(3),
  "decidedByName"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RentalCharge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RentalCharge_budgetId_dedupeKey_key" ON "RentalCharge"("budgetId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "RentalCharge_organizationId_budgetId_idx" ON "RentalCharge"("organizationId", "budgetId");
CREATE INDEX IF NOT EXISTS "RentalCharge_organizationId_eventId_idx" ON "RentalCharge"("organizationId", "eventId");

DO $$ BEGIN
  ALTER TABLE "RentalCharge" ADD CONSTRAINT "RentalCharge_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RentalCharge" ADD CONSTRAINT "RentalCharge_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RentalCharge" ADD CONSTRAINT "RentalCharge_amounts_check"
    CHECK ("quantity" >= 1 AND "unitAmount" >= 0 AND "amount" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
