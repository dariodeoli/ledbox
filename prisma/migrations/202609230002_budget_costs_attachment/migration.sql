-- Costos internos, campos del cliente y adjunto del presupuesto (issue #65).
--
-- Aditiva, idempotente y re-re-ejecutable (`ADD COLUMN IF NOT EXISTS` /
-- `CREATE TABLE IF NOT EXISTS`): agrega lo que falta y no toca ningún dato.
--
-- - `Budget.materialCost` y `Budget.laborCost`: costos internos separados (el
--   costo por ítem es `BudgetItem.costPrice` y el estimado `Budget.costEstimate`).
--   Nunca salen al cliente: el portal y el imprimible los excluyen por contrato.
-- - `Budget.deliveryAt`, `Budget.ivaType` y `Budget.warranty`: fecha de entrega,
--   condición de IVA y garantía, datos de la versión que ve el cliente (la
--   vigencia es `validUntil`, la forma de pago `paymentTerms` y las
--   observaciones `notes`, que ya existían).
-- - `BudgetAttachment`: el PDF original u otro archivo del presupuesto, con el
--   mismo patrón que los comprobantes de pago (issue #17): binario en la base,
--   servido solo con sesión, compatible con los backups.

ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "materialCost" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "laborCost" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "deliveryAt" TIMESTAMP(3);
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "ivaType" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "warranty" TEXT;

CREATE TABLE IF NOT EXISTS "BudgetAttachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "uploadedByName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BudgetAttachment_organizationId_budgetId_createdAt_idx"
    ON "BudgetAttachment"("organizationId", "budgetId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "BudgetAttachment" ADD CONSTRAINT "BudgetAttachment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BudgetAttachment" ADD CONSTRAINT "BudgetAttachment_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
