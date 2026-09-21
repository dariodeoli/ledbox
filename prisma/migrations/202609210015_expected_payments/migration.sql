-- Pagos esperados y confirmación en cuenta (issue #28).
--
-- Aditiva, idempotente y re-ejecutable: crea los enums y la tabla `ExpectedPayment`
-- con IF NOT EXISTS, y amplía `PaymentReminderLog` para recordar también pagos
-- esperados (el destinatario pasa a una clave `targetKey` que sobrevive a que el
-- recordatorio no sea de un cobro). No toca datos existentes: los presupuestos ya
-- aprobados quedan sin pagos esperados hasta que se sincronicen (al cambiar el
-- plan) y los recordatorios viejos se backfillean con `client:<paymentId>`.
--
-- El dinero esperado NO es plata cobrada: el estado (`AWAITING` / `PROOF` /
-- `CONFIRMED` / `CANCELLED`) y el cobro (`paymentId`) recién se sellan al
-- confirmar en una cuenta de tesorería.

DO $$ BEGIN
  CREATE TYPE "ExpectedPaymentConcept" AS ENUM ('advance', 'installment', 'balance');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExpectedPaymentStatus" AS ENUM ('AWAITING', 'PROOF', 'CONFIRMED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ExpectedPayment" (
  "id"                TEXT NOT NULL,
  "organizationId"    TEXT NOT NULL,
  "budgetId"          TEXT NOT NULL,
  "concept"           "ExpectedPaymentConcept" NOT NULL,
  "slot"              TEXT NOT NULL,
  "installmentNumber" INTEGER,
  "label"             TEXT NOT NULL,
  "amount"            INTEGER NOT NULL,
  "dueAt"             TIMESTAMP(3),
  "status"            "ExpectedPaymentStatus" NOT NULL DEFAULT 'AWAITING',
  "expectedAccountId" TEXT,
  "proofId"           TEXT,
  "paymentId"         TEXT,
  "reviewNote"        TEXT,
  "reviewedAt"        TIMESTAMP(3),
  "reviewedByName"    TEXT,
  "confirmedAt"       TIMESTAMP(3),
  "confirmedById"     TEXT,
  "confirmedByName"   TEXT,
  "confirmedByEmail"  TEXT,
  "cancelledAt"       TIMESTAMP(3),
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpectedPayment_pkey" PRIMARY KEY ("id")
);

-- Un concepto por ranura estable del plan (`advance`, `installment:N`, `balance`):
-- es el candado de idempotencia de la sincronización.
CREATE UNIQUE INDEX IF NOT EXISTS "ExpectedPayment_budgetId_slot_key"
  ON "ExpectedPayment"("budgetId", "slot");
CREATE INDEX IF NOT EXISTS "ExpectedPayment_organizationId_status_dueAt_idx"
  ON "ExpectedPayment"("organizationId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "ExpectedPayment_budgetId_createdAt_idx"
  ON "ExpectedPayment"("budgetId", "createdAt");
CREATE INDEX IF NOT EXISTS "ExpectedPayment_expectedAccountId_idx"
  ON "ExpectedPayment"("expectedAccountId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExpectedPayment_proofId_key"
  ON "ExpectedPayment"("proofId");
CREATE UNIQUE INDEX IF NOT EXISTS "ExpectedPayment_paymentId_key"
  ON "ExpectedPayment"("paymentId");

DO $$ BEGIN
  ALTER TABLE "ExpectedPayment"
    ADD CONSTRAINT "ExpectedPayment_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ExpectedPayment"
    ADD CONSTRAINT "ExpectedPayment_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ExpectedPayment"
    ADD CONSTRAINT "ExpectedPayment_expectedAccountId_fkey"
    FOREIGN KEY ("expectedAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ExpectedPayment"
    ADD CONSTRAINT "ExpectedPayment_proofId_fkey"
    FOREIGN KEY ("proofId") REFERENCES "BudgetPaymentProof"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ExpectedPayment"
    ADD CONSTRAINT "ExpectedPayment_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "ClientPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Recordatorios de pagos esperados: el destinatario deja de ser siempre un cobro.
ALTER TABLE "PaymentReminderLog" ADD COLUMN IF NOT EXISTS "targetKey" TEXT;
ALTER TABLE "PaymentReminderLog" ADD COLUMN IF NOT EXISTS "expectedPaymentId" TEXT;

-- Backfill de los recordatorios existentes: cada cobro tiene su clave estable.
UPDATE "PaymentReminderLog"
   SET "targetKey" = 'client:' || "paymentId"
 WHERE "targetKey" IS NULL AND "paymentId" IS NOT NULL;

ALTER TABLE "PaymentReminderLog" ALTER COLUMN "targetKey" SET NOT NULL;

-- Un recordatorio por destinatario, canal y día (los cobros conservan además su
-- índice único propio, que sigue valiendo para `paymentId` no nulo).
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReminderLog_targetKey_channel_dayKey_key"
  ON "PaymentReminderLog"("targetKey", "channel", "dayKey");
CREATE INDEX IF NOT EXISTS "PaymentReminderLog_expectedPaymentId_idx"
  ON "PaymentReminderLog"("expectedPaymentId");

ALTER TABLE "PaymentReminderLog" ALTER COLUMN "paymentId" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "PaymentReminderLog"
    ADD CONSTRAINT "PaymentReminderLog_expectedPaymentId_fkey"
    FOREIGN KEY ("expectedPaymentId") REFERENCES "ExpectedPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
