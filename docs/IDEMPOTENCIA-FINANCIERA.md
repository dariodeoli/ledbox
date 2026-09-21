# Idempotencia y snapshots financieros (issue #20)

> Estado: implementado en la rama `feat/idempotencia-financiera`.
> Regla madre: `docs/REGLAS-GENERALES.md` §8 (dinero y datos críticos).

## 1. Capa única de idempotencia

`lib/server/idempotency.ts` es la única puerta de las mutaciones financieras.
Cada request lleva una **clave por intento**:

- Header `Idempotency-Key` (lo manda el cliente del panel) o `idempotencyKey` en el body.
- La clave se agrupa por empresa y por operación (`scope`, p. ej. `finance:POST:client`),
  así la misma clave puede usarse en endpoints distintos sin chocar.

Tabla `IdempotencyKey` (aditiva, `202609210015_idempotency_snapshots`):

| Campo | Para qué |
| --- | --- |
| `organizationId` + `scope` + `key` | índice único: el candado real |
| `requestHash` | hash del cuerpo normalizado (sin la clave): la misma clave con otro cuerpo responde 409 |
| `status` + `response` | la respuesta original, tal cual se devolvió |
| `expiresAt` | vencimiento a 7 días (`IDEMPOTENCY_TTL_DAYS`) |

La operación, sus escrituras y el resultado se confirman **en la misma
transacción**. Consecuencias:

- Repetir la misma clave devuelve la misma respuesta (`Idempotent-Replay: true`)
  sin volver a tocar los datos.
- Una validación o conflicto devuelve su `Response` sin dejar clave ni fila.
- Carrera de dos requests con la misma clave: el índice único define el ganador;
  el perdedor revierte completo (no queda ningún dato suelto) y responde con el
  resultado del ganador.
- Sin clave, la operación corre igual (misma transacción) pero sin protección de
  reintentos, para no romper clientes viejos.

`purgeExpiredIdempotencyKeys()` borra las claves vencidas y se ejecuta al inicio
de cada operación con clave (determinista, sin cron).

### Operaciones cubiertas

| Endpoint | `scope` |
| --- | --- |
| `POST /api/admin/finance` (`kind: client`) | `finance:POST:client` |
| `PATCH /api/admin/finance` (collect/cancel) | `finance:PATCH:client` |
| `POST /api/admin/expenses` | `expenses:POST` |
| `PATCH /api/admin/expenses` | `expenses:PATCH` |
| `POST /api/admin/treasury` (`account`/`movement`/`supplier-payment`) | `treasury:POST:<kind>` |
| `PATCH /api/admin/treasury` (`account`) | `treasury:PATCH:account` |
| `POST /api/admin/suppliers/jobs` | `suppliers-jobs:POST` |
| `PATCH /api/admin/suppliers/jobs` | `suppliers-jobs:PATCH` |

Los comprobantes del portal (`/api/portal/budget/[token]/proof`) **no** se
tocaron en este cambio (el portal quedó fuera del alcance del workstream); la
capa queda lista para envolverlos cuando se trabaje ese frente.

## 2. Snapshots inmutables

`lib/server/finance-snapshots.ts` es la fuente única de las copias que se
guardan al momento de la operación:

- **`TreasuryMovement.sourceSnapshot`**: el hecho que originó el movimiento
  (`{ kind, label, amount, ref }`) con la etiqueta legible de ese instante. La
  lista de tesorería lo lee antes que la fuente viva; los movimientos anteriores
  a la migración caen a la lectura viva (comportamiento histórico, no se inventa
  hacia atrás).
- **`ClientPayment.collectedSnapshot`**: el detalle del cobro al confirmarlo
  (fecha real, monto, método, referencia, factura, y los nombres del cliente,
  presupuesto y cuenta del momento).

Qué **no** se snapshotea, y por qué:

- **Saldos de tesorería**: no se guardan; se derivan de los movimientos.
- **La aprobación del presupuesto y el plan de pagos del portal**: se snapshotea
  en el frente del portal (fuera de este cambio); hoy siguen leyendo el
  presupuesto vivo.
- **Los comprobantes de pago del portal**: ya son inmutables por naturaleza (el
  binario y sus metadatos se guardan tal cual).
- **Los datos propios del gasto**: el gasto es el hecho mismo, no una
  referencia; al editarlo, su movimiento sincroniza monto, cuenta, fecha y
  etiqueta (misma verdad, sin historia duplicada).

## 3. Transiciones monotónicas

- **Cobros**: `collect` sobre un cobro ya cobrado y `cancel` sobre uno ya
  anulado responden 200 con el estado actual (`unchanged: true`), sin escribir ni
  auditar. Un retroceso real (cobrar un anulado, anular un cobrado) responde 409
  sin tocar nada.
- **Trabajos de proveedor**: un pedido atrasado (fuera de la máquina de estados
  y por detrás del avance actual, p. ej. `CONTRACTED` cuando ya está
  `IN_PRODUCTION`) responde 200 con el trabajo tal como está
  (`supplierJobStatusBehind` en `lib/admin-types.ts`), sin auditar. Los estados
  terminales (`PAID`, `CANCELLED`) no se reabren.
- **Pagos a proveedor**: un trabajo cerrado no admite pagos (409); con la misma
  clave, el reintento devuelve el movimiento original.

## 4. UI

`lib/admin-api.ts` (`adminSend`) es el único transporte:

- `{ idempotencyKey: true }` genera una clave por intento y la manda en
  `Idempotency-Key`; si el request se queda sin respuesta, reintenta una vez con
  **la misma clave**.
- Dos mutaciones idénticas en vuelo (mismo método, ruta y cuerpo) comparten la
  misma promesa: una doble activación no dispara dos requests.
- `FinanzasModule.tsx` y `ProveedoresModule.tsx` mandan la clave en todas sus
  operaciones financieras.

## 5. Auditoría

La auditoría viaja en `afterCommit`: corre después del commit y **una sola vez**,
solo para el request que completó la operación. El reintento idempotente no
genera una segunda entrada (verificado en el smoke).
