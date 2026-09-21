-- Historial de correos (issue #31): verificación de envío del panel.
--
-- Aditiva, idempotente y re-ejecutable: crea los enums, la tabla, sus índices y
-- la clave foránea con IF NOT EXISTS / duplicate_object, así se puede correr
-- dos veces sin efectos. No toca ninguna tabla ni dato existente: los envíos
-- que ya ocurrieron (recordatorios del issue #19) siguen en su bitácora
-- (`PaymentReminderLog`) y el historial nuevo arranca vacío.
--
-- `organizationId` es opcional: un reset de contraseña de una cuenta sin empresa
-- no pertenece a ninguna empresa.

DO $$ BEGIN
  CREATE TYPE "MailCategory" AS ENUM ('reset', 'reminder', 'budget', 'test', 'invitation');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MailStatus" AS ENUM ('sending', 'sent', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MailLog" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT,
  "category"       "MailCategory" NOT NULL,
  "status"         "MailStatus" NOT NULL DEFAULT 'sending',
  "to"             TEXT NOT NULL,
  "subject"        TEXT NOT NULL,
  "error"          TEXT,
  "providerId"     TEXT,
  "entity"         TEXT,
  "entityId"       TEXT,
  "actorId"        TEXT,
  "actorName"      TEXT,
  "actorEmail"     TEXT,
  "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MailLog_organizationId_createdAt_idx"
  ON "MailLog"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "MailLog_category_createdAt_idx"
  ON "MailLog"("category", "createdAt");

DO $$ BEGIN
  ALTER TABLE "MailLog"
    ADD CONSTRAINT "MailLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
