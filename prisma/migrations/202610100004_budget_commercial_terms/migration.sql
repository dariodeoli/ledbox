-- Campos opcionales sin backfill ni reinterpretación comercial histórica.
DO $$ BEGIN
  CREATE TYPE "BudgetPriceMode" AS ENUM ('TARIFF', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "BudgetDiscountMode" AS ENUM ('AMOUNT', 'PERCENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "BudgetItem"
  ADD COLUMN IF NOT EXISTS "priceMode" "BudgetPriceMode",
  ADD COLUMN IF NOT EXISTS "tariffSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "discountMode" "BudgetDiscountMode",
  ADD COLUMN IF NOT EXISTS "discountValue" INTEGER,
  ADD COLUMN IF NOT EXISTS "discountAmount" INTEGER;
ALTER TABLE "Budget"
  ADD COLUMN IF NOT EXISTS "discountMode" "BudgetDiscountMode",
  ADD COLUMN IF NOT EXISTS "discountValue" INTEGER,
  ADD COLUMN IF NOT EXISTS "advancePercentBps" INTEGER;
