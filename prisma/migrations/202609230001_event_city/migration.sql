-- Ciudad del evento (issue #48).
--
-- Aditiva, idempotente y re-ejecutable (`ADD COLUMN IF NOT EXISTS`): agrega
-- `Event.city` solo si falta y no toca ningún dato existente. «Lugar»
-- (`location`) sigue siendo el venue; la ciudad es un dato aparte, opcional y
-- con sugerencias del catálogo compartido de owncoding-ui (`CIUDADES_PARAGUAY`).
-- Se permite texto libre: no hay validación contra el catálogo y los eventos ya
-- cargados quedan con la ciudad en nulo.

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "city" TEXT;
