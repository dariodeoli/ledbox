# Diseño acotado #245: stock desconocido y Pendiente conteo

15/10/2026 · READONLY. Fuente inspeccionada: base133b380acb + CONFIG1347b653fa, preorden7a9aadd y ciudades2ccf7a6 en `ledbox-134-review`. No se modificó schema/código/migraciones, no PG/build/GitHub. Es propuesta recuperable para una unidad posterior a134, no implementación ni aprobación de migración.

## Decisión recomendada

Mantener `InventoryItem.quantity` entero como espejo de las unidades activas y agregar **una bandera persistente `quantityKnown Boolean @default(true)`**. `false` significa «cantidad total desconocida / Pendiente conteo», distinto de una cantidad conocida0. Nombre final a acordar en implementación; **no llamarla `quantityVerified` si true también incluye cantidades importadas o históricas que nunca se contaron físicamente**.

No reutilizar `status=MAINTENANCE`, `comboIncomplete`, `incidentHold`, etiquetas, notas ni precio0: expresan condiciones distintas y cambiarían operación, reservas o publicación. No volver `quantity` nullable: rompería aritmética, DTOs, agregados y contratos de unidades existentes. Una bandera evita esa migración amplia y conserva el conteo físico actual.

La bandera tiene que viajar con la lectura interna de stock; escribirla sin cambiar los consumidores crea otra disponibilidad falsa. El público puede reutilizar `CONSULT` sin mostrar conteos ni información interna. No hace falta crear un motor de inventario paralelo ni una tabla de conteos completa para este primer alcance.

## Estado real encontrado

- `prisma/schema.prisma`, modelo InventoryItem: quantityIntdefault1 es espejo de unidades activas, excluye RETIRED. No existe `quantityVerified`, `quantityKnown`, stockKnown o fecha de conteo en el schema inspeccionado.
- `inventory-units.ts::syncInventoryQuantity` cuenta unidades no retiradas y actualiza quantity. **Nunca debe establecer que se conoce el total sólo por sincronizar**.
- `createInventoryUnits` transforma cantidad no positiva/no entera en1. **Cambiar sólo `cantidad ?? 1` a0 crearía igualmente una unidad**. El caller debe omitir creación para0; el helper debe tener contrato explícito seguro (recomendado: rechazar cantidades inválidas;0 no-op sólo si se adopta y prueba en todos sus callers). No usar coerción silenciosa a1.
- `import-catalog.ts`: cantidad usa `parseWholeNumber` y actualmente sólo acepta>=1 o null; mensaje confirma que0 hoy no está admitido. Plan inicial y cálculo de estados usan `cantidad ?? 1` para nuevos.
- `server/import-catalog.ts`: alta unidad crea quantity y llama incondicionalmente a createInventoryUnits; existente sólo agrega si cantidad numérica supera quantity actual. No reduce stock ni cambia tipos de forma libre.
- `InventoryFicha` pestaña Verificación es placeholder E4; no hay conteo físico ya implementado que se pueda activar con un label. #202 es el futuro conteo/verificación/cronología.
- `InventoryStockPanels` sí ofrece unidades por depósito, movimientos y compras, calculados de unidades reales. `inventory-families.ts` ya evita createInventoryUnits cuando quantity0: patrón útil para el importador.
- Disponibilidad central está en `server/inventory-availability.ts` (buildAvailability, itemAvailability, commitInventoryAssignment y reserva de presupuestos). UI de grilla y ruta legacy también calculan disponibilidad actual: hay que propagar la bandera ahí.
- Combos no tienen unidades propias: `inventory-combos.ts::comboCapacity` toma mínimo por piezas, `server/inventory-combos.ts` expande y reserva piezas. `comboIncomplete` ya protege composiciones incompletas; cantidad conocida de un combo debe derivarse de sus componentes.
- Público: `catalog-public.ts` define hints AVAILABLE/LOW/CONSULT; `server/catalog-public.ts::hintsFor` calcula disponibilidad por fecha. `store-cart.ts` revalida líneas y precios; carrito/preorden no reserva. Aprobación/reservas es otro flujo.

## Transiciones y contrato de importación

| Antes | Entrada | Resultado recomendado |
| --- | --- | --- |
| Producto nuevo unidad | cantidad:null/ausente | quantity0, quantityKnownfalse, **cero InventoryUnit creadas**, etiqueta Pendiente conteo. Puede tener foto/precio/categoría y figurar para consulta. |
| Producto nuevo unidad | cantidad:0 | Ampliar parser a entero>=0: quantity0, quantityKnowntrue, cero unidades, texto0 conocido/sin stock. No Pending conteo. |
| Producto nuevo unidad | cantidad:N>0 | Crear exactamenteN unidades, quantityKnowntrue; «cantidad informada» no equivale a conteo físico auditado. Aplicar estados válidos existentes. |
| Existente conocido | cantidad:null/ausente | Conservar quantity, unidades, bandera, estados e historial; nunca volver a desconocido. |
| Existente desconocido | cantidad:null/ausente | Permanece desconocido; no materializa unidades. Fotos/precios válidos se actualizan por contrato actual. |
| Existente desconocido sin unidades/historial | cantidad:N>=0 explícita | Establecer cantidad conocida: crear exactamenteN si>0, ninguna si0. Auditoría origen importación, sin afirmar inspección física. |
| Existente con unidades | cantidad:N>=cantidad actual | Reutilizar no reducción y altas por diferencia; para desconocido, marcar conocido sólo si N es **total explícito** y el usuario ve/acepta ese alcance en preview. |
| Existente con unidades | cantidad:N<cantidad actual | Conservar no reducción y no retirar automáticamente. Aviso de discrepancia; **no borrar bandera desconocida** si no se reconcilió el total. Corregir mediante revisión de unidades con guardas existentes. |
| Existente conocido/histórico | edición de foto/precio/nombre | No cambia conocimiento de stock ni fechas de conteo. |
| Juego completo | cantidad:null o numérica | Sin stock propio. Capacidad/conocimiento derivados de componentes; cantidad importada propia se ignora con aviso como hoy. |
| Juego sin componentes | cualquier cantidad | Mantener comboIncomplete y bloqueo actual. No resolver por cantidad ni por quantityKnowntrue. |

`null` nuevo con estados positivos (ejemplo mantenimiento7) **no permite inferir total7 ni añadir unidades desconocidas**. Vista previa debe explicar que falta cantidad total; mantener el patrón actual de error de fila sin aplicación parcial hasta que se complete. Ceros de estado no inventan unidades. Estados positivos válidos junto a cantidadN sí usan planUnitStates/applyUnitStates y sus límites de asignadas.

La representación JSON externa sigue usando `cantidad:null`; no hace falta obligar a todos los archivos a traer la bandera interna. En una futura exportación restaurable, sí incluir el conocimiento de stock de forma explícita y versionada para no confundir quantity0 con cero confirmado.

## Conteo y otras entradas de unidades

Primera UI pequeña dentro de ficha/Verificación existente: Pendiente conteo, explicación y acción explícita para informar total. Puede alimentar el listado/filtro Datos por completar; **no crear un segundo editor ni tabla de inventario**. Reusar NumberField/AdminDialog y permisos inventory.write existentes, con historial recordAudit del cambio de conocimiento y unidades creadas/ajustadas. No atribuir una fecha «verificado físicamente» a una importación.

El primer cierre sencillo se limita a desconocido sin unidades y sin historial: total0 oN creaN bajo lock de InventoryItem y marca conocido en la misma transacción. Contar un producto que ya tiene unidades usa reconciliación segura: no eliminar ni reducir unidades con reservas, salida, incidentes o historia. Si faltan unidades, el usuario revisa retiros/reparaciones por flujo existente; no resolver diferencias mediante `UPDATE quantity` directo.

**Compra no es conteo:** comprar3 de un producto cuyo total era desconocido prueba al menos3 unidades, no que sean las únicas3. Crear unidades y sincronizar quantity mantiene quantityKnownfalse hasta declarar/reconciliar el total. Igual para crear variante, registrar unidad manual, devoluciones o restaurar incidentes. Es un caso relevante para UI: «3 registradas; total pendiente de conteo», sin anunciar3 libres garantizadas.

No permitir cambiar conocido→desconocido por un PATCH genérico ni reimportación null. Si se requiere declarar pérdida de confiabilidad, debe ser una acción específica futura con impacto en reservas revisado, no parte implícita de esta unidad.

## Disponibilidad y consumidores: misma verdad en todos los caminos

1. Propagar quantityKnown en selectores DB y DTOs internos; tipo/adapter canónico con `knowledge:known|unknown` o bandera. Por compatibilidad, cálculos numéricos conservan available0 cuando desconocido, **con razón explícita desconocido**, no «stock físico0». No usar NaN/null en la aritmética existente ni ocultar compromisos históricos.
2. `buildAvailability`/wrapper canónico: desconocido no ofrece capacidad reservable y devuelve motivo Pendiente conteo. Mantener total de unidades registradas/comprometidas para trazabilidad; una presentación de stock0 sin motivo sería engañosa. Revisar cálculos paralelos de ruta legacy/grilla actual además del motor por rango.
3. Picker de presupuesto: producto desconocido sigue encontrable por nombre/código y cotizable, etiqueta Pendiente conteo; no eliminarlo silenciosamente ni fabricar stock1. Picker de operación/reserva impide asignar capacidad desconocida con mensaje accionable. Precios continúan independientes de stock.
4. Tienda pública/privada/mayorista y cart: desconocido devuelve CONSULT aun sin fechas; con fechas no AVAILABLE/LOW. Puede sumarse a preorden como consulta según flujo actual; precio cargado puede estimarse, pero no implica disponibilidad. No exponer cantidades físicas exactas ni notas internas.
5. Combos: si una pieza está desconocida, capacidad reservable0 conservadora y razón «Stock de [pieza] pendiente de conteo». Propagar incertidumbre al padre; **no mostrarlo como cero conocido**. Mantener incompleto distinto de desconocido. Misma regla en cotización de combo, alternativas/sustitutos, pickers, hints, reserva directa y expansión de piezas.
6. Nuevas reservas/retenciones: verificar flag con lectura fresca bajo el mismo lock InventoryItem, antes de insertar asignaciones, también en importación de eventos. No basta deshabilitar botón. Nada de auto-reservar al confirmar conteo: sólo habilita el flujo normal posterior.
7. Aprobación: conservar el gate/roles actual. Política recomendada para la primera unidad: desconocido bloquea **reserva** sin posibilidad de fabricar capacidad. Si se mantiene el camino OWNER/ADMIN «Aprobar igual», sólo puede asumir un compromiso comercial **sin reserva física**, con motivo y pendientes explícitos como el flujo actual de faltantes. No introducir una nueva prohibición global de aprobación ni asignación forzada sin revisar su contrato; prueba causal debe acreditar que APPROVED no equivale a stock reservado. Si se elige bloqueo comercial no forzable como comboIncomplete, documentarlo como decisión de producto y probarlo, no cambiarlo accidentalmente mediante `blocked` genérico.
8. Reservas históricas/salida/devolución/incidentCycle: no borrar ni liberar por despliegue o lectura. La bandera nueva nace false sólo para productos nuevos sin unidades: no debe reclasificar equipos ya entregados. Devolver/restaurar mantiene cantidad sincronizada pero no convierte un total desconocido en conocido.

## Migración y backfill seguros

Una migración **aditiva de una columna**, con defaulttrue para conservar semántica histórica. No modificar quantity ni InventoryUnit ni EventInventory. No usar quantity1, cantidadnull en notas, fecha de lote, cantidad0 o ausencia de reservas para inferir que un registro histórico es inventado.

true para histórico significa «se conserva la interpretación existente», no «el depósito lo contó». El UI no debe añadir sello de verificación física ni autor/fecha ficticios. Los productos creados por la nueva ruta con null escriben false explícito; los escritores manuales de cantidad conocida pueden usar true explícito/documentado. Reimportar null de histórico mantiene true y sus unidades.

Si después se confirma que un lote antiguo generó unidades ficticias, preparar informe por código con evidencia del archivo original y todas las relaciones. Reparación separada, autorizada por el dueño y revisada: no retirar masivamente las unidades1 ni tocar reservas/incidentes. La migración no incluye esa reparación.

Despliegue: schema aditivo primero, clientes Prisma compatibles y escritores/lectores de stock integrados juntos. Evitar habilitar importación desconocida mientras queden procesos viejos activos que ignoren la bandera. Rollback conserva columna/datos; si ya existen desconocidos con unidades registradas por compras, volver a lector antiguo podría ofrecer esas unidades sin reconocer incertidumbre: bloquear ese rollback o mantener el guard/función deshabilitada hasta reconciliar. No convertir todos atrue para facilitar rollback.

## Paths que debe cubrir una implementación posterior

| Capa | Paths principales y revisión requerida |
| --- | --- |
| Persistencia | `prisma/schema.prisma`, migración aditiva futura; clientes propios al probar. Defaults/restore/backfill sin cambios de registros históricos. |
| Importación | `lib/import-catalog.ts`, `lib/server/import-catalog.ts`, `lib/import-modules.ts`, `lib/server/import-tabular.ts`, `components/admin/AdminImportPanel.tsx`, guía/prompt. Preview nuevo vs existente/null/0/estados, resultado honesto. |
| Unidades | `lib/server/inventory-units.ts`, `lib/server/inventory-families.ts`, `app/api/admin/inventory/route.ts`, `app/api/admin/resources/route.ts` (alta manual), demás escritores localizados por `inventoryItem.create`. Compra/creación/sync no validan total automáticamente. |
| Lectura/UI | `lib/admin-types.ts`, `lib/server/inventory-grid.ts`, `app/api/admin/inventory/route.ts`, `InventoryGridData`, `InventoryList/Tiles/Ficha/StockPanels`, `BudgetInventoryPicker`, listas/sugerencias de variantes. Selecciones deben incluir flag. |
| Motor/combos | `lib/server/inventory-availability.ts`, `lib/server/inventory-combos.ts`, `lib/inventory-combos.ts`, `lib/server/approval-stock.ts`, import-eventos. Misma razón/guard bajo locks y proyección de incertidumbre. |
| Público/cart | `lib/server/catalog-public.ts`, `lib/catalog-public.ts`, `lib/server/store-cart.ts`, componentes de disponibilidad y DTOs de retail/private/wholesale. Preservar CONSULTable/preorden sin reserva. |
| Trazabilidad | `recordAudit` existente para transición explícita, reporte del lote y JSON portátil futuro; no tabla E4 completa como requisito de este parche. |

## Casos de aceptación indispensables, todavía NO ejecutados

- Nuevo null crea producto, cero unidades y pending; mismo archivo repetido no crea1. Nuevo0 conocido no crea1. NuevoN crea exactamenteN; null/0 no cambian foto/precio/categoría ajenos.
- ConocidoN + reimportnull conserva flag/unidades/incidentes/reservas. Histórico1 sin prueba del archivo no se reclasifica. Desconocido + compra3 sigue desconocido; counttotal3 lo resuelve, counttotal0 no destruye esas3.
- Cantidad explícita menor que actual no reduce ni certifica desconocido. Estados positivos con total desconocido dan error explícito; cantidad10/mantenimiento7 produce7+3; asignadas protegidas y aviso de diferencia.
- Transacción de conteo vs reserva/compra concurrente: orden de lock InventoryItem y lectura fresca; sin duplicar unidades, sin conteo perdido ni reserva antes del flag conocido. Tenant/rol/JSONtipo/error rollback sin escritura parcial.
- Componente desconocido hace padre consultable/no reservable y nombra razón; completar conteo habilita cálculo mínimo real. Combo incompleto sigue sin piezas; no se resuelve marcando flag.
- Public/private/wholesale sin fechas y con fechas: CONSULT y preorden posible, nunca cantidad exacta ni AVAILABLE falso. Carrito con producto con precio pero desconocido estima dinero sin prometer stock.
- Reserva directa, hold, aprobar presupuesto, cambio de fechas y eventos importados aplican misma guarda. «Aprobar igual» sólo según política definida, sin asignaciones ficticias. Histórico ya asignado/entregado no se libera; devoluciones/ciclos siguen íntegros.
- Empresa limpia y empresa histórica: migración conserva cantidades/bytes/relaciones. Backup/restauración futura conserva flag. Rollback de aplicación no oculta incertidumbre.

## Riesgos y límite de alcance

Principal riesgo: convertir el problema de null en0 y seguir llamando al helper que crea1; segundo, añadir bandera sólo al importador y dejar un camino de reserva/combos sin ella. Tercero, llamar «verificado» a una cantidad histórica o importada. Cuarto, sumar compras a un desconocido y asumir total conocido. Quinto, reparación retroactiva automática de la unidad ficticia con historia.

Este diseño no implementa E4 completo, conteos masivos, depósitos nuevos, reservas históricas retroactivas ni reparación de41combos. No hay nuevo resultado de pruebas ni validación de producción. La unidad245 debe tener revisión independiente de motor/locks y pruebas PG causales antes de publicar; no integrarla a134 por un cambio local de operador `??`.
