-- FIN policy V1 support, same S1 #163/#173. No backfill or synthesized proof.
-- The prior source/migration remains immutable. Historical NULL is unsupported.
ALTER TABLE "ServiceEconomicEvidence" ADD COLUMN IF NOT EXISTS "policySupport" JSONB;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='SvcEvidence_policy_shape_check' AND conrelid='"ServiceEconomicEvidence"'::regclass) THEN
    ALTER TABLE "ServiceEconomicEvidence" ADD CONSTRAINT "SvcEvidence_policy_shape_check"
      CHECK ("policySupport" IS NULL OR COALESCE((jsonb_typeof("policySupport")='object'
        AND "policySupport"->>'policyVersion'='1' AND "policySupport"->>'censusVersion'='2'
        AND jsonb_typeof("policySupport"->'legacyDispositionByField')='array'
        AND jsonb_array_length("policySupport"->'legacyDispositionByField')=3
        AND jsonb_typeof("policySupport"->'componentObligationClosure')='array'
        AND jsonb_typeof("policySupport"->'overlaps')='array'),false));
  END IF;
END $$;
