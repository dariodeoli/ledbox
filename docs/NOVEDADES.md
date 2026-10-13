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

## v2.1.75 — 2026-10-10

- Carrito público compartido y persistente (#157).
- Guía de cobro real y logo autorizado del cliente (#143, #129).
- Foco y fondo del menú móvil (#159).
- Landing comercial y pie institucional único (#156).
- Validación del contrato de identidad Hub para esta publicación.

## v2.1.76 — 2026-10-10

- Mejoras de operación: edición masiva/en línea, columnas compactas y archivo con fecha opcional.
- Calendario de eventos: integración de API y vista de calendario con cambios aislados.
- Automatización: admisión explícita y deduplicada, ventanas exactas y QA diferida ligada al candidato.

## v2.1.77 — 2026-10-10

- Preparación interna de inventario: estados y transiciones privados de servicios, con validaciones y ocho tests propios verificados.
- Esta ronda no habilita configuración ni cargos de servicios en el panel; la persistencia, DTO y cálculo financiero continúan en sus entregas separadas.
- QA de aceptación y verificación SHA posterior al deploy diferidas por orden del dueño; no equivalen a PASS ni cierre funcional.

## v2.1.78 — 2026-10-12

- Footer institucional unificado: identidad y operador canónicos de EventOS, privacidad, términos, estado y soporte coherentes en públicas, acceso, panel y portal, conservando la privacidad de LedBox donde corresponde.
- Guard de release reforzado: el siguiente patch debe actualizar package, lock y NOVEDADES juntos; se rechaza metadata incompleta, reset de versión y alteración del historial.
- Los documentos firmados conservan sus snapshots. Las correcciones PDF nativas y la nueva composición financiera se califican en sus scopes independientes; este release no las presenta como verificadas.
- QA de aceptación y verificación SHA postdeploy diferidas por orden del dueño; versión y estado del deploy se acreditan por separado.

## v2.1.79 — 2026-10-12

- El editor de presupuestos utiliza el cálculo comercial canónico después del lock comercial y la comprobación de revisión: totales enteros, descuento fijo, anticipo y líneas excluidas comparten una única aritmética, sin inventar tarifas ni hechos económicos ausentes.
- La validación conserva el rechazo HTTP 400 de overflow antes de cualquier escritura y las protecciones existentes de firma, empresa y edición concurrente.
- Tooling offline de procedencia Pilot y política GitHub de pendientes/cierre incorporados junto al cambio real de producto; no habilitan capturas, probes ni aceptación de producción.
- La evidencia del consumidor conserva la desviación del selector que reejecutó dos subtests previamente aceptados. No se presenta como cumplimiento íntegro del alcance ni certificación PostgreSQL, económica o PDF nativa.
- QA de aceptación y verificación SHA postdeploy diferidas por orden del dueño. El footer y health compilan la versión real de este release.

## v2.1.80 — 2026-10-12

- Nueva factura en móvil: controles y totales se apilan a una columna, con ancho contraíble y desglose que puede envolver, sin recortar importes. El estilo permanece scoped al formulario en el stylesheet canónico.
- Usuarios: el PATCH serializa cambios de membresías mediante el lock de la empresa y comprueba el último OWNER efectivo con membresía y cuenta activas antes de una baja o democión; conserva permisos, selfguard, auditoría y revocación de sesiones.
- Recovery Pilot offline valida referencias, hashes, identidad y binding explícitos; distingue NOT_RUN de FAIL y no inventa trazas, autores o costos. La validación offline no acredita reparación del inventario productivo ni procedencia económica.
- Los textos explicativos fiscales conservan las razones sociales y los datos guardados sin normalizar su puntuación. QA visual y verificación SHA postdeploy permanecen diferidas; los tests mocked de OWNER no son prueba nativa PostgreSQL.

## v2.1.81 — 2026-10-12

- Carrito público: Tab y Shift+Tab mantienen el foco dentro del pedido abierto; al cerrar por botón, Escape o fondo se recupera el control de apertura si sigue conectado.
- Finanzas: la división de un cobro pendiente previsualiza y valida los montos redondeados por parte como el API, respetando de dos a doce partes y el saldo exacto.
- Usuarios: crear, editar e invitar deshabilitan el envío con datos inválidos y muestran el motivo; los campos permanecen editables y se conservan los permisos y el bloqueo de envíos simultáneos.
- QA visual y SHA postdeploy continúan diferidos por orden del dueño; las pruebas unitarias no acreditan aceptación visual global.

## v2.1.82 — 2026-10-12

- Correos transaccionales: el renderer compartido usa pares de texto y fondo legibles en modo claro y oscuro, incluidos notas, estados, enlaces, pie y botón; conserva el contenido, URLs y texto plano de los consumidores existentes.
- Correos en teléfono: contenido y enlaces largos pueden envolver, las tablas se ajustan al ancho y el botón mantiene un área táctil mínima de 44 px. El pie HTML toma la versión real compilada.
- Inventario: disponibilidad y unidades comprometidas usan singular/plural según sus conteos reales; los datos ausentes se muestran como no disponibles en lugar de inventar cero.
- Los checks de contraste y estructura son offline; render visual Gmail/Outlook, QA y SHA postdeploy permanecen diferidos. No se envían correos reales como parte de esta verificación.

## v2.1.83 — 2026-10-12

- Sitio público: el menú móvil recupera el acceso a Productos, Servicios, Marcas, Proceso y Contacto; el diálogo bloquea el scroll de fondo, restaura el control de apertura y se cierra al pasar a escritorio.
- Presupuestos: Pedir cambios exige una nota válida antes de enviar; el botón y el envío comparten la validación del límite de 1000 caracteres del API. Registrar aprobación conserva la nota opcional.
- QA visual móvil, flujos de navegador y SHA postdeploy permanecen diferidos por orden del dueño; las pruebas offline no acreditan aceptación visual global.

## v2.1.84 — 2026-10-12

- Presupuestos: Enviar por correo muestra primero el remitente, destinatario, asunto y contenido real en HTML y texto plano; el envío requiere una confirmación separada de esa vista previa.
- La confirmación vence a los diez minutos y valida empresa, usuario, presupuesto y contenido actualizado. Cambiar destinatario, mensaje o link exige una nueva vista previa; previsualizar no envía, registra correo ni modifica el presupuesto.
- La primera adopción cubre correo de presupuestos; documento para firma, WhatsApp y resultado del presupuesto conservan sus alcances pendientes. QA interactiva, clientes de correo y SHA postdeploy permanecen diferidos por orden del dueño.

## v2.1.85 — 2026-10-12

- Presupuestos: al seleccionar un producto, la tarifa sugerida respeta el precio mínimo configurado en inventario. Una regla de precio por duración con días o precio en cero queda deshabilitada; un producto sin tarifa configurada conserva cero.
- La selección explícita copia la tarifa al presupuesto; la edición manual mantiene su comportamiento. Este alcance no incorpora el contrato comercial AL ni modifica documentos firmados. QA y SHA postdeploy permanecen diferidos por orden del dueño.

## v2.1.86 — 2026-10-13

- Inventario: ya no se puede asignar el mismo equipo dos veces. Si dos personas asignan a la vez el último stock, entra una sola y la otra ve cuánto queda libre. Las tareas operativas de cada evento pasan por el mismo control y la reserva al aprobar un presupuesto ocurre de una sola vez.
- Los eventos cancelados y los presupuestos perdidos liberan su stock. Un equipo que salió y todavía no volvió sigue ocupado hasta su devolución.
- Leads: nuevo botón «Armar presupuesto». Abre el presupuesto con el cliente, el título y las notas del pedido ya cargados; si el cliente no existe se crea al guardar, sin duplicar por correo o teléfono. El lead pasa a «Cotizado» y cada presupuesto muestra de qué lead viene.

## v2.1.87 — 2026-10-13

- Panel: los campos son más altos y claros. La etiqueta va arriba y lleva «*» si el dato es obligatorio. Guaraníes, teléfono y porcentaje muestran su prefijo fijo, y un error se ve en rojo debajo del campo con lo que hay que corregir. En el celular los campos miden 44 px.
- Ventanas de carga: un encabezado con ícono que dice qué pasa al guardar, contenido con su propio scroll y los botones siempre visibles abajo. En el celular ocupan toda la pantalla. Si cerrás con cambios sin guardar, la ventana pregunta antes de descartarlos.
- Una ventana abierta desde otra, como «Nuevo cliente» dentro de «Precio y condiciones», ya no queda cortada. El teclado recorre solo la ventana de arriba y Esc cierra solo esa.

## v2.1.88 — 2026-10-13

- Alquileres: nueva sección en Ajustes. Cada empresa define su seña, cuánto dura una reserva sin confirmar (48 h por defecto) y los tiempos de preparación, transporte, entrega, devolución y limpieza. Cada producto puede tener sus propios tiempos.
- La disponibilidad cuenta esos tiempos. Un equipo que vuelve de un evento no queda libre hasta que termina su limpieza.
- Las unidades se pueden marcar como dañadas o perdidas, y dejan de contar como disponibles. Una reserva que venció sin confirmarse libera su stock sola. Al confirmarla, se vuelve a revisar que haya lugar.
