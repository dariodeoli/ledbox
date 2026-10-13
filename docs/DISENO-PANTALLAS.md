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

Responde: *¿qué eventos tengo y cómo va cada uno?*

1. KPIs: en curso · próximos 7 días · con checklist incompleto · por cerrar.
2. Filtros: estado · rango de fecha · búsqueda (una sola barra).
3. Tablero o lista (vista recordada del usuario) con la plantilla de columnas.
4. Acciones de fila (ficha, checklist, WhatsApp, timeline).

Acción principal: **Nuevo evento**. Por defecto, la vista arranca en lo que está
en juego (hoy/mañana y checklist incompleto primero en el tablero).

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
- **Estado** (`/estado/sistema`, `/estado/auditoria`): mismo patrón; las dos
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
