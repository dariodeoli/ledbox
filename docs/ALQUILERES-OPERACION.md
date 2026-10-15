# Alquileres: operación de punta a punta (vajilla, mobiliario y decoración)

Caso real: La Vajilla Alquileres (PY), ~200 productos: juegos lounge (combos), mesas y sillas, vajilla/cubiertos/copas
a Gs. 2.500 c/u, mantelería, utilería, barras, infantiles. **El catálogo cobra por evento**, no por día.
Análisis del arquitecto (15-10-2026) sobre `origin/codex/ledbox-gestion-multiempresa` @ db1a519; todo lo que dice
«existe» está verificado en el código. Reglas: migraciones aditivas e idempotentes, montos `Int` PYG, `OPERATIONS` sin
plata, `VIEWER` sin acciones.

## 1. Tres fallas de hoy (P1, antes de que La Vajilla opere)
1. **El precio se multiplica por días**: `BudgetItem` = cantidad × días × precio y la tienda manda siempre
   `billingUnit: "DAILY"` (`lib/server/catalog-public.ts:391`); además `rentalDaysBetween` cuenta ambos extremos. Un
   juego de 660.000 entregado viernes y retirado domingo sale el triple.
2. **Un equipo atrasado figura libre**: `assignmentBlockedRange` solo extiende con `checkedInAt`; mientras no vuelve,
   bloquea hasta el fin planeado y puede ofrecerse a otro evento.
3. **Se aprueba sin stock**: `reserveBudgetInventory` «nunca lanza» y el portal aprueba igual
   (`app/api/portal/budget/[token]/approve/route.ts:107-124`) → doble reserva.

## 2. Ciclo y qué puede salir mal (resumen)
Tienda (pedido sobre el mínimo, sin zona/horario, juego al que le falta una pieza) → disponibilidad con colchones (la
vajilla lava 24–48 h, un sofá 2 h; varios eventos el mismo día) → retención 48 h (vence sin aviso) → seña y garantía
(no cobrada, no alcanza) → aprobación (sin stock) → cambios de último momento → sustitución → cancelación (sin
política escrita) → flete y armado por zona → entrega con remito y conteo firmado (parcial, «llegaron rotas») →
retiro (tarde, incompleto, roturas, sucio, manchas, daño de mobiliario; sin fotos ni firma se discute) → liquidación
(cargos − garantía = saldo) → postventa (morosos, pérdidas, lavandería, facturar extras) → comercial (mayorista,
precios por días, fechas pico).

## 3. Qué existe y qué falta
| Punto | Hoy | Falta | Riesgo |
|---|---|---|---|
| Precio por evento | `BillingUnit.EVENT` existe pero no se usa en tienda ni cálculo | modo por producto | alto |
| Disponibilidad y colchones | `buildAvailability`, `commitInventoryAssignment`, `resolveRentalBuffers` (empresa + producto) | colchón por categoría | medio |
| Retención | `holdExpiresAt`, `confirmHold` | aviso antes de vencer | medio |
| Aprobar con stock | — | chequeo previo con lock | alto |
| Devolución tarde | — | fin efectivo = max(fin, ahora), alerta y recargo | alto |
| Combos y sustitución | `inventory-combos.ts`, `findSubstitutes` | — | bajo |
| Lote y serie | por cantidad / `InventoryUnit` | — | bajo |
| Seña y garantía | `depositPercent`, `security-deposit.ts` (PENDING→HELD→RETURNED/KEPT_PARTIAL/KEPT) | ligarla a cargos y tesorería | alto |
| Remito y conteo firmado | `imprimir/evento/[id]` (firma en papel), `dispatchAssignment` parcial | remito numerado con snapshot, firma en el lugar y fotos | alto |
| Devolución parcial y faltantes | `returnAssignment`, `eventClosureBlockers` | — | bajo |
| Rotura, lavado, manchas | `InventoryIncident` DAMAGE/MISSING/CLEANING con `cost`, `replacementCost` | cargo al cliente | alto |
| Cancelación | CANCELLED/LOST liberan stock | política y retención de seña | medio |
| Flete, horarios, morosos | ítem libre; `Event.setupAt…strikeAt`; `Client.active` | zonas, franjas, bloqueo | medio |
| Mayorista y precios por días | `catalogAudience`, `wholesale*`, `listFromDays/listFromPrice` | — | bajo |

## 4. Plan
### P1
- **P1-1 Precio por evento** (ops, S): `InventoryItem.billingUnit` NOT NULL DEFAULT 'DAILY'; EVENT → días = 1 en
  `quoteProductPrice`, tienda (`QuoteItem.billingUnit`) y `catalog-convert` (`BudgetItem.days=1`); ficha, edición
  masiva, tienda («por evento») e Importar catálogo. QA: (1) juego EVENT de 660.000 viernes→domingo cotiza 660.000;
  (2) DAILY de 3 días sigue siendo el triple; (3) aprobados viejos no cambian; (4) mayorista con días = 1.
- **P1-2 Ajustes de alquiler** (infra+ui, M): en `OrganizationRentalSettings` `lateFeeMode`
  (PERCENT|FIXED_DAY|FIXED_HOUR), `lateFeeValue`, `lateGraceMinutes`, `damageChargeMode`
  (REPLACEMENT|PERCENT_REPLACEMENT), `damageChargePercent`, `cleaningFeePerUnit`, `stainFeeDefault`,
  `cancellationPolicy` JSONB `[{minDaysBefore, retainPercent}]`, `minimumOrderAmount`, `rentalTerms`; tabla
  `RentalCategoryBuffer(organizationId, category, beforeMin, afterMin)` con orden producto → categoría → empresa.
  Ajustes → Alquileres. QA: (1) sin fila rigen los defaults de §5; (2) negativos y % > 100 rechazados; (3) colchón
  «Vajilla» de 24 h bloquea el día siguiente y el de producto le gana; (4) OPERATIONS no guarda montos (403);
  (5) condiciones visibles en portal e impreso.
- **P1-3 Disponibilidad con atraso y aprobación con stock** (ops, M): fin efectivo `max(fin, ahora)` + colchón si
  salió y no volvió; aprobación verifica stock con lock antes de aprobar; portal «hay piezas sin disponibilidad, te
  contactamos» (queda en revisión); panel con «aprobar igual» solo OWNER/ADMIN y auditado; lista «Devoluciones
  vencidas». QA: (1) copa que salió el sábado sin volver figura ocupada el lunes; (2) dos aprobaciones concurrentes
  del último stock: una aprueba y otra queda en revisión (.pg); (3) «aprobar igual» auditado; (4) retención por vencer
  en < 6 h en el resumen.
- **P1-4 Cargos y liquidación con la garantía** (pay+ops, L, QA): modelo `RentalCharge` (budget/event/incident/
  assignment, `kind` LATE|DAMAGE|MISSING|CLEANING|STAIN|OTHER, cantidad, unitario, monto, `status`
  PROPOSED|APPLIED|WAIVED, motivo, `@@unique([incidentId, kind])`) + `ExpectedPaymentConcept.extra`.
  `returnAssignment` propone cargos; el equipo aplica o condona; «Liquidar» en transacción: cargos > garantía → KEPT +
  `ExpectedPayment` extra por la diferencia; si no, KEPT_PARTIAL/RETURNED con devuelto calculado; lo retenido entra
  como cobro confirmado (método «Garantía retenida») sin tocar `Budget.total`. UI en Evento → Devolución →
  «Liquidación» (dentro de `BudgetSecurityDeposit`); detalle en el portal. QA: (1) 12 copas × 15.000 = 180.000;
  (2) garantía 500.000 y cargos 180.000 → KEPT_PARTIAL, 320.000 a devolver; (3) cargos 700.000 → KEPT + extra
  200.000; (4) liquidar dos veces no duplica; (5) condonar exige motivo; (6) ajeno 404; (7) reportes de plata incluyen
  lo eliminado; (8) OPERATIONS propone pero no liquida.
- **P1-5 Remito de salida y de devolución firmados** (ops+pay, L, QA): `DeliveryNote` (OUT|IN, número correlativo
  por empresa, `linesSnapshot`, firmante, documento, trazo, fecha, ip/UA) + `DeliveryNotePhoto` (≤10, ≤1 MiB, magic
  bytes); firma DRAWN de `lib/server/signature` desde el celular del operador; impreso desde el snapshot. QA:
  (1) salida parcial = lo despachado; (2) snapshot inmutable tras firmar; (3) MIME falso rechazado; (4) número sin
  huecos con concurrencia (.pg); (5) usable a 360 px.
### P2
Cancelación con penalidad (retención sugerida por política, sin reembolso automático) · pedido mínimo (aviso, no
bloquea) · flete por zona (`DeliveryZone`) · clientes bloqueados (`Client.blockedAt/blockedReason`) · franjas de
entrega/retiro y agenda del camión · vista de lavandería · facturar cargos extra.
### P2 implementado: precio por días, flete por zona y paquetes
Un solo cálculo puro (`lib/price-tiers.ts`, `lib/delivery-zones.ts`) lo usan tienda, presupuesto, conversión del
catálogo, mayorista y portal. Todo en Int PYG.

**Precio por días** (`InventoryPriceTier`: producto, frente RETAIL|WHOLESALE, `fromDays`, `mode` PER_DAY|TOTAL, precio;
único por producto + frente + días). Para N días rige el escalón con el **mayor `fromDays` ≤ N**: PER_DAY = precio × N;
TOTAL = precio fijo del período (5 días por 300.000 = 300.000 también a los 10). Sin escalón: precio base × N, o una sola
vez si el producto es EVENT (EVENT ignora los escalones). Una línea TOTAL se guarda con `días = 1` y el total como precio
unitario (así `cantidad × días × precio` queda exacto al guaraní) y recuerda los días reales en
`BudgetItem.pricingSnapshot` (escalones y paquete congelados al crear la línea: el portal y los cambios de días
recalculan con eso, nunca con el inventario vivo; si alguien edita el precio a mano la línea queda fija). El piso de
venta (`minimumPrice`) aplica al precio por día, no a un total cerrado. Migración `202610220001`: el
`listFromDays/listFromPrice` y `wholesaleFrom*` viejos pasan a escalones **PER_DAY** (antes el precio «desde» se
multiplicaba por los días); las columnas viejas quedan sin uso y no se tocan. UI: tabla «Precio por días» en el alta y
la edición del producto (con vista previa «3 días = …, 5 días = …»), en la ficha y en Inventario → Combos; la tienda
muestra «desde 5 días: 300.000 total». Importar: `precios_dias` = `[{desde_dias, modo: "dia"|"total", precio}]` en el
JSON o `5:total:300000; 3:dia:90000` en la planilla (cliente final; vacío no toca lo cargado).

**Flete por zona** (`DeliveryZone`: nombre único por empresa, `basePrice`, `volumeThreshold`, `extraPrice`, notas,
orden, `archivedAt`). Regla: flete = precio base + recargo **si las piezas del pedido SUPERAN el umbral** (50 piezas con
umbral 50 no pagan; 51 sí). «Piezas» = suma de cantidades de las líneas de inventario (un combo cuenta por su
cantidad; el flete y las líneas libres no cuentan). Ajustes → Alquileres → «Zonas de flete» (alta, edición, archivar y
restaurar; `budgets.write`: OWNER, ADMIN y FINANCE; OPERATIONS y VIEWER no editan montos). En la tienda el cliente elige
zona (opcional) o «A coordinar»; el pedido guarda el id y el NOMBRE de la zona. Al convertir se crea la línea
«Flete — <zona>» editable a mano; el presupuesto es un snapshot: editar, archivar o borrar la zona no lo cambia. Si la
zona se borró antes de convertir no se inventa un monto: queda una nota para coordinar. En el editor del presupuesto,
«Flete por zona» calcula con las piezas actuales.

**Paquetes (combos con precio)**. El combo ya reserva todas sus piezas; ahora además: precio del paquete (el precio del
combo, con sus propios escalones), **suma por unidad** (precio de cada pieza × cantidad con la regla de días de cada
una) y **ahorro** = suma − paquete (nunca negativo; si falta el precio de alguna pieza no se muestra ahorro) en
presupuesto, tienda y portal. Si una pieza no alcanza (cotizar: `GET /api/admin/inventory/combos?pricing=1`; aprobar:
`reserveBudgetInventory` → `comboParts`) se listan **alternativas reales** (`findSubstitutes`: misma categoría, con
stock libre, que no sean parte del paquete ni otro combo) con la **diferencia de precio**
`cantidad por paquete × (total del sustituto − total de la pieza)` para los mismos días. **Regla de re-precio: precio
del paquete + diferencia** (nunca por debajo de 0); sin precio en alguna de las dos piezas la diferencia es «sin precio»
y el equipo fija el monto. El presupuesto no se modifica solo: en el editor, «Usar este precio» fija la línea al total
con el reemplazo; la sustitución en un evento ya reservado (`substituteComboComponent`) informa la diferencia y el
paquete re-precificado. Un combo de categorías mixtas («Evento completo»: tótem + piso + impresión + sillas) se arma
en Inventario → Combos con su precio de paquete.

### P1-2 y P1-4 implementados: ajustes de alquiler, cargos y liquidación
Decisión del dueño (manda sobre el texto de arriba): **todo configurable por empresa, con valores por defecto y
editable en cada caso**. Reglas puras en `lib/rental-charges.ts`; datos y liquidación en `lib/server/rental-settlement.ts`.

**Ajustes → Alquileres** (`OrganizationRentalSettings`, migración `202610250001`): garantía (`securityDepositMode`
NONE|OPTIONAL|ALWAYS, `securityDepositPurpose` RESERVE|DAMAGES, `securityDepositCalc` FIXED|PERCENT|PER_PRODUCT con
`securityDepositDefault` como monto fijo, `securityDepositPercent` y `securityDepositRules` por producto o categoría; el
producto gana a la categoría); recargo por demora (`lateFeeKind` PERCENT|FIXED, `lateFeeUnit` DAY|HOUR, `lateFeeValue`,
`lateGraceMinutes`; default 10 % por día, 2 h de tolerancia); `damageChargePercent` (default 100 % de `replacementCost`);
`customCharges` (lista `{id, name, amount, unit PIECE|EVENT, categoryId?}`; reemplaza a `cleaningFeePerUnit` y
`stainFeeDefault` del texto original); `cancellationPolicy` (`[{minDaysBefore, retainPercent}]`, defaults de §5) y
`rentalTerms` (portal e impreso). Cada bloque muestra el monto en vivo («2 días tarde = 120.000»). Las empresas que ya
tenían garantía por defecto pasan a `ALWAYS`. La garantía del presupuesto se puede cambiar (monto y propósito:
`Budget.securityDepositPurpose`; NULL = daños, como antes) y «Calcular según Ajustes» la recalcula.

**Garantía de reserva**: al marcarla recibida entra como cobro confirmado «Garantía de reserva» (cobro + movimiento de
tesorería) y el saldo baja; no se devuelve ni se retiene a mano. **Garantía de daños**: queda en custodia hasta liquidar.

**Cargos** (`RentalCharge`, `dedupeKey` único por presupuesto): `returnAssignment` propone (PROPOSED) dentro de su
transacción la rotura/faltante (cantidad × % del costo de reposición), y la demora (% del alquiler de las piezas tarde,
o monto fijo una vez por evento). Quien tiene `budgets.write` (OWNER, ADMIN, FINANCE) los aplica, edita, condona (motivo
obligatorio) o reabre, y agrega los de la lista de la empresa (se ofrecen según la categoría de lo devuelto). OPERATIONS
solo dispara la propuesta al devolver: no ve montos de la liquidación ni decide.

**Liquidar** (`POST /api/admin/budgets/settlement`, `action: "settle"`): una transacción con `FOR UPDATE` del presupuesto,
idempotente (`rentalSettledAt`). Exige todo devuelto, sin cargos PROPOSED y garantía recibida. Garantía de daños:
retiene `min(cargos, garantía)` (cobro «Garantía retenida» + movimiento IN), devuelve el resto (RETURNED, KEPT_PARTIAL o
KEPT) y lo que excede queda como `ExpectedPayment` `extra` (slot `extra:settlement`, que el sincronizado del plan no
cancela). Garantía de reserva o sin garantía: todos los cargos van como `extra`. Nunca toca `Budget.total`. El cliente ve
cargos decididos, liquidación, condiciones y política de cancelación en el portal; el impreso del presupuesto trae las
condiciones, la política y los cargos.

**Cancelación**: `GET /api/admin/budgets/settlement?budgetId=…&cancellation=1` y el diálogo de la garantía muestran la
retención PROPUESTA de lo cobrado según la política; no reembolsa ni mueve plata. **Pendiente**: colchón por categoría
(`RentalCategoryBuffer`, P1-2 QA 3), que toca el motor de disponibilidad (`resolveRentalBuffers` y sus 6 llamadores).

### P3
Precios de temporada, flete por km, comisión del planner, ranking de roturas, aviso automático de devolución vencida.

## 5. Configuración por empresa (defaults)
Recargo por demora 10 % del alquiler por día (gracia 2 h) · rotura o faltante 100 % de `replacementCost` · lavado
Gs. 1.000 por pieza · mancha Gs. 30.000 · colchón: vajilla, copas y mantelería 24 h; mobiliario, lounge, toldos y
sombrillas 4 h · cancelación: ≥15 días 0 %, 7–14 días 50 % de la seña, < 7 días 100 % · pedido mínimo sin mínimo ·
seña 50 % · garantía sin garantía · retención 48 h · flete sin zonas.

## 6. Riesgos
La garantía hoy no pasa por tesorería (choca con #175): P1-4 con QA de pay, idempotente y con `FOR UPDATE` del
presupuesto; nunca tocar `Budget.total`. Todo compromiso de stock por `lockInventoryItems`. Cada modelo nuevo con
`organizationId`. El default DAILY protege los datos viejos. Revisar `maxEventsPerMonth` del plan de La Vajilla para
diciembre. Rollback: columnas aditivas y nulables; ajustes en null = comportamiento actual.
