# Inventario: edición masiva e inline — #161

Admisión AL del dueño; antecedentes #112 (unidades), #109 (edición/foto), #110
(tarifas). Los antecedentes cerrados no constituyen una nueva autorización.

## Selección y actualización

`POST /api/admin/inventory`, sesión/clave con `inventory.write` y empresa activa:

- `{kind:"bulk-items", ids:[...], changes:{...}}`
- `{kind:"bulk-units", ids:[...], changes:{...}}`

Selección explícita de 1–100 IDs únicos. Solo registros de la empresa activa.
Un lote con ID inexistente/ajeno o datos inválidos no aplica ningún cambio.
Guardado transaccional completo; respuesta `updatedIds` y `updated`; cada registro
modificado queda auditado. No hay éxitos parciales: ante error la UI conserva
selección y cambios pendientes. El campo ausente no cambia. `null` vacía solamente
campos opcionales: texto → null/URL manual vacía; dinero/días → 0.

Campos comunes de productos: categoría, tipo, estado, visibilidad web, notas,
URL manual de imagen, costo diario, reposición y los siete campos de tarifa
existentes. Vaciar la URL manual **no borra la foto subida**: vuelve al fallback
de imagen existente. Códigos/SKU/nombres se editan individualmente. Cantidad es
derivada de unidades y no admite sobrescritura masiva.

Campos comunes de unidades: estado, costo de adquisición y notas. Los códigos
son únicos por empresa y se editan inline individualmente. Cambiar estados
sincroniza cantidad activa del producto (retiradas excluidas); mantenimiento se
descuenta mediante la disponibilidad existente.

Cliente final y mayorista mantienen tarifas normales y sus propios umbrales
`desde días`. **Duración nunca cambia el segmento de cliente**. 0 desactiva la
regla; `minimumPrice` sigue siendo el piso existente. Esta unidad no modifica
aritmética ni cálculos de presupuesto de FIN.

## Unidades inline

Agregar y editar ocurre en el detalle existente del producto, sin diálogo nuevo
ni navegación. Código de alta vacío genera el código existente; edición exige
código válido. La ficha no cambia mientras hay un editor de unidad abierto:
guardar/cancelar conserva su contexto; errores mantienen campos. Abrir unidades
desde la edición del producto conserva los cambios pendientes de ese producto.

Reposición desaparece de tabla y tarjetas principales. Sigue persistida y visible
en un bloque secundario plegable del detalle y de la edición.

## Reparaciones: contrato comprobado, límites actuales

`InventoryUnit`: código, estado (AVAILABLE/MAINTENANCE/RETIRED), **purchaseCost**
(adquisición), notas libres, createdAt/updatedAt. No existen fechas estructuradas
de ingreso/reparación/retorno, taller/local, nombre/referencia de reparación ni
presupuesto de reparación. Las notas existentes permiten documentar un detalle
libre, sin presentarlo como un campo estructurado o contabilidad de reparación.
`purchaseCost`, `dailyCost` y `replacementCost` no significan importe de reparación.
`createdAt/updatedAt` tampoco significan fechas de reparación.

`EventInventory` tiene checkedOutAt/checkedInAt, conditionOut/conditionIn,
damagedQuantity, missingQuantity y damageNotes: pertenecen a salida/devolución de
una asignación a evento, no a un taller. No se reinterpretan ni se copian a la
unidad. Nuevos campos/semántica necesitan acuerdo de datos con PLATAFORMA y dueño.

Ayudas hover/foco/tap se consumen del objeto compartido de PANEL; sin helper local.

## Archivo organizacional y restauración — delta del dueño #161

Dependencia aislada PLATAFORMA `5e5cc17`: `InventoryItem.archivedAt` nullable,
migración aditiva `ADD COLUMN IF NOT EXISTS`, sin backfill. No es un estado
operativo ni modifica disponibilidad.

`POST /api/admin/inventory` con `{kind:"item-archive",id}` o
`{kind:"item-restore",id}`, mismos `inventory.write`, empresa activa y auditoría.
Archivar conserva la fecha de archivo si ya estaba archivado; restaurar deja
`archivedAt=null`. Sólo se modifica ese campo y el timestamp técnico `updatedAt`;
unidades, status, cantidad, precios, visibilidad, notas, reservas, presupuestos e
historia permanecen intactos. No hay DELETE ni conversión a RETIRED. Los filtros
de disponibilidad mantienen su cálculo existente incluso para un producto
archivado. El listado completo prioriza productos activos antes de su límite
actual de 300 registros.

Activos en la lista principal; sección **ARCHIVADOS** al final, usando
`AdminDisclosure` compartido cerrado por defecto. Desde allí se consulta la ficha
o se restaura. La recarga vuelve a colapsar la sección y conserva el archivo real.
La UI bloquea archivo/restauración mientras la ficha tiene cambios pendientes,
sin descartar el formulario. VIEWER/FINANCE sólo consultan; no ven restauración.

`AdminInventoryRow.archivedAt` es el único hunk compartido consumido por OPS;
contratos de presupuestos, schema de servicios y cálculos FIN no se modifican.
