-- API keys de servicio (issue #69): automatizaciones que cargan clientes y
-- presupuestos sin contraseñas.
--
-- Aditiva, idempotente y re-ejecutable (`CREATE TABLE IF NOT EXISTS`, índice
-- `IF NOT EXISTS` y FK con guard `duplicate_object`): agrega la tabla y no toca
-- ningún dato existente. El token plano nunca vive acá: solo su hash SHA-256.
CREATE TABLE IF NOT EXISTS "ApiToken" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'OPERATIONS',
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "ApiToken_organizationId_revokedAt_idx" ON "ApiToken"("organizationId", "revokedAt");

DO $$ BEGIN
  ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
