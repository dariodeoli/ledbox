-- Seña por empresa + depósito de garantía del alquiler.
--
-- Aditiva, idempotente y re-ejecutable. Todas las columnas son NULL: no cambia
-- el total ni los cobros de ningún presupuesto existente (la garantía vive aparte).

ALTER TABLE "OrganizationRentalSettings" ADD COLUMN IF NOT EXISTS "securityDepositDefault" INTEGER;

ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "securityDeposit" INTEGER;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "securityDepositStatus" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "securityDepositRetained" INTEGER;

DO $$ BEGIN
  ALTER TABLE "Budget" ADD CONSTRAINT "Budget_securityDepositStatus_check"
    CHECK ("securityDepositStatus" IS NULL OR "securityDepositStatus" IN ('PENDING','HELD','RETURNED','KEPT_PARTIAL','KEPT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Budget" ADD CONSTRAINT "Budget_securityDeposit_check"
    CHECK ("securityDeposit" IS NULL OR "securityDeposit" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Budget" ADD CONSTRAINT "Budget_securityDepositRetained_check"
    CHECK ("securityDepositRetained" IS NULL OR ("securityDepositRetained" >= 0 AND "securityDepositRetained" <= COALESCE("securityDeposit", 0)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OrganizationRentalSettings" ADD CONSTRAINT "OrganizationRentalSettings_securityDepositDefault_check"
    CHECK ("securityDepositDefault" IS NULL OR "securityDepositDefault" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
