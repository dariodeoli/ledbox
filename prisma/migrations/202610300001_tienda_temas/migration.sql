-- Tienda: sistema de 4 temas (Lienzo, Boutique, Noir y Studio). Migración de datos de la plantilla elegida.
--
-- Aditiva, idempotente y re-ejecutable: solo reescribe la clave "template" del JSON "Organization"."appearance"
-- cuando trae un valor de una versión anterior. No toca ninguna otra clave ni ninguna otra fila, y "boutique" (que
-- se llama igual en el sistema nuevo) queda como está. Una segunda corrida no encuentra nada que cambiar.
-- Mapa (docs/TIENDA-PLANTILLAS.md): minimal, clasica, minimalista -> lienzo; boutique, editorial, elegante -> boutique;
-- noche, tecnologica, oscura -> noir; fresca -> studio. El mismo mapa vive en LEGACY_TEMPLATE_MAP (lib/storefront-templates.ts).

UPDATE "Organization"
SET "appearance" = jsonb_set(
  "appearance"::jsonb,
  '{template}',
  to_jsonb(
    CASE "appearance"::jsonb ->> 'template'
      WHEN 'minimal' THEN 'lienzo'
      WHEN 'clasica' THEN 'lienzo'
      WHEN 'minimalista' THEN 'lienzo'
      WHEN 'editorial' THEN 'boutique'
      WHEN 'elegante' THEN 'boutique'
      WHEN 'noche' THEN 'noir'
      WHEN 'tecnologica' THEN 'noir'
      WHEN 'oscura' THEN 'noir'
      WHEN 'fresca' THEN 'studio'
    END
  )
)
WHERE "appearance" IS NOT NULL
  AND jsonb_typeof("appearance"::jsonb) = 'object'
  AND "appearance"::jsonb ->> 'template' IN ('minimal', 'clasica', 'minimalista', 'editorial', 'elegante', 'noche', 'tecnologica', 'oscura', 'fresca');
