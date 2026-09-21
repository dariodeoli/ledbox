-- Perfil propio y marca de la empresa (issue #22): avatar del usuario del panel
-- y logo de la empresa por tema.
--
-- Aditiva, idempotente y re-ejecutable: crea el enum, las tablas, sus índices y
-- claves foráneas solo si faltan, así se puede correr dos veces sin efectos. Los
-- binarios viven en la base (`data` bytea) como los comprobantes de pago y se
-- sirven únicamente con sesión del panel: nunca se exponen en el sitio público.
-- Sin datos previos: los usuarios sin avatar y las empresas sin logo siguen con
-- las iniciales / el monograma `LB`.

DO $$ BEGIN
  CREATE TYPE "OrganizationLogoVariant" AS ENUM ('light', 'dark');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Un avatar por usuario (el binario ya viene recortado y comprimido a ≤1 MB).
CREATE TABLE IF NOT EXISTS "AdminUserAvatar" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminUserAvatar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminUserAvatar_userId_key" ON "AdminUserAvatar"("userId");

-- Un logo por empresa y variante (claro/oscuro).
CREATE TABLE IF NOT EXISTS "OrganizationLogo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "variant" "OrganizationLogoVariant" NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationLogo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationLogo_organizationId_variant_key"
  ON "OrganizationLogo"("organizationId", "variant");

DO $$ BEGIN
  ALTER TABLE "AdminUserAvatar"
    ADD CONSTRAINT "AdminUserAvatar_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "OrganizationLogo"
    ADD CONSTRAINT "OrganizationLogo_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
