-- S1 #163/#173: private immutable observations, NO backfill/default authority.
CREATE UNIQUE INDEX IF NOT EXISTS "AuditLog_org_id_key" ON "AuditLog" ("organizationId","id");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcAlloc_org_budget_id_key" ON "ServiceCostAllocation" ("organizationId","budgetId","id");
CREATE TABLE IF NOT EXISTS "ServiceEconomicEvidence" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "budgetId" TEXT NOT NULL,
  "contractVersion" INTEGER NOT NULL, "revision" INTEGER NOT NULL, "kind" TEXT NOT NULL,
  "applicationId" TEXT, "budgetItemId" TEXT, "budgetUpdatedAt" TIMESTAMP(3) NOT NULL,
  "censusDigest" TEXT NOT NULL, "snapshot" JSONB NOT NULL,
  "auditId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "recordedAt" TIMESTAMP(3) NOT NULL,
  "rationale" TEXT NOT NULL, "legacyOverlaps" JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS "ServiceEconomicEvidenceMember" (
  "id" TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "budgetId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL, "applicationId" TEXT, "budgetItemId" TEXT,
  "sourceId" TEXT, "allocationId" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "SvcEvidence_scope_id_key" ON "ServiceEconomicEvidence" ("organizationId","budgetId","id");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcEvidence_audit_key" ON "ServiceEconomicEvidence" ("organizationId","auditId");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcEvidence_app_revision_key" ON "ServiceEconomicEvidence" ("organizationId","budgetId","kind","applicationId","revision");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcEvidence_item_revision_key" ON "ServiceEconomicEvidence" ("organizationId","budgetId","kind","budgetItemId","revision");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcEvidence_legacy_revision_key" ON "ServiceEconomicEvidence" ("organizationId","budgetId","revision") WHERE "kind"='LEGACY_RECONCILIATION';
CREATE INDEX IF NOT EXISTS "SvcEvidence_scope_idx" ON "ServiceEconomicEvidence" ("organizationId","budgetId");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcEvidence_member_app_key" ON "ServiceEconomicEvidenceMember" ("evidenceId","applicationId");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcEvidence_member_item_key" ON "ServiceEconomicEvidenceMember" ("evidenceId","budgetItemId");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcEvidence_member_source_key" ON "ServiceEconomicEvidenceMember" ("evidenceId","sourceId");
CREATE UNIQUE INDEX IF NOT EXISTS "SvcEvidence_member_alloc_key" ON "ServiceEconomicEvidenceMember" ("evidenceId","allocationId");
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('ServiceEconomicEvidence','SvcEvidence_org_fkey','FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")'),
    ('ServiceEconomicEvidence','SvcEvidence_budget_fkey','FOREIGN KEY ("organizationId","budgetId") REFERENCES "Budget"("organizationId","id")'),
    ('ServiceEconomicEvidence','SvcEvidence_audit_fkey','FOREIGN KEY ("organizationId","auditId") REFERENCES "AuditLog"("organizationId","id")'),
    ('ServiceEconomicEvidence','SvcEvidence_app_fkey','FOREIGN KEY ("organizationId","budgetId","applicationId") REFERENCES "BudgetServiceApplication"("organizationId","budgetId","id")'),
    ('ServiceEconomicEvidence','SvcEvidence_item_fkey','FOREIGN KEY ("budgetId","budgetItemId") REFERENCES "BudgetItem"("budgetId","id")'),
    ('ServiceEconomicEvidenceMember','SvcEvidenceMember_evidence_fkey','FOREIGN KEY ("organizationId","budgetId","evidenceId") REFERENCES "ServiceEconomicEvidence"("organizationId","budgetId","id")'),
    ('ServiceEconomicEvidenceMember','SvcEvidenceMember_app_fkey','FOREIGN KEY ("organizationId","budgetId","applicationId") REFERENCES "BudgetServiceApplication"("organizationId","budgetId","id")'),
    ('ServiceEconomicEvidenceMember','SvcEvidenceMember_item_fkey','FOREIGN KEY ("budgetId","budgetItemId") REFERENCES "BudgetItem"("budgetId","id")'),
    ('ServiceEconomicEvidenceMember','SvcEvidenceMember_source_fkey','FOREIGN KEY ("organizationId","budgetId","sourceId") REFERENCES "ServiceCostSource"("organizationId","budgetId","id")'),
    ('ServiceEconomicEvidenceMember','SvcEvidenceMember_alloc_fkey','FOREIGN KEY ("organizationId","budgetId","allocationId") REFERENCES "ServiceCostAllocation"("organizationId","budgetId","id")')
  ) AS v(t,n,d) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=c.n AND conrelid=to_regclass(format('%I',c.t))) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s ON DELETE RESTRICT ON UPDATE RESTRICT',c.t,c.n,c.d);
    END IF;
  END LOOP;
  FOR c IN SELECT * FROM (VALUES
    ('ServiceEconomicEvidence','SvcEvidence_version_check','"contractVersion"=1 AND "revision">=1'),
    ('ServiceEconomicEvidence','SvcEvidence_kind_check','("kind"=''LEGACY_RECONCILIATION'' AND "applicationId" IS NULL AND "budgetItemId" IS NULL) OR ("kind"=''COMPONENT_ZERO'' AND num_nonnulls("applicationId","budgetItemId")=1)'),
    ('ServiceEconomicEvidence','SvcEvidence_provenance_check','length(btrim("actorId"))>0 AND length(btrim("rationale")) BETWEEN 1 AND 2000 AND "censusDigest" ~ ''^[a-f0-9]{64}$'' AND jsonb_typeof("snapshot")=''object'' AND jsonb_typeof("legacyOverlaps")=''array'''),
    ('ServiceEconomicEvidenceMember','SvcEvidenceMember_xor_check','num_nonnulls("applicationId","budgetItemId","sourceId","allocationId")=1')
  ) AS v(t,n,d) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=c.n AND conrelid=to_regclass(format('%I',c.t))) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)',c.t,c.n,c.d);
    END IF;
  END LOOP;
END $$;
-- Preserve observations and their census: changed live rows invalidate readback,
-- never rewrite history. Provenance/semantic approval is still validated internally.
CREATE OR REPLACE FUNCTION service_economic_evidence_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SERVICE_ECONOMIC_EVIDENCE_IMMUTABLE'; END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='SvcEvidence_immutable' AND tgrelid='"ServiceEconomicEvidence"'::regclass) THEN
    CREATE TRIGGER "SvcEvidence_immutable" BEFORE UPDATE OR DELETE ON "ServiceEconomicEvidence" FOR EACH ROW EXECUTE FUNCTION service_economic_evidence_immutable();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='SvcEvidenceMember_immutable' AND tgrelid='"ServiceEconomicEvidenceMember"'::regclass) THEN
    CREATE TRIGGER "SvcEvidenceMember_immutable" BEFORE UPDATE OR DELETE ON "ServiceEconomicEvidenceMember" FOR EACH ROW EXECUTE FUNCTION service_economic_evidence_immutable();
  END IF;
END $$;
