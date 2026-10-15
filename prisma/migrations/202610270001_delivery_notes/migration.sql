-- Remitos de salida y de devolución firmados (alquileres P1-5).
-- Aditiva e idempotente: tablas/índices con IF NOT EXISTS, tipo y FKs con guarda duplicate_object,
-- trigger con CREATE OR REPLACE + DROP IF EXISTS.

DO $$ BEGIN
  CREATE TYPE "DeliveryNoteKind" AS ENUM ('OUT', 'IN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "DeliveryNote" (
  "id"              TEXT NOT NULL,
  "organizationId"  TEXT NOT NULL,
  "eventId"         TEXT NOT NULL,
  "kind"            "DeliveryNoteKind" NOT NULL,
  "number"          INTEGER NOT NULL,
  "linesSnapshot"   JSONB NOT NULL,
  "notes"           TEXT,
  "createdById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "signerName"      TEXT,
  "signerDocument"  TEXT,
  "signatureData"   BYTEA,
  "signatureMime"   TEXT,
  "signedAt"        TIMESTAMP(3),
  "signedById"      TEXT,
  "signedIp"        TEXT,
  "signedUserAgent" TEXT,
  "termsSnapshot"   TEXT,
  CONSTRAINT "DeliveryNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryNote_organizationId_number_key" ON "DeliveryNote"("organizationId", "number");
CREATE INDEX IF NOT EXISTS "DeliveryNote_organizationId_eventId_kind_signedAt_idx" ON "DeliveryNote"("organizationId", "eventId", "kind", "signedAt");

CREATE TABLE IF NOT EXISTS "DeliveryNotePhoto" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "noteId"         TEXT NOT NULL,
  "mime"           TEXT NOT NULL,
  "size"           INTEGER NOT NULL,
  "data"           BYTEA NOT NULL,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryNotePhoto_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DeliveryNotePhoto_noteId_createdAt_idx" ON "DeliveryNotePhoto"("noteId", "createdAt");

CREATE TABLE IF NOT EXISTS "DeliveryNoteCounter" (
  "organizationId" TEXT NOT NULL,
  "last"           INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "DeliveryNoteCounter_pkey" PRIMARY KEY ("organizationId")
);

DO $$ BEGIN
  ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DeliveryNotePhoto" ADD CONSTRAINT "DeliveryNotePhoto_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DeliveryNotePhoto" ADD CONSTRAINT "DeliveryNotePhoto_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "DeliveryNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Un remito firmado es inmutable: ni las líneas, ni el firmante, ni el trazo, ni el número.
-- (Borrar el remito entero por cascada de la empresa o el evento sigue permitido.)
CREATE OR REPLACE FUNCTION "delivery_note_immutable"() RETURNS trigger AS $fn$
BEGIN
  IF OLD."signedAt" IS NOT NULL AND (
    NEW."linesSnapshot" IS DISTINCT FROM OLD."linesSnapshot"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."kind" IS DISTINCT FROM OLD."kind"
    OR NEW."eventId" IS DISTINCT FROM OLD."eventId"
    OR NEW."signedAt" IS DISTINCT FROM OLD."signedAt"
    OR NEW."signerName" IS DISTINCT FROM OLD."signerName"
    OR NEW."signerDocument" IS DISTINCT FROM OLD."signerDocument"
    OR NEW."signatureData" IS DISTINCT FROM OLD."signatureData"
    OR NEW."termsSnapshot" IS DISTINCT FROM OLD."termsSnapshot"
  ) THEN
    RAISE EXCEPTION 'El remito % ya está firmado y no se puede modificar', OLD."number" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "DeliveryNote_immutable" ON "DeliveryNote";
CREATE TRIGGER "DeliveryNote_immutable" BEFORE UPDATE ON "DeliveryNote"
  FOR EACH ROW EXECUTE FUNCTION "delivery_note_immutable"();
