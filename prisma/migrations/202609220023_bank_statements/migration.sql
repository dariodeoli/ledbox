-- Conciliación bancaria (issue #40).
--
-- Aditiva, idempotente y re-ejecutable: crea los enums y las dos tablas del
-- extracto con IF NOT EXISTS, agrega los índices y las claves foráneas con
-- guardas de `duplicate_object` y no toca ningún dato existente. El saldo de la
-- cuenta de tesorería sigue derivándose de los movimientos: el extracto no lo
-- reescribe, lo concilia fila por fila.

DO $$ BEGIN
  CREATE TYPE "BankStatementRowDirection" AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BankStatementRowStatus" AS ENUM ('PENDING', 'MATCHED', 'IGNORED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "BankStatement" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "accountId"       TEXT NOT NULL,
  "label"           TEXT NOT NULL,
  "periodStart"     TIMESTAMP(3) NOT NULL,
  "periodEnd"       TIMESTAMP(3) NOT NULL,
  "originalName"    TEXT,
  "lineCount"       INTEGER NOT NULL DEFAULT 0,
  "rowCount"        INTEGER NOT NULL DEFAULT 0,
  "errorCount"      INTEGER NOT NULL DEFAULT 0,
  "duplicateCount"  INTEGER NOT NULL DEFAULT 0,
  "importedById"    TEXT,
  "importedByName"  TEXT NOT NULL,
  "importedByEmail" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BankStatement_organizationId_accountId_periodStart_idx"
  ON "BankStatement"("organizationId", "accountId", "periodStart");
CREATE INDEX IF NOT EXISTS "BankStatement_organizationId_createdAt_idx"
  ON "BankStatement"("organizationId", "createdAt");

CREATE TABLE IF NOT EXISTS "BankStatementRow" (
  "id"             TEXT NOT NULL,
  "statementId"    TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "accountId"      TEXT NOT NULL,
  "line"           INTEGER NOT NULL,
  "date"           TIMESTAMP(3) NOT NULL,
  "description"    TEXT NOT NULL,
  "reference"      TEXT,
  "direction"      "BankStatementRowDirection" NOT NULL,
  "amount"         INTEGER NOT NULL,
  "status"         "BankStatementRowStatus" NOT NULL DEFAULT 'PENDING',
  "fingerprint"    TEXT NOT NULL,
  "raw"            TEXT,
  "movementId"     TEXT,
  "matchedAt"      TIMESTAMP(3),
  "matchedById"    TEXT,
  "matchedByName"  TEXT,
  "matchedByEmail" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankStatementRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BankStatementRow_organizationId_accountId_date_idx"
  ON "BankStatementRow"("organizationId", "accountId", "date");
CREATE INDEX IF NOT EXISTS "BankStatementRow_organizationId_status_idx"
  ON "BankStatementRow"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "BankStatementRow_statementId_line_idx"
  ON "BankStatementRow"("statementId", "line");
CREATE INDEX IF NOT EXISTS "BankStatementRow_organizationId_accountId_fingerprint_idx"
  ON "BankStatementRow"("organizationId", "accountId", "fingerprint");
CREATE INDEX IF NOT EXISTS "BankStatementRow_movementId_idx"
  ON "BankStatementRow"("movementId");

DO $$ BEGIN
  ALTER TABLE "BankStatement"
    ADD CONSTRAINT "BankStatement_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BankStatement"
    ADD CONSTRAINT "BankStatement_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "TreasuryAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BankStatementRow"
    ADD CONSTRAINT "BankStatementRow_statementId_fkey"
    FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BankStatementRow"
    ADD CONSTRAINT "BankStatementRow_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BankStatementRow"
    ADD CONSTRAINT "BankStatementRow_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "TreasuryAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "BankStatementRow"
    ADD CONSTRAINT "BankStatementRow_movementId_fkey"
    FOREIGN KEY ("movementId") REFERENCES "TreasuryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
