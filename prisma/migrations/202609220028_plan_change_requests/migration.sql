-- Solicitudes de cambio de plan (issue #42): el equipo pide el cambio desde el
-- panel y queda auditado; el cambio efectivo lo hace Owncoding (todavía sin
-- pasarela de pago), que marca la fila `approved` o `rejected`.
--
-- Aditiva, idempotente y re-ejecutable: crea el enum y la tabla solo si faltan,
-- con sus índices y claves foráneas. Sin datos previos: las empresas existentes
-- arrancan sin ninguna solicitud (y su plan vigente lo fija la migración 027).
--
-- Una sola solicitud `pending` por empresa es la regla de la capa de API:
-- pedir otro plan actualiza la pendiente en vez de acumular filas.

DO $$ BEGIN
  CREATE TYPE "PlanChangeRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PlanChangeRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "PlanChangeRequestStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "requestedById" TEXT,
    "requestedByName" TEXT NOT NULL,
    "requestedByEmail" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlanChangeRequest_organizationId_status_createdAt_idx"
  ON "PlanChangeRequest"("organizationId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "PlanChangeRequest_planId_idx" ON "PlanChangeRequest"("planId");

DO $$ BEGIN
  ALTER TABLE "PlanChangeRequest"
    ADD CONSTRAINT "PlanChangeRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlanChangeRequest"
    ADD CONSTRAINT "PlanChangeRequest_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
