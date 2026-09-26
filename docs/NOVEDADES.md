# Novedades para el dueño

Lo que cambia en cada ronda, en lenguaje de producto. Las rondas automáticas
(`ht`/`hd`) agregan su bloque acá antes de publicar.

## v2.1.18 — 2026-09-22

- El menú quedó ordenado por áreas (General · Operación · Comercial · Finanzas ·
  Sistema) y se puede colapsar a solo iconos; el panel recuerda cómo lo dejaste.
- El encabezado ahora dice la empresa activa y el área (por ejemplo «LedBox Demo
  · General»), en vez de un texto fijo.
- Resumen muestra primero lo que te está pidiendo atención; Finanzas ordena
  Cobros antes de Tesorería y Facturación pone arriba los presupuestos por
  facturar.
- Toda la app usa la misma escala visual (tipografías, espaciados, sombras y
  estados) y los estados de carga/vacío/error son consistentes en cada módulo.

## v2.1.16 / v2.1.17 — 2026-09-22

- Panel: íconos en todas las secciones, KPIs, pestañas y acciones; se quitaron
  los textos repetidos.
- Ayuda «¿Qué es esto?» en cada módulo, buscador global con ⌘/Ctrl + K y barra
  de navegación inferior en mobile.
- El presupuesto del cliente quedó rediseñado: el responsable de la empresa
  viene precargado, hay un solo botón para autorizar o pedir un cambio y, una
  vez autorizado, desaparecen las opciones de cambio.

## v2.1.13 / v2.1.14 — 2026-09-22

- Conciliación bancaria: importás el extracto, el sistema sugiere el match con
  tesorería y podés conciliar, rechazar o crear el movimiento.
- Facturación con libro de IVA y cierre mensual; Plan con límites y consumo;
  Sistema con el estado del respaldo y su alerta.
## v2.1.19 — 2026-09-22

- footer único (empresa + crédito) en vez de dos pies pegados

## v2.1.20 — 2026-09-22

- la ayuda de Clientes nombra los filtros reales de la cartera
- cierra la pasada por pantalla (señal, urgencia y acción única)

## v2.1.21 — 2026-09-22

- bordes de controles con contraste AA y aviso de datos fiscales incompletos

## v2.1.22 — 2026-09-23

- estado del paso 4 de bancos y frontera «use client»
- datos bancarios del presupuesto en isla cliente
- el campo Banco sugiere el catálogo del BCP
- catálogo y marcas de bancos desde owncoding-ui
- montos del panel con el formateador de owncoding-ui (Refs #46)

## v2.1.23 — 2026-09-23

- campo Ciudad con catálogo compartido y sugerencias
- teléfono, monto PYG y ciudad usan owncoding-ui

## v2.1.24 — 2026-09-23

- portal simulado sin persistencia y qué se puede simplificar
- la demo no escribe — endpoints del portal en solo lectura
- acciones del cliente simuladas por sesión en la demo
- el modo demo se detecta en el servidor y la URL va sin marcador
- raíz de la demo sin bucle y host resuelto como el middleware
- sin sesión el panel va al login sin dibujar el shell
- nav compacto con acordeón por altura

## v2.1.25 — 2026-09-23

- PIN de 4 o 6 dígitos con cajas y avance automático

## v2.1.26 — 2026-09-23

- recorrido guiado, casos fuertes con conteo real y reinicio que reinicia
- lista y cuadrícula recordadas por usuario en inventario, clientes y proveedores
- los catálogos de los selectores se piden al abrir el diálogo

## v2.1.27 — 2026-09-23

- nav consolidado 18→13 y pasada mobile con arrastre táctil

## v2.1.28 — 2026-09-23

- /api/admin/finance devuelve solo lo que la pantalla usa
- el documento va del servidor y el comprobante se carga al enviar
- selectores con campos mínimos y catálogo recortado

## v2.1.29 — 2026-09-23

- sesión embebida por SSR y GET en vuelo compartidos

## v2.1.31 — 2026-09-23

- la versión del cliente suma entrega, IVA y garantía
- precio, condiciones y adjunto en el panel
- costos internos separados, margen y precio final

## v2.1.32 — 2026-09-23

- event-ops y trabajos con campos mínimos + ciudad en el calendario
- buscador por ciudad y contactos, paleta diferida y fricciones

## v2.1.34 — 2026-09-25

- el PATCH comercial guarda los campos del cliente


## v2.1.35 — 2026-09-25

- portal del cliente con modo claro y oscuro a elección, con el botón en la barra superior
- el presupuesto abre con «Tus pendientes»: decisión, transferencia, comprobante o pedido en revisión, con acceso directo a cada paso
- avance de pagos confirmados sobre el plan, en monto y cantidad
- iconos por sección en todo el presupuesto, como en el panel
- cuando no falta nada, el portal lo dice: «Sin pendientes»

## v2.1.36 — 2026-09-25

- el respaldo de la base se instala y se programa solo en cada deploy: el contenedor nuevo ya trae el cliente PostgreSQL 18
- las dos tareas de Coolify (respaldo diario y chequeo cada 6 h) ya no quedan atadas al contenedor viejo
- checklist post-deploy para el equipo y el caso real del 24-09 documentados en `docs/OPERACION.md`
- el respaldo deja de ser un pendiente del dueño: ciclo automático confirmado

## v2.1.37 — 2026-09-25

- el respaldo no falla en la ventana del deploy: si el cliente PostgreSQL todavía se está instalando, espera unos segundos y reintenta
## v2.1.38 — 2026-09-25

- el presupuesto de la entrada del portal se puede aprobar

## v2.1.39 — 2026-09-26

- tablas sin scroll lateral y acciones dentro del container

## v2.1.41 — 2026-09-26

- acciones sticky en las tablas de Finanzas
- icono oficial de Google en el login

## v2.1.42 — 2026-09-26

- Resumen y superficies de módulos con la piel nueva
- piel fase 2 y tonos de estado — base, shell y login (Refs #72,

