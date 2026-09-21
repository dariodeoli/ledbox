-- Recordatorios de cobro al cliente (issue #19): email por Resend y WhatsApp
-- prellenado, con bitácora por cobro, canal y día.
--
-- Aditiva, idempotente y re-ejecutable: crea los enums y la tabla con IF NOT
-- EXISTS y agrega el índice único `(paymentId, channel, dayKey)`, que es el
-- candado de idempotencia (un recordatorio por cobro y canal por día de
-- Asunción, aunque corran a la vez el despacho diario y el envío manual).
-- No se toca ninguna tabla ni dato existente.

DO $$ BEGIN
  CREATE TYPE "PaymentReminderChannel" AS ENUM ('email', 'whatsapp');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PaymentReminderStatus" AS ENUM ('sending', 'sent', 'failed', 'opened');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PaymentReminderLog" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "paymentId"      TEXT NOT NULL,
  "channel"        "PaymentReminderChannel" NOT NULL,
  "status"         "PaymentReminderStatus" NOT NULL DEFAULT 'sending',
  "to"             TEXT NOT NULL,
  "dayKey"         TEXT NOT NULL,
  "subject"        TEXT,
  "error"          TEXT,
  "actorKind"      TEXT NOT NULL DEFAULT 'system',
  "actorId"        TEXT,
  "actorName"      TEXT,
  "actorEmail"     TEXT,
  "sentAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentReminderLog_paymentId_channel_dayKey_key"
  ON "PaymentReminderLog"("paymentId", "channel", "dayKey");
CREATE INDEX IF NOT EXISTS "PaymentReminderLog_organizationId_sentAt_idx"
  ON "PaymentReminderLog"("organizationId", "sentAt");
CREATE INDEX IF NOT EXISTS "PaymentReminderLog_organizationId_dayKey_idx"
  ON "PaymentReminderLog"("organizationId", "dayKey");

DO $$ BEGIN
  ALTER TABLE "PaymentReminderLog"
    ADD CONSTRAINT "PaymentReminderLog_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentReminderLog"
    ADD CONSTRAINT "PaymentReminderLog_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "ClientPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
