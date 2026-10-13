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

## Seña por empresa, depósito de garantía y transporte (alquileres)

**Seña por defecto.** Si la empresa tiene `OrganizationRentalSettings.depositPercent` (Ajustes > Alquileres),
todo presupuesto nuevo nace con el plan «Seña N %» + «Saldo» (alta manual, «Armar presupuesto» desde el lead,
API/CLI y conversión de preórdenes). Una sola función lo arma: `defaultDepositPlanRows`
(`lib/budget-payment-plan.ts`); `newBudgetDefaults` (`lib/budget-security-deposit.ts`) decide qué aplica en el alta.
El plan es porcentual, así que se recalcula con el total y la suma cierra al guaraní. Un `installmentsJson` explícito
(o `null` = sin plan) o un `depositPercent` elegido en el formulario se respeta; sin `depositPercent` no hay seña.

**Depósito de garantía.** `Budget.securityDeposit` (Int PYG, opcional), `securityDepositStatus`
(`PENDING`, `HELD`, `RETURNED`, `KEPT_PARTIAL`, `KEPT`) y `securityDepositRetained`. Default por empresa:
`OrganizationRentalSettings.securityDepositDefault`. **No suma al total, no se factura y no es un cobro**: nunca
entra en `lib/budget-commercial.ts`, en los pagos esperados ni en el snapshot de firma (los documentos firmados
no cambian). Se muestra aparte en el panel (tarjeta y diálogo «Depósito de garantía»), en el portal del cliente
(monto y estado, sin motivos internos) y en el imprimible.

Estados: `PENDING → HELD → RETURNED | KEPT_PARTIAL | KEPT` (los tres últimos son finales). Cada cambio se valida,
toma el candado de la fila del presupuesto y se audita (`action: status`, con motivo).

**Punto de entrada para la Fase 4 (InventoryIncident):** `transitionBudgetSecurityDeposit(context, budgetId, { to, retainedAmount?, reason? })`
en `lib/server/security-deposit.ts`. Con un incidente: `to: "KEPT_PARTIAL"`, `retainedAmount` = costo del incidente (entero PYG,
menor a la garantía) y `reason: "Incidente <id>"`; sin incidentes: `to: "RETURNED"`. `equipmentReturnByEvent` resume
la devolución de equipos de un evento (`clean`, `incidents`, `pending`) y el diálogo ofrece «Devolver garantía» o
«Retener parcial» según ese estado. La acción hoy es manual (`PATCH /api/admin/budgets`, `kind: "security-deposit-status"`,
`{ budgetId, to, retainedAmount?, reason? }`; el monto con `kind: "security-deposit"`); no depende de la Fase 4.

**Transporte.** Es un ítem libre más del presupuesto («Transporte», con su precio): suma al total y lo ve el
cliente. El formulario tiene el atajo «Transporte» junto a «Agregar ítem».
