-- Disponibilidad de promotoras (issue #24): estado explícito, motivo y, si
-- aplica, hasta cuándo no está disponible.
--
-- Aditiva, idempotente y re-ejecutable: crea el enum y las columnas con IF NOT
-- EXISTS. Las promotoras existentes quedan en AVAILABLE por el default (nadie
-- queda marcado como no disponible sin que alguien lo declare). No se pierde
-- ningún dato previo.

DO $$ BEGIN
  CREATE TYPE "PromoterAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'TO_DEFINE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Promoter" ADD COLUMN IF NOT EXISTS "availability" "PromoterAvailability" NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "Promoter" ADD COLUMN IF NOT EXISTS "availabilityNote" TEXT;
ALTER TABLE "Promoter" ADD COLUMN IF NOT EXISTS "unavailableUntil" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Promoter_organizationId_availability_idx"
  ON "Promoter"("organizationId", "availability");
