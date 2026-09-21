-- Idempotencia y snapshots de las operaciones financieras (issue #20).
--
-- Aditiva, idempotente y re-ejecutable: crea la tabla de claves de idempotencia
-- y agrega las columnas de snapshot con IF NOT EXISTS / DO $$ ... EXCEPTION, sin
-- tocar ningún dato existente. Las columnas de snapshot quedan nulas en los
-- registros viejos: la lectura cae a la fuente viva (documentado en el schema) y
-- nada se inventa hacia atrás.

CREATE TABLE IF NOT EXISTS "IdempotencyKey" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "scope"          TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "requestHash"    TEXT NOT NULL,
  "status"         INTEGER NOT NULL DEFAULT 0,
  "response"       JSONB,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- Candado real de la idempotencia: una sola fila por empresa, operación y clave.
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyKey_organizationId_scope_key_key"
  ON "IdempotencyKey"("organizationId", "scope", "key");
CREATE INDEX IF NOT EXISTS "IdempotencyKey_expiresAt_idx"
  ON "IdempotencyKey"("expiresAt");
CREATE INDEX IF NOT EXISTS "IdempotencyKey_organizationId_createdAt_idx"
  ON "IdempotencyKey"("organizationId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "IdempotencyKey"
    ADD CONSTRAINT "IdempotencyKey_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Snapshot inmutable del cobro al confirmarlo (issue #20).
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "collectedSnapshot" JSONB;

-- Snapshot inmutable del hecho que originó cada movimiento de tesorería (issue #20).
ALTER TABLE "TreasuryMovement" ADD COLUMN IF NOT EXISTS "sourceSnapshot" JSONB;
