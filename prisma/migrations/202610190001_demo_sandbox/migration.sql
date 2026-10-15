-- Demo interactiva por visitante (docs/DEMO-INTERACTIVA.md §6).
-- Aditiva, idempotente y re-ejecutable. Una sandbox es una empresa con isDemo = true y demoParentId.

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "demoParentId" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "demoExpiresAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "demoLastSeenAt" TIMESTAMP(3);
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "demoReady" BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS "Organization_isDemo_demoExpiresAt_idx" ON "Organization"("isDemo", "demoExpiresAt");

-- La vitrina (slug demo) es una empresa demo de solo lectura.
UPDATE "Organization" SET "isDemo" = true WHERE "slug" = 'demo' AND NOT "isDemo";

ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "demoOrganizationId" TEXT;
CREATE INDEX IF NOT EXISTS "AdminUser_demoOrganizationId_idx" ON "AdminUser"("demoOrganizationId");

ALTER TABLE "DemoSession" ADD COLUMN IF NOT EXISTS "sandboxOrgId" TEXT;
ALTER TABLE "DemoSession" ADD COLUMN IF NOT EXISTS "actions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DemoSession" ADD COLUMN IF NOT EXISTS "actionsByEntity" JSONB;
ALTER TABLE "DemoSession" ADD COLUMN IF NOT EXISTS "resets" INTEGER NOT NULL DEFAULT 0;

-- Correo simulado de la demo: MailLog «skipped» («Demo: simulado»). No se usa dentro de esta migración.
ALTER TYPE "MailStatus" ADD VALUE IF NOT EXISTS 'skipped';
