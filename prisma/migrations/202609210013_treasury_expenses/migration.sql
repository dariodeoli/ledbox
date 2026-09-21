-- Tesorería por cuentas y gastos con carga rápida (issue #27).
--
-- Aditiva, idempotente y re-ejecutable: crea los enums y las tablas con IF NOT
-- EXISTS, agrega la cuenta del cobro a `ClientPayment` y no toca ningún dato
-- existente. El saldo de una cuenta NO se guarda: se deriva de
-- `openingBalance` + los movimientos registrados (fuente única).
--
-- Provisión de arranque: toda empresa que todavía no tenga ninguna cuenta
-- recibe "Efectivo" (efectivo) y "Ueno Bank" (banco) con saldo inicial 0 y un
-- id determinístico; si la empresa ya tiene cuentas, no se toca nada. Como la
-- provisión va en una sola sentencia, la segunda cuenta no ve la primera y la
-- re-ejecución no duplica (además del `ON CONFLICT`).

DO $$ BEGIN
  CREATE TYPE "TreasuryAccountType" AS ENUM ('CASH', 'BANK', 'CHEQUE', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TreasuryMovementDirection" AS ENUM ('IN', 'OUT', 'TRANSFER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TreasuryMovementOrigin" AS ENUM ('client_payment', 'supplier_job', 'expense', 'adjustment');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ExpenseCategory" AS ENUM ('TRANSPORT', 'FUEL', 'FOOD', 'MATERIALS', 'RENT', 'SERVICES', 'SALARIES', 'TOOLS', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TreasuryAccount" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "type"           "TreasuryAccountType" NOT NULL DEFAULT 'CASH',
  "bank"           TEXT,
  "currency"       TEXT NOT NULL DEFAULT 'PYG',
  "openingBalance" INTEGER NOT NULL DEFAULT 0,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TreasuryAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TreasuryAccount_organizationId_name_key"
  ON "TreasuryAccount"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "TreasuryAccount_organizationId_active_sortOrder_idx"
  ON "TreasuryAccount"("organizationId", "active", "sortOrder");

CREATE TABLE IF NOT EXISTS "TreasuryMovement" (
  "id"               TEXT NOT NULL,
  "organizationId"   TEXT NOT NULL,
  "accountId"        TEXT NOT NULL,
  "counterAccountId" TEXT,
  "direction"        "TreasuryMovementDirection" NOT NULL,
  "amount"           INTEGER NOT NULL,
  "occurredAt"       TIMESTAMP(3) NOT NULL,
  "origin"           "TreasuryMovementOrigin" NOT NULL DEFAULT 'adjustment',
  "sourceId"         TEXT,
  "notes"            TEXT,
  "createdById"      TEXT,
  "createdByName"    TEXT NOT NULL,
  "createdByEmail"   TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TreasuryMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TreasuryMovement_organizationId_occurredAt_idx"
  ON "TreasuryMovement"("organizationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "TreasuryMovement_accountId_occurredAt_idx"
  ON "TreasuryMovement"("accountId", "occurredAt");
CREATE INDEX IF NOT EXISTS "TreasuryMovement_organizationId_origin_sourceId_idx"
  ON "TreasuryMovement"("organizationId", "origin", "sourceId");

CREATE TABLE IF NOT EXISTS "Expense" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "accountId"      TEXT NOT NULL,
  "eventId"        TEXT,
  "supplierId"     TEXT,
  "date"           TIMESTAMP(3) NOT NULL,
  "amount"         INTEGER NOT NULL,
  "category"       "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
  "description"    TEXT NOT NULL,
  "method"         TEXT,
  "receipt"        TEXT,
  "notes"          TEXT,
  "createdById"    TEXT,
  "createdByName"  TEXT NOT NULL,
  "createdByEmail" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Expense_organizationId_date_idx"
  ON "Expense"("organizationId", "date");
CREATE INDEX IF NOT EXISTS "Expense_organizationId_category_idx"
  ON "Expense"("organizationId", "category");
CREATE INDEX IF NOT EXISTS "Expense_organizationId_eventId_idx"
  ON "Expense"("organizationId", "eventId");
CREATE INDEX IF NOT EXISTS "Expense_accountId_date_idx"
  ON "Expense"("accountId", "date");

-- Cuenta de tesorería del cobro de cliente (issue #27): se elige al registrar
-- el cobro y el movimiento la usa al cobrarse. Sin cuenta, el cobro sigue
-- funcionando y no genera movimiento.
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "treasuryAccountId" TEXT;
CREATE INDEX IF NOT EXISTS "ClientPayment_treasuryAccountId_idx"
  ON "ClientPayment"("treasuryAccountId");

DO $$ BEGIN
  ALTER TABLE "TreasuryAccount"
    ADD CONSTRAINT "TreasuryAccount_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TreasuryMovement"
    ADD CONSTRAINT "TreasuryMovement_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TreasuryMovement"
    ADD CONSTRAINT "TreasuryMovement_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "TreasuryAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TreasuryMovement"
    ADD CONSTRAINT "TreasuryMovement_counterAccountId_fkey"
    FOREIGN KEY ("counterAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Expense"
    ADD CONSTRAINT "Expense_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Expense"
    ADD CONSTRAINT "Expense_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "TreasuryAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Expense"
    ADD CONSTRAINT "Expense_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Expense"
    ADD CONSTRAINT "Expense_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ClientPayment"
    ADD CONSTRAINT "ClientPayment_treasuryAccountId_fkey"
    FOREIGN KEY ("treasuryAccountId") REFERENCES "TreasuryAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Provisión de arranque (solo si la empresa no tiene ninguna cuenta): una sola
-- sentencia para que las dos cuentas vean el mismo estado previo y la
-- re-ejecución sea un no-op.
INSERT INTO "TreasuryAccount"
  ("id", "organizationId", "name", "type", "bank", "currency", "openingBalance", "sortOrder", "active", "createdAt", "updatedAt")
SELECT
  o."id" || seed."suffix",
  o."id",
  seed."name",
  seed."type"::"TreasuryAccountType",
  seed."bank",
  'PYG',
  0,
  seed."sortOrder",
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (
  VALUES
    ('_acct_cash', 'Efectivo', 'CASH', NULL, 10),
    ('_acct_ueno', 'Ueno Bank', 'BANK', 'Ueno Bank', 20)
) AS seed("suffix", "name", "type", "bank", "sortOrder")
WHERE NOT EXISTS (
  SELECT 1 FROM "TreasuryAccount" a WHERE a."organizationId" = o."id"
)
ON CONFLICT ("id") DO NOTHING;
