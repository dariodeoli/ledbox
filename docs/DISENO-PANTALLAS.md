# Rediseño por pantalla — orden objetivo

Complemento de `docs/DISENO-PANEL.md` para la pasada por pantalla del rediseño
(22-09-2026). Regla general: **primero lo urgente/accionable, después lo
operativo, al final lo descriptivo**. Cada pantalla tiene **una** acción
principal, y el encabezado va en el ritmo fijo de la guía (§4).

## Inicio (`/dashboard`)

Responde: *¿qué hago ahora y cómo viene el mes?* (rediseño del 13-10-2026,
detalle en `docs/DISENO-PANEL.md` §15)

| # | Bloque | Por qué |
| --- | --- | --- |
| 1 | **Para hacer hoy** (hasta 5 acciones por urgencia, con botón) | Es lo accionable: mora, leads sin contestar, comprobantes |
| 2 | Embudo del mes (Leads → Presupuestos → Aprobados → Eventos) | El pulso comercial; cada etapa abre su lista |
| 3 | Plata (por cobrar, en mora, cobrado del mes) | La foto financiera sin abrir Finanzas |
| 4 | Esta semana | Agenda operativa con su checklist o seña |

Acción principal: **Nuevo lead**. Por pagar y caja comprometida viven en Finanzas.

## Eventos (`/eventos`)

Responde: *¿qué eventos tengo y qué le falta a cada uno?*

1. KPIs que filtran al tocarlos (botones con `aria-pressed`; se quitan con «Quitar filtro»):
   próximos 7 días · en curso · con faltantes o checklist incompleto · por cerrar
   (pasaron sin finalizar) · **tareas vencidas** (abre la vista «Tareas» ya filtrada).
   Misma fuente de verdad para el conteo y para el filtro (`lib/event-readiness.ts`).
   «Con faltantes» cuenta todos los eventos abiertos con algo por resolver (el
   despacho solo pesa dentro de los 7 días previos).
   La seña sale de `GET /api/admin/events/readiness` (agregada en la base, sin el tope
   de 200 del listado de presupuestos); sin dato se muestra «—».
2. Barra fija: selector de vista (Lista · Tarjetas · Calendario, no se mueve entre
   vistas) · búsqueda · estado · **Nuevo evento**.
3. Lista: fecha y hora · evento · cliente · lugar · **preparación** · estado ·
   **siguiente paso**. La preparación son cuatro chips compactos: checklist x/y,
   equipos despachados x/y (los combos se mueven por componentes y no cuentan),
   seña (cobrada / pendiente / sin dato) y promotoras asignadas. Una sola acción
   visible por fila, la siguiente lógica: *Completar checklist → Despachar →
   Registrar devolución → Finalizar*; el resto va en «•••» (abrir detalle, editar,
   cronología, imprimir, WhatsApp, finalizar). El VIEWER no ve acciones de escritura.
4. Celular (≤ 980 px): tarjetas con la fecha destacada, estado, preparación, lo
   primero que falta y la siguiente acción (44 px de alto táctil).
5. Detalle: diálogo centrado amplio (`AdminDialog size="ficha"`, abre también con
   `?evento=<id>`, que es lo que enlaza la etapa «Evento» del presupuesto). Arriba la
   franja **Qué falta** (cada ítem lleva a su pestaña); pestañas Resumen (datos,
   responsable, presupuesto vinculado con `StageTrail` y seña), Checklist, Equipos
   (asignación, despacho, devolución parcial, incidentes, combos), Personal
   (promotoras y sus tareas) e Historial. El pie lleva la siguiente acción y «•••».

6. Pestaña **Tareas** (`?vista=tareas`, no es parte del selector de vista): todas las
   tareas pendientes de los eventos abiertos con el mismo checklist de siempre;
   filtros Pendientes · Vencidas · Esta semana y por promotora; marcar como hecha
   solo con permiso de operación; avisa de las promotoras no disponibles.

Acción principal: **Nuevo evento**. Orden por defecto: lo que está en juego primero
(en curso o por empezar con checklist abierto), lo pasado al final.

## Presupuestos (`/presupuestos`)

Responde: *¿qué está en juego y qué tengo que enviar o seguir?*

1. KPIs: vigentes · por vencer (7 días) · aprobados del mes · monto en juego.
2. Filtros: estado · vencimiento · búsqueda.
3. Tablero o lista.
4. Acciones: abrir portal, enviar, WhatsApp con plantilla, timeline.

Acción principal: **Nuevo presupuesto**.

## Finanzas (`/finanzas`)

Responde: *¿cuánto tengo, cuánto me deben y qué está sin confirmar?*

1. KPIs de dinero (cobrado, por cobrar, por confirmar, anticipos, saldo por pagar).
2. **Por confirmar** (pagos esperados con comprobante o sin él): lo que requiere
   decisión hoy.
3. **Cobros** (mora arriba: vencidos primero).
4. **Tesorería** (cuentas y saldos).
5. **Conciliación bancaria** (extracto contra libros).
6. **Gastos**.
7. Reportes/exportaciones al final (son de consulta, no del día).

Acción principal: **Registrar gasto**; secundaria, `Reporte mensual`.

## Clientes (`/clientes`)

Responde: *¿a quién le vendo y qué le falta a su ficha?*

1. KPIs: activos · nuevos del mes · con saldo pendiente.
2. Buscador + filtros (tipo, con/sin responsable cargado).
3. Lista con avatar, contacto y links directos.
4. Ficha 360 en diálogo (`size="ficha"`) con contratación y cronología.

Acción principal: **Nuevo cliente**. El «sin responsable cargado» se señala en
la fila porque afecta a la autorización del presupuesto.

## Facturación (`/facturacion`)

Responde: *¿qué facturé, qué compras tengo y cómo va el mes?*

1. Pestañas: Facturas · Compras · Libro de IVA · Cierre mensual · Datos fiscales.
2. En Facturas: KPIs (facturado del mes, IVA débito, saldadas, anuladas).
3. **Presupuestos aprobados para facturar** (lo accionable) arriba de la lista.
4. Lista de facturas con acciones (imprimir, saldar, anular con motivo).

Acción principal: **Emitir factura** (desde presupuesto o manual).

## Inventario (`/inventario`)

Responde: *¿qué tengo, cuánto queda libre hoy y qué necesita atención?* (rediseño
E2 del 15-10-2026; la disponibilidad la sigue calculando el API, la pantalla solo la muestra)

1. Encabezado con las acciones: **Nuevo producto** (principal), **Nuevo combo**,
   **Escanear** (deshabilitado, «próximamente» hasta E3), **Importar**,
   **Incidentes (n abiertos)** y Exportar CSV. Las altas solo con permiso de escritura.
2. Cinco indicadores que **filtran al tocarlos**: Productos activos · Unidades
   disponibles hoy · En reparación / dañadas / perdidas · Ocupación de esta semana
   (`GET /api/admin/inventory/occupancy`) · Publicados en la tienda.
3. Pestañas con conteo: Todos · Combos · Con incidentes · Publicados en tienda · Ocultos.
4. **Barra fija** (pegada bajo el topbar; en celular fluye con la página): búsqueda
   (nombre, SKU y código de unidad), Tipo, Categoría (árbol con subcategorías),
   Depósito, Estado (los del mapa), Proveedor, «Disponible desde / Hasta», «Limpiar
   filtros» y el conmutador **Lista · Cuadrícula · Por categoría** (recordado por usuario).
   Los filtros se combinan con «Y».
5. **Estado visual** (`lib/inventory-visual-state.ts`, mapa único, ícono + texto):
   Disponible (verde) · Alquilado (rojo, camión) · **Vencida** (rojo, alerta, negrita,
   gana sobre «alquilado») · Dañado (naranja) · Mantenimiento / Fuera de servicio
   (info) · Reservado desde dd/mm (acento) · Archivado (neutro). Los parciales llevan
   el chip principal, la barra segmentada y «12/40».
6. **Lista** con una plantilla de columnas (`--inventario-cols`): selección, producto
   (foto chica y SKU), categoría, **ubicación** (`D1-E3-B2`, «3 depósitos» o «—»),
   libres sobre el total con la barra segmentada, **chip de estado**, lista, mayorista,
   tienda y **una** acción visible («Ficha»); el resto en «•••». Tarjetas en celular.
7. **Cuadrícula compacta** `.admin-inv-grid`: foto de 64 px, nombre en 2 líneas, código,
   chip y «libres/total». 8 por fila a 1440 px y 2 a 390 px, sin scroll horizontal
   (`--admin-inv-card-min`, 132 px: el ancho útil a 1440 es ~1164 px, con 148 caen 7).
8. **Por categoría**: secciones por `sortOrder` con encabezado pegajoso (nombre, conteo
   y libres), plegables; lo no ligado queda en «Sin categoría».
9. **Datos**: la pantalla usa `GET /api/admin/inventory?fields=grid` (liviano, paginado
   por cursor, sin unidades ni asignaciones; agregados por `groupBy`) y carga todas las
   páginas. La ficha pide su detalle con `?itemId=<id>&vivas=1`.
10. **Ficha** (`AdminDialog size="ficha"`, `?producto=<id>`): resumen siempre visible y
    pestañas Datos · Disponibilidad · Stock por depósito · Unidades · Precios · Tienda web
    · Combos · Proveedor y garantía · Verificación · Cronología. Tienda web y Combos solo
    aparecen si aplican; la garantía que vence en menos de 30 días se resalta. Verificación
    y la cronología unificada son «próximamente (E4)» (la cronología reúne hoy incidentes e
    historial; no se inventan datos).

Un VIEWER ve la misma pantalla sin controles que mutan (el servidor además responde 403).

## Calendario (vista de Eventos)

Desde la consolidación del 23-09-2026 (issue #56) el calendario **no es un
destino del nav**: es una vista de Eventos (`/eventos?vista=calendario`, con el
conmutador Lista · Tablero · Calendario). La ruta vieja `/calendario` redirige
ahí. En la vista de calendario se mantienen los KPIs de Eventos fuera de foco (no
se dibujan) y el calendario trae los suyos: mes/semana, con montajes, eventos,
desmontajes, cobros y checklist.

## Ajustes y Estado (áreas con secciones)

- **Ajustes** (`/ajustes/empresa`, `/ajustes/correo`, `/ajustes/plan`,
  `/ajustes/usuarios`): barra de subtabs arriba, contenido del módulo debajo.
  Empresa, Correo y Usuarios son OWNER/ADMIN; Plan se ve en todos los roles.
- **Estado**, dentro de Ajustes (`/estado/sistema`, `/estado/auditoria`): conserva Sistema/Auditoría y la barra compartida de Ajustes; las dos
  secciones son OWNER/ADMIN.
- El PIN y el auto-bloqueo viven **solo** en Mi perfil; no se repiten acá.

## Plantilla para el resto de los módulos

Todos los demás (Calendario como vista, Inventario, Proveedores, Promotoras,
Plantillas, Plan, Usuarios, Empresa, Correo, Auditoría, Sistema) siguen el mismo
esqueleto: **KPIs → filtros → contenido → acciones**, con la acción principal
en el encabezado y el texto descriptivo movido a la ayuda del módulo. Los
módulos de solo consulta (Auditoría, Sistema) van directo al contenido con su
filtro.

## Portal del cliente y sitio público (fase 3, 27-09-2026)

La guía de orden también aplica fuera del panel. El portal y el sitio **no**
tienen shell ni KPIs: su ritmo es «una columna, una acción principal».

**Portal del cliente** (`clientes.ledbox.online`)

| Pantalla | Orden | Acción principal |
| --- | --- | --- |
| Portada (`/portal`) | kicker → título → qué se puede hacer → validador del código + entrada al ejemplo | **Ver presupuesto** |
| Presupuesto (`/p/[token]`) | estado y hechos → **pendientes del cliente** → ajuste de ítems → decisión (una sola) → plan de pagos → cronología → ayuda | **Autorizar / pedir cambio** (la que corresponda al estado) |
| Firma (`/firma/[codigo]`) | estado de la solicitud → documento → **firmar** (consentimiento + método + firma) → resumen y evidencias | **Firmar documento** |

**Sitio público** (`ledbox.online`)

| Pantalla | Orden | Acción principal |
| --- | --- | --- |
| Landing (`/`) | hero (acción) → ticker → números → productos → servicios → marcas → proceso → por qué → FAQ → contacto | **Consultar disponibilidad** |
| Ficha (`/productos/[slug]`) | migas → hero con precio y hechos → **pedido** → incluido → otros equipos | **Agregar al pedido** (WhatsApp como secundaria) |

Lo que se revisa en estas superficies (además de la guía de la fase 2):

1. El tema (`data-theme`) queda aplicado antes del primer pintado y no
   parpadea; el portal lo elige el visitante, el sitio sigue la preferencia
   guardada y, si no hay, la del sistema.
2. AA de texto ≥ 4.5 y controles ≥ 3 en los dos temas (incluido el texto que
   vive directo sobre la aurora); la firma mantiene el papel blanco.
3. Botones ≥ 44 px y foco visible en todo el flujo de firma (consentimiento,
   canvas, «Limpiar», envío).
4. Impresión del portal sin aurora, vidrio ni sombras; `lbprint` intacto.
5. 0 scroll horizontal a 390 y capturas claro/oscuro 390/1440 de cada pantalla.

## Qué se revisa en cada PR de pantalla

1. El orden de arriba se cumple (o el reporte explica por qué no).
2. Hay **una** acción principal y ninguna compite.
3. Ningún texto se repite (título/nota/ayuda/estado dicen lo mismo una sola vez).
4. Estados de carga/vacío/error consistentes y con ícono.
5. Capturas claro/oscuro, desktop 1440 y mobile 390, contra el «antes».
6. Los checks verdes (`typecheck`, `build`, `test:rules`, `check:fields`) y sin
   scroll horizontal a 390.

## Inicio (Resumen) como tablero (13-10-2026)

- Arriba, «Para hacer hoy» (lo accionable) y la tira de plata (por cobrar, mora, cobrado del mes); debajo, un tablero de 6 bloques: previsibilidad de cobros (8 semanas, apilado con comprobante / pendiente / mora, totales a 30-60-90 días), pendientes por antigüedad (cada tramo enlaza a `/finanzas/por-cobrar?vence=al-dia|1-30|31-60|60-mas`), presupuestos en juego (con embudo y conversión; los 5 mayores abren `/presupuestos?detalle=<id>`), tendencia de 6 meses, operación (eventos por semana y ocupación de la semana, reutilizando `lib/server/rental-report.ts`) y «Esta semana».
- Gráficos en SVG propio (`components/admin/charts/`: `ChartBars`, `ChartBarList`, `ChartSkeleton`; estilos `.admin-chart*` y `.admin-barlist*` en `globals.css`). El SVG es decorativo; la tabla `sr-only` es el equivalente accesible y cada columna lleva `<title>`.
- Datos: `GET /api/admin/resumen` devuelve `{ resumen, board }`; `board` lo arma `lib/server/resumen-board.ts` con agregados en la base y las agrupaciones puras de `lib/resumen-board.ts`.
