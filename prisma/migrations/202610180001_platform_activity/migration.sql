-- Panel de plataforma /superadmin (docs/SUPERADMIN.md §3), etapa E0.
--
-- Aditiva, idempotente y re-ejecutable: todo con IF NOT EXISTS (o guardado en un bloque DO).
-- Sin backfill: lastActiveAt y emailVerifiedAt arrancan en NULL.

ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3);
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "AdminActivityDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "day" DATE NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "hourMask" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AdminActivityDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminActivityDay_userId_day_key" ON "AdminActivityDay"("userId", "day");
CREATE INDEX IF NOT EXISTS "AdminActivityDay_day_idx" ON "AdminActivityDay"("day");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AdminActivityDay_userId_fkey'
  ) THEN
    ALTER TABLE "AdminActivityDay"
      ADD CONSTRAINT "AdminActivityDay_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Índices para barridos por fecha del panel de plataforma.
CREATE INDEX IF NOT EXISTS "AuditLog_entity_createdAt_idx" ON "AuditLog"("entity", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AdminSession_createdAt_idx" ON "AdminSession"("createdAt");
CREATE INDEX IF NOT EXISTS "Budget_approvedAt_idx" ON "Budget"("approvedAt");
CREATE INDEX IF NOT EXISTS "ClientPayment_paidAt_idx" ON "ClientPayment"("paidAt");
CREATE INDEX IF NOT EXISTS "Event_createdAt_idx" ON "Event"("createdAt");
