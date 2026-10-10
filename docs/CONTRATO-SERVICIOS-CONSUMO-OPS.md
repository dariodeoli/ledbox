# #161 / #173 · contrato concreto de consumo OPS para servicios

## Estado y bases

Reglas financieras/ACK OPS/PF cerrados documentalmente en FIN§12 y
`evidencia/ronda-al/PF-SIGPDF-REVIEW-HANDOFF.md:371–448`. No queda pregunta FIN
abierta sobre unidad de traslado/instalación, costo incurrido/pendiente o IVA.
Falta **mapping/constraints/DTO/admisión PDF/versionado PF y dependencia aislada**.

Delta OPS preparatorio en `feat/ops-servicios-config-state`, parent explícito
`9c7b90c907e01034a0166f238e1abd122891edf8`. La rama de inventario aceptada
`feat/ops-inventario-masivo-inline` queda en9c, sin rebase/replay. Esta base permite
desarrollar estado local fueraHD; no es base implícita de integración posterior.
No cambios de schema/types compartidos/API/renderer/calculador financiero.

`components/admin/modules/inventory-service-state.ts` es estado privado de
formulario, **no DTO PF, endpoint, serializer público ni autorización server**.
Los nombres lógicos siguientes requieren mapping expreso PF para persistir.
El archivo tiene consumidores contractuales en `tests/inventory-service-state.test.ts`;
la ficha/API se conectarán cuando exista dependencia. No se muestra guardar ni
éxito ficticio ni se transmite un request de servicio hoy.

## Campo lógico → consumo y hunk esperado PF

| Campo de estado OPS | Configuración/UX y validación local | Hunk necesario PF / contraejemplo |
| --- | --- | --- |
| serviceClass | TRANSPORT / INSTALLATION / TECHNICAL_GUARD / PROMOTER explícitos; dos conceptos traslado/instalación, no campo combinado | Enum/modelo config y validator PF. `TRANSPORT` con PERSON_DAY o FIXED_EVENT rechazado; sólo fijo por ejecución×1. No dato seed ficticio. |
| mode, unit | FIXED_EXECUTION/PYG por ejecución para traslado/instalación; FIXED_EVENT/PYG por evento o PERSON_DAY/PYG por persona-día para guardia/promotora. Tokens locales usan PYG_PER_* | Mapping exacto de discriminante/unidad y null por brazo; no inferir unidad desde BillingUnit de landing. |
| people, serviceDays, contextualServiceDays | Enteros1..9999; variable con people/serviceDays, contextual null; fijo con people/serviceDays null y contexto selector obligatorio si umbral activo | DTO patch/create PF con transición atómica, omitir preserva y null no evade requisito. Fijo con people2/serviceDays3 debe fallar, no sumar/multiplicar ambos. |
| front | Admin elige FINAL o WHOLESALE; no automático por tipo/días | Permiso y snapshot PF, resolver FIN. X−1/X/X+1 sólo cambia tramo del frente; FINAL a5d no se convierte en WHOLESALE. |
| final/wholesale normalPrice/fromDays/fromPrice | Strings de campos canónicos a enteros Int o null; vacío ≠0. Umbral0 desactiva. Precio por duración sin umbral explícito inválido | Catálogo configurado PF, sin duplicar `InventoryItem` como servicio físico. Snapshot aplicado público sólo del frente efectivo; alternativo/origen admin privado. |
| snapshot, override | Preview de tarifas del snapshot conservado; cambio de brazo preserva costo/cobertura y exige override de nueva unidad o null explícito. No calcula bruto/floor/totales | Snapshot/revisión/refresh server PF y cálculo FIN. Override persona-día no se convierte a importe fijo tácitamente; catálogo/cargos anteriores intactos. |
| minimumPrice, minimumApplicability | Mínimo null cuando vacío,0 sólo explícito; CHARGED_ONLY. Cargo bloqueado sin mínimo acreditado. FREE/NOT_INCLUDED no borran el snapshot | Validator/config PF exige dominio CHARGED_ONLY, no alternativa obligaFREE. Piso materializado y postdescuentos FIN; OPS no implementa allocator ni clamp. |
| tax, budgetTax | IVA10/IVA5/EXEMPT explícito; known/homogéneo presupuesto; nada default por clase o venta0 | Tipo efectivo/confirmación server PF y cálculo fiscal FIN. IVA5 vs presupuestoIVA10/missing rechazado; no fiscal mixto ni suma IVAextra. |
| inclusion | NOT_INCLUDED / INCLUDED_FREE / INCLUDED_CHARGED, independiente de catálogo/costo | DTO/locks PF y selección FIN. Pasar aFREE no usa descuento100%, no convierte minimumPrice a0 ni purga privateCost. |
| id, organizationId, budgetId, configurationId, productId | Identidad/origen explícitos, chequeo contra contexto ya resuelto; configuración misma empresa/producto/clase | Constraints/queries/auth PF. Misma FK porID no basta. Línea o ejecución de otra empresa/presupuesto inválida. El navegador no acredita estos IDs por sí solo. |
| scope, scopeKey, executionId | LINE para origen realmente por línea de otras clases; SHARED_EXECUTION obligatorio traslado/instalación aunque cubra1línea | Unique company+budget+configuration+executionId; clase coherente. No aliasLINE del mismo traslado para segundo cargo. ID distinto sólo para nueva ejecución real/admin explícita. |
| coverageIds | IDs explícitos únicos, same-company/budget, líneas activas, no vacíos si incluido | Cobertura unique application+parentLine y constraints atómicas PF. Repetir producto/duplicar línea/render no clona aplicación; traslado+instalación separados pueden cubrir A/B con mismo executionId. |
| historicalCoverageIds, coverageState | NEEDS_REVIEW bloquea incluido hasta decisión; retiro parcial resuelto en una acción, retirototal exigeNOT_INCLUDED con historial/costo; restaurar padre no invoca transición de cargo | Lifecycle/locks/revisión PF + FINeditor, no EVENT nuevo sin líneas. Borrado/cascade no destruye snapshot/costo/relación histórica. Validación local no implementa transacciónDB. |
| privateCost (opaque) | Estado opaco preservado por referencia al cambiar inclusión/modo/cobertura; OPS no calcula costo ni lo publica | PF private oblig/source/contributions/completeness; FINeffective=incurrido+pendiente no superpuesto. Compromiso30000 incurrido10000 no crea40000; unknown no0. No copiar costo de equipo/SupplierJob ni escribir ledger. |

Nota: PYG es la moneda de todos los tokens; las etiquetas por ejecución/evento/
persona-día describen unidad contractual, no nuevos tipos monetarios públicos.

## Reserva exacta y composiciones

- **OPS ahora:** nuevo `components/admin/modules/inventory-service-state.ts`,
  `tests/inventory-service-state.test.ts` y este contrato. Config read/preview no
  duplica aritmética financiera ni crea API. Estado local preparatorio aislado.
- **OPS después mapping CLOSED y dependencia:** hunks alta/edición/detalle y
  form-state de servicios en `InventarioModule.tsx`; consumo del validator/catálogo
  PF, auth `inventory.write`, scoped/audit en `app/api/admin/inventory/route.ts`.
  `lib/server/inventory-catalog.ts` sólo si provisión acordada, sin precios/costos
  ficticios. Ruta de mutación/body/response exactos son input PF, no inventados.
- **FIN reserva confirmada:** `lib/budget-service-financial.ts` y
  `tests/budget-service-financial.test.ts` nuevos privados; reusa allocator/fiscal
  canónicos sin editarlos. Sin solape con estado OPS. FIN entrega materialización
  de G/M/pisos/IVA/discounts/costcompleteness, no DTO/schema/proyección pública.
- **PF:** schema/migración/types/validator/proyección/versión firmable por lista
  exacta de hunk y SHA aislado entregados. OPS no implementa renderer/snapshot v4,
  ni presupone v4 compatible por nombre; no tests deprivacidad completos con DTO
  ausente ni serializer público provisional.

## Input PF consumible requerido (impedimento preciso)

1. Nombres/versiones y shapes exactos de configuration/snapshot/application/
   coverage/cost-private y mapping a campos lógicos arriba, con límites/null y
   unicidad/cobertura/locks. API read/write contrato exacto para inventario.
2. Validator/fábrica/proyección existentes extendidos y paths/hunks donde se
   importan. Aclarar owner de preview/resolver para reemplazar o delegar helpers
   locales al conectar; no dos resolvers financieros paralelos.
3. DTO público allowlist y nueva versión firmable entregada, admisión PDF externo
   acreditada; históricos y REQUEST_CREATED inmutables. No claves/costos privados
   en documento/APIcliente/metadata. No publicar todos los campos locales.
4. Handoff CLOSED con fullSHA/base/parents/patch-id/diff por hunk/migración aditiva/
   checks reales; reserva FIN/OPS acordada. Consumo aislado, no wholehistory ni
   cssfa6/oracle6948 como dependencia de servicios.

Hasta estos inputs se ejecuta la parte local de estados y contraejemplos, sin
activar guardar ficticio, endpoint compartido o migración propia. Es impedimento
de wiring/persistencia exacto, no espera por ACK financiero ya cerrado.

## Verificación y recuperación

Tests afectados propuestos: parsing unknown/0 y límites; X±1/0 por frente;
exclusión de brazos/contexto fijo; IVA homogéneo/min explícito; identidad y cargos
separados; bindings cross-company/budget; retiro parcial/total/protegido atómico;
preservación costo/origen y unidad de override. Son tests de código significativos,
no réplica del Pilot161 aceptado.

No checks ejecutados sin DIRECT usable del emisor Secretaría actual. Cuando
otorgue ventana porSHA/argv/budget/jobs actuales: tests afectados, typecheck,
checkerfields disponible (no scriptlint en package), build sin DB y con URLs
locales; secuenciar generate/build y tests para no repetir racePrisma histórica.

QA visual/browser/flujos: **QA_NOT_RUN_DEFERRED_OWNER**, source candidato nuevo
de estado OPS y futuro wiring, owners OPSconfig/FINcálculo/PFprivacidadfirma;
recuperación al requerir evidencia específica o indicar dueño. Pruebas afectadas
de auth/proyección/migración/fallos públicos son exigibles al existir esos cambios.
Servicios fueraHDfinal58989 y AUTO. Rama9c/artifacts51PASS preservados, sin replay.
