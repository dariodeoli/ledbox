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

## v2.1.89 — 2026-10-13

- Presupuestos: cuando el cliente aprueba, el presupuesto avisa «Falta crear el evento» y ofrece el botón «Crear evento». El evento se crea con el cliente, el nombre y la fecha del presupuesto, ya confirmado, y los equipos quedan reservados. Si el evento existía como borrador, el botón lo confirma.
- Cada presupuesto muestra sus etapas: Lead → Presupuesto → Aprobado → Evento → Cobrado, con un link a cada una.
- Clientes: la ficha pasa a ser una página propia, con presupuestos, eventos, cobros, leads, historial y datos en pestañas, más el resumen de plata y contacto al costado. Tiene accesos directos a WhatsApp, Editar y Nuevo presupuesto.

## v2.1.90 — 2026-10-13

- Menú nuevo, ordenado como una venta: Inicio · Ventas (Leads → Presupuestos → Eventos) · Clientes · Operación · Plata · Ajustes. Cada etapa de Ventas muestra cuántos pendientes tiene. Firmas pasa a ser una pestaña de Presupuestos y Plantillas una de Ajustes. En el celular, la barra inferior es Inicio, Leads, Presupuestos, Eventos y Más.
- El Resumen pasa a tener cuatro bloques: «Para hacer hoy», con hasta cinco acciones ordenadas por urgencia y un botón cada una; «Embudo del mes»; «Plata», con por cobrar, en mora y cobrado este mes; y «Esta semana». Los montos se ven completos, sin cortes.
- Leads: alta manual desde «Nuevo lead», con la confirmación de que el contacto pidió ser llamado.
- Demo: la bienvenida aparece una sola vez y queda una franja fina con «Recorrido guiado» y «Salir».

## v2.1.91 — 2026-10-13

- Catálogo público por empresa: cada empresa puede publicar su catálogo de alquiler en /catalogo/<empresa>, con fotos, categorías, búsqueda y precio de referencia (o «Consultar»). Para las fechas elegidas muestra si un producto está disponible, sin dar el stock exacto. Se activa en Ajustes → Alquileres.
- Pedido sin cuenta: el cliente elige productos, fechas, lugar y contacto, y envía su pedido. La pantalla aclara que todavía NO es una reserva confirmada y hasta cuándo se le responde. Ofrece un link de WhatsApp con el resumen y otro para seguir el pedido.
- En Leads, cada pedido del catálogo muestra su estado y sus productos. «Convertir en presupuesto» lo arma sin volver a cargar nada, con la seña configurada por la empresa. «Retener stock» aparta los equipos durante el tiempo configurado.

## v2.1.92 — 2026-10-13

- Inventario: combos. Un combo se arma con productos existentes, por ejemplo «Kit pantalla LED 3×2» = 6 módulos + procesador + 2 truss, y no lleva stock propio. La pantalla muestra «Se pueden armar N» y cuál es el componente que limita.
- Un combo y sus componentes sueltos comparten el mismo stock: reservar un combo descuenta sus piezas y nunca se reserva de más, aunque se pida al mismo tiempo. Cancelar o liberar un combo devuelve exactamente sus piezas.
- Un componente se puede reemplazar por otro de la misma categoría, con control de stock, y el cambio queda registrado. Un combo no puede contener otro combo.

## v2.1.93 — 2026-10-13

- Eventos e Inventario: las altas y ediciones se hacen en la ventana de carga nueva, con secciones, botones siempre visibles abajo y aviso si cerrás con cambios sin guardar. En el celular ocupan toda la pantalla.
- Leads: el detalle queda como vista de lectura y el seguimiento (estado y notas) se edita en su propia ventana.
- Finanzas y Usuarios: recordatorios, confirmar pagos, dividir saldo, marcar cobrado, trazabilidad, invitar y revocar usan la misma ventana que el resto del panel.

## v2.1.94 — 2026-10-13

- Presupuestos: cada presupuesto nuevo arranca con la seña configurada por la empresa en Ajustes → Alquileres (por ejemplo «Seña 50 %» y «Saldo»), y se puede cambiar. Los presupuestos que ya existían no cambian.
- Depósito de garantía: se puede pedir una garantía por presupuesto, con un valor por defecto de la empresa. No suma al total ni a los cobros. Su estado (pendiente, retenida, devuelta, retenida en parte o retenida completa) se ve en el panel, en el portal del cliente y en el impreso, y cada cambio queda registrado.
- Transporte: el botón «Transporte» agrega ese ítem al presupuesto en un clic.

## v2.1.95 — 2026-10-13

- Eventos: «Despachar» registra qué salió, cuánto, quién lo sacó y cuándo, y se puede despachar por partes. «Registrar devolución» admite devoluciones parciales: el evento muestra «Faltan N por devolver» y permite marcar equipos dañados o faltantes.
- Incidentes: cada daño o faltante abre un incidente vinculado a la reserva y a la unidad. La unidad queda fuera del stock hasta que se repara (vuelve a estar disponible) o se da de baja. Desde Inventario → Incidentes se pasa a reparación, se resuelve o se da de baja, y se registra el costo de la reparación.
- Lo devuelto no vuelve solo al stock: queda «en limpieza o revisión» durante el tiempo configurado.
- Un evento no se puede cerrar con equipos sin devolver o faltantes sin resolver. Para eventos anteriores a esta versión, el sistema admite un cierre forzado con nota obligatoria que queda registrado; su botón en pantalla llega en una próxima versión.
- Calendario: muestra las entregas y devoluciones de equipos con sus horarios previstos.

## v2.1.96 — 2026-10-13

- Clientes, Proveedores (proveedor, trabajo y estado), Promotoras, Finanzas (cobro, cuenta, movimiento y gasto) y Usuarios cargan en la ventana nueva. El gasto tiene «Guardar y cargar otro», con el foco en el monto. Un doble clic ya no envía dos veces.
- Invitar usuario pone el foco en el correo, y en «Revocar» el foco nunca cae sobre el botón destructivo.
- Celular: el menú muestra tu nombre y tu rol, y la barra inferior no tapa los formularios ni los botones de las ventanas.

## v2.1.97 — 2026-10-13

- Eventos: nuevo botón «Finalizar evento». Si quedan equipos sin devolver o faltantes, muestra el detalle; para eventos anteriores a esta versión, «Cerrar igual» exige una nota que queda registrada. Un evento cancelado no se puede finalizar.
- Incidentes: los daños o faltantes cargados sin código de unidad se marcan «Unidad sin identificar».
- Finanzas: el pago a proveedores se hace en la ventana nueva.
- Catálogo público: cada producto puede tener una «Descripción para el catálogo», separada de las notas internas, que nunca se muestran. Hay un tope diario de pedidos por empresa contra abusos.
- Clientes: la ficha muestra todos los leads del cliente, sin el límite anterior de 1.000.
- Mejoras internas: el límite de eventos del plan se respeta aunque se creen dos a la vez, y los cambios de la garantía quedan registrados en la misma operación.

## v2.1.98 — 2026-10-13

- Reporte mensual: nueva sección «Alquileres», también en el CSV:
  - Ocupación por producto, con los más y los menos usados.
  - Conversión de los pedidos del catálogo.
  - Cancelaciones.
  - Daños y faltantes, con el costo de reparación; lo que no tiene costo cargado figura «sin dato», nunca 0.
  - Señas cobradas y pendientes, y garantías por estado.
  - Rentabilidad estimada por producto, con su criterio escrito en pantalla.
- Si un mes tiene más movimientos de los que entran, el reporte lo avisa. Si la sección de alquileres no se puede calcular, el resto del reporte se muestra igual.

## v2.1.99 — 2026-10-13

- Panel: mientras cargan, los indicadores muestran una barra de carga en vez de un 0 que todavía no es real. Si un dato no se pudo cargar se ve «—», y los demás indicadores se siguen mostrando igual.
- Eventos: el selector de vista (lista, tarjetas, calendario) queda siempre en el mismo lugar, y el calendario ya no repite los indicadores.

## v2.1.100 — 2026-10-13

- Inicio con gráficos y estadísticas. «Para hacer hoy» sigue arriba, y debajo hay un tablero con seis bloques:
  - Previsibilidad de cobros: lo que debería entrar en las próximas 8 semanas y los totales a 30, 60 y 90 días.
  - Pendientes de cobro por antigüedad: cada barra abre Por cobrar ya filtrado.
  - Presupuestos en juego: monto total, los 5 más grandes y el embudo del mes con la tasa de conversión entre etapas.
  - Tendencia de 6 meses: venta aprobada y cobrado.
  - Operación: eventos de las próximas semanas y ocupación del inventario.
  - Esta semana.
- Los gráficos se adaptan al celular y tienen una tabla equivalente para lectores de pantalla.
- Finanzas → Por cobrar se puede filtrar por antigüedad, y un link puede abrir directo el detalle de un presupuesto.

## v2.1.101 — 2026-10-13

- Tienda web por empresa en /tienda/<empresa>, con portada (logo, frase, categorías destacadas, cómo funciona y contacto), catálogo con búsqueda, disponibilidad para las fechas elegidas, carrito y pedido, todo con el color de marca de la empresa. Se enciende desde Ajustes → Tienda web con «Crear tienda». El sitio de LedBox no cambia.
- Cada producto elige dónde se muestra: Oculto, Cliente final, Mayorista o Ambos. El cliente final ve el precio de lista (o «Consultar»).
- Catálogo mayorista: desde la ficha del cliente, «Compartir catálogo mayorista» genera un link privado con precios mayoristas. El link se puede revocar y no aparece en buscadores. El pedido llega al panel ya vinculado a ese cliente y el presupuesto usa los precios mayoristas.
- Los links anteriores /catalogo/<empresa> siguen funcionando y llevan a la tienda.

## v2.1.102 — 2026-10-13

- Presupuestos rediseñados:
  - Arriba, cinco indicadores por etapa con cantidad y monto: Borrador, Enviado, Aprobado sin evento, Aprobado y Perdido. Al tocar uno se filtra la lista.
  - La lista entra completa en pantalla: número, cliente, evento, monto, seña o saldo, etapa y vencimiento. Cada fila muestra una sola acción, la que toca ahora (Enviar, Aprobar, Responder, Crear evento o Cobrar seña), y el resto queda en «•••».
  - El detalle se abre en un panel lateral con todo en un solo lugar: etapas, cliente y evento, condiciones (seña, plan de pagos y garantía), ítems, portal y firma, e historial.
  - Pestañas: Presupuestos · Firmas · Solicitudes del portal.
  - Vuelven a estar disponibles «WhatsApp con plantilla» y «Comprobantes del portal».
- En el celular, cada presupuesto se ve como una tarjeta con su etapa, el monto y la próxima acción.

## v2.1.103 — 2026-10-13

- Eventos rediseñado:
  - Arriba, cuatro indicadores que filtran la lista: Próximos 7 días, En curso, Con pendientes y Por cerrar. También está «Tareas vencidas».
  - Cada fila muestra qué tan listo está el evento: checklist, equipos despachados, seña y promotoras. Tiene una sola acción, la que toca ahora (completar checklist, despachar, registrar devolución o finalizar), y el resto queda en «•••».
  - El detalle se abre en un panel lateral con «Qué falta» arriba y pestañas: Resumen (con el presupuesto y sus etapas), Checklist, Equipos, Personal e Historial. Cada evento tiene su propio link, y las etapas del presupuesto llevan directo a él.
  - Pestaña «Tareas»: las tareas pendientes de todos los eventos, con filtros por vencidas, esta semana y promotora, y avisos de promotora no disponible.
- En el celular, cada evento se ve como una tarjeta con la fecha destacada, su estado, lo que falta y la próxima acción.

## v2.1.104 — 2026-10-13

- Clientes rediseñado:
  - Lista con cinco indicadores que filtran: Activos, Con saldo pendiente, Mayoristas con link, Nuevos del mes y Sin actividad hace más de 6 meses.
  - Segmentos Cliente final y Mayorista, y búsqueda por nombre, RUC, teléfono o correo.
  - La tabla muestra cliente, tipo, contacto, eventos, contratado, saldo y última actividad. Hay una acción por fila y la fila entera abre la ficha.
- Ficha del cliente:
  - La acción principal cambia según el estado: «Cobrar» si tiene saldo vencido, «Seguir presupuesto» si hay uno enviado, y si no, «Nuevo presupuesto».
  - Franja con contratado, cobrado, saldo, eventos y último evento.
  - Cada presupuesto y cada evento se abre con un clic.
  - El catálogo mayorista se muestra solo a mayoristas, o a quien todavía tenga un link activo, para poder revocarlo.
- Si la cartera supera los 200 clientes, la lista lo avisa para que los indicadores no parezcan el total.

## v2.1.105 — 2026-10-13

- Inventario rediseñado:
  - Arriba están las acciones «Nuevo producto», «Nuevo combo» e «Incidentes» (con la cantidad de abiertos), y cinco indicadores que filtran la lista.
  - Pestañas: Todos · Combos · Con incidentes · Publicados en la tienda · Ocultos.
  - La lista muestra foto, producto y SKU, categoría, stock libre sobre total con una barra, estado, precio de lista, precio mayorista y si está en la tienda. Cada fila tiene una sola acción y el resto queda en «•••».
  - Las tarjetas con foto se usan en el celular y también se pueden elegir en escritorio.
- Ficha del producto en un panel lateral:
  - Secciones: resumen, disponibilidad (con las reservas y retenciones de las próximas 4 semanas), unidades, precios, tienda web, combos, incidentes e historial.
  - Cada producto tiene su propio link.
- Al elegir varios productos aparece la edición en lote.

## v2.1.106 — 2026-10-13

- Eventos: el indicador «Con pendientes · 14 días» cuenta solo los eventos en curso o que empiezan en las próximas dos semanas, para que muestre lo que hay que atender ahora.
- Clientes: «Cobrar» en la ficha abre Por cobrar ya filtrado por ese cliente, con la opción «Quitar filtro».

## v2.1.107 — 2026-10-13

- Presupuestos: cuando el cliente aprueba (en el portal, al firmar una alternativa o al elegir en una comparativa) o se aprueba a mano en el panel, el evento se crea solo, ya confirmado, y se reservan los equipos. Si ya existía un evento en borrador, se confirma.
- Si el evento no se puede crear (por ejemplo, por el límite de eventos del plan), el presupuesto queda aprobado igual, el motivo queda registrado y sigue disponible el botón «Crear evento». Si la reserva de equipos falla, el evento queda creado y la reserva figura como pendiente.

## v2.1.108 — 2026-10-13

- Panel al día con owncoding-ui v0.68.3: los formularios usan los campos de la librería compartida (36 px en escritorio, 44 px en el celular, fondo opaco y foco más claro), igual que en el resto de las apps.
- Logos de bancos del catálogo en Finanzas, en los datos de pago del presupuesto y en el portal del cliente; un banco que no está en el catálogo se muestra con su nombre.
- Pie del panel en una sola fila, avatares con paleta sobria y filas del menú de 44 px en el celular.

## v2.1.109 — 2026-10-13

- Papelera: eventos, productos, clientes, oportunidades, proveedores, promotoras y presupuestos se archivan primero y, una vez archivados, se pueden eliminar desde el menú «•••». Cada lista tiene su filtro «Archivados».
- Ajustes → Eliminados (solo dueño y administradores): lista lo eliminado con quién, cuándo y por qué; permite restaurar (vuelve a archivado), eliminar definitivamente escribiendo el nombre y un motivo, o anonimizar cuando hay historial contable.
- Lo que tiene cobros, facturas, gastos o reservas sin devolver no se borra nunca: el sistema dice qué lo bloquea y ofrece anonimizar los datos personales. Los reportes de dinero siguen contando lo eliminado, rotulado «(eliminado)».
- Lo eliminado desaparece de listas, búsqueda, calendario, catálogo, disponibilidad y portal; lo archivado sale del inicio, el resumen y los contadores, pero los saldos pendientes siguen contando.

## v2.1.110 — 2026-10-13

- Papelera: en Ajustes → Eliminados elegís «Vaciar automáticamente» (Nunca, 30, 60, 90 o 180 días; por defecto Nunca). Cada fila dice «Se borra en N días»; lo que tiene cobros, facturas o reservas queda «Conservado (contable)» y nunca se borra solo. Cada borrado automático queda en la auditoría como «Sistema».
- Ajustes de la prueba en pantalla: el menú «•••» ya no queda recortado en Leads, Proveedores y Promotoras; en Eliminados las acciones entran sin desplazar; el motivo de una acción deshabilitada se lee debajo de la opción (también en el celular); los avisos de bloqueo hablan en castellano («Tiene 2 cobros»).

## v2.1.111 — 2026-10-13

- Ventanas de edición rediseñadas en todo el panel (productos, clientes, eventos, leads, proveedores, promotoras, inventario, cobros, facturación, presupuestos, usuarios y ajustes): campos ordenados por secciones con lo más usado primero y «Más opciones» plegable; título arriba y Guardar/Cancelar siempre visibles abajo; el error aparece justo arriba de los botones; «Guardando…» mientras guarda; si cerrás con cambios sin guardar, pregunta antes. Una sección plegada se abre sola si tiene un campo con error.
- En el celular cada ventana ocupa la pantalla completa, sin desplazarse hacia los costados y con los botones encima del teclado.
- Las confirmaciones (borrar compra, cerrar mes, revocar invitación, clave o link, quitar logo o foto) se piden dentro de la misma ventana.
- Portal del cliente más claro: arriba «Qué tenés que hacer ahora» con una sola acción; una única sección «Pagar» (cuánto falta, datos del banco con copiar y subida del comprobante); un solo estado; un presupuesto aprobado ya no dice «venció»; sin «Evento: Indefinido» ni «Vía: Panel»; la cuenta interna de tesorería ya no aparece como destino de la transferencia («A coordinar» si no hay banco cargado). En el celular, tarjetas y botón de la acción principal fijo abajo.

## v2.1.112 — 2026-10-14

- Papelera: el aviso de bloqueo ya no repite el mensaje en una línea roja.
- Registrar cobro: al pasar de contado a plazo, «Más opciones» se abre sin parpadear.
- Promotoras: las inactivas de antes de la papelera aparecen en «Archivadas» (antes no se veían en ningún listado).
- Build más liviano y controlado: el contexto que recibe Coolify bajó de 32,6 MB a 15,5 MB, y la publicación y la CI frenan si vuelve a pasar 400 MB o entra un archivo de más de 5 MB.

## v2.1.113 — 2026-10-14

- Panel de plataforma `/superadmin` (solo el dueño, en app.ledbox.online): Resumen con empresas, usuarios activos, ingresos, eventos, presupuestos enviados y aprobados, montos y cobros, cada uno contra el período anterior; Actividad por día y por hora (hora de Paraguay); Empresas y Usuarios con búsqueda, filtros, detalle y CSV; Tráfico del sitio, la landing de EventOS y el portal (visitas de hoy contra ayer, tiempo, scroll, rebote, páginas, origen, celular/computadora) y la demo aparte (demos iniciadas, duración, módulos más usados). La demo nunca se mezcla con los números del negocio.
- Acceso: solo la cuenta del dueño con el correo verificado (entrando con Google o completando un cambio de contraseña); cualquier otra persona vuelve al inicio. Nadie puede asignar el correo del dueño a otra cuenta, y cambiar el correo de una cuenta anula sus links de cambio de contraseña.
- Métricas propias de visitas sin datos personales: sin IP, sin navegador, sin cookies y respetando «no rastrear».
- Los CSV del panel neutralizan fórmulas: los textos que empiezan con «=», «+», «@» o «-» salen con un apóstrofo adelante.

## v2.1.114 — 2026-10-14

- «Cerrar sesión» al pie del menú lateral, en el panel y en el superadmin (en la demo dice «Salir de la demo»). Antes solo se podía desde Mi perfil.

## v2.1.115 — 2026-10-14

- Demo completa con todos los estados: productos disponibles, reservados, agotados (hoy y en un rango), en mantenimiento, archivados y combos; presupuestos borrador, enviados, en negociación, aprobados, firmados, pagados, perdidos, cancelados y vencidos, con señas, cuotas y garantías; firmas en todos sus estados (con su huella real); incidentes, devoluciones, trabajos de proveedor y registros archivados. Las fechas se mueven con el día de hoy, así la demo nunca se ve vieja.

## v2.1.116 — 2026-10-15

- Demo interactiva: cada visitante recibe su propia copia de la demo completa y puede usar todo (reservar, mover, crear, enviar, aprobar desde el portal, firmar) como dueño. Nadie más ve sus cambios y la copia se borra sola a la hora sin uso (máximo 24 h). Franja «DEMO · Tus cambios se borran si no la usás por 1 hora» con la hora límite, «Reiniciar la demo» y «Salir».
- En la demo nada sale hacia afuera: los correos y los WhatsApp se simulan y se muestra «así se vería»; el código para firmar aparece en pantalla; las claves de API, invitaciones, cambio de plan y cambio de correo o contraseña están desactivados; mayorista y tienda web dicen «No disponible en la demo».
- Con más de 150 demos abiertas a la vez, el visitante nuevo ve «La demo está llena, volvé en unos minutos». La demo se abre con «Entrar a la demo» (los robots no gastan copias).
- Superadmin → Tráfico → Demo: copias creadas por día, activas ahora, reinicios, cuántas hicieron algo y qué tocaron. Las copias nunca cuentan como empresas ni usuarios reales.

## v2.1.117 — 2026-10-15

- Superadmin → Empresas → «Nueva empresa»: alta de un cliente nuevo con su plan y una lista de invitados (dueño o administrador). A cada uno le llega su invitación por correo y entra con su propia contraseña; también se puede reenviar.
- Empresa predeterminada: quien pertenece a varias empresas elige en Mi perfil con cuál se abre el panel al entrar.
- Inventario → «Importar»: carga masiva de productos (con juegos y fotos) de tres formas: planilla para descargar y completar, texto listo para pedirle a ChatGPT o la IA de LedBox. Todo termina en una vista previa con los problemas y las dudas antes de aplicar; reimportar actualiza y no duplica. Los productos sin precio quedan «Consultar precio». El botón de IA del encabezado se sacó: la IA vive en «Importar».
- Cada producto se cobra «por día» o «por evento» (precio total). Un producto por evento cotiza lo mismo aunque el alquiler dure varios días.
- Un equipo que salió y no volvió a tiempo queda ocupado hasta que vuelve, con la lista «Devoluciones vencidas» y avisos en el resumen.
- Ya no se puede aprobar sin stock: en el portal el cliente ve «el equipo te contacta» y el presupuesto queda en revisión; en el panel solo dueño o administrador pueden «aprobar igual», y queda registrado. La firma de una alternativa sin stock no se ofrece, y si igual falta algo después de firmar, el equipo recibe una alerta.
- Las listas de búsqueda y los menús desplegables ya no quedan tapados ni transparentes sobre el resto del formulario.

## v2.1.118 — 2026-10-15

- Inventario: el código del producto (SKU) admite un solo carácter, como «2» o «3». Los catálogos reales los usan y antes se rechazaban al importar.

## v2.1.119 — 2026-10-15

- Precio por días con escalones, por producto y por lista (cliente final o mayorista): por ejemplo «100.000 por día» y «desde 5 días: 300.000 en total», o «desde 3 días: 80.000 por día». La tienda, el carrito, el presupuesto y el portal calculan igual; lo ya aprobado no cambia.
- Flete por zona (Ajustes → Alquileres → Zonas de flete): precio base por zona y un extra si el pedido supera cierta cantidad de piezas; en la tienda el cliente elige la zona o «a coordinar», y el presupuesto suma la línea «Flete».
- Paquetes: muestran el precio del paquete, la suma por unidad y el ahorro; si falta una pieza, se sugieren reemplazos con la diferencia de precio.
- Perfil de la empresa: teléfonos, WhatsApp, Instagram, correo, web, dirección con «Cómo llegar» en Google Maps, horarios de atención y de entrega/retiro/devolución, tipo de cuenta, medios de pago aceptados y condiciones comerciales; se muestran en la tienda, el portal, el presupuesto impreso y los correos.
- Apariencia: plantillas (Clásica, Minimalista, Elegante, Oscura), color de marca con control de contraste, tipografía y portada para escritorio (1920×600) y para celular (1080×1350), con vista previa.
- Acceso al catálogo: abierto, con solicitud (el cliente se registra y la empresa lo aprueba como cliente final o mayorista) o privado.
- Pedidos de la tienda: la empresa puede aceptarlos, rechazarlos con motivo o modificarlos (cantidades, quitar, reemplazar, «ya no lo tengo») y el cliente aprueba la versión modificada desde su seguimiento.

## v2.1.120 — 2026-10-15

- Inventario más ordenado: cada producto tiene **Tipo** (reutilizable, consumible o descartable), **Categoría** y **Subcategoría** (por ejemplo Reutilizable › Vajilla › Copas). Las categorías que ya existían se convierten solas, sin perder nada.
- **Depósitos** con código y **ubicación** de cada unidad (por ejemplo «D1-E3-B2»), «Mover unidades» entre depósitos y stock por depósito en la ficha.
- **Condición** de cada unidad del 1 al 10 (también en %), y **proveedor, fecha de compra y garantía**, con «Registrar compra» para sumar unidades nuevas.
- Ajustes → **Inventario**: administrar categorías, subcategorías y depósitos.
- Importar productos acepta categoría, subcategoría, depósito y ubicación (planilla, ChatGPT e IA).

## v2.1.121 — 2026-10-15

- Ajustes → Alquileres, todo configurable por empresa y editable en cada caso: **garantía** (no, opcional o siempre; para reservar o por daños; monto fijo, % del pedido o por producto), **recargo por demora** (% o monto fijo, por día o por hora, con tolerancia), **roturas y faltantes** (100 % del costo de reposición por defecto), **cargos personalizados** (lavado, mancha, armado…, por pieza o por evento y por categoría), **política de cancelación** por tramos y **condiciones del alquiler**, con el monto calculado a la vista.
- **Liquidación de la devolución**: al devolver, el sistema propone los cargos; el equipo los aplica o los condona (con motivo) y «Liquida»: con garantía por daños se retiene lo justo y se devuelve el resto, o queda un saldo a cobrar; el cliente ve el detalle en su portal. La garantía retenida y los cargos extra cuentan como ingreso pero no bajan lo que el cliente debe del alquiler.
- **Pantalla nueva de Inventario**: estado con color e ícono (alquilado en rojo, «Vencida» destacada, disponible, dañado, mantenimiento), cuadrícula compacta, vista por categoría, filtros por tipo, categoría, depósito, estado y proveedor, y carga por partes para cientos de productos. La ficha tiene pestañas.
- Los costos internos (costo diario, reposición, compra y proveedor) solo los ven dueño, administración, finanzas y operación.
- Finanzas: el indicador de cobros pasa a llamarse «Ingresos de clientes».

## v2.1.122 — 2026-10-15

- Cambiar de empresa: quien pertenece a más de una empresa ve, debajo de la empresa activa en el menú lateral, un botón «Cambiar a <empresa>» por cada una. Faltaba el botón (el servidor ya lo permitía).

## v2.1.123 — 2026-10-15

- Empresas: la caja «Empresa» del menú lateral ahora es un selector. Tocás tu empresa y se abre la lista de todas las tuyas para cambiarte; el logo se ve más grande.
- Usuarios: el rol Propietario solo lo puede dar otro Propietario, con confirmación y registro de quién lo hizo.
- Remitos: al entregar y al recibir de vuelta un alquiler se genera un remito de salida y uno de devolución, con numeración sin saltos, firma del cliente en el celular, fotos del estado y versión para imprimir. Se ven en Equipos.
- Correos: todos los mails salen con una misma plantilla sobria, con el logo, el nombre y el contacto de tu empresa. El remitente figura como «Tu empresa vía EventOS» y las respuestas de los clientes te llegan a vos.
- Panel: botones, etiquetas, pestañas y cuadros de diálogo ahora son iguales en todas las pantallas, y hay un control automático para que no se vuelvan a mezclar estilos.
- Importar catálogo: los juegos sin piezas entran como «juego incompleto» (no se pueden alquilar hasta completarlos y no aparecen en la tienda); una unidad que pasa a ser juego se convierte sola si no tiene reservas; el precio vacío o 0 queda «a consultar» y el presupuesto avisa «falta precio» hasta cargarlo; cada categoría puede traer su foto. Las medidas y la capacidad del archivo ahora van a sus campos propios de la ficha del producto.
- Tienda web: nueva plantilla «Catálogo editorial» con las fotos de cada categoría, orden de la tienda a tu gusto (arrastrar o Subir / Bajar), carrito que se conserva, ficha de cada producto con medidas y capacidad, y pedido de mejor precio.

## v2.1.124 — 2026-10-15

- Tienda: arriba aparece el sello EventOS junto al logo y nombre de tu empresa; el menú queda fijo al bajar y en el celular se compacta.
- Tienda: fechas «Desde / Hasta», búsqueda por nombre o código y categorías como botones que se deslizan.
- Tienda: el mismo pie en todas las páginas, con tus datos y «Desarrollado por OwnCoding · EventOS v2.1.124». Botón de WhatsApp que no tapa el pedido.
- Invitaciones: el link sirve una sola vez y vence a los 7 días (se muestra en el panel y en el correo). Si quien invitó deja de ser propietario, sus invitaciones de propietario pendientes se cancelan solas.
- «Gratis a propósito» en un presupuesto: solo propietario y administración.

## v2.1.125 — 2026-10-15

- Ficha del producto: la barra de pestañas ya no queda tapada en Unidades y Cronología (vale para todas las ventanas con pestañas).
- «Editar producto» rediseñado: foto, nombre y código arriba; secciones Identidad · Precio y cobro · Medidas y capacidad · Stock y depósito · Tienda web · Proveedor y costos · Notas; dos columnas en computadora y una en celular, con Guardar siempre visible.
- Sin permiso de costos, guardar un producto ya no pisa los costos con 0.

## v2.1.126 — 2026-10-15

- Tienda: tarjeta de producto más compacta (foto, código, nombre, medidas, precio y botones «Agregar» y «Ver más»), sin huecos ni textos cortados.
- Tienda: «Ver más» abre una vista rápida con el producto, lo que incluye y opciones similares, sin salir del catálogo.
- Tienda: el carrito y el panel de datos del pedido se arreglaron: ya no quedan tapados por el menú, los campos ocupan todo el ancho y el botón principal tiene el color de tu empresa.
- Tienda: la barra del pedido muestra el monto. Sin fechas dice cuánto es por día y «Elegí fechas para el total»; con fechas, el total.
- Tienda: cinco plantillas nuevas para elegir en Apariencia: Tecnológica, Boutique, Noche, Fresca y Minimal. Las tarjetas, la vista rápida y el carrito siguen el estilo de cada una.
- Tienda: la sección de contacto ya no se ve partida en dos columnas.

## v2.1.127 — 2026-10-15

- Tienda: ahora hay 4 plantillas para elegir en Ajustes → Apariencia: Lienzo, Boutique, Noir y Studio, agrupadas por rubro y con una vista previa real de cada una. Las empresas que ya habían elegido una pasaron solas a la más parecida (minimal y clásica → Lienzo; boutique y editorial → Boutique; noche, tecnológica y oscura → Noir; fresca → Studio).
- Tienda: encabezado fijo que se achica al bajar, con el sello EventOS chico junto al logo, botón «Pedido (N)» y una barra de anuncio opcional que editás vos.
- Tienda: portada única sin repetir el nombre de la empresa. Elegís la fecha del evento y los días de alquiler; «Invitados» es opcional y no filtra. Las fechas se recuerdan en toda la tienda.
- Tienda: categorías con «N productos · Desde Gs. …» en letra chica; barra de filtros que acompaña al bajar, con categorías, orden (precio, nombre, capacidad) y buscador; botón «Mostrar más».
- Tienda: la tarjeta entera abre la vista rápida y tiene un solo botón «+ Agregar» con aviso al agregar. Capacidad sobre la foto, precio sin caja y, si no hay foto, un ícono del tema (nunca letras sueltas).
- Tienda: ficha nueva con la foto grande y el panel de compra fijo al costado: precio una sola vez, «Incluye» con tildes, fechas con disponibilidad, WhatsApp con el mensaje armado, acordeón y «Completá el ambiente».
- Tienda: el pedido se abre como cajón (hoja inferior en el celular) con las fechas adentro, arriba; si faltan, un aviso neutro, no rojo. Muestra «Total estimado» y «Confirmamos el monto final en la cotización». En el celular hay una barra compacta; el botón de WhatsApp no la pisa.
- Tienda: pie completo (contacto, horarios, zonas de entrega, medios de pago) con «Desarrollado por OwnCoding · EventOS v…». Pantallas de carga, de «sin resultados» y de error.
- Apariencia: color de marca, frase de la tienda, tipografía de los títulos (lista curada), barra de anuncio con texto, modo de precio (por día, por unidad «c/u» con cantidades de a 10, o a cotizar) y portada. El fondo propio y el acento manuscrito se retiraron: cada plantilla trae su fondo.
- Panel: el botón «Ver mi tienda» abre la tienda de la empresa activa (antes llevaba a la página de LedBox).

## v2.1.128 — 2026-10-15

- Seis plantillas nuevas para la tienda, listas para elegir en Ajustes → Apariencia: Jardín (verdes y papel, para exteriores y bodas al aire libre), Mármol (blanco y gris piedra, para lujo y decoración premium), Terracota (tierra y crema, para vajilla rústica y catering), Nórdico (madera clara, para mobiliario y oficinas), Gala (negro y dorado, para bodas de gala y eventos nocturnos) y Brisa (azul profundo y arena, para eventos de playa y náutica). Todas cumplen contraste AA y tienen el botón principal de color.
- Importar catálogo: ahora podés indicar cuántas unidades están en mantenimiento, dañadas o perdidas (columnas «En mantenimiento», «Dañadas» y «Perdidas»). Una planilla anterior sin esas columnas sigue valiendo.
- La frase de la portada se edita solo en Ajustes → Apariencia (se quitó el campo repetido de Tienda web).
- Buscador de fechas: el campo «Invitados» queda alineado con los demás.

## v2.1.129 — 2026-10-15

- Tienda: siete plantillas elegidas por rubro: Boutique (eventos, vajilla y decoración), Escenario (producción y sonido), Corporativo (empresas), Fiesta (eventos sociales), Gourmet (catering), Kids (infantil) e Industrial (carpas y estructuras). Se retiraron las anteriores del selector; las tiendas que las usaban pasan a una alternativa compatible.
- Fotos de productos y categorías cuadradas, completas sobre fondo claro. Los nombres quedan debajo y el botón principal conserva un color legible en todas las plantillas.
- Portadas separadas para computadora (1920 × 600) y celular (1080 × 1350), con vista previa de ambas en Apariencia y una alternativa centrada si falta un archivo.
- Tienda más compacta: fechas, días, invitados, filtros y pedido alineados; cantidades y subtotales claros; aviso pequeño para guardar el carrito, sin tapar otras ventanas ni la confirmación de agregado.
- Portal del cliente: selectores de cantidad y días compactos y alineados, montos ordenados, acciones con color, anclas que respetan el encabezado, resumen del presupuesto y contacto con WhatsApp, ubicación e Instagram.
- Inventario más ágil y familias de variantes en el panel: agrupar productos, elegir opciones y administrar precios comunes o propios, conservando unidades y reservas.
- Tienda con colecciones, galería de producto, etiquetas y filtros, destacados y orden de las secciones del inicio.
- Importación de eventos con reservas: vista previa y aplicación desde JSON, planilla o IA. Reimportar no duplica; no se cambia la fecha de un evento reservado sin reprogramarlo antes desde Eventos.
- Seguridad: protección de altas y agrupaciones simultáneas, aislamiento entre empresas y actualización de la lectura de archivos ZIP importados.

## v2.1.130 — 2026-10-15

- Boutique adopta el estilo minimalista elegido: blanco y negro, tipografía moderna y pie claro. Fecha, días e invitados usan campos cortos (160/100/80 px en computadora), sin estirarse por toda la pantalla.

- Nuevo diseño completo de la tienda: encabezado con identidad de la empresa, inicio ordenado, catálogo de cuatro columnas en computadora y dos en celular, filtros discretos y pie en tres columnas.

- Cada categoría de la tienda tiene su propia página y conserva las fechas elegidas y el pedido al navegar.
- Pedido visible desde el primer producto, con productos, unidades e importe; confirmación animada al agregar y guardado voluntario sin interrumpir la elección.
- El popup muestra la ficha pública completa, galería, composición, características y fechas, sin tener que abrir otra página.
- Tarjetas sin huecos: precio y acción visibles, también en juegos con ahorro. Cuando falta precio se indica «Consultar precio y disponibilidad» y se puede agregar para cotizar.
- Campos minimalistas con línea inferior en tienda y portal del cliente, con controles compactos y foco visible.
- La portada se muestra limpia, separada del título, los botones y las fechas; se conserva una imagen para computadora y otra para celular.


## v2.1.131 — 2026-10-15

- La demo suma mobiliario, vajilla, catering, sonido y exteriores: nuevos productos, combos, familias y colores, clientes, presupuestos y eventos. Incluye reservas, equipos entregados, mantenimiento, daños, devoluciones, señas y saldos con sus movimientos de tesorería. Las demos nuevas reciben estos ejemplos; las abiertas conservan tus cambios hasta reiniciarlas.
- Ajustes y Mi perfil aprovechan mejor el espacio: navegación compacta, paneles en columnas en computadora, campos con línea inferior y portadas separadas para computadora y celular.
- Clientes, leads y selectores de presupuestos y eventos buscan en todos los registros de la empresa. Las respuestas anteriores de una búsqueda ya no reemplazan los resultados nuevos. El alta de cliente muestra primero lo esencial y deja los datos adicionales plegados.
- Aprobar desde el tablero o desde el botón aplica las mismas verificaciones y genera el mismo evento y plan de pagos. Los cambios simultáneos no pueden deshacer una aprobación ni aceptar una verificación de stock anterior a una edición de productos o fechas.
- Los retiros y altas simultáneos de unidades mantienen la cantidad correcta. La edición masiva protege las categorías de las variantes y deja de mostrar controles de precios que no tenían efecto.
- Los cobros parciales y sus reintentos no se duplican; dividir un saldo conserva la deuda y el origen de los cargos extra. Cobrar desde un presupuesto abre sus pagos, incluidos futuros o sin fecha. La seña porcentual se reconoce en la preparación del evento.
- Los gastos simultáneos conservan los cambios de cada operación. Los cobros comprueban que cliente y presupuesto coincidan y guardan la cuenta efectiva del movimiento.
- Se protegen los nombres de eventos aceptados, los vínculos de inventario de presupuestos aprobados o firmados y la identidad de usuarios compartidos entre empresas. Los recursos del portal dejan de estar disponibles cuando el cliente o presupuesto están eliminados.
- Se ajustan filtros de fechas y navegación de fichas para pantallas pequeñas.

## v2.1.132 — 2026-10-15

- Los campos del panel usan línea inferior y formularios más compactos. Datos opcionales de presupuestos y eventos quedan plegados; las acciones del portal se agrupan y las fechas pendientes tienen un acceso directo para completarlas.
- El historial del presupuesto se actualiza después de aprobar o editar, sin tener que cerrar y volver a abrir la ficha.
- Podés cargar una consulta de WhatsApp sin inventar un correo: el alta manual mantiene teléfono y consentimiento obligatorios. El formulario público conserva sus validaciones.
- Editar productos que se cobran por evento mantiene un único cargo, aunque el alquiler dure varios días. Una edición simultánea ya no guarda descuentos sobre un subtotal anterior.
- Los pagos simultáneos a proveedores conservan el anticipo y los movimientos correctos; los reintentos de una misma operación devuelven el resultado original.
- Reprogramar o reabrir eventos y presupuestos comprueba nuevamente el stock antes de reactivar sus reservas. Si falta disponibilidad, se conserva el estado anterior y se informa el conflicto.
- La disponibilidad consulta todas las reservas relevantes, aunque haya un historial grande. Tienda, combos y sustitutos comparten la misma lectura completa por rango.
- Los incidentes distinguen cada ciclo de reparación o faltante: resolver uno no revive una unidad dada de baja ni bloquea una reparación posterior a una restauración explícita.
- Una solicitud de cambios del portal no puede deshacer una aprobación simultánea. Una constancia tampoco hace retroceder un cobro ya confirmado.
- Por cobrar incorpora páginas y filtros en servidor; los importes corresponden a todos los resultados, aunque el cobro sea antiguo. El CSV identifica la página exportada y suma solamente lo cobrado.
- Los formularios inválidos se rechazan antes de modificar el perfil, los datos bancarios, usuarios e inventario. Finanzas, tesorería, trabajos y gastos validan el límite real de cada importe almacenado sin dejar registros parciales.

## v2.1.133 — 2026-10-15

- Presupuestos: acciones frecuentes en una fila de iconos; el detalle reúne pagos, garantías, inventario e historial, sin repetir el siguiente paso.
- Al preparar el correo del presupuesto podés guardar inicio y fin del evento antes de generar la vista previa. Guardar fechas no aprueba el presupuesto ni reserva equipos.
- Eventos: formulario alineado, ciudad del catálogo y recintos reutilizables con dirección, referencia y contacto. Escribir un recinto nuevo alcanza para guardarlo con el evento.
- Clientes: presentación compartida con logo o iniciales, nombre comercial, responsable y tipo de cliente en las principales listas, fichas y selectores.
- Clientes → Mensajes: biblioteca de plantillas, personalización, variables, modelos, vista previa y guardado por empresa. Cambiar de sección con una edición pendiente pide confirmación. Guardar no envía mensajes.
- Menús, desplegables y selector de empresa comparten la superficie visual; el selector de empresa también admite navegación por teclado.

## v2.1.134 — 2026-10-15

- Apariencia: módulos de la tienda ordenables y visibles por empresa, independientes de la plantilla. «Poner primero» permite subir Categorías u otra sección en un paso. La vista previa respeta esa organización.
- Categorías: cada empresa elige Tarjetas o Desplegables. Los desplegables muestran hasta cuatro productos y conservan el enlace a la página completa, las fechas y el mismo carrito.
- Preorden: el resumen distingue productos estimados y flete pendiente de cotizar; enviar no confirma alquiler ni reserva productos o fechas.
- Fotos de identidad: editor compartido para perfil y logos de empresa/cliente, con zoom, posición, teclado, arrastre y vista previa antes de aplicar. También permite reabrir la imagen guardada. Las fotos de productos conservan su encuadre completo.
- Ciudad: empresa, clientes, eventos y revisión de cargas usan el selector compartido del catálogo del sistema. Los valores históricos se conservan cuando se editan otros datos.
- Auditoría de los pedidos del día registrada en documentación e issues, distinguiendo entregas, trabajo en curso y hallazgos históricos sin reproducir.

## v2.1.135 — 2026-10-15

- Ajustes queda fijo al pie del menú, justo encima de Empresa. Estado se abre desde Ajustes, con Sistema y Auditoría y sus permisos habituales.
- Entrar a Ajustes compacta el menú de escritorio; se puede expandir manualmente sin que otra pestaña de Ajustes lo vuelva a cerrar. Entrar a Inventario u otro módulo lo abre. El botón de expandir queda debajo de EventOS cuando está compacto. En celular se conserva el menú desplegable habitual.

- Ajustes aprovecha mejor el espacio: navegación interna fija, horarios de atención en columnas y políticas de alquiler agrupadas.
- Apariencia funciona como editor: vista previa lateral con selector computadora/celular, selector visual de color, fotos compactas y una indicación de dónde queda cada módulo antes de soltarlo.
- Las plantillas de mensajes quedan en Clientes. Bancos y datos de pago se administran desde Finanzas con el mismo formulario compartido.
- Se puede cambiar el identificador de empresa conservando enlaces anteriores. Los identificadores históricos quedan protegidos frente a su reasignación a otra empresa.
- Las solicitudes de planes superiores aparecen en el panel superadministrador sin conceder el plan automáticamente.
- Un laboratorio interno permite probar la presentación de la landing de Ledbox con catálogo y carrito, usando una finalización simulada.
- OwnData: el botón Extraer consulta explícitamente el RUC, permite revisar la razón social antes de aplicarla y descarta respuestas de ediciones anteriores. La conexión real requiere configurar OwnData en el servidor.
- El carrito reutiliza la gestión compartida de foco y teclado de las ventanas de tienda; Escape responde sólo a la ventana superior.

- Fechas de eventos y presupuestos: atajos Hoy, Mañana y Pasado mañana con fecha exacta, límites y hora conservada. Los formularios históricos conservan su selección exacta sin sugerencias que no corresponden.
- Campos compartidos adoptados en formularios públicos, portal y plataforma. Los montos conservan el valor pegado con «Gs.» y las rebajas del portal usan el mismo campo de monto y porcentaje que el panel.
- Recintos: libreta independiente con contactos y ubicación predeterminados para próximos eventos; guardar o actualizar es explícito y no cambia eventos anteriores. La ficha sobrevive al borrado del evento.

## v2.1.136 — 2026-10-15

- Cantidades y días comparten un control compacto en tienda, carrito y portal. Conserva los límites de cada contexto, permite borrar mientras se escribe y admite flechas del teclado.
- Consentimientos, opciones de aprobación y comprobantes usan el kit común. El comprobante conserva selección, obligatoriedad, compresión y validación existentes.
- Ventanas de panel, tienda, carrito y consulta comparten foco, Tab, Escape, bloqueo del fondo y retorno al botón de origen, incluso con ventanas anidadas y menús. El menú móvil nativo conserva el comportamiento del navegador.
- La nota de rechazo de propuesta y el selector del reporte usan los mismos campos compartidos. Una revisión automática de toda la app impide introducir controles visibles nativos fuera del kit.

- Los selectores de opciones respetan su tamaño indicado y no invaden el campo de al lado dentro de grillas compactas.

## v2.1.137 — 2026-10-16

- Inventario: cero confirmado y pendiente de conteo son estados distintos. Un catálogo sin cantidad no crea existencias ficticias ni promete disponibilidad. El conteo se confirma explícitamente y conserva reservas, retiradas e historial.
- Importación: el resultado cuenta los estados que realmente se guardaron, incluso si aparecen reservas después de la vista previa. Las unidades nuevas conservan el depósito y ubicación elegidos.
- Crear sólo productos nuevos conserva los códigos existentes, sus tarifas, unidades y fotos; también conserva las categorías y colecciones existentes. La vista previa distingue conservar de omitir por error y muestra el conteo antes/después.
- Conversión a combo: los rechazos revierten las escrituras y conservan las unidades. Los datos de compra, depósito, incidentes e historial impiden una conversión destructiva.
- Origen separado de compra: propio, consignado físico y alquiler externo por evento. El dueño se registra por unidad y los defaults sólo se proponen a las altas nuevas; los históricos quedan sin revisar. Un pedido externo no crea stock permanente ni confirma cobertura de un proveedor.
- Exportación de unidades por depósito: código de unidad, estado, depósito, ubicación y propietario en un CSV de consulta; no reemplaza el respaldo restaurable completo.

## v2.1.138 — 2026-10-16

- Las variantes y su resumen distinguen pendiente de conteo de cero confirmado. Si falta contar alguna variante, no se muestra una disponibilidad total como si estuviera completa.
- La importación separa fotos modificadas, conservadas, fallidas y archivos no aportados. El detalle identifica producto, galería, categoría o colección; una galería parcialmente aplicada avisa qué ocurrió.
- Las fotos idénticas de categorías y colecciones se conservan sin reescribir. Los contadores del resultado reflejan cambios guardados; la vista previa aclara que sólo encontró archivos, todavía sin aplicarlos.

## v2.1.139 — 2026-10-16

- Respaldo portable de catálogo e inventario con fotos, relaciones y propietarios. Permite revisar y restaurar en una demo nueva; no reemplaza un respaldo completo de empresa ni restaura reservas, caja o historial.
- Importación explícita de precios de productos existentes: conservar, vaciar o reemplazar cada precio y tarifa. La vista previa muestra antes/después; detecta cambios concurrentes y permite recuperar reportes sin aplicar dos veces. Fotos y estados selectivos siguen pendientes.
- Enviar presupuestos guarda un recibo antes de contactar al proveedor. Consultar o repetir el mismo intento no reenvía; la aceptación pasa un borrador sin cambios a Enviado y refresca el panel. Un resultado incierto queda visible y exige revisar antes de crear otro intento.
- Identidad compartida de cliente en calendario, facturación viva, comparaciones y selector de precios: avatar, nombre comercial, responsable y segmento. Los documentos fiscales e históricos mantienen sus snapshots.
- Las propuestas de ciudad por IA exigen una opción del catálogo; los formularios históricos conservan valores anteriores.

## v2.1.140 — 2026-10-16

- Cantidades y días de formularios comerciales y operativos usan la validación compartida de enteros. Pegar signos, decimales o exponentes ya no los transforma en otra cantidad; se conserva el borrado mientras se edita. Los campos con otros contratos mantienen su comportamiento.
- Las contraofertas permiten borrar y volver a escribir cantidades y días. Una fila incompleta impide aplicar; los cálculos respetan tarifas por paquete, precios manuales y por evento, con el contexto de precios de la solicitud.
- Se corrigió el rechazo «El presupuesto cambió» al aceptar una contraoferta sin cambios concurrentes. La comparación usa los mismos campos y conserva la protección ante una edición real del precio congelado.
- La fila editable de contraoferta se reorganiza en celular para mostrar completos los campos de cantidad y días, sin columnas cortadas.
- Al borrar la ciudad en el carrito también se limpia el departamento derivado. Seleccionar otra ciudad actualiza ambos datos y no se modifica una selección que no se editó.

## v2.1.141 — 2026-10-16

- Antes de enviar un presupuesto se comprueban fechas y stock sin reservar: se muestran faltantes y datos pendientes. Para cotizar con disponibilidad por confirmar se pide una elección explícita y el correo lo aclara. Si cambia la disponibilidad desde la vista previa, hay que revisarla nuevamente.
- Las familias de productos eliminadas aparecen en Ajustes → Eliminados. Se pueden recuperar sin alterar productos, precios ni existencias; los códigos reutilizados y las variantes todavía vinculadas protegen la recuperación y el borrado definitivo.
- La papelera aprovecha mejor el ancho: acciones compactas en computadora y botones con texto en celular.
- El portal pide un código cuando el campo está vacío; el ejemplo se abre sólo con su botón. Los enlaces inexistentes ofrecen WhatsApp clickeable.
- Los diagnósticos de conexión ocultan más formatos de direcciones internas y credenciales.
- Las solicitudes del cliente distinguen el presupuesto actual de la propuesta recibida y muestran los días reales de las tarifas por duración, sin inventar un original histórico.

## v2.1.142 — 2026-10-16

- Las fichas y ventanas del panel se abren centradas, con margen visible y altura ajustada al contenido. En celular el cuerpo se desplaza y las acciones quedan visibles; se conserva la protección de cambios sin guardar.
- El resumen del producto usa indicadores más chicos. Precios, tarifas y costos quedan en una sola grilla compacta, sin cortar sus condiciones; la foto y los estados aprovechan mejor el espacio en celular.
- Antes de enviar un presupuesto se muestra cada línea con su cantidad y capacidad comprobada para las fechas del evento. Las líneas que comparten inventario explican el pedido máximo; los datos desconocidos y los movimientos pendientes quedan por confirmar.
- Si falla la comprobación de inventario, no se presenta disponibilidad acreditada ni se registra una auditoría de aprobación. Consultar disponibilidad sigue sin reservar unidades ni enviar correos.

## v2.1.143 — 2026-10-16

- Selección por página o de todos los resultados filtrados en Inventario, Clientes, Proveedores, Promotoras, Presupuestos y Eventos. Se pueden excluir registros y el alcance permanece visible al cambiar filtros.
- Archivar o enviar a papelera una selección reutiliza las validaciones de cada registro. Los bloqueos y resultados inciertos se muestran por fila; un intento incierto detiene el lote sin repetir acciones automáticamente. La recuperación sigue disponible para administradores en Ajustes → Eliminados.
- La selección completa recorre páginas verificadas, sin quedarse sólo con los primeros resultados. Cambiar de empresa descarta la selección; los permisos se comprueban también en el servidor.
- Fecha del evento, días e invitados quedan alineados en la tienda y la preorden, también en celular, con los campos compactos y los atajos de fecha conservados.
- La papelera explica que el plazo configura la elegibilidad para el vaciado al abrir Eliminados; no promete una hora exacta de borrado.
# 2.1.145

- Tienda: nueva plantilla LedBox con fondo de escenario, retícula sutil, acentos cyan/lima, categorías, fichas y carrito reutilizados del catálogo público.

# 2.1.144

- Inventario: separar el depósito de catálogo de la ubicación física de stock en filtros y edición masiva, con etiquetas claras en las opciones.

