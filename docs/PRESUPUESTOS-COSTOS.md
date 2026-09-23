# Presupuestos con costos internos, margen y precio final (issue #65)

## Modelo

| Dato | Dónde | Quién lo ve |
| --- | --- | --- |
| Costo por ítem | `BudgetItem.costPrice` (existía) | **Solo el panel** |
| Estimado por ítems | `Budget.costEstimate` (= Σ cantidad × días × costo, lo calcula el API) | **Solo el panel** |
| Materiales | `Budget.materialCost` (nuevo) | **Solo el panel** |
| Mano de obra | `Budget.laborCost` (nuevo) | **Solo el panel** |
| Precio final | `Budget.total` (subtotal − descuento) | Cliente (portal e imprimible) |
| Entrega | `Budget.deliveryAt` (nuevo) | Cliente |
| IVA | `Budget.ivaType` (nuevo: `IVA10`, `IVA5`, `EXEMPT`) | Cliente |
| Garantía | `Budget.warranty` (nuevo) | Cliente |
| Vigencia / pago / observaciones | `validUntil`, `paymentTerms` + `advanceAmount` + `installmentsJson`, `notes` (ya existían) | Cliente |
| Adjunto (PDF original u otro archivo) | `BudgetAttachment` (nuevo, binario en la base como los comprobantes) | **Solo el panel**, con sesión |

**Costo interno** = materiales + mano de obra + ítems. **Margen** = (precio final − costo interno) / precio
final. **Precio sugerido** para un margen: `costo / (1 − margen/100)`. Todo en PYG enteros
(`lib/budget-costs.ts`, tests en `tests/budget-costs.test.ts`).

El precio final se aplica como **descuento** cuando entra en la suma de los ítems; si el precio la supera,
el panel reparte el precio entre los precios unitarios (`distributePrice`) para que la suma de los ítems
siga siendo coherente con el total que ve el cliente.

## Dónde se edita

- **Panel → Presupuestos → ícono «Precio, costos internos y condiciones»** (fila del presupuesto):
  ítems y precios, materiales, mano de obra, precio final, margen deseado (calculadora «Usar Gs …»),
  vigencia, entrega, IVA, garantía, observaciones y adjunto (subir / abrir / borrar).
- El presupuesto nace en **Borrador**. Sin aprobación se editan ítems, precio y condiciones; una vez
  aprobado por el cliente, la versión enviada queda congelada (los costos internos se pueden corregir
  siempre). Estados `LOST`/`CANCELLED` no se editan.
- El **margen** se ve en la columna «Margen» de la lista, calculado sobre el costo interno completo.

## Garantía de que el cliente no ve costos

`tests/budget-privacy.test.ts` arma la vista pública con costos cargados y verifica que no haya ninguna
clave ni monto interno (materiales, mano de obra, costo por ítem, estimado, margen) en la respuesta, y que
el portal, el imprimible y la vista estática no nombren esos campos.

## Caso de aceptación (local)

Cliente **SCALE STRATEGY GROUP EAS** · presupuesto **«Paneles para estudio»**, 4 ítems, costo interno
**Gs. 8.105.000** (materiales 5.105.000 · mano de obra 3.000.000), precio final **Gs. 12.469.231**
(margen 35 % sobre el precio). Verificado de punta a punta contra el API real: el panel muestra el margen
y el portal muestra el precio y las condiciones sin ningún dato interno. El paso a paso para cargarlo a
mano está en el handover del issue (no se cargan datos reales en producción desde el entorno del agente).

## Pendiente declarado

El **portal de firma** (documento del dueño todavía sin definir) no se toca: las acciones del portal siguen
siendo Aprobar · Solicitar cambios (y Rechazar desde el panel), más Enviar y Descargar PDF en el panel.
Cuando el dueño defina el circuito de firma, se implementa sobre este mismo presupuesto sin cambiar los
costos internos (que ya están fuera de la vista del cliente).
