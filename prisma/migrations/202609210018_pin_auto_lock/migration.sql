-- PIN de desbloqueo y auto-bloqueo por inactividad del panel (issue #21).
--
-- Aditiva, idempotente y re-ejecutable: agrega columnas con `IF NOT EXISTS` y
-- defaults para las filas que ya existen, así se puede correr dos veces sin
-- efectos y nadie queda bloqueado por la migración.
--
-- El PIN se guarda **hasheado con bcrypt** (`pinHash`), nunca en claro; el
-- auto-bloqueo es una preferencia por usuario (`autoLockEnabled` /
-- `autoLockMinutes`, default 10 minutos) y el estado del bloqueo vive en la
-- sesión (`lockedAt` / `lockAttempts`), no en el usuario: cada sesión se
-- desbloquea con su propio PIN y a los 5 fallidos se revoca y exige login.

ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "pinHash" TEXT;
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "pinUpdatedAt" TIMESTAMP(3);
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "autoLockEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "autoLockMinutes" INTEGER NOT NULL DEFAULT 10;

ALTER TABLE "AdminSession" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
ALTER TABLE "AdminSession" ADD COLUMN IF NOT EXISTS "lockAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdminSession" ADD COLUMN IF NOT EXISTS "lockReason" TEXT;
