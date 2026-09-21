-- Autogestión del presupuesto por el cliente (issue #14): plan de pagos con
-- anticipo y cuotas, solicitudes del portal (propuesta de ítems / rebaja /
-- cambios) y datos de pago de la empresa.
--
-- Aditiva, idempotente y re-ejecutable: columnas con IF NOT EXISTS, tipos con
-- guarda de duplicado, tabla con IF NOT EXISTS y constraints con guarda. Las
-- filas existentes quedan con plan vacío (`advanceAmount` 0, `installmentsJson`
-- NULL) y sin solicitudes; no se toca ningún dato previo.

-- ── Enums de las solicitudes del portal ─────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "BudgetChangeKind" AS ENUM ('items', 'discount', 'changes');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BudgetChangeStatus" AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Plan de pagos del presupuesto ───────────────────────────────────────────

ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "advanceAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "installmentsJson" JSONB;

-- ── Datos de pago de la empresa ─────────────────────────────────────────────

ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "paymentDetails" JSONB;

-- ── Solicitudes del portal ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "BudgetChangeRequest" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "budgetId" TEXT NOT NULL,
  "kind" "BudgetChangeKind" NOT NULL,
  "status" "BudgetChangeStatus" NOT NULL DEFAULT 'pending',
  "payload" JSONB NOT NULL,
  "note" TEXT,
  "requestedByName" TEXT NOT NULL,
  "requestedByEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedByName" TEXT,
  "responseNote" TEXT,
  CONSTRAINT "BudgetChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BudgetChangeRequest_organizationId_status_createdAt_idx"
  ON "BudgetChangeRequest"("organizationId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "BudgetChangeRequest_budgetId_createdAt_idx"
  ON "BudgetChangeRequest"("budgetId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "BudgetChangeRequest"
    ADD CONSTRAINT "BudgetChangeRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BudgetChangeRequest"
    ADD CONSTRAINT "BudgetChangeRequest_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
