-- Notas internas del lead (pipeline comercial del panel).
--
-- Aditiva, idempotente y re-ejecutable: agrega una columna nueva sin tocar los
-- datos existentes. El `message` que escribe el sitio público se conserva tal
-- cual; las notas del equipo viven aparte para no pisarlo.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "internalNotes" TEXT;
