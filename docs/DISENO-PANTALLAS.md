# Rediseño por pantalla — orden objetivo

Complemento de `docs/DISENO-PANEL.md` para la pasada por pantalla del rediseño
(22-09-2026). Regla general: **primero lo urgente/accionable, después lo
operativo, al final lo descriptivo**. Cada pantalla tiene **una** acción
principal, y el encabezado va en el ritmo fijo de la guía (§4).

## Resumen (`/dashboard`)

Responde: *¿qué me está pidiendo atención hoy?*

| # | Bloque | Por qué |
| --- | --- | --- |
| 1 | **Qué mirar hoy** (avisos con acción) | Es lo accionable: venció, hay que confirmar, falta cobrar |
| 2 | KPIs de cartera (clientes, eventos, presupuestos, leads) | Contexto del negocio en una lectura |
| 3 | KPIs de dinero (por cobrar, por pagar, caja, inventario) | La foto financiera del día |
| 4 | Próximos eventos | Agenda operativa |
| 5 | Checklist pendiente | Trabajo por cerrar |

Acción principal: **Ver calendario**. Lo que era un párrafo descriptivo vive en
la ayuda del módulo (`¿Qué es esto?`).

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

## Plantilla para el resto de los módulos

Todos los demás (Calendario, Inventario, Proveedores, Promotoras, Plantillas,
Plan, Usuarios, Empresa, Configuración, Auditoría, Sistema) siguen el mismo
esqueleto: **KPIs → filtros → contenido → acciones**, con la acción principal
en el encabezado y el texto descriptivo movido a la ayuda del módulo. Los
módulos de solo consulta (Auditoría, Sistema) van directo al contenido con su
filtro.

## Qué se revisa en cada PR de pantalla

1. El orden de arriba se cumple (o el reporte explica por qué no).
2. Hay **una** acción principal y ninguna compite.
3. Ningún texto se repite (título/nota/ayuda/estado dicen lo mismo una sola vez).
4. Estados de carga/vacío/error consistentes y con ícono.
5. Capturas claro/oscuro, desktop 1440 y mobile 390, contra el «antes».
6. Los checks verdes (`typecheck`, `build`, `test:rules`, `check:fields`) y sin
   scroll horizontal a 390.
