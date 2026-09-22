-- Alerta de operación por correo (issue #43): el aviso de respaldo de la base
-- vencido o fallido viaja por el mailer único y queda en el historial de correo.
-- Aditiva e idempotente: agrega un valor al enum sin tocar los existentes.
ALTER TYPE "MailCategory" ADD VALUE IF NOT EXISTS 'alert';
