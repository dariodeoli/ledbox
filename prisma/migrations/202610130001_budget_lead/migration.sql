-- Lead → Presupuesto: el presupuesto recuerda de qué lead nació. Aditiva e idempotente.
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "leadId" TEXT;

CREATE INDEX IF NOT EXISTS "Budget_organizationId_leadId_idx" ON "Budget"("organizationId", "leadId");

DO $$
BEGIN
  ALTER TABLE "Budget"
    ADD CONSTRAINT "Budget_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
