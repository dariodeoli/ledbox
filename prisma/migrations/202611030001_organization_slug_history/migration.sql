-- Aditiva: no cambia identificadores, IDs, tokens, datos ni relaciones existentes.
CREATE TABLE "OrganizationSlug" (
  "slug" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationSlug_pkey" PRIMARY KEY ("slug")
);
CREATE INDEX "OrganizationSlug_organizationId_idx" ON "OrganizationSlug"("organizationId");
-- Se conserva propietario aun tras eliminar una empresa: no hay FK ON DELETE CASCADE.
INSERT INTO "OrganizationSlug" ("slug", "organizationId") SELECT "slug", "id" FROM "Organization";

-- La lectura/guarda tolera identificadores históricos con mayúsculas.
CREATE INDEX "OrganizationSlug_slug_lower_idx" ON "OrganizationSlug" (lower("slug"));
CREATE INDEX "Organization_slug_lower_idx" ON "Organization" (lower("slug"));
