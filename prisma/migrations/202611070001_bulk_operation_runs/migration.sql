DO $$ BEGIN
  CREATE TYPE "BulkOperationRunStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'INCOMPLETE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BulkOperationRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "actorEmail" TEXT NOT NULL,
  "actorRole" "AdminRole" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestedIds" JSONB NOT NULL,
  "outcomes" JSONB,
  "response" JSONB,
  "status" "BulkOperationRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "BulkOperationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BulkOperationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BulkOperationRun_organizationId_idempotencyKey_key"
  ON "BulkOperationRun"("organizationId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "BulkOperationRun_organizationId_createdAt_idx"
  ON "BulkOperationRun"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "BulkOperationRun_organizationId_status_createdAt_idx"
  ON "BulkOperationRun"("organizationId", "status", "createdAt");
