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

## v2.1.43 — 2026-09-26

- ola 3 en la guía — superficies, estados y pulidos
- ola 3 — barrido de módulos, superficies de estado y tipografía heredada (Refs #72,

## v2.1.44 — 2026-09-26

- rebaja con monto formateado y tope validado en vivo (Refs #76,
- monto Gs y porcentaje con el manejo de owncoding-ui

## v2.1.45 — 2026-09-27

- overrides de postcss y deepmerge-ts para npm audit en cero

## v2.1.46 — 2026-09-27

- botones del portal con área táctil de 44 px
- hitos de firma en la cronología del presupuesto
- portal público /firma/[codigo] con firma y auditoría
- enviar a firma desde la ficha del presupuesto
- modelo, migración y núcleo del portal de firma

## v2.1.47 — 2026-09-27

- sección Firmas con listado, envío y cancelación
- envío por correo y recordatorios de vencimiento

## v2.1.48 — 2026-09-27

- precisión del borde de papel en la firma del portal
- fase 3 — portal del cliente y sitio público en las guías
- piel fase 3 — C·Vitrina y C1·Aurora viva en portal del cliente y sitio público

## v2.1.49 — 2026-09-30

- reglas de precios y coherencia
- precios visibles y editables en el panel
- precios de venta del ítem (lista, mayorista y mínimo)
- reglas de la imagen y provisión del catálogo
- miniatura y alta con imagen en el panel
- imagen del ítem, migración aditiva y catálogo de la landing
- alta rápida de cliente y evento con selectores de búsqueda
- combobox con búsqueda en el kit del panel

## v2.1.50 — 2026-09-30

- barras de herramientas alineadas y conmutador de vistas solo con íconos
- logos de las marcas en la franja «Marcas que confiaron» (issue #87)
- las fotos del catálogo se muestran completas (marco según orientación)

## v2.1.55 — 2026-10-01

- precios por frente, umbrales y avisos
- bloque de precios por frente y resumen legible
- precios por frente (normal + «desde X días»)
- foto subida, URL efectiva y alta con categoría
- categoría buscable, campos finos y subir foto en el alta
- foto del ítem subida, en la base y pública por UUID

## v2.1.56 — 2026-10-01

- nombre fantasía en los datos fiscales y el imprimible
- el registro fiscal de la empresa no pide timbrado
- el guardado de ítems conserva el vínculo con inventario
- post-aprobación ordenada y miniaturas de los ítems

## v2.1.64 — 2026-10-02

- guarda del encabezado de tarjetas y del ancho de «Acciones»
- el nombre de las tarjetas no se aplasta y «Acciones» entra completo
- guardas de las listas móviles y del ancho de la grilla de Clientes
- Eventos y Clientes como tarjetas en móvil y Clientes sin links en la grilla
- guardas de las altas manuales y regla de SKU
- altas manuales con menos campos, es-PY y sin controles muertos
- registrar la segunda pasada móvil v2.1.61 (#155)
- la landing de EventOS corrige el header y suma resultados, perfiles y flujo

## v2.1.65 — 2026-10-02

- resumen sticky, plan en tarjetas, secciones plegadas y éxito post-autorización
- filtros y pestañas de estado, próximo paso, menú de acciones y solicitudes comparativas
- una sola regla de ancho compacto para las tarjetas
- cierre mensual legible y tarjetas móviles en Plantillas/Facturación
- subnavegación por secciones y tarjetas móviles
- método unificado y «Pendiente» sin cuenta para lo a crédito

## v2.1.66 — 2026-10-03

- Kanban sin corte y plan de pagos sin desbordes

## v2.1.67 — 2026-10-03

- sanitizar el detalle técnico de /estado/sistema
- páginas legales y de estado de EventOS, 404 propia y pie del producto
- Auditoría y Usuarios en tarjetas y fechas es-PY en el historial
- guardas de las pantallas de Operación en móvil
- Proveedores, Leads e Inventario como tarjetas en móvil
- los avisos del topbar se portalan y quedan legibles en móvil


## v2.1.74 — 2026-10-10

- fix(firma): imprimir fechas de cuotas como días de calendario (Refs #173)
- fix(firma): sellar cuotas públicas completas con roundtrip JSON canónico (Refs #173)
- fix(automation): contar AUTO desde SHA servido y aplicar cadencia autorizada (Refs #173)
- fix(deploy): adoptar token común y verificar deployment terminal por SHA (Refs #173)
- fix(panel): confirmar borrado de adjuntos con diálogo compartido (Refs #173)
- fix(panel): asegurar contraste y reflow de formularios al 200% (Refs #173)
- fix(automation): superseder READY publicado manualmente con FAIL y ACK exactos (Refs #173)
- fix(firma): congelar documento público versionado y preservar guard LIVE legacy (Refs #173)
- fix(panel): compactar impresión y evitar cierre huérfano (Refs #173)
- fix(presupuestos): persistir orden A15 y rechazar costos inválidos A04 (Refs #173)
- fix(automation): rechazar READY sólo con Pilot FAIL exacto sin publicación (Refs #173)
- fix(schema): persistir orden explícito nullable de ítems sin backfill (Refs #173)
