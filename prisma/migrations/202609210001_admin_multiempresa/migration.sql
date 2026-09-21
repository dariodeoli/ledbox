-- Multiempresa real: organización por defecto, membresías de panel y aislamiento
-- por `organizationId` en todos los módulos operativos.
--
-- Aditiva, idempotente y re-ejecutable: corre igual sobre una base creada con
-- `prisma migrate deploy` (que hasta ahora solo aplicaba la migración init) y
-- sobre la base publicada, donde las tablas operativas se crearon con
-- `prisma db push`, sin perder datos ni romper filas existentes.
--
-- Backfill: crea la organización "LedBox" (`org_ledbox`, slug `ledbox`), asigna a
-- ella todas las filas existentes y deja a los AdminUser actuales como OWNER.

-- 1. Enum AdminRole ---------------------------------------------------------------
-- La migración init creó el enum solo con 'ADMIN'; los otros cuatro roles del panel
-- vienen de commits posteriores. Si falta alguno se recrea el tipo: no se puede
-- usar un valor nuevo del enum dentro de la misma transacción que lo agrega.
DO $$
DECLARE
  labels text[];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    WHERE t.typname = 'AdminRole' AND t.typnamespace = current_schema()::regnamespace
  ) THEN
    CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'ADMIN', 'FINANCE', 'OPERATIONS', 'VIEWER');
    RETURN;
  END IF;

  SELECT array_agg(e.enumlabel::text ORDER BY e.enumlabel) INTO labels
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'AdminRole' AND t.typnamespace = current_schema()::regnamespace;

  IF labels = ARRAY['ADMIN', 'FINANCE', 'OPERATIONS', 'OWNER', 'VIEWER'] THEN
    RETURN;
  END IF;

  ALTER TYPE "AdminRole" RENAME TO "AdminRole_legacy";
  CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'ADMIN', 'FINANCE', 'OPERATIONS', 'VIEWER');
  ALTER TABLE "AdminUser" ALTER COLUMN "role" DROP DEFAULT;
  ALTER TABLE "AdminUser" ALTER COLUMN "role" TYPE "AdminRole" USING ("role"::text::"AdminRole");
  ALTER TABLE "AdminUser" ALTER COLUMN "role" SET DEFAULT 'ADMIN';
  DROP TYPE "AdminRole_legacy";
END $$;

-- 2. Enums restantes (organización, portal de clientes y módulos operativos) ------
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('OrganizationRole', ARRAY['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
      ('ClientType', ARRAY['FINAL', 'RESELLER']),
      ('EventStatus', ARRAY['DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']),
      ('CommercialStatus', ARRAY['DRAFT', 'SENT', 'NEGOTIATING', 'APPROVED', 'LOST', 'CANCELLED']),
      ('PaymentStatus', ARRAY['PENDING', 'PARTIAL', 'PAID', 'CANCELLED']),
      ('SupplierCategory', ARRAY['CARPENTRY', 'GRAPHICS', 'ELECTRICITY', 'TRANSPORT', 'FURNITURE', 'AUDIOVISUAL', 'STAFF', 'OTHER']),
      ('SupplierWorkStatus', ARRAY['PENDING', 'CONTRACTED', 'ADVANCE_PENDING', 'ADVANCE_PAID', 'IN_PRODUCTION', 'DELIVERED', 'BALANCE_PENDING', 'PAID', 'CANCELLED']),
      ('InventoryKind', ARRAY['REUSABLE', 'CONSUMABLE', 'DISPOSABLE']),
      ('InventoryStatus', ARRAY['AVAILABLE', 'RESERVED', 'IN_USE', 'MAINTENANCE', 'RETIRED']),
      ('EventTaskType', ARRAY['SETUP', 'EVENT', 'STRIKE', 'PAYMENT', 'COLLECTION'])
    ) AS t(name, labels)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_type pt
      WHERE pt.typname = spec.name AND pt.typnamespace = current_schema()::regnamespace
    ) THEN
      EXECUTE format(
        'CREATE TYPE %I AS ENUM (%s)',
        spec.name,
        (SELECT string_agg(quote_literal(label), ', ') FROM unnest(spec.labels) AS label)
      );
    END IF;
  END LOOP;
END $$;

-- 3. Tablas base que nunca llegaron a una migración -------------------------------
-- (hasta ahora existían solo por `prisma db push`). Sin claves foráneas: se agregan
-- en el paso 8 para que el orden de creación no importe.
CREATE TABLE IF NOT EXISTS "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AppUser" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "googleSub" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AppUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AppSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AdminMembership" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'VIEWER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminMembership_pkey" PRIMARY KEY ("id")
);
-- El índice único se crea antes del backfill de membresías: el INSERT usa
-- ON CONFLICT ("adminUserId", "organizationId").
CREATE UNIQUE INDEX IF NOT EXISTS "AdminMembership_adminUserId_organizationId_key" ON "AdminMembership"("adminUserId", "organizationId");
CREATE INDEX IF NOT EXISTS "AdminMembership_organizationId_active_idx" ON "AdminMembership"("organizationId", "active");

CREATE TABLE IF NOT EXISTS "Client" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "ClientType" NOT NULL DEFAULT 'FINAL',
    "name" TEXT NOT NULL,
    "company" TEXT,
    "ruc" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Event" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "setupAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "strikeAt" TIMESTAMP(3),
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Budget" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "eventId" TEXT,
    "title" TEXT NOT NULL,
    "status" "CommercialStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "costEstimate" INTEGER NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BudgetItem" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "days" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL,
    "costPrice" INTEGER NOT NULL DEFAULT 0,
    "subtotal" INTEGER NOT NULL,
    "notes" TEXT,
    CONSTRAINT "BudgetItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ClientPayment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "budgetId" TEXT,
    "amount" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    CONSTRAINT "ClientPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "category" "SupplierCategory" NOT NULL DEFAULT 'OTHER',
    "paymentTerms" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupplierJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "eventId" TEXT,
    "category" "SupplierCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "advance" INTEGER NOT NULL DEFAULT 0,
    "status" "SupplierWorkStatus" NOT NULL DEFAULT 'PENDING',
    "dueAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "receipt" TEXT,
    "notes" TEXT,
    CONSTRAINT "SupplierJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "InventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sku" TEXT,
    "kind" "InventoryKind" NOT NULL DEFAULT 'REUSABLE',
    "status" "InventoryStatus" NOT NULL DEFAULT 'AVAILABLE',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "replacementCost" INTEGER NOT NULL DEFAULT 0,
    "dailyCost" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EventInventory" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "checkedOut" BOOLEAN NOT NULL DEFAULT false,
    "checkedIn" BOOLEAN NOT NULL DEFAULT false,
    "conditionOut" TEXT,
    "conditionIn" TEXT,
    CONSTRAINT "EventInventory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Promoter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "photoUrl" TEXT,
    "specialties" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Promoter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EventTask" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "promoterId" TEXT,
    "type" "EventTaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    CONSTRAINT "EventTask_pkey" PRIMARY KEY ("id")
);

-- 4. Organización por defecto -----------------------------------------------------
-- `org_ledbox` es el id estable de la empresa LedBox; el slug se usa en el seed y
-- en `DEFAULT_ORGANIZATION_SLUG`.
INSERT INTO "Organization" ("id", "name", "slug", "active", "createdAt", "updatedAt")
VALUES ('org_ledbox', 'LedBox', 'ledbox', true, now(), now())
ON CONFLICT DO NOTHING;

-- 5. Columnas multiempresa --------------------------------------------------------
-- En bases nuevas las tablas ya se crearon con `organizationId`; en la base
-- publicada se agregan acá y se completan con la organización por defecto.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "SupplierJob" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Promoter" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "QuoteRequest" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;

DO $$
DECLARE
  org_id text;
  target text;
BEGIN
  SELECT o."id" INTO org_id FROM "Organization" o
  WHERE o."slug" = 'ledbox'
  ORDER BY o."createdAt" ASC, o."id" ASC
  LIMIT 1;

  -- Fallback: primera organización existente (misma regla que el API).
  IF org_id IS NULL THEN
    SELECT o."id" INTO org_id FROM "Organization" o ORDER BY o."createdAt" ASC, o."id" ASC LIMIT 1;
  END IF;

  IF org_id IS NULL THEN
    RETURN;
  END IF;

  FOREACH target IN ARRAY ARRAY[
    'Client', 'Event', 'Budget', 'ClientPayment', 'Supplier',
    'SupplierJob', 'InventoryItem', 'Promoter', 'Lead', 'QuoteRequest'
  ]
  LOOP
    EXECUTE format('UPDATE %I SET "organizationId" = $1 WHERE "organizationId" IS NULL', target) USING org_id;
  END LOOP;
END $$;

-- Los módulos operativos no admiten filas sin empresa (Lead/QuoteRequest sí, porque
-- la captura pública puede quedar sin organización resuelta).
ALTER TABLE "Client" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Budget" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "ClientPayment" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Supplier" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "SupplierJob" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "InventoryItem" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "Promoter" ALTER COLUMN "organizationId" SET NOT NULL;

-- 6. Membresías de panel ----------------------------------------------------------
-- Los AdminUser que ya existían quedan como OWNER de la organización por defecto.
INSERT INTO "AdminMembership" ("id", "adminUserId", "organizationId", "role", "active", "createdAt", "updatedAt")
SELECT 'am_' || u."id", u."id", o."id", 'OWNER', true, now(), now()
FROM "AdminUser" u
CROSS JOIN LATERAL (
  SELECT o."id" FROM "Organization" o
  WHERE o."slug" = 'ledbox'
  ORDER BY o."createdAt" ASC, o."id" ASC
  LIMIT 1
) AS o
ON CONFLICT ("adminUserId", "organizationId") DO NOTHING;

-- 7. Empresa activa de la sesión --------------------------------------------------
ALTER TABLE "AdminSession" ADD COLUMN IF NOT EXISTS "activeOrganizationId" TEXT;

UPDATE "AdminSession" s
SET "activeOrganizationId" = (
  SELECT o."id" FROM "Organization" o
  ORDER BY (o."slug" = 'ledbox') DESC, o."createdAt" ASC, o."id" ASC
  LIMIT 1
)
WHERE s."activeOrganizationId" IS NULL;

-- 8. Índices ----------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX IF NOT EXISTS "Organization_active_createdAt_idx" ON "Organization"("active", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_email_key" ON "AppUser"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_googleSub_key" ON "AppUser"("googleSub");
CREATE INDEX IF NOT EXISTS "AppUser_active_createdAt_idx" ON "AppUser"("active", "createdAt");
CREATE INDEX IF NOT EXISTS "OrganizationMembership_userId_role_idx" ON "OrganizationMembership"("userId", "role");
CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "AppSession_tokenHash_key" ON "AppSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "AppSession_userId_expiresAt_idx" ON "AppSession"("userId", "expiresAt");
CREATE INDEX IF NOT EXISTS "AppSession_expiresAt_idx" ON "AppSession"("expiresAt");
CREATE INDEX IF NOT EXISTS "AdminSession_activeOrganizationId_idx" ON "AdminSession"("activeOrganizationId");
CREATE INDEX IF NOT EXISTS "Lead_organizationId_createdAt_idx" ON "Lead"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "QuoteRequest_organizationId_createdAt_idx" ON "QuoteRequest"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Client_type_active_idx" ON "Client"("type", "active");
CREATE INDEX IF NOT EXISTS "Client_createdAt_idx" ON "Client"("createdAt");
CREATE INDEX IF NOT EXISTS "Client_organizationId_createdAt_idx" ON "Client"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Event_startsAt_status_idx" ON "Event"("startsAt", "status");
CREATE INDEX IF NOT EXISTS "Event_clientId_createdAt_idx" ON "Event"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "Event_organizationId_startsAt_idx" ON "Event"("organizationId", "startsAt");
CREATE INDEX IF NOT EXISTS "Budget_status_createdAt_idx" ON "Budget"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Budget_organizationId_createdAt_idx" ON "Budget"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "BudgetItem_budgetId_idx" ON "BudgetItem"("budgetId");
CREATE INDEX IF NOT EXISTS "ClientPayment_clientId_paidAt_idx" ON "ClientPayment"("clientId", "paidAt");
CREATE INDEX IF NOT EXISTS "ClientPayment_organizationId_paidAt_idx" ON "ClientPayment"("organizationId", "paidAt");
CREATE INDEX IF NOT EXISTS "Supplier_category_active_idx" ON "Supplier"("category", "active");
CREATE INDEX IF NOT EXISTS "Supplier_organizationId_name_idx" ON "Supplier"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "SupplierJob_status_dueAt_idx" ON "SupplierJob"("status", "dueAt");
CREATE INDEX IF NOT EXISTS "SupplierJob_eventId_idx" ON "SupplierJob"("eventId");
CREATE INDEX IF NOT EXISTS "SupplierJob_organizationId_dueAt_idx" ON "SupplierJob"("organizationId", "dueAt");
CREATE INDEX IF NOT EXISTS "InventoryItem_status_category_idx" ON "InventoryItem"("status", "category");
CREATE INDEX IF NOT EXISTS "InventoryItem_organizationId_name_idx" ON "InventoryItem"("organizationId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "EventInventory_eventId_inventoryId_key" ON "EventInventory"("eventId", "inventoryId");
CREATE INDEX IF NOT EXISTS "Promoter_active_name_idx" ON "Promoter"("active", "name");
CREATE INDEX IF NOT EXISTS "Promoter_organizationId_name_idx" ON "Promoter"("organizationId", "name");
CREATE INDEX IF NOT EXISTS "EventTask_dueAt_completedAt_idx" ON "EventTask"("dueAt", "completedAt");

-- El SKU pasa a ser único por empresa (antes era global).
DROP INDEX IF EXISTS "InventoryItem_sku_key";
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_organizationId_sku_key" ON "InventoryItem"("organizationId", "sku");

-- 9. Claves foráneas --------------------------------------------------------------
DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('OrganizationMembership', 'OrganizationMembership_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('OrganizationMembership', 'OrganizationMembership_userId_fkey', 'FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('AppSession', 'AppSession_userId_fkey', 'FOREIGN KEY ("userId") REFERENCES "AppUser"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('AdminMembership', 'AdminMembership_adminUserId_fkey', 'FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('AdminMembership', 'AdminMembership_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('AdminSession', 'AdminSession_activeOrganizationId_fkey', 'FOREIGN KEY ("activeOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
      ('Lead', 'Lead_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
      ('QuoteRequest', 'QuoteRequest_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
      ('Client', 'Client_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('Event', 'Event_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('Event', 'Event_clientId_fkey', 'FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('Budget', 'Budget_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('Budget', 'Budget_clientId_fkey', 'FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('Budget', 'Budget_eventId_fkey', 'FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
      ('BudgetItem', 'BudgetItem_budgetId_fkey', 'FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('ClientPayment', 'ClientPayment_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('ClientPayment', 'ClientPayment_clientId_fkey', 'FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('ClientPayment', 'ClientPayment_budgetId_fkey', 'FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
      ('Supplier', 'Supplier_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('SupplierJob', 'SupplierJob_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('SupplierJob', 'SupplierJob_supplierId_fkey', 'FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('SupplierJob', 'SupplierJob_eventId_fkey', 'FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE'),
      ('InventoryItem', 'InventoryItem_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('EventInventory', 'EventInventory_eventId_fkey', 'FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('EventInventory', 'EventInventory_inventoryId_fkey', 'FOREIGN KEY ("inventoryId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('Promoter', 'Promoter_organizationId_fkey', 'FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('EventTask', 'EventTask_eventId_fkey', 'FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE'),
      ('EventTask', 'EventTask_promoterId_fkey', 'FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE')
    ) AS t(table_name, constraint_name, definition)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conname = spec.constraint_name
        AND c.conrelid = to_regclass(format('%I', spec.table_name))
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', spec.table_name, spec.constraint_name, spec.definition);
    END IF;
  END LOOP;
END $$;
