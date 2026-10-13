-- Papelera (docs/PAPELERA.md, etapa 1): archivar -> eliminar -> papelera.
--
-- Aditiva, idempotente y re-ejecutable (cada columna/índice se crea solo si falta, así
-- una segunda ejecución no pide locks de tabla). Los `*ById` son texto sin FK. El backfill solo
-- copia `active = false` a `archivedAt` cuando esta es nula (no pisa lo archivado).

DO $$
DECLARE
  t TEXT;
  c TEXT;
  cols TEXT[] := ARRAY['archivedAt:TIMESTAMP(3)', 'archivedById:TEXT', 'deletedAt:TIMESTAMP(3)', 'deletedById:TEXT', 'deleteReason:TEXT', 'anonymizedAt:TIMESTAMP(3)'];
BEGIN
  FOREACH t IN ARRAY ARRAY['Event', 'InventoryItem', 'Client', 'Lead', 'Supplier', 'Promoter', 'Budget']
  LOOP
    FOREACH c IN ARRAY cols
    LOOP
      -- Solo se altera lo que falta: re-ejecutar no pide el lock exclusivo de la tabla.
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = t AND column_name = split_part(c, ':', 1)
      ) THEN
        EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', t, split_part(c, ':', 1), split_part(c, ':', 2));
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = t || '_organizationId_deletedAt_idx') THEN
      EXECUTE format('CREATE INDEX %I ON %I ("organizationId", "deletedAt")', t || '_organizationId_deletedAt_idx', t);
    END IF;
  END LOOP;
END $$;

-- Backfill: lo desactivado queda archivado (solo si todavía no lo estaba).
UPDATE "Client" SET "archivedAt" = CURRENT_TIMESTAMP WHERE "active" = false AND "archivedAt" IS NULL;
UPDATE "Supplier" SET "archivedAt" = CURRENT_TIMESTAMP WHERE "active" = false AND "archivedAt" IS NULL;
UPDATE "Promoter" SET "archivedAt" = CURRENT_TIMESTAMP WHERE "active" = false AND "archivedAt" IS NULL;

-- Purga de la papelera a N días (NULL = sin purga).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'OrganizationRentalSettings' AND column_name = 'trashPurgeDays'
  ) THEN
    ALTER TABLE "OrganizationRentalSettings" ADD COLUMN "trashPurgeDays" INTEGER;
  END IF;
END $$;
