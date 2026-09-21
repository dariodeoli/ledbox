-- Portal del cliente (issue #12): token público del presupuesto y evidencia de
-- la aprobación digital o manual.
--
-- Aditiva, idempotente y re-ejecutable: agrega columnas nuevas con IF NOT EXISTS
-- y el índice único del token con IF NOT EXISTS. Los presupuestos existentes
-- quedan sin link (publicToken NULL) hasta que el panel lo genere; no se toca
-- ningún dato previo.

ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "publicTokenCreatedAt" TIMESTAMP(3);
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "approvedByName" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "approvalMethod" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "approvalIp" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "approvalUserAgent" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "approvalNote" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "revisionRequestedAt" TIMESTAMP(3);
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "revisionNote" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Budget_publicToken_key" ON "Budget"("publicToken");
