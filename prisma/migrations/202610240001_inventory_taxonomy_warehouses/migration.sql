-- Inventario para catálogos grandes (rediseño E1): categorías de dos niveles,
-- depósitos con ubicación por unidad, condición 1-10, y proveedor/compra/garantía.
--
-- Aditiva, idempotente y re-ejecutable: tablas e índices con IF NOT EXISTS,
-- columnas con ADD COLUMN IF NOT EXISTS, FKs y CHECK con guarda duplicate_object y
-- backfills con ids determinísticos + ON CONFLICT DO NOTHING / «solo si es NULL».
-- El texto `InventoryItem.category` queda como espejo de la categoría en el formato único
-- «Padre › Hija» (al final del backfill se normaliza, para que no convivan dos formatos).
-- La normalización de `key` replica `categoryKey` de `lib/inventory-categories.ts`
-- (NFD sin marcas combinantes, espacios colapsados, minúsculas) con `normalize(…, NFD)` de
-- Postgres 13+, así cubre todos los acentos latinos igual que el runtime; si cambia, actualizá
-- los dos (lo comprueba tests/inventario-fix120.pg.test.ts).

CREATE TABLE IF NOT EXISTS "InventoryCategory" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "parentId"       TEXT,
  "key"            TEXT NOT NULL,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "color"          TEXT,
  "icon"           TEXT,
  "archivedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryCategory_organizationId_key_key" ON "InventoryCategory"("organizationId", "key");
CREATE INDEX IF NOT EXISTS "InventoryCategory_organizationId_parentId_idx" ON "InventoryCategory"("organizationId", "parentId");

CREATE TABLE IF NOT EXISTS "Warehouse" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "address"        TEXT,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "isDefault"      BOOLEAN NOT NULL DEFAULT false,
  "archivedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_organizationId_code_key" ON "Warehouse"("organizationId", "code");
-- Un solo depósito principal por empresa.
CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_one_default_per_org" ON "Warehouse"("organizationId") WHERE "isDefault";

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "defaultWarehouseId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "defaultLocation" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "purchasedAt" TIMESTAMP(3);
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "warrantyUntil" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "InventoryItem_organizationId_categoryId_idx" ON "InventoryItem"("organizationId", "categoryId");

ALTER TABLE "InventoryUnit" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;
ALTER TABLE "InventoryUnit" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "InventoryUnit" ADD COLUMN IF NOT EXISTS "conditionScore" SMALLINT;
ALTER TABLE "InventoryUnit" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;
ALTER TABLE "InventoryUnit" ADD COLUMN IF NOT EXISTS "purchasedAt" TIMESTAMP(3);
ALTER TABLE "InventoryUnit" ADD COLUMN IF NOT EXISTS "warrantyUntil" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "InventoryUnit_inventoryId_warehouseId_status_idx" ON "InventoryUnit"("inventoryId", "warehouseId", "status");

DO $$ BEGIN
  ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_conditionScore_range"
    CHECK ("conditionScore" IS NULL OR ("conditionScore" >= 1 AND "conditionScore" <= 10));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryCategory" ADD CONSTRAINT "InventoryCategory_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "InventoryCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "InventoryCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_defaultWarehouseId_fkey"
    FOREIGN KEY ("defaultWarehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryUnit" ADD CONSTRAINT "InventoryUnit_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Clave de categoría igual a `categoryKey` del runtime (NFD sin marcas combinantes, espacios colapsados,
-- minúsculas). `normalize` existe desde PostgreSQL 13 y solo con codificación UTF8: si la base es más vieja,
-- se usa un `translate` equivalente para los acentos latinos, así la migración nunca falla al publicar.
DO $ledbox_key$
BEGIN
  IF current_setting('server_version_num')::int >= 130000 AND current_setting('server_encoding') = 'UTF8' THEN
    EXECUTE $f$CREATE OR REPLACE FUNCTION pg_temp.ledbox_cat_key(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $b$
      SELECT lower(btrim(regexp_replace(regexp_replace(normalize(t, NFD), '[\u0300-\u036f]', '', 'g'), '\s+', ' ', 'g')))
    $b$ $f$;
  ELSE
    EXECUTE $f$CREATE OR REPLACE FUNCTION pg_temp.ledbox_cat_key(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $b$
      SELECT lower(btrim(regexp_replace(translate(t, 'áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ', 'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'), '\s+', ' ', 'g')))
    $b$ $f$;
  END IF;
END $ledbox_key$;

-- Backfill de categorías: una por (empresa, texto distinto). «Vajilla > Copas»,
-- «Vajilla / Copas» o «Vajilla › Copas» crean padre e hija; «Vajilla» y «vajilla »
-- caen en la misma key. Ids determinísticos: correrlo de nuevo no duplica nada.
DO $$
BEGIN
  DROP TABLE IF EXISTS _inv_cat_src;
  CREATE TEMP TABLE _inv_cat_src AS
  WITH src AS (
    SELECT DISTINCT "organizationId" AS org, COALESCE(NULLIF(btrim("category"), ''), 'General') AS raw
    FROM "InventoryItem"
  ),
  segs AS (
    SELECT org, raw,
      ARRAY(
        SELECT btrim(x) FROM unnest(regexp_split_to_array(raw, '\s*(?:›|>|/)\s*')) AS x WHERE btrim(x) <> ''
      ) AS parts
    FROM src
  ),
  named AS (
    SELECT org, raw,
      left(parts[1], 60) AS parent_name,
      CASE WHEN array_length(parts, 1) >= 2 THEN left(array_to_string(parts[2:array_length(parts, 1)], ' - '), 60) END AS child_name
    FROM segs WHERE array_length(parts, 1) >= 1
  )
  SELECT org, raw, parent_name, child_name,
    pg_temp.ledbox_cat_key(parent_name) AS parent_key,
    CASE WHEN child_name IS NOT NULL THEN pg_temp.ledbox_cat_key(child_name) END AS child_key
  FROM named;

  INSERT INTO "InventoryCategory" ("id", "organizationId", "name", "parentId", "key", "sortOrder", "createdAt", "updatedAt")
  SELECT DISTINCT ON (s.org, s.parent_key)
    'cat_' || md5(s.org || s.parent_key), s.org, s.parent_name, NULL, s.parent_key, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM _inv_cat_src s
  ORDER BY s.org, s.parent_key, s.parent_name
  ON CONFLICT DO NOTHING;

  INSERT INTO "InventoryCategory" ("id", "organizationId", "name", "parentId", "key", "sortOrder", "createdAt", "updatedAt")
  SELECT DISTINCT ON (s.org, s.parent_key, s.child_key)
    'cat_' || md5(s.org || s.parent_key || '/' || s.child_key), s.org, s.child_name, p."id",
    s.parent_key || '/' || s.child_key, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM _inv_cat_src s
  JOIN "InventoryCategory" p ON p."organizationId" = s.org AND p."key" = s.parent_key AND p."parentId" IS NULL
  WHERE s.child_key IS NOT NULL AND s.child_key <> ''
  ORDER BY s.org, s.parent_key, s.child_key, s.child_name
  ON CONFLICT DO NOTHING;

  UPDATE "InventoryItem" i
  SET "categoryId" = c."id"
  FROM _inv_cat_src s
  JOIN "InventoryCategory" c ON c."organizationId" = s.org
    AND c."key" = CASE WHEN s.child_key IS NOT NULL AND s.child_key <> '' THEN s.parent_key || '/' || s.child_key ELSE s.parent_key END
  WHERE i."categoryId" IS NULL
    AND i."organizationId" = s.org
    AND COALESCE(NULLIF(btrim(i."category"), ''), 'General') = s.raw;

  DROP TABLE IF EXISTS _inv_cat_src;
END $$;

-- Texto espejo único «Padre › Hija»: todo producto con categoría pasa a ese formato
-- (idempotente: solo toca las filas que difieren).
UPDATE "InventoryItem" i
SET "category" = CASE WHEN p."id" IS NULL THEN c."name" ELSE p."name" || ' › ' || c."name" END
FROM "InventoryCategory" c
LEFT JOIN "InventoryCategory" p ON p."id" = c."parentId"
WHERE i."categoryId" = c."id"
  AND i."category" IS DISTINCT FROM (CASE WHEN p."id" IS NULL THEN c."name" ELSE p."name" || ' › ' || c."name" END);

-- Backfill de depósitos: «Depósito principal · D1» solo en empresas con unidades, y
-- todas sus unidades sin depósito quedan ahí. Los depósitos nuevos los crea el API.
INSERT INTO "Warehouse" ("id", "organizationId", "name", "code", "sortOrder", "isDefault", "createdAt", "updatedAt")
SELECT DISTINCT 'wh_' || md5(u."organizationId"), u."organizationId", 'Depósito principal', 'D1', 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "InventoryUnit" u
WHERE NOT EXISTS (SELECT 1 FROM "Warehouse" w WHERE w."organizationId" = u."organizationId" AND w."isDefault")
ON CONFLICT DO NOTHING;

UPDATE "InventoryUnit" u
SET "warehouseId" = w."id"
FROM "Warehouse" w
WHERE u."warehouseId" IS NULL AND w."organizationId" = u."organizationId" AND w."isDefault";
