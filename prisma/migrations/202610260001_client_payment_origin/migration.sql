-- Origen del cobro (alquileres P1-4): separa lo que NO baja el saldo del alquiler.
-- Aditiva e idempotente. Los cobros de «Garantía retenida» ya creados se marcan por su método.
ALTER TABLE "ClientPayment" ADD COLUMN IF NOT EXISTS "origin" TEXT;

UPDATE "ClientPayment"
SET "origin" = 'deposit_retained'
WHERE "origin" IS NULL AND "method" = 'Garantía retenida' AND "budgetId" IS NOT NULL;

UPDATE "ClientPayment" cp
SET "origin" = 'rental_extra'
FROM "ExpectedPayment" ep
WHERE cp."origin" IS NULL AND cp."expectedPaymentId" = ep."id" AND ep."concept" = 'extra';

UPDATE "ClientPayment"
SET "origin" = 'deposit_reserve'
WHERE "origin" IS NULL AND "method" = 'Garantía de reserva' AND "budgetId" IS NOT NULL;
