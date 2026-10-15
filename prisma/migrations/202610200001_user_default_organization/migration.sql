-- Empresa predeterminada del usuario (Mi perfil). Aditiva e idempotente; sin FK (se valida en código).
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "defaultOrganizationId" TEXT;
