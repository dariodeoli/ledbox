-- Comprobantes de pago del portal (issue #17).
--
-- Aditiva, idempotente y re-ejecutable: crea la tabla, sus índices y las claves
-- foráneas solo si faltan, así se puede correr dos veces sin efectos. El
-- binario del comprobante vive en `data` (bytea) y nunca se expone en el sitio
-- público: se sirve únicamente con sesión del panel.

CREATE TABLE IF NOT EXISTS "BudgetPaymentProof" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "budgetId"       TEXT NOT NULL,
  "paymentId"      TEXT,
  "uploadedByName" TEXT NOT NULL,
  "mime"           TEXT NOT NULL,
  "size"           INTEGER NOT NULL,
  "data"           BYTEA NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BudgetPaymentProof_pkey" PRIMARY KEY ("id")
);

-- Comprobantes de una empresa y un presupuesto, en orden de llegada.
CREATE INDEX IF NOT EXISTS "BudgetPaymentProof_organizationId_budgetId_createdAt_idx"
  ON "BudgetPaymentProof"("organizationId", "budgetId", "createdAt");

-- Comprobantes asociados a un cobro a plazo.
CREATE INDEX IF NOT EXISTS "BudgetPaymentProof_paymentId_idx"
  ON "BudgetPaymentProof"("paymentId");

DO $$ BEGIN
  ALTER TABLE "BudgetPaymentProof"
    ADD CONSTRAINT "BudgetPaymentProof_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BudgetPaymentProof"
    ADD CONSTRAINT "BudgetPaymentProof_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BudgetPaymentProof"
    ADD CONSTRAINT "BudgetPaymentProof_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "ClientPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
