-- Registro fiscal interno, parte 2 (issue #41): facturas de compra del libro de
-- IVA y cierre mensual del período.
--
-- Aditiva, idempotente y re-ejecutable: cada objeto se crea con IF NOT EXISTS o
-- con un guardián `duplicate_object`. No toca ninguna tabla existente.
--
-- `PurchaseInvoice` guarda el comprobante que **emite el proveedor** y carga el
-- equipo (crédito fiscal del libro de compras); `FiscalPeriod` es el cierre
-- mensual con el snapshot del resumen (`summary`), el bloqueo de edición del mes
-- cerrado y la reapertura (solo OWNER, con motivo y auditoría).

DO $$ BEGIN
  CREATE TYPE "FiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseInvoice" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "supplierId"     TEXT,
  "date"           TIMESTAMP(3) NOT NULL,
  "reason"         TEXT NOT NULL,
  "ruc"            TEXT,
  "timbrado"       TEXT,
  "number"         TEXT,
  "concept"        TEXT,
  "taxable10"      INTEGER NOT NULL DEFAULT 0,
  "iva10"          INTEGER NOT NULL DEFAULT 0,
  "taxable5"       INTEGER NOT NULL DEFAULT 0,
  "iva5"           INTEGER NOT NULL DEFAULT 0,
  "exempt"         INTEGER NOT NULL DEFAULT 0,
  "total"          INTEGER NOT NULL,
  "createdById"    TEXT,
  "createdByName"  TEXT NOT NULL,
  "createdByEmail" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FiscalPeriod" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "month"          TEXT NOT NULL,
  "status"         "FiscalPeriodStatus" NOT NULL DEFAULT 'CLOSED',
  "summary"        JSONB,
  "closedAt"       TIMESTAMP(3),
  "closedById"     TEXT,
  "closedByName"   TEXT,
  "reopenedAt"     TIMESTAMP(3),
  "reopenedById"   TEXT,
  "reopenedByName" TEXT,
  "reopenReason"   TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalPeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PurchaseInvoice_organizationId_date_idx" ON "PurchaseInvoice"("organizationId", "date");
CREATE INDEX IF NOT EXISTS "PurchaseInvoice_supplierId_idx" ON "PurchaseInvoice"("supplierId");
CREATE INDEX IF NOT EXISTS "FiscalPeriod_organizationId_status_idx" ON "FiscalPeriod"("organizationId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "FiscalPeriod_organizationId_month_key" ON "FiscalPeriod"("organizationId", "month");

DO $$ BEGIN
  ALTER TABLE "PurchaseInvoice"
    ADD CONSTRAINT "PurchaseInvoice_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PurchaseInvoice"
    ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "FiscalPeriod"
    ADD CONSTRAINT "FiscalPeriod_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
