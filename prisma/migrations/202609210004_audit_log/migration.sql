-- Auditoría: historial de cambios del panel (quién creó, editó, cambió de estado
-- o eliminó cada registro), con el actor denormalizado y el detalle acotado a los
-- campos tocados.
--
-- Aditiva, idempotente y re-ejecutable: crea la tabla y sus índices con
-- IF NOT EXISTS y agrega la clave foránea solo si falta. No toca datos existentes.

CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Lectura del historial por empresa ordenada por fecha, y por registro.
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX IF NOT EXISTS "AuditLog_organizationId_actorId_idx" ON "AuditLog"("organizationId", "actorId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conname = 'AuditLog_organizationId_fkey'
      AND c.conrelid = to_regclass('"AuditLog"')
  ) THEN
    ALTER TABLE "AuditLog"
      ADD CONSTRAINT "AuditLog_organizationId_fkey"
      FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
