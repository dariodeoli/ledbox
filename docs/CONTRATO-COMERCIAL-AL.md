# Contrato compartido AL — persistencia comercial

Contrato aprobado por dueño/integrador mediante ACK de nombres y formulario de
distribución neta en sesión original PF. FIN implementa cálculos/API/portal;
PF entrega persistencia/tipos/validación y, por separado, binding firma nuevo.
No pertenece a AUTO173 ni acredita integración/publicación.

## Persistencia

Todos los nuevos campos son nullable, sin defaults ni backfill:

- `BudgetItem.priceMode`: `TARIFF|MANUAL`; NULL = precio histórico pactado.
- `BudgetItem.tariffSnapshot`: SQL NULL o JSON estricto
  `{version:1,front:FINAL|WHOLESALE,normalPrice,fromDays,fromPrice,minimumPrice}`.
  Sólo frente efectivo copiado por admin desde inventario de la misma empresa.
  TARIFF exige snapshot. MANUAL puede retenerlo y mantiene su piso vinculante.
  Histórico NULL nunca se reinterpreta consultando inventario live.
- `BudgetItem.discountMode`: `AMOUNT|PERCENT`, nullable junto a `discountValue`;
  AMOUNT es PYG entero, PERCENT es BPS entero. `discountAmount` es importe
  efectivo calculado server, NULL histórico, no input autoritativo.
- `Budget.discountMode/discountValue`: misma representación; NULL conserva
  `Budget.discount` fijo legacy. `discount` sigue siendo importe efectivo global.
- `Budget.advancePercentBps`: NULL conserva `advanceAmount` fijo legacy;
  0..10000 es modalidad automática, `advanceAmount` materializa importe efectivo.

Un BPS = 0,01%. Montos Int no negativos <=2147483647. Duración de snapshot
fromDays 0..9999; 0 desactiva regla. Omitir campo preserva; reset NULL es una
edición explícita coherente, no un mecanismo para eludir piso/lock.
`lib/budget-commercial-contract.ts` contiene schemas estrictos de términos y
patches parciales. API debe fusionar con persistencia y validar el resultado;
snapshot no es input confiado del portal. SQL NULL se escribe con Prisma.DbNull.

## Cálculo acordado para FIN

Frente nunca cambia por duración. Precio tarifario = fromPrice sólo si
fromDays>0, fromPrice>0 y days>=fromDays; si no, normalPrice. Respeta
minimumPrice existente. MANUAL conserva unitPrice pactado, pero no evade piso
retenido. Bruto_i=qty_i×days_i×unitPrice_i. No participan líneas excluidas.

Descuento de línea una vez sobre bruto; N_i=bruto_i-descuento_i.
Budget.subtotal=S=sum(N_i), es suma NETA. Global D se aplica una vez a S.
Porcentaje monetario half-up exacto:
`(BigInt(base)*BigInt(bps)+5000n)/10000n`. Validar overflow antes de materializar.

Piso_i=minimumPrice_snapshot×qty_i×days_i tanto TARIFF como MANUAL con snapshot.
Sin snapshot legacy/manual libre no se inventa piso. Exige N_i>=piso_i.
Cambiar modo no elimina/reduce piso retenido: revisión comercial explícita.

Para validar GLOBAL contra pisos:

1. Exigir 0<=D<=S. Si S=0 sólo D=0 y asignaciones cero.
2. A_i=floor(D×N_i/S), R_i=(D×N_i)%S con BigInt.
3. Distribuir D-sum(A_i) unidades monetarias, una por línea, por resto
   descendente; empate sortOrder asc (NULL al final), luego ID persistente asc.
   Asignar/preservar ID de líneas nuevas antes de calcular. No modifica orden
   histórico/documental ni `stableOrderBudgetItems`.
4. Exigir N_i-A_i>=piso_i en cada línea. Total=sum(N_i-A_i)=S-D.
5. Si falla cualquier piso, rechazar descuento completo; no redistribuir a
   otras líneas, no clamp. Global100%/sin cargo no tiene exención implícita.

Descuento fijo mayor que base reducida => 400 editable con ajuste explícito;
409/revisión en documentos/ledger protegidos. No cambios parciales.

Seña automática usa TOTAL final después de descuentos y servicios sólo si
fueron acordados. No convierte cuota porcentual/saldo en seña. Mantener slot
`advance`, lock comercial, guards de ExpectedPayment/proof/split/recibido;
conflictos 409/revisión atómica. Nunca reescribir ClientPayment histórico.

## Proyección pública y firma

TARIFF expone sólo snapshot del frente efectivo para preview por días; MANUAL
expone precio pactado y piso retenido, no tramos automáticos. Descuentos y
montos efectivos públicos. Nunca otro frente/costos internos.

La dependencia de persistencia no cambia handlers ni firma. Nueva proyección
documental con términos requiere **v3** para solicitudes nuevas, binding LIVE
por versión y render/snapshot canónicos. V1/v2 conservan recetas/selects/hash
históricos exactos y REQUEST_CREATED append-only. Aprobado/firmado sigue
409/revisión. No afirmar v3 operativa hasta handoff de implementación PF.

## Servicios: relevamiento, no modelo inventado

InventoryItem.dailyCost/replacementCost, Budget.materialCost/laborCost y
BudgetItem.costPrice son costos internos, no tarifa de venta de servicio.
SupplierJob.total/advance y Promoter/EventTask no prueban precio comercial
por unidad/día/evento. Línea libre conserva qty×days×unitPrice pactados;
nombre no determina servicio. No modelo/API acreditado de tarifas comerciales
de guardia/traslado/activación/promotora con frentes/tramos/base/selección.

Pendiente dueño/OPS: base/multiplicadores/días, traslado y activación juntos o
separados, asociación al producto, impuestos/descuentos/pisos y selección
no incluido/sin cargo/con cargo/visibilidad. No instalación separada inferida,
no migración/cargo de servicio hasta contrato real.
