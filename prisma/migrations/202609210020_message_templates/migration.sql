-- Plantillas de mensajes de WhatsApp por contexto (issue #35): tabla por
-- empresa con categoría (`budget` · `client` · `event` · `collection` ·
-- `other`), título, cuerpo con variables `{{...}}`, estado `active` y orden.
--
-- Aditiva, idempotente y re-ejecutable: crea el enum, la tabla, sus índices y la
-- clave foránea con IF NOT EXISTS / duplicate_object, y la provisión de arranque
-- usa un guardián `NOT EXISTS` con ids estables, así correrla dos veces no
-- duplica nada ni pisa lo que el equipo haya editado.
--
-- El índice único (`organizationId`, `category`, `title`) evita dos plantillas
-- con el mismo título en la misma categoría y es el candado de la semilla.
-- El cuerpo se renderiza desde una sola fuente (`lib/server/message-templates.ts`).

DO $$ BEGIN
  CREATE TYPE "MessageTemplateCategory" AS ENUM ('budget', 'client', 'event', 'collection', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "MessageTemplate" (
  "id"             TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "category"       "MessageTemplateCategory" NOT NULL,
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "createdById"    TEXT,
  "createdByName"  TEXT,
  "updatedById"    TEXT,
  "updatedByName"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MessageTemplate_organizationId_category_title_key"
  ON "MessageTemplate"("organizationId", "category", "title");
CREATE INDEX IF NOT EXISTS "MessageTemplate_organizationId_category_sortOrder_idx"
  ON "MessageTemplate"("organizationId", "category", "sortOrder");
CREATE INDEX IF NOT EXISTS "MessageTemplate_organizationId_active_idx"
  ON "MessageTemplate"("organizationId", "active");

DO $$ BEGIN
  ALTER TABLE "MessageTemplate"
    ADD CONSTRAINT "MessageTemplate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Provisión de arranque (issue #35): plantillas útiles de LedBox para cada
-- empresa que todavía no tenga ninguna. Una sola sentencia con guardián
-- `NOT EXISTS` e ids estables (`<org>_tpl_<clave>`): la re-ejecución es un no-op
-- y una empresa que ya usa plantillas no recibe filas nuevas.
--
-- Misma lista que `DEFAULT_MESSAGE_TEMPLATES` en `lib/server/message-templates.ts`
-- (y el seed): si cambia, actualizá las tres.
INSERT INTO "MessageTemplate"
  ("id", "organizationId", "category", "title", "body", "active", "sortOrder", "createdAt", "updatedAt")
SELECT
  o."id" || '_tpl_' || seed."suffix",
  o."id",
  seed."category"::"MessageTemplateCategory",
  seed."title",
  seed."body",
  true,
  seed."sortOrder",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (
  VALUES
    (
      'budget_presupuesto_enviado',
      'budget',
      'Presupuesto enviado',
      E'Hola {{cliente}}: te compartimos el presupuesto «{{presupuesto}}» de {{empresa}}.\n\n• Total: {{monto}}\n• Validez: hasta el {{vencimiento}}\n• Detalle y aprobación en el portal: {{link_portal}}\n\nCualquier consulta quedo a disposición.\n{{vendedor}}',
      10
    ),
    (
      'budget_seguimiento',
      'budget',
      'Seguimiento de presupuesto',
      E'Hola {{cliente}}: ¿cómo estás? Te escribo de {{empresa}} para saber si pudiste revisar el presupuesto «{{presupuesto}}» por {{monto}}.\n\nSi querés, ajustamos ítems, fechas o forma de pago.\n{{vendedor}}',
      20
    ),
    (
      'client_bienvenida',
      'client',
      'Bienvenida a cliente nuevo',
      E'Hola {{cliente}}: ¡gracias por elegir a {{empresa}}! Soy {{vendedor}} y quedo a disposición para lo que necesites.',
      10
    ),
    (
      'client_factura',
      'client',
      'Datos para factura',
      E'Hola {{cliente}}: para dejar lista la factura necesitamos tu RUC o cédula y la razón social. Podés respondernos por acá.\n{{vendedor}} · {{empresa}}',
      20
    ),
    (
      'event_confirmado',
      'event',
      'Evento confirmado',
      E'Hola {{cliente}}: te confirmamos el evento «{{evento}}» de {{empresa}}.\n\n• Fecha: {{fecha}}\n• Lugar: {{lugar}}\n\nNos vemos ahí.\n{{vendedor}}',
      10
    ),
    (
      'event_recordatorio',
      'event',
      'Recordatorio de evento',
      E'Hola {{cliente}}: te recordamos que «{{evento}}» es el {{fecha}} en {{lugar}}. Nuestro equipo llega con antelación para el montaje.\n\n¡Nos vemos!\n{{vendedor}}',
      20
    ),
    (
      'event_agradecimiento',
      'event',
      'Agradecimiento post-evento',
      E'Hola {{cliente}}: ¡gracias por confiar en {{empresa}} para «{{evento}}»! Fue un gusto acompañarlos.\n\nPara tu próximo evento, escribinos.\n{{vendedor}}',
      30
    ),
    (
      'collection_recordatorio',
      'collection',
      'Recordatorio de pago',
      E'Hola {{cliente}}: te recordamos el pago pendiente con {{empresa}}.\n\n• Monto: {{monto}}\n• Vencimiento: {{vencimiento}}\n• Presupuesto: {{presupuesto}}\n\nSi ya abonaste, ignorá este mensaje.\n{{vendedor}}',
      10
    ),
    (
      'collection_recordatorio_link',
      'collection',
      'Recordatorio de pago con link',
      E'Hola {{cliente}}: te recordamos el pago pendiente de «{{presupuesto}}».\n\n• Monto: {{monto}}\n• Saldo del presupuesto: {{saldo}}\n• Vencimiento: {{vencimiento}}\n\nPodés ver el detalle y los datos de pago en el portal: {{link_portal}}\n\nSi ya abonaste, ignorá este mensaje.\n{{vendedor}}',
      20
    ),
    (
      'collection_pago_recibido',
      'collection',
      'Pago recibido',
      E'Hola {{cliente}}: ¡gracias! Registramos tu pago de {{monto}} correspondiente a «{{presupuesto}}». Cualquier duda quedo a disposición.\n{{vendedor}} · {{empresa}}',
      30
    ),
    (
      'other_general',
      'other',
      'Mensaje general',
      E'Hola {{cliente}}: te escribimos de {{empresa}}. Contanos en qué te podemos ayudar.\n{{vendedor}}',
      10
    )
) AS seed("suffix", "category", "title", "body", "sortOrder")
WHERE NOT EXISTS (
  SELECT 1 FROM "MessageTemplate" m WHERE m."organizationId" = o."id"
)
ON CONFLICT ("id") DO NOTHING;
