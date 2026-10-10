-- #173 A15: persistir sólo orden explícito nuevo; no inferir ni backfillear históricos.
ALTER TABLE "BudgetItem" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER;
