-- Primera vista del portal (issue #33): `Budget.viewedAt` sella cuándo el
-- cliente abrió el link del presupuesto por primera vez.
--
-- Aditiva, idempotente y re-ejecutable (`ADD COLUMN IF NOT EXISTS`): no toca
-- ninguna tabla ni dato existente. Los presupuestos ya abiertos quedan con
-- `viewedAt` nulo hasta la próxima apertura; el hito nunca se inventa.

ALTER TABLE "Budget" ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMP(3);
