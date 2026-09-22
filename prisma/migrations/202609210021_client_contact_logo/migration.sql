-- Datos completos del cliente (issue #36): persona encargada, links directos y
-- logo propio.
--
-- Aditiva, idempotente y re-ejecutable (`ADD COLUMN IF NOT EXISTS` y
-- `CREATE TABLE/INDEX IF NOT EXISTS` con `duplicate_object` para la clave
-- foránea): no toca ninguna tabla ni dato existente. Los clientes que ya están
-- quedan con los campos nuevos en nulo y sin logo: la ficha sigue mostrando el
-- monograma de iniciales y no se completa ningún dato que falte.

ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "contactName" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "contactRole" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "website" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "instagram" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;

-- Logo del cliente: una fila por cliente, con el binario ya recortado y
-- comprimido a ≤1 MB por el navegador (`lib/identity-image.ts`).
CREATE TABLE IF NOT EXISTS "ClientLogo" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientLogo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClientLogo_clientId_key" ON "ClientLogo"("clientId");

DO $$ BEGIN
  ALTER TABLE "ClientLogo"
    ADD CONSTRAINT "ClientLogo_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
