-- Planes vendibles por empresa (issue #42): catálogo de planes con límites de
-- usuarios y de eventos creados por mes, precio mensual en guaraníes y orden de
-- exhibición; más el plan vigente de cada empresa.
--
-- Aditiva, idempotente y re-ejecutable:
--  * crea la tabla `Plan` solo si falta (IF NOT EXISTS) y su catálogo con
--    `ON CONFLICT DO NOTHING` (no pisa precios ni límites ya ajustados);
--  * agrega `Organization.planId`/`planStartedAt` solo si faltan y hace backfill
--    al plan por defecto únicamente donde `planId` es NULL (las empresas que ya
--    tienen plan no se tocan);
--  * los límites solo frenan altas nuevas: ningún dato existente se oculta ni se
--    borra, y los usuarios/eventos ya cargados quedan como están.
--
-- `priceMonthly` es Int PYG (sin decimales); un límite NULL significa sin tope.
-- Misma lista de planes que `PLAN_CATALOG` en `lib/plan-rules.ts` y el seed: si
-- cambia, actualizá las tres.

CREATE TABLE IF NOT EXISTS "Plan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxUsers" INTEGER,
    "maxEventsPerMonth" INTEGER,
    "priceMonthly" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Plan_code_key" ON "Plan"("code");
CREATE INDEX IF NOT EXISTS "Plan_active_sortOrder_idx" ON "Plan"("active", "sortOrder");

-- Catálogo de arranque. `Inicial` es el plan por defecto de toda empresa sin
-- plan (incluido el backfill de abajo): 5 usuarios y 50 eventos por mes.
INSERT INTO "Plan" ("id", "code", "name", "description", "maxUsers", "maxEventsPerMonth", "priceMonthly", "features", "sortOrder", "active", "createdAt", "updatedAt")
VALUES
  (
    'plan_inicial',
    'inicial',
    'Inicial',
    'Para empezar a ordenar la operación de una empresa.',
    5,
    50,
    0,
    '["Eventos, calendario y checklist","Clientes, leads y presupuestos","Portal del cliente y cobros","Hasta 5 usuarios y 50 eventos por mes"]'::jsonb,
    10,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'plan_negocio',
    'negocio',
    'Negocio',
    'Operación completa: agenda, finanzas, inventario y equipo.',
    10,
    100,
    450000,
    '["Todo lo del plan Inicial","Inventario, proveedores y promotoras","Tesorería, gastos y cobranzas","Hasta 10 usuarios y 100 eventos por mes"]'::jsonb,
    20,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'plan_pro',
    'pro',
    'Pro',
    'Para productoras y alquileres con equipo grande y varias marcas.',
    20,
    200,
    890000,
    '["Todo lo del plan Negocio","Exportaciones y reportes imprimibles","Auditoría e historial completo","Hasta 20 usuarios y 200 eventos por mes"]'::jsonb,
    30,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'plan_corporativo',
    'corporativo',
    'Corporativo',
    'Sin límites de usuarios ni de eventos, con acompañamiento dedicado.',
    NULL,
    NULL,
    1900000,
    '["Todo lo del plan Pro","Sin límite de usuarios","Sin límite de eventos por mes","Acompañamiento dedicado"]'::jsonb,
    40,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT DO NOTHING;

-- Plan vigente de cada empresa. `planStartedAt` arranca con la fecha de alta de
-- la empresa (el backfill no inventa un inicio nuevo).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "planId" TEXT;
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "planStartedAt" TIMESTAMP(3);

UPDATE "Organization"
SET
  "planId" = 'plan_inicial',
  "planStartedAt" = COALESCE("planStartedAt", "createdAt")
WHERE "planId" IS NULL;

CREATE INDEX IF NOT EXISTS "Organization_planId_idx" ON "Organization"("planId");

DO $$ BEGIN
  ALTER TABLE "Organization"
    ADD CONSTRAINT "Organization_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
