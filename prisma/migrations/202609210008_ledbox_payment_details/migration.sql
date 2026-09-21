-- Datos de pago de la empresa LedBox (provisión inicial del 21-09-2026).
--
-- Se cargan una sola vez, y solo si la empresa todavía no tiene ninguno: si el
-- equipo los edita desde el panel (Presupuestos → datos de pago), esta
-- migración no los pisa, ni siquiera si se vuelve a ejecutar a mano.
--
-- Forma del JSON (la misma que valida la API): { bank, holder, ruc, account, alias }.

UPDATE "Organization"
SET "paymentDetails" = jsonb_build_object(
  'bank', 'Ueno Bank',
  'holder', 'Santiago Javier Rodas',
  'ruc', NULL,
  'account', '6191649354',
  'alias', 'c.i +595 982 029217'
)
WHERE "slug" = 'ledbox'
  AND "paymentDetails" IS NULL;
