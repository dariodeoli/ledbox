# Orden canónico de ítems de presupuesto — #173 A15

## Persistencia (plataforma)

`BudgetItem.sortOrder` es `Int?`: nullable, sin default Prisma/SQL y sin backfill.
La migración aditiva `202610100002_budget_item_sort_order` usa
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; se puede reejecutar sin modificar
ítems históricos. Nunca se edita una migración aplicada ni se migra producción
desde un carril.

El índice existente `BudgetItem(budgetId)` sigue resolviendo las lecturas por
presupuesto. No se agrega un índice de orden: el ordenamiento canónico se hace
estable en JS y no se introduce un `ORDER BY` SQL que reorganice empates/NULL.

## Escritura y lectura (FIN)

- En creación/editor, FIN persiste posiciones explícitas del array validado
  (`0..n-1`, enteros >= 0 generados por el servidor) al crear/editar las líneas,
  junto con la transacción comercial.
- El servidor valida el array (identidad, duplicados, pertenencia y resto de
  guardas existentes); el cliente no puede imponer posiciones arbitrarias
  fuera de ese array ni eludir el bloqueo de documentos firmados.
- Un PATCH editor con `[Second, First]` debe persistir ese orden y releerse así
  en API del panel, portal e impresión, mediante un único helper estable de FIN.
- Si `sortOrder` es NULL, no se infiere posición de ID, nombre, fecha, stock,
  precio ni snapshots. La lectura conserva el orden relativo del query original
  de esas líneas. Empates de posiciones explícitas también conservan su orden
  relativo de entrada; no agregar desempates SQL inventados.
- El helper debe definir consistentemente la mezcla de líneas explícitas/NULL,
  mantener estabilidad de NULL y ser compartido por todas las superficies.
- No cambiar snapshots ni documentos firmados/aceptados para asignarles orden.
  Esta migración sólo agrega almacenamiento opcional; no reescribe JSON ni
  reinterpreta historia comercial.

## Entrega / consumo

Plataforma entrega schema/migración/este contrato por commit LOCAL `Refs #173`.
Integrador consume el commit local y regenera Prisma antes de la implementación
FIN; validación local PostgreSQL nueva alcanza 46 migraciones con esta adición.
FIN es dueño del helper, creates/editor y lecturas API/portal/print.
La corrección requiere candidato final nuevo y QA retarget, no reutiliza PASS
del candidato `b582d0e872842ae50de9ccd97439a8e06af34faa` que falló A15.
