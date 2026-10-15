# Inventario: rediseño para catálogos grandes (categorías, depósitos, códigos y conteos)

Caso: La Vajilla (~200 productos de vajilla, mobiliario y decoración). Arquitecto, 15-10-2026, sobre `origin/codex/ledbox-gestion-multiempresa`
@ db1a519 más las ramas `agent/alquiler-p1` y `agent/importar-catalogo`. Migraciones aditivas e idempotentes (las aplica el deploy), todo con `organizationId`.

## 1. Qué existe (auditado) y la decisión que cambia todo
- **Cada producto ya tiene una fila `InventoryUnit` por unidad** (issue #112): `quantity` = unidades no retiradas (`syncInventoryQuantity`),
  código `PREFIJO-NN` único por empresa, estados AVAILABLE/MAINTENANCE/DAMAGED/LOST/RETIRED y `purchaseCost` por unidad. **Decisión: depósito y
  ubicación viven en la unidad** y el «stock por depósito» es un `groupBy` de unidades. No se crea `InventoryStock(quantity)`: sería un segundo
  número que puede no cuadrar con `quantity`. Así no hay desfasaje posible.
- Motor reutilizable: `buildAvailability`, `maintenanceUnits` (unidades fuera + `incidentHold`), `assignmentIsActiveNow`, `lockInventoryItems`,
  `createIncident` (retiene por cantidad bajo lock), combos sin stock propio (`inventory-combos.ts`).
- `category` es texto libre (≤80, «General»). Lo usan `findSubstitutes` (igualdad de texto), el catálogo público (agrupa y ordena), importar
  catálogo (`categoria`), la IA de carga, la edición masiva y P1-2 (`RentalCategoryBuffer` por texto). **Se conserva** como espejo del nombre.
- Ya existen: `Supplier` (con papelera), `lib/qr.ts` + `qrcode` (QR en SVG), hojas `/imprimir/*` con `lbprint`, ficha con `?producto=<id>`,
  `AdminViewSwitch` lista/cuadrícula. `GET /api/admin/inventory` trae hasta 300 ítems **con todas sus unidades** y 1000 asignaciones globales: no escala.
- **Bloqueante para la cámara**: `next.config.mjs` manda `Permissions-Policy: camera=()` a todo el sitio. No existen categorías, depósitos, condición ni conteos.

## 2. Modelo de datos (una migración por etapa con `IF NOT EXISTS`; número posterior al último de la rama de integración)
**E1 · `InventoryCategory`**: `id, organizationId, name(≤60), parentId?` (un nivel de subcategoría), `key` (ruta normalizada sin tildes ni
mayúsculas: «vajilla/copas»), `sortOrder, color?` (de la paleta de tonos), `icon?` (`AdminIconName`), `archivedAt?`, fechas;
`@@unique([organizationId, key])`. `InventoryItem.categoryId?` (SetNull).
- Backfill en la misma migración: por cada `(organizationId, trim(category))` distinto, `INSERT … ON CONFLICT DO NOTHING` con id determinístico
  (`'cat_' || md5(org || key)`); «Vajilla > Copas» o «Vajilla / Copas» crea padre e hija. Después `UPDATE … SET categoryId WHERE categoryId IS NULL`
  por key. Se puede correr de nuevo; el texto no se toca.
- **Un solo escritor**: `resolveInventoryCategory(tx, org, { categoryId | texto })` en `lib/server/inventory-categories.ts` busca por key o crea, y
  escribe `categoryId` + `category` = «Padre › Hija». Lo usan alta/edición, edición masiva, importar catálogo, IA de carga y demo. Renombrar o mover
  una categoría reescribe el texto de sus productos en la misma transacción. Test de fuente: nadie escribe `category` sin el helper.
- `findSubstitutes` compara `categoryId` (texto si es NULL). El catálogo público sigue con el texto (sin cambio de contrato).
- Colchón por categoría (P1-2): si E1 entra antes, va como `bufferBeforeMin/AfterMin` **en `InventoryCategory`** (sin `RentalCategoryBuffer`);
  si P1-2 ya creó la tabla, se le suma `categoryId` y el backfill la liga. Nunca dos lugares para el mismo colchón.

**E1 · `Warehouse`**: `id, organizationId, name(≤60), code(≤6, «D1»), address?, sortOrder, isDefault, archivedAt?`, `@@unique([organizationId, code])`.
Backfill: «Depósito principal · D1» (id `'wh_' || md5(org)`) solo en empresas con unidades. Con unidades se archiva, no se borra (409).
- `InventoryUnit`: `warehouseId?` (backfill al principal), `location?` (≤20). `InventoryItem`: `defaultWarehouseId?`, `defaultLocation?` (para altas).
- **Abreviatura** = `warehouse.code` + «-» + `location` → «D1-E3-B2». `location` se normaliza en `lib/field-rules.ts` (mayúsculas, segmentos
  `[A-Z0-9]{1,4}` con guion, hasta 4). Se guarda separado para que cambiar el código del depósito no rompa nada.
- Las reservas **no eligen depósito** en E1–E4: la disponibilidad sigue global por producto y el depósito dice dónde buscar. Depósito al despachar: P2.

**E1 · Condición, proveedor y compra**
- `conditionScore SmallInt?` con `CHECK` 1..10 (en `DO $$`), **en la unidad**; se muestra «8/10 · 80 %». El producto muestra promedio y peor
  unidad, calculado (una sola verdad). Se carga en lote con `bulk-units`.
- `InventoryItem`: `supplierId?, purchasedAt?, warrantyUntil?` (lote principal). `InventoryUnit`: los mismos (NULL = hereda) + su `purchaseCost`. FK SetNull.
- Acción «Registrar compra» (proveedor, fecha, cantidad, costo por unidad, garantía, depósito) extiende `createInventoryUnits`. Sin costo nuevo en el ítem.

**E3 · Códigos**: `labelCode` inmutable y único global (`P` + 11 hex en producto, `U` + 11 hex en unidad); backfill en `DO $$` fila por fila con
reintento ante choque; las altas lo generan. `InventoryItem.barcode?` (≤32, EAN del fabricante; único por empresa si no es NULL). SKU y `unit.code`
se aceptan al escanear o tipear pero **no van en el QR** (son editables; una etiqueta pegada no se puede romper).
- QR = `<adminUrl>/q/<labelCode>`: no hace falta firmarlo porque no lleva datos; `/q/*` exige sesión y resuelve solo en la empresa activa (si es de
  otra empresa del usuario, ofrece cambiar; si no, «Etiqueta no encontrada»). Sin sesión lleva al login. Código de barras Code 128-B del mismo código.

**E4 · Conteos**: `InventoryCount` (`id, organizationId, number` correlativo, `warehouseId, categoryId?` alcance, `status` OPEN|SUBMITTED|APPLIED|
CANCELLED, `startedById/At, submittedById/At, appliedById/At, notes`; índice único parcial: un OPEN/SUBMITTED por depósito).
`InventoryCountLine` (`countId, organizationId, inventoryId, unitId?, expected, outAtStart` = despachado sin volver al abrir, `counted,
conditionScore?, firstScanAt, lastScanAt, resolution` NONE|ADJUST_UP|MISSING|MOVED|IGNORED, `incidentId?`; únicos parciales por producto sin unidad
y por unidad). `InventoryCountScan` (`id` = uuid generado en el celular, idempotente ante reintentos; `lineId, delta, byId, at`).
`lastVerifiedAt?, lastVerifiedById?` en ítem y unidad. `InventoryIncident.countId?` (SetNull).

## 3. Reglas de servidor
- Permisos: categorías y depósitos en Ajustes `org.manage`; alta rápida de categoría en el formulario, unidades, ubicación, condición, proveedor y
  **contar** `inventory.write` (OPERATIONS sí); **aplicar un conteo** capacidad nueva `inventory.adjust` (OWNER/ADMIN) en `lib/server/permissions.ts`.
  VIEWER y FINANCE ven, buscan escaneando e imprimen etiquetas (lectura).
- Multiempresa: todo `categoryId/warehouseId/supplierId/unitId` recibido se valida con `findFirst({ id, organizationId })`; ajeno → 404.
- Mover entre depósitos: `bulk-units` suma `warehouseId/location`; «Mover N de D1 a D2» toma unidades AVAILABLE por orden de código.
- Aplicar conteo, en una transacción con `lockInventoryItems` de sus productos: (1) línea vieja si hubo despacho, devolución, incidente o cambio de
  unidad después de su `firstScanAt` → «volver a contar» o «aplicar igual» auditado; (2) sobrante sin serie → `createInventoryUnits` en el depósito
  con nota «Alta por conteo #N»; (3) faltante → `createIncident` MISSING (con `unitId` si tiene serie, si no por cantidad) y `countId`; (4) unidad
  escaneada en otro depósito → MOVED; (5) `lastVerified*`; (6) un `recordAudit` con el detalle. Antes se muestran las reservas que quedan sin stock.
- Esperado por línea = unidades del depósito no LOST/RETIRED; si hay `outAtStart > 0` y el producto está en un solo depósito, se descuenta; si está
  repartido, la línea queda «revisar» y **no** propone MISSING automático (las salidas no registran unidad ni depósito).
- Cronología `GET /api/admin/inventory/history?inventoryId&unitId&cursor`: une `EventInventory` (evento, cliente, salida, vuelta, dañado, faltante),
  incidentes, líneas de conteo y `AuditLog` (solo OWNER/ADMIN, como hoy). Métricas en SQL, sin columnas: **veces alquilado** = eventos con
  `checkoutQuantity > 0` no liberados; **días** = Σ (`checkedInAt` o ahora − `checkedOutAt`); **último uso** = última vuelta con su evento.
  Por unidad no hay historial de alquiler (las salidas no dicen qué unidad): la ficha de la unidad lo aclara, sin inventar.

## 4. Estado visual: un mapa único
`lib/inventory-visual-state.ts` (puro, con tests) recibe el bloque `availability` del API, ya con el atraso de P1-3, y devuelve `{ key, tone, icon, label }`.

| Estado (en orden de precedencia) | Cuándo (dato real) | Tono · ícono |
|---|---|---|
| Archivado | `archivedAt` | neutral · archive |
| Fuera de servicio | `status` MAINTENANCE/RETIRED del producto | info · wrench |
| Devolución vencida | P1-3: salió, no volvió y pasó el fin | danger · clock |
| Alquilado ahora | `availableNow = 0` y `committedNow > 0` | danger (rojo) · truck |
| Dañado | `availableNow = 0` con DAMAGED/LOST o retención DAMAGE/MISSING | warn (naranja) · alert |
| Mantenimiento / lavandería | `availableNow = 0` con MAINTENANCE o retención REPAIR/CLEANING | info (azul) · wrench |
| Disponible | `availableNow > 0` | ok (verde) · check |

Parciales: chip principal + barra segmentada verde/rojo/naranja/azul y «12/40»; «Reservado desde 18/10» (accent · calendar) si hay reserva futura.
El API suma `unitsByStatus`, `holdByKind` y `nextCommittedAt`. Unidad: AVAILABLE ok, DAMAGED warn, MAINTENANCE info, LOST danger, RETIRED neutral.
Siempre ícono + texto. Faltan en `globals.css` `--a-info-surface/-text` y `--a-accent-surface/-text` (AA ≥ 4.5 medido en claro y oscuro) y anotar
en `DISENO-PANEL.md` §3 la excepción de inventario (azul y violeta como estado).

## 5. Pantalla (se actualiza la sección Inventario de DISENO-PANTALLAS.md)
1. Encabezado: **Nuevo producto** (principal), Escanear, Importar (de importar-catalogo), Incidentes (n). A 390 px, Escanear fijo abajo (44 px).
2. Los 5 KPIs que filtran. 3. Barra fija: búsqueda (nombre, SKU, código de unidad, barcode), Categoría (árbol), Depósito, Estado (los del mapa),
   Proveedor, rango «Disponible desde/hasta» y vista **Lista · Cuadrícula · Por categoría**.
4. Lista: la de hoy + columna «Ubicación» (D1-E3-B2 o «3 depósitos») y el chip nuevo, en la misma `--inventario-cols`.
5. Cuadrícula compacta `.admin-inv-grid` (`minmax(148px, 1fr)`: 8 por fila a 1440, 2 a 390): foto 64 px, nombre en 2 líneas, código, chip, «libres/total».
6. Por categoría: secciones por `sortOrder`, encabezado pegajoso con conteo y libres, plegables. 7. Payload `?fields=grid`: sin unidades ni asignaciones, con agregados por `groupBy` y paginado por cursor (sin tope de 300). La ficha trae el detalle.
8. Ficha: Datos · Disponibilidad · Stock por depósito · Unidades (filtro por depósito, condición, lote) · Precios · Tienda web · Combos · Proveedor y
   garantía (vence en < 30 días resaltado) · Verificación · Cronología (reemplaza Incidentes e Historial). Tienda y Combos solo si aplican.
9. Ajustes → **Inventario** (`/ajustes/inventario`, restringida): Categorías (árbol, «Mover a…», color, ícono, unir dos, archivar) y Depósitos.

## 6. Escaneo y etiquetas
- `components/admin/AdminScanner.tsx` (único): `BarcodeDetector` (qr_code, code_128, ean_13) si existe; si no (Safari de iPhone), `jsqr` con versión
  exacta e `import()` dinámico solo ahí, para QR. Siempre un campo manual que también recibe lectores de mano (teclado + Enter). Cámara trasera,
  vibración al leer, anti-rebote de 1,5 s por código. `Permissions-Policy: camera=(self)` **solo** en `/inventario*` y `/q/*`.
- Modo **Buscar**: abre la ficha (pestaña Unidades si fue una unidad). Modo **Conteo** (E4): elige depósito; cada lectura suma 1 o marca la unidad;
  ± y «cantidad» para cajas; esperado/contado en vivo; cola local con uuid por lectura si se corta la señal.
- `GET /api/admin/inventory/scan?code=` resuelve `labelCode` → `unit.code` → `sku` → `barcode`, con límite de pedidos.
- `/imprimir/etiquetas?items=&units=&formato=` (A4 3×8 de 70×37 mm y 4×10 de 48×25 mm): QR SVG (`lib/qr.ts`), Code 128 SVG de
  `lib/barcode-code128.ts` (puro, sin dependencia), nombre, código y ubicación. 300 copas = 1 etiqueta de estante, no 300.

## 7. Etapas (cada una se publica sola)
| Etapa | Dueño | Tamaño | Espera a |
|---|---|---|---|
| E1 Datos: categorías, depósitos, ubicación, condición, proveedor y compra, backfill, helper único, Ajustes → Inventario y campos | infra + ops + ui | M | integrar alquiler-p1 e importar-catalogo (tocan schema, `route.ts`, `InventoryItemDialogs`, `inventory-bulk`, `import-catalog`) |
| E2 Pantalla: mapa de estados y tokens, cuadrícula, por categoría, filtros, payload liviano, pestañas nuevas | ui + ops | L | E1 y P1-3 |
| E3 Códigos: `labelCode`, barcode, `/q`, scan, etiquetas, escáner Buscar, header de cámara | ops + ui + infra | M | E1 (en paralelo con E2) |
| E4 Conteos, Verificación y Cronología | ops + ui, con QA | L | E2 y E3 |

superadmin-alta solo comparte el número de migración y `globals.css`. Máximo 3 agentes a la vez: E2 y E3 juntas.

## 8. QA por etapa
**E1** 1) Productos con «Vajilla», «vajilla », «Sillas»: se crean 2 categorías por empresa y todos quedan ligados; correrlo dos veces no duplica (.pg).
2) Nada de la empresa A aparece en B; id ajeno → 404. 3) Renombrar «Sillas» → «Sillería» cambia texto, tienda y sustitutos. 4) Importar
`categoria: "Mobiliario / Sofás"` crea o asocia padre e hija sin duplicar. 5) Todas las unidades quedan en D1; «Mover 120 a D2» deja 120 en D2 y
`quantity` igual. 6) «d1 e3 b2» se guarda E3-B2 y se ve D1-E3-B2. 7) Condición 0 u 11 → 400. 8) Proveedor de otra empresa → 404. 9) VIEWER 403 en
todo lo mutante; OPERATIONS no entra a Ajustes → Inventario. 10) La demo carga completa.
**E2** 1) Cada fila del mapa con un caso real en test puro y en pantalla. 2) Ningún estado se calcula fuera del mapa (test de fuente). 3) 250
productos: 8 por fila a 1440, 2 a 390, sin scroll horizontal. 4) Filtros combinados. 5) AA ≥ 4.5 de los 6 tonos en los dos temas. 6) Capturas 1440/390.
**E3** 1) El QR impreso abre la ficha desde Chrome de Android (nativo) y Safari de iPhone (jsQR). 2) Otra empresa: «Etiqueta no encontrada»; sin
sesión: login y vuelve. 3) Un lector de mano busca igual. 4) El Code 128 lo lee un lector físico (vector de prueba). 5) A4 3×8 imprime 24 alineadas.
6) `camera=(self)` solo en `/inventario` y `/q`. 7) Cambiar el SKU no rompe etiquetas ya impresas.
**E4** 1) D1: 48 copas contadas de 50 → al aplicar, MISSING de 2 con `countId` y capacidad −2. 2) Dos celulares sobre el mismo producto suman bien y
una lectura reintentada no cuenta doble (.pg). 3) Un despacho durante el conteo marca «volver a contar». 4) Segundo conteo abierto en D1 → 409.
5) OPERATIONS cuenta y envía, no aplica (403); OWNER aplica y queda auditado. 6) Aviso de reservas sin stock. 7) Cronología: 3 eventos → «3 veces,
7 días, último 12/10»; VIEWER no ve la auditoría. 8) Usable a 390 px con una mano.

## 9. Riesgos y vuelta atrás
- Stock que no cuadra: evitado al no guardar cantidades por depósito; test que compara `quantity` con unidades activas por depósito. Volumen (miles de unidades): `groupBy` e índice `(inventoryId, warehouseId, status)`.
- Conteo y reservas: el conteo no toca reservas; ajusta con incidentes bajo lock y avisa conflictos antes de aplicar.
- Ramas paralelas: E1 después de integrar alquiler-p1 e importar-catalogo; `next.config.mjs` lo tocan importar-catalogo y E3 (combinar).
- Vuelta atrás: todo es aditivo y el texto `category` sigue intacto; revertir el código deja columnas sin uso sin romper nada; el escáner y `camera=(self)` se apagan revirtiendo E3.

## 10. Dudas para el dueño
1. El rojo de «alquilado» es el mismo de «vencido» en todo el panel. ¿Lo dejamos así o usamos violeta para alquilado y rojo solo para devolución vencida?
2. ¿Alcanza con un nivel de subcategoría (Vajilla › Copas) o hacen falta más?
3. ¿Quién aprueba las diferencias de un conteo: solo dueño y administrador, o también el encargado de depósito?
