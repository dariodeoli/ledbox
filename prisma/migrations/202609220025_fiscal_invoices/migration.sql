-- Registro fiscal interno, parte 1 (issue #41): datos fiscales de la empresa,
-- facturas de venta con su numeración correlativa y sus líneas.
--
-- Aditiva, idempotente y re-ejecutable: cada objeto se crea con IF NOT EXISTS o
-- con un guardián `duplicate_object`. No toca ninguna tabla existente más que
-- agregar la columna `fiscalDetails` a Organization.
--
-- Alcance honesto: esto **no** es la factura electrónica de SIFEN/DNIT (hace
-- falta certificado, timbrado autorizado y servicios de la DNIT; ver
-- `docs/FISCAL-SIFEN.md`). Es el registro fiscal interno de la empresa.

DO $$ BEGIN
  CREATE TYPE "InvoiceCondition" AS ENUM ('CASH', 'CREDIT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'VOID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceTaxType" AS ENUM ('IVA10', 'IVA5', 'EXEMPT');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Datos fiscales de la empresa (los editan OWNER/ADMIN desde el panel).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "fiscalDetails" JSONB;

CREATE TABLE IF NOT EXISTS "Invoice" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "number"         INTEGER NOT NULL,
  "status"         "InvoiceStatus" NOT NULL DEFAULT 'ISSUED',
  "condition"      "InvoiceCondition" NOT NULL DEFAULT 'CASH',
  "clientId"       TEXT,
  "clientName"     TEXT NOT NULL,
  "clientRuc"      TEXT,
  "budgetId"       TEXT,
  "eventId"        TEXT,
  "issuedAt"       TIMESTAMP(3) NOT NULL,
  "dueAt"          TIMESTAMP(3),
  "taxable10"      INTEGER NOT NULL DEFAULT 0,
  "iva10"          INTEGER NOT NULL DEFAULT 0,
  "taxable5"       INTEGER NOT NULL DEFAULT 0,
  "iva5"           INTEGER NOT NULL DEFAULT 0,
  "exempt"         INTEGER NOT NULL DEFAULT 0,
  "total"          INTEGER NOT NULL,
  "notes"          TEXT,
  "voidedAt"       TIMESTAMP(3),
  "voidedById"     TEXT,
  "voidedByName"   TEXT,
  "voidReason"     TEXT,
  "paidAt"         TIMESTAMP(3),
  "createdById"    TEXT,
  "createdByName"  TEXT NOT NULL,
  "createdByEmail" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InvoiceItem" (
  "id"        TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "quantity"  INTEGER NOT NULL DEFAULT 1,
  "unitPrice" INTEGER NOT NULL,
  "taxType"   "InvoiceTaxType" NOT NULL DEFAULT 'IVA10',
  "subtotal"  INTEGER NOT NULL,
  "taxable"   INTEGER NOT NULL DEFAULT 0,
  "taxAmount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- Secuencia de numeración por empresa (una fila por empresa): el `UPDATE …
-- RETURNING` atómico de `app/api/admin/fiscal/route.ts` es el que garantiza
-- correlativo sin huecos; acá se provisionan las filas de las empresas que ya
-- existen para que la primera emisión no dependa del alta.
CREATE TABLE IF NOT EXISTS "InvoiceSequence" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "lastNumber"     INTEGER NOT NULL DEFAULT 0,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Invoice_organizationId_issuedAt_idx" ON "Invoice"("organizationId", "issuedAt");
CREATE INDEX IF NOT EXISTS "Invoice_organizationId_status_idx" ON "Invoice"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "Invoice_clientId_idx" ON "Invoice"("clientId");
CREATE INDEX IF NOT EXISTS "Invoice_budgetId_idx" ON "Invoice"("budgetId");
CREATE INDEX IF NOT EXISTS "Invoice_eventId_idx" ON "Invoice"("eventId");
CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_organizationId_number_key" ON "Invoice"("organizationId", "number");
CREATE INDEX IF NOT EXISTS "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");
CREATE UNIQUE INDEX IF NOT EXISTS "InvoiceSequence_organizationId_key" ON "InvoiceSequence"("organizationId");

DO $$ BEGIN
  ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_budgetId_fkey"
    FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InvoiceItem"
    ADD CONSTRAINT "InvoiceItem_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "InvoiceSequence"
    ADD CONSTRAINT "InvoiceSequence_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Provisión idempotente: una fila de secuencia por empresa existente.
INSERT INTO "InvoiceSequence" ("id", "organizationId", "lastNumber", "updatedAt")
SELECT 'seq_' || o."id", o."id", 0, CURRENT_TIMESTAMP
FROM "Organization" o
ON CONFLICT ("organizationId") DO NOTHING;
