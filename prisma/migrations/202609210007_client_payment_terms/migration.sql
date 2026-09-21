-- Cobros a plazo (issue #16): estado del cobro, factura emitida (fecha y número),
-- vencimiento de cobro, fecha del cheque y fecha real de cobro.
--
-- Aditiva, idempotente y re-ejecutable: crea el enum y las columnas con IF NOT
-- EXISTS, relaja `paidAt` a nullable (un cobro a plazo todavía no está pagado:
-- la plata cobrada vive en `collectedAt` y solo cuenta con `status = 'RECEIVED'`),
-- hace el backfill de los cobros existentes y crea el índice de vencimientos.
-- No se pierde ningún dato previo.

DO $$ BEGIN
  CREATE TYPE "ClientPaymentStatus" AS ENUM ('PENDING', 'RECEIVED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "status" "ClientPaymentStatus" NOT NULL DEFAULT 'RECEIVED';
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "collectedAt" TIMESTAMP(3);
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "invoiceIssuedAt" TIMESTAMP(3);
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "dueAt" TIMESTAMP(3);
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "chequeDate" TIMESTAMP(3);
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ClientPayment" ALTER COLUMN "paidAt" DROP NOT NULL;
ALTER TABLE "ClientPayment" ALTER COLUMN "paidAt" DROP DEFAULT;

-- Backfill: los cobros ya registrados quedan cobrados (RECEIVED) y su fecha real
-- de cobro es la que ya tenían en `paidAt`. Re-ejecutarlo no cambia nada.
UPDATE "ClientPayment"
   SET "collectedAt" = "paidAt"
 WHERE "status" = 'RECEIVED'
   AND "collectedAt" IS NULL
   AND "paidAt" IS NOT NULL;

-- La fecha de registro de los cobros viejos es la de su cobro; los nuevos nacen
-- con `createdAt` real al cargarse.
UPDATE "ClientPayment"
   SET "createdAt" = "paidAt"
 WHERE "paidAt" IS NOT NULL
   AND "paidAt" < "createdAt";

CREATE INDEX IF NOT EXISTS "ClientPayment_organizationId_status_dueAt_idx"
  ON "ClientPayment"("organizationId", "status", "dueAt");
