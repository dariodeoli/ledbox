-- Invitaciones al equipo (issue #31): fila por correo + empresa con el token
-- del link, el rol, quién invita, el vencimiento y el estado real.
--
-- Aditiva, idempotente y re-ejecutable: crea el enum, la tabla, sus índices y la
-- clave foránea con IF NOT EXISTS / duplicate_object, así se puede correr dos
-- veces sin efectos. No toca ninguna tabla ni dato existente.
--
-- Una sola invitación por correo + empresa: el índice único
-- (`TeamInvitation_organizationId_email_key`) es el candado del flujo; reenviar
-- o volver a invitar **actualiza** esa fila (token nuevo, vencimiento extendido
-- y estado `pending`) en lugar de acumular registros.
--
-- El token plano del link nunca se guarda: `tokenHash` es su SHA-256 (mismo
-- criterio que los tokens de reset y el código del portal).

DO $$ BEGIN
  CREATE TYPE "TeamInvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "TeamInvitation" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "role"           "AdminRole" NOT NULL DEFAULT 'VIEWER',
  "tokenHash"      TEXT NOT NULL,
  "status"         "TeamInvitationStatus" NOT NULL DEFAULT 'pending',
  "invitedById"    TEXT,
  "invitedByName"  TEXT NOT NULL,
  "invitedByEmail" TEXT,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "lastSentAt"     TIMESTAMP(3),
  "sentCount"      INTEGER NOT NULL DEFAULT 0,
  "acceptedAt"     TIMESTAMP(3),
  "acceptedById"   TEXT,
  "acceptedByName" TEXT,
  "revokedAt"      TIMESTAMP(3),
  "revokedByName"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TeamInvitation_tokenHash_key"
  ON "TeamInvitation"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "TeamInvitation_organizationId_email_key"
  ON "TeamInvitation"("organizationId", "email");
CREATE INDEX IF NOT EXISTS "TeamInvitation_organizationId_status_expiresAt_idx"
  ON "TeamInvitation"("organizationId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "TeamInvitation_email_idx"
  ON "TeamInvitation"("email");

DO $$ BEGIN
  ALTER TABLE "TeamInvitation"
    ADD CONSTRAINT "TeamInvitation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
