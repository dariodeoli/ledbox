-- Aditiva: la libreta no depende de la vida del evento y no modifica sus snapshots.
CREATE TABLE "EventVenue" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "city" TEXT,
  "department" TEXT,
  "address" TEXT,
  "addressReference" TEXT,
  "locationUrl" TEXT,
  "venueContactName" TEXT,
  "venueContactPhone" TEXT,
  "venueContactEmail" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "needsReview" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventVenue_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventVenue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EventVenue_organizationId_key_key" ON "EventVenue"("organizationId", "key");
CREATE INDEX "EventVenue_organizationId_location_idx" ON "EventVenue"("organizationId", "location");
-- Misma clase Unicode de espacios que JS /\s/; conserva tildes, sólo colapsa espacios/mayúsculas.
-- Una ficha completa de la última edición viva, sin combinar contactos de eventos distintos.
WITH source AS (
  SELECT e.*, lower(btrim(regexp_replace(e."location", U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g'))) AS venue_key
  FROM "Event" e WHERE e."deletedAt" IS NULL AND e."location" IS NOT NULL
), latest AS (
  SELECT DISTINCT ON ("organizationId", venue_key) * FROM source WHERE venue_key <> ''
  ORDER BY "organizationId", venue_key, "updatedAt" DESC, "id" ASC
), contact AS (
  SELECT DISTINCT ON ("organizationId", venue_key) * FROM source
  WHERE venue_key <> '' AND (nullif(btrim("venueContactName"), '') IS NOT NULL OR nullif(btrim("venueContactPhone"), '') IS NOT NULL OR nullif(btrim("venueContactEmail"), '') IS NOT NULL)
  ORDER BY "organizationId", venue_key,
    (nullif(btrim("venueContactName"), '') IS NOT NULL AND (nullif(btrim("venueContactPhone"), '') IS NOT NULL OR nullif(btrim("venueContactEmail"), '') IS NOT NULL)) DESC,
    "updatedAt" DESC, "id" ASC
), chosen AS (
  SELECT l."organizationId", l.venue_key,
    CASE WHEN coalesce(nullif(btrim(l."venueContactName"), ''), nullif(btrim(l."venueContactPhone"), ''), nullif(btrim(l."venueContactEmail"), '')) IS NULL THEN coalesce(c."id", l."id") ELSE l."id" END AS chosen_id,
    l."id" AS latest_id
  FROM latest l LEFT JOIN contact c ON c."organizationId" = l."organizationId" AND c.venue_key = l.venue_key
)
INSERT INTO "EventVenue" ("id", "organizationId", "key", "location", "city", "department", "address", "addressReference", "locationUrl", "venueContactName", "venueContactPhone", "venueContactEmail", "needsReview")
SELECT 'venue_' || md5(e."organizationId" || ':' || e.venue_key), e."organizationId", e.venue_key,
  btrim(regexp_replace(e."location", U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')),
  e."city", e."department", e."address", e."addressReference", e."locationUrl", e."venueContactName", e."venueContactPhone", e."venueContactEmail", e."id" <> c.latest_id
FROM chosen c JOIN source e ON e."id" = c.chosen_id
ON CONFLICT ("organizationId", "key") DO NOTHING;
