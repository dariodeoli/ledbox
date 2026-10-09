-- Refs #173. Aditiva e idempotente: sin conversión de name/company/location.
ALTER TABLE "Client"
  ADD COLUMN IF NOT EXISTS "tradeName" TEXT,
  ADD COLUMN IF NOT EXISTS "legalName" TEXT,
  ADD COLUMN IF NOT EXISTS "billingEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "department" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "addressReference" TEXT,
  ADD COLUMN IF NOT EXISTS "locationUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "contacts" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "rucSnapshot" JSONB;

ALTER TABLE "Event"
  ADD COLUMN IF NOT EXISTS "department" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "addressReference" TEXT,
  ADD COLUMN IF NOT EXISTS "locationUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "venueContactName" TEXT,
  ADD COLUMN IF NOT EXISTS "venueContactPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "venueContactEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "responsibleName" TEXT,
  ADD COLUMN IF NOT EXISTS "responsiblePhone" TEXT,
  ADD COLUMN IF NOT EXISTS "responsibleEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "modality" TEXT,
  ADD COLUMN IF NOT EXISTS "attendees" INTEGER;
