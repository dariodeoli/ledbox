-- Precio por evento (alquileres P1-1): cada producto declara si se cobra por día
-- (DAILY, el comportamiento de siempre) o una sola vez por evento (EVENT).
--
-- Aditiva, idempotente y re-ejecutable: el tipo `BillingUnit` ya existe desde la
-- migración inicial; la columna se agrega con IF NOT EXISTS y DEFAULT 'DAILY', así
-- que todas las filas viejas conservan su cálculo por días y los presupuestos ya
-- aprobados no cambian (sus ítems guardan su propio snapshot de días y precio).

ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "billingUnit" "BillingUnit" NOT NULL DEFAULT 'DAILY';
