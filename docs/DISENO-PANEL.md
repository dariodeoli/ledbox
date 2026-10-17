# Rediseño completo del panel (EventOS) — guía de diseño

Guía para el rediseño integral de la UI del panel, pedido por el dueño el
22-09-2026 («rediseñar la UI de la app, completa, y reordenar todo»). Es la
fuente única del lenguaje visual: todo componente nuevo o tocado la respeta.
No contradice `docs/REGLAS-GENERALES.md` ni `AGENTS.md`: los completa.

> **Piel fase 2 (26-09-2026, issue #72)**: sobre esta guía se aplicó la
> identidad elegida por el dueño — oscuro **C · Vitrina** (vidrio y aurora,
> aprobado en la fase 1) y claro **C1 · Aurora viva** (elegido el 26-09). Los
> valores están en **§12** y los tres tonos de estado (issue #75) en **§3**.
> La **ola 3** (§12.5) completó el barrido de todos los módulos.
>
> **Piel fase 3 (27-09-2026, issue #83)**: la misma identidad se extendió al
> **portal del cliente** (`clientes.ledbox.online`) y al **sitio público**
> (`ledbox.online`), cada superficie con su voz: **§13**.
>
> **Auditoría UX de producción (01-10-2026, issue #138)**: el relevamiento del
> dueño sobre la **v2.1.61** (escritorio + móvil de 390 px: landing, login,
> dashboard, eventos, clientes, presupuestos, finanzas, plan, modales y portal)
> vive en **`docs/AUDITORIA-UX-PROD.md`**; sus prioridades —tablas móviles,
> desbordamientos, Finanzas con subnavegación— ordenan las próximas tandas del
> rediseño.

## 1. Objetivo

Que la app **se entienda de un vistazo**: jerarquía clara, íconos que asocien
cada título con lo que hace, nada de texto repetido y **una sola acción
principal por pantalla**. Rediseño, no maquillaje: se reordenan las secciones y
se unifican los componentes, sin cambiar datos ni contratos.

## 2. Principios

1. **Densidad primero**: sin espacios vacíos; filas de 44–52 px; una sola línea
   de contenido principal por fila; toda la información en columnas alineadas.
2. **Ícono + título**: cada sección, pestaña y KPI lleva un ícono consistente
   (el mismo concepto usa el mismo ícono en toda la app).
3. **Una acción principal**: en cada pantalla hay **una** acción primaria
   visible (el resto son secundarias o viven en el menú de fila).
4. **Estado honesto**: los estados vacíos, de carga y de error dicen la verdad
   y proponen el siguiente paso; nunca se inventan métricas ni se ocultan datos.
5. **Sin texto repetido**: el mismo mensaje se dice **una vez**, en el lugar más
   útil. Las reglas del negocio, límites y advertencias no se borran: se mueven
   al lugar donde se leen.
6. **Un componente por tipo**: extender los primitivos (`AdminUI`, `AdminFields`)
   antes que crear variantes. CSS solo en `app/globals.css`, tokens `--a-*`.

## 3. Tokens (una sola escala)

- **Tipografía**: display (títulos de pantalla y montos grandes) · body 12.5–13
  px (filas, campos, notas) · micro 10–11 px (etiquetas en mayúscula, chips,
  cabeceras de tabla). Nada intermedio suelto. Desde la fase 2 (§12) la display
  es **Space Grotesk** y el cuerpo **Inter**, self-hosted.
- **Espaciado**: 4 · 8 · 12 · 16 · 24 · 32 (todo padding/gap sale de acá).
- **Radios**: controles en píldora (999) · paneles/chips con `--a-radius` y
  tarjetas/diálogos con `--a-radius-lg`; el valor depende del tema (§12): C usa
  14/20 y C1 usa 18/26.
- **Sombras**: `--a-shadow` para flotantes y `--a-shadow-card` para las
  superficies de la piel; el color de la sombra acompaña al tema.
- **Estados (issue #75)**: el color de estado se dice con **tres tonos** y cada
  uno tiene base, superficie y texto (`--a-ok|warn|danger`,
  `--a-*-surface`, `--a-*-text`): **verde** aprobado / confirmado / cobrado ·
  **naranja** pendiente / en curso · **rojo** esperando aprobación / vencido /
  rechazado. El texto del estado no cambia: el color acompaña. `accent`, `info`
  y `neutral` quedan para lo que no es estado (roles, tipos, categorías, IVA).
  **Excepción de Inventario (E2, 15-10-2026)**: el estado visual del inventario
  usa seis tonos del mismo mapa (`lib/inventory-visual-state.ts`): verde
  disponible, **rojo** alquilado y devolución vencida (la vencida con ícono de
  alerta y etiqueta en negrita), naranja dañado, **info** (azul/violeta del tema)
  mantenimiento y fuera de servicio, **acento** reservado a futuro y neutro
  archivado. Por eso `info` y `accent` tienen también `--a-info-surface/-text` y
  `--a-accent-surface/-text`. Siempre ícono + texto. AA medido en claro y oscuro
  por `tests/inventory-visual-tokens.test.ts` (texto sobre superficie ≥ 7.9 / 6.4
  acento, 8.2 / 5.8 info, ≥ 5.0 los otros; color base sobre el panel ≥ 3).
- **Bordes**: `--a-line` para separadores internos, `--a-line-2` para el borde
  de los objetos; en modo claro marcan el objeto (calibrados el 22-09-2026).
- **Estados**: hover (acento suave), activo/seleccionado (acento), foco visible
  (`:focus-visible` con acento), deshabilitado (opacidad .5).
- **Modo claro/oscuro**: los tokens se definen en ambos temas y se verifica
  contraste AA (texto ≥ 4.5, UI ≥ 3). Desde la fase 2 el claro **no espeja** al
  oscuro: tiene su propio lenguaje (§12).

## 4. Shell del panel

- **Sidebar**: marca arriba; navegación **agrupada** (ver §6); pie con la
  empresa, el usuario (avatar, rol, menú) y la nota del panel. Colapsable en
  escritorio (solo íconos) y drawer en mobile.
- **Topbar**: ícono del módulo + eyebrow + título del módulo; a la derecha las
  herramientas reales (buscar ⌘K, avisos, tema, demo, salir). Sin botones mudos.
- **Área de contenido**, con este ritmo fijo:
  1. encabezado del módulo (título, ícono, ayuda «¿Qué es esto?»),
  2. KPIs del módulo (máximo 4–5, con ícono y tono),
  3. barra de filtros/búsqueda (una sola),
  4. contenido (tabla o tablero) con su plantilla de columnas,
  5. acciones masivas solo si existen y son reales.
- **Mobile**: barra inferior con los 4 módulos diarios + «Más»; el contenido
  nunca queda tapado (padding real) y no hay scroll horizontal de página.

## 5. Componentes (contrato)

| Componente | Reglas |
| --- | --- |
| Botón primario | Uno por pantalla; verbo + ícono; nunca en dos acciones a la vez |
| Botón secundario / ghost | Acciones de soporte, sin ícono si el texto alcanza |
| Acción de fila | Ícono 15–16 px, `title` + `aria-label`, agrupadas a la derecha |
| Panel/sección | Título con ícono + contador o dato clave a la derecha; cuerpo denso |
| KPI | Etiqueta micro, valor display, nota corta, ícono con el tono |
| Tabla | Encabezado de columnas + filas 44–52 px, plantilla `--<vista>-cols` |
| Pestañas | Ícono + etiqueta; contador cuando aporta; estado activo evidente |
| Campos | Kit canónico (`AdminFields`); nunca `<input>` suelto en `components/admin` |
| Diálogo | `AdminDialog` (default/wide/ficha); título con ícono; acción primaria al pie |
| Estado vacío | Ícono + una línea + una acción; sin párrafos |
| Estado de carga | Filas fantasma con la densidad real; sin spinners sueltos |
| Nota/ayuda | Una línea, al lado del dato que explica; nunca repetida |

## 6. Reordenar: navegación por etapas (13-10-2026)

| Grupo | Módulos |
| --- | --- |
| **Inicio** (suelto) | Inicio (`/dashboard`) |
| **Ventas** (flujo, con línea vertical) | Leads → Presupuestos → Eventos |
| **Catálogo** | Catálogo de venta (lista interna, separada del alquiler) |
| **Clientes** (suelto) | Clientes |
| **Operación** | Inventario · Proveedores · Promotoras |
| **Plata** | Finanzas · Facturación |
| **Sistema** (fijo sobre Empresa) | Ajustes; Estado vive dentro y conserva acceso OWNER/ADMIN |

> **Menú por etapas (13-10-2026).** El orden sigue el recorrido del negocio:
> entra un lead, se cotiza, se hace el evento; después se cobra. `ADMIN_NAV`
> (`lib/admin-policy.ts`) es la fuente única; `bare` marca los ítems sueltos (sin
> encabezado ni acordeón) y `flow` las etapas de un flujo, que se dibujan unidas
> por una línea vertical (`.admin-nav-list[data-flow]`).
> **Firmas** pasó a una pestaña de Presupuestos (`/firmas` sigue siendo ruta) y
> **Plantillas** a una sección de Ajustes (`/plantillas` sigue siendo ruta): el
> ítem del menú queda activo por `also`, y la barra de pestañas
> (`PresupuestosTabs`, `AjustesTabs`) se dibuja en las dos pantallas.
> **Contadores**: cada etapa de Ventas muestra lo pendiente con datos reales de
> `GET /api/admin/nav-counts` (tres `count` por empresa): leads `NEW` sin
> contactar, presupuestos `SENT`/`NEGOTIATING` y eventos de los próximos 7 días.
> Sin dato o en 0 no se dibuja contador. Se refrescan al navegar y con
> `requestAdminRefresh()`. Los permisos por rol no cambian: `adminNavGroups(role)`
> mantiene las restricciones de cada sección (Estado es OWNER/ADMIN dentro de Ajustes).
> **Móvil**: la barra inferior es Inicio · Leads · Presupuestos · Eventos · Más
> (el resto vive en el drawer).
>
> Consolidación previa (23-09-2026, issue #56): Calendario es una **vista dentro
> de Eventos** (`/eventos?vista=calendario`), el PIN vive solo en **Mi perfil**,
> **Ajustes** agrupa Empresa · Correo · Plan · Usuarios · Plantillas y **Estado**
> agrupa Sistema · Auditoría. Las rutas viejas siguen entrando con redirect.

Reglas del reordenamiento:
- Lo que se usa todos los días arriba (Inicio, y Ventas en el orden del flujo).
- Finanzas y Facturación juntas bajo **Plata** (son el mismo trabajo con dos caras).
- Ajustes queda fijo encima de Empresa, fuera del scroll de módulos. Estado conserva Sistema/Auditoría dentro de Ajustes.
- Entrar a Ajustes/Estado compacta el menú de escritorio sin sobrescribir la preferencia manual. Cambiar una pestaña interna respeta la expansión manual; al entrar a un módulo diario se expande. El control queda debajo de la marca en modo compacto. El drawer de celular mantiene su comportamiento.
- Dentro de cada módulo: primero lo urgente/accionable (avisos, pendientes), después lo
  operativo (listas y tableros), al final lo descriptivo (notas, ayudas, históricos).

## 7. Qué NO cambia

- Contratos públicos (`/api/leads`, `/api/quotes`, portal, demo), roles y
  permisos, montos `Int` PYG, fechas es-PY 24 h, aislamiento por empresa,
  auditoría, migraciones y el footer con versión (`AppFooter`).
- La demo sigue siendo de solo lectura y con sus datos simulados.
- Sin dependencias nuevas ni librerías de UI.

## 8. Verificación obligatoria

1. `npm run typecheck`, `npm run build`, `npm run test:rules`, `npm run check:fields`.
2. Capturas CDP en **claro y oscuro**, desktop 1440 y mobile 390, de todos los
   módulos; consola sin errores; sin scroll horizontal de página a 390.
3. Contraste: texto ≥ 4.5 y UI ≥ 3 en ambos temas.
4. Teclado: foco visible, Escape cierra diálogos, la acción principal se alcanza
   con Tab en orden lógico.
5. Comparar contra el «antes» (`/tmp/antes-oscuro`, `/tmp/antes-claro` del
   22-09-2026) para el antes/después del reporte.

## 9. Rendimiento del shell (23-09-2026, issue #61)

Medición con el build de producción local, sesión real y Chrome headless con 3G
rápido (150 ms, 1,6 Mbps) y caché deshabilitada, en `/dashboard`, `/eventos` y
`/finanzas` (mismos datos que `docs/RENDIMIENTO-FINANZAS.md`).

| Pantalla | CLS antes | CLS después | API antes | API después |
| --- | --- | --- | --- | --- |
| `/dashboard` | 0,135 | **0,028** | 6 | **5** |
| `/eventos` | 0,112 | **0** | 6 | **5** |
| `/finanzas` | 0,112 | **0** | 8 | 7 |

Qué se cambió:

- **Sesión embebida**: el layout del panel resuelve la sesión en el servidor
  (`buildAdminSessionPayload`, el mismo payload de `/api/admin/session`) y el
  shell arranca con ella. Se eliminó el esqueleto de 6 filas que se reemplazaba
  por el contenido (el salto de layout) y el pedido fijo de entrada. Frescura y
  permisos iguales: la sesión es del request y `reload()` sigue refrescando
  contra el API.
- **GET en vuelo compartidos** (`lib/admin-api.ts`): dos componentes que piden lo
  mismo al mismo tiempo (la campana y el Resumen piden `notifications`) comparten
  la promesa; los pedidos con `signal` propio siguen siendo suyos.
- La navegación cliente no repite pedidos del shell: `session` y `notifications`
  se piden una vez por carga de documento (verificado: 0 pedidos de sesión al
  movernos entre Eventos, Finanzas, Presupuestos y Resumen).

Lo que queda (fuera de PANEL): el CLS restante de `/dashboard` (0,028) es el
bloque «Qué mirar hoy» creciendo con sus avisos; y `/finanzas` pide el extracto
dos veces con filtros distintos (lista completa y por cuenta), decisión de FIN.

## 10. Mobile y arrastre táctil (23-09-2026, issue #55)

- **Pasada mobile** con Chrome device emulation a **390 y 414 px** sobre las 22
  rutas del panel: **0 pantallas con scroll horizontal de página** (los scrollers
  internos de listas/tableros no cuentan) y sin errores de consola. Los diálogos
  entran con el pulgar: el de «Datos de pago» mide 358 px de ancho a 390 con sus
  campos y sin scroll interno; el alto se resuelve con el scroll del overlay.
- **Arrastre táctil de los tableros**: el DnD HTML5 no dispara con el dedo, así
  que `AdminBoard` suma un camino por Pointer Events con **pulsación larga**
  (300 ms) y `touch-action: manipulation`; durante el arrastre se frena el
  `touchmove` con un listener nativo no pasivo (React lo registra pasivo y el
  navegador cancelaba el pointer). Un swipe normal sigue scrolleando: el arrastre
  solo empieza después de la pulsación larga y «Mover a…» queda como alternativa
  accesible.
- Verificación: con emulación de toque, arrastrar una tarjeta de Borrador a
  Enviado dispara el PATCH real y la tarjeta queda en la columna destino; un
  swipe rápido scrollea la página (0 → 336 px) sin activar el arrastre.

## 11. Buscador global y paleta diferida (23-09-2026, issue #67)

- **Cobertura del buscador** (⌘/Ctrl + K): suma `Event.city` y los contactos
  directos del cliente —teléfono, WhatsApp, Instagram y sitio— a lo que ya
  cubría (nombre, empresa, RUC, correo, teléfono, persona encargada, título de
  presupuesto, eventos y usuarios del equipo). La consulta de teléfono se
  **normaliza**: «0981 222 333», «0981222333» y «+595 981222333» encuentran al
  mismo cliente. El subtítulo del evento muestra lugar y ciudad.
  Límite conocido: la búsqueda no ignora acentos (`contains` de Prisma);
  ignorarlos pediría `unaccent` en Postgres (migración, plataforma).
- **Paleta diferida**: `AdminCommandPalette` se carga con `next/dynamic`
  (`ssr: false`) desde el shell, con prefetch ocioso para que la primera
  apertura sea instantánea. Su chunk propio (4,7 kB crudos) **ya no está entre
  los scripts del HTML inicial** (verificado en el navegador: no figura en
  `script[src]` y se pide recién al quedar ocioso el shell). El botón del topbar
  y el atajo ⌘/Ctrl + K viven en `AdminShell`.
- **Fricciones corregidas y verificadas**: la primera apertura de la paleta se
  cerraba sola (el efecto de «cerrar al navegar» corría también en el montaje) y
  ⌘K con la paleta abierta borraba la consulta; el foco arranca en el buscador,
  Escape cierra y el botón del topbar sigue ahí. Al navegar, la página vuelve
  arriba (comportamiento de Next, verificado: 304 → 0 px de scroll).
- **CLS de `/dashboard` (0,028)**: el salto restante es el crecimiento de los
  bloques de lista al llegar sus datos. No se reservan más filas a propósito:
  con la lista vacía el bloque se encoge, así que reservar de más empeora el
  caso opuesto; queda bajo el objetivo (< 0,1) y documentado.

## 12. Piel fase 2 (26-09-2026, issues #72 y #75)

Identidad elegida por el dueño sobre las direcciones de `docs/rediseno-v2/`
(fase 1 en `origin/feat/experimento-rediseno-v2`, solo doc y capturas):

- **Oscuro C · Vitrina** (aprobado en la fase 1): luz de escenario, vidrio y
  aurora, acento en degradado.
- **Claro C1 · Aurora viva** (elegido el 26-09): aurora pastel con color de
  verdad, superficies que flotan sin borde, curvas amplias. **No espeja** al
  oscuro: tiene su propio lenguaje.

Todo vive en `app/globals.css`: los tokens en `.admin-root` /
`.admin-root[data-theme="light"]` y la terminación en el bloque «PIEL FASE 2».
**Cero cambios de marcado** para la piel; la densidad, las plantillas
`--<vista>-cols` y los contratos no cambian.

### 12.1 Tokens

| Token | Oscuro C | Claro C1 |
| --- | --- | --- |
| `--a-bg` / `--a-bg-art` | `#0a0a13` + 3 auroras (cian, violeta, rosa) fijas | `#f6f8ff` + 4 auroras (cian, lila, rosa, menta) sobre lavado periwinkle |
| `--a-panel` / `--a-panel-2` | `rgba(255,255,255,.045)` / `.075` | `rgba(255,255,255,.84)` / `#fff` |
| `--a-line` / `--a-line-2` | `rgba(255,255,255,.10)` / `.20` | `rgba(28,34,74,.07)` / `.16` |
| `--a-line-control` | `rgba(255,255,255,.40)` | `rgba(28,34,74,.55)` |
| `--a-text` / `--a-text-strong` | `#eceefb` / `#fff` | `#141a33` / `#0a0e20` |
| `--a-muted` / `--a-muted-2` | `#9ea1c0` / `#c9cce6` | `#545a80` / `#343a5e` |
| `--a-accent` / `-strong` / `-soft` | `#5ad9ff` / `#93e7ff` / `.12` | `#0b6f8f` / `#085a75` / `.10` |
| `--a-grad-accent` | `120deg, #5ad9ff → #a78bfa` | `120deg, #7dd3fc → #c4b5fd` |
| `--a-grad-action` (acción primaria) | el degradado de acento, tinta `#0d1026` | `120deg, #0b6f8f → #4f46e5`, tinta `#fff` |
| `--a-grad-ink` (título del login) | degradado de acento | `120deg, #0891b2 → #4f46e5` |
| `--a-radius` / `--a-radius-lg` | 14 / 20 | 18 / 26 |
| `--a-shadow` / `--a-shadow-card` | largas y negras + luz interna | color (`rgba(76,61,186,…)`) |
| `--a-blur` | `blur(18px) saturate(1.3)` | `blur(18px) saturate(1.2)` |
| `--a-sticky-bg` | `#16171f` | `#fff` |

Reglas de la piel:

- **Vidrio acotado**: `backdrop-filter` solo en superficies fijas (sidebar,
  topbar, menú/avisos, login y diálogos). **Nunca** en filas ni tarjetas de
  lista (rendimiento; la fase 1 ya lo había medido con 0 blur por fila).
- **Fila sticky opaca**: la columna de acciones (#73) y el encabezado sticky
  usan `--a-sticky-bg`, porque con superficies translúcidas el contenido de
  abajo se transparentaba.
- **Formas**: en C1 el sidebar termina en curva (`0 30px 30px 0`), los paneles
  y KPI pierden borde y flotan con sombra de color, las filas son tiras
  blancas (radio 17) que se elevan 1 px al pasar el mouse. En C el sidebar y la
  topbar son vidrio con línea fina, los paneles llevan luz interna y las filas
  son tiras translúcidas.
- **KPI**: grilla de 2 columnas en mobile y 4 en escritorio; los tonos pintan
  la superficie (`--a-*-surface`), el valor (`--a-*-text`) y el chip del ícono.
- **Navegación**: el ítem activo es una píldora con `--a-grad-accent` y tinta
  oscura; hover sin color de acento pleno.

### 12.2 Tipografía self-hosted

La app declaraba `Space Grotesk`/`Archivo Black` pero **no cargaba ninguna**
(hallazgo de la fase 1: 0 recursos de fuente y todo caía al genérico). Desde la
fase 2:

- **Space Grotesk** (display: títulos de pantalla, paneles, KPI, montos) y
  **Inter** (cuerpo) en woff2 **variable**, subset latin, OFL, en
  `public/fonts/` (`space-grotesk-latin-var.woff2` 22 KB +
  `inter-latin-var.woff2` 48 KB) con `@font-face` en `globals.css`.
- Las familias se llaman **«Space Grotesk Panel»** e **«Inter Panel»** a
  propósito: mantienen un nombre propio y estable en `@font-face`, así el panel
  las declara sin pisar a nadie. Desde la **fase 3 (§13)** el portal del cliente
  y el sitio público también las consumen (los woff2 son los mismos); `lbprint`
  sigue con su stack y no se toca. Sin librerías nuevas.
- Licencias en `public/fonts/LICENSE-*.txt`.

### 12.3 Contraste (AA medido)

Pares reales con la luminancia relativa de los tokens finales, considerando la
aurora en su campo más saturado (texto ≥ 4.5, controles ≥ 3):

| Par | Oscuro C | Claro C1 |
| --- | --- | --- |
| Texto / panel | 11.2 | 16.4 |
| Texto / fila | 9.9 | 17.1 |
| Muted / panel | 5.1 | 6.4 |
| Muted / aurora (peor campo) | 5.3 | 5.1 |
| Acento / panel | 7.9 | 5.5 |
| Texto ok / superficie ok | 6.5 | 5.7 |
| Texto warn / superficie warn | 6.4 | 6.2 |
| Texto danger / superficie danger | 5.3 | 5.7 |
| Borde de control / panel | 3.4 | 3.5 |
| Tinta de la acción primaria / degradado | 6.9–11.4 | 5.7–6.3 |
| Tinta del nav activo / degradado | 6.9–11.4 | 10.2–11.3 |

Único ajuste durante la ronda: en C el borde de control subió de `.34` a `.40`
de blanco para llegar a 3:1 sobre la aurora violeta.

### 12.4 Alcance de esta ola y lo que sigue

- **Hecho acá**: tokens y tipografía, shell (sidebar, topbar, navegación,
  búsqueda), command palette, login (con el botón de Google existente) y foco
  visible; **Resumen** completo (KPIs, «Qué mirar hoy», agenda) y los tres tonos
  de estado en badges/chips, celdas, KPIs y filas del shell + Resumen.
- **Fuera**: hojas `lbprint` (siguen igual en la fase 3) y el sitio público (que
  pasó a la **fase 3, §13**).

### 12.5 Ola 3 — barrido de módulos (26-09-2026, issues #72 y #75)

Mismos tokens, sin estructura nueva: la piel llegó a **Calendario, Eventos,
Clientes (lista, cuadrícula y ficha 360), Leads (lista y detalle), Inventario
(lista y detalle), Proveedores (lista, tablero y fichas), Promotoras,
Checklist, Presupuestos (lista, tablero, detalle y trazabilidad), Finanzas (por
confirmar, cobros, cobros a plazo, pagar, tesorería cuentas/movimientos, gastos
y conciliación), Facturación (facturas, facturables, compras, libro de IVA,
cierre y datos fiscales), Correo, Usuarios/Invitaciones, Ajustes (empresa,
correo, plan), Estado (sistema y auditoría), Perfil, Plantillas, Configuración,
Demo, más los diálogos y el mobile.**

Superficies de estado (#75) aplicadas en esta ola:

- **Filas**: el tono del estado tiñe fondo y filete
  (`data-tone="ok|warn|danger"` en `AdminRow`, mismo lenguaje que los chips).
- **Tableros**: la columna lleva el lavado de su tono (acento, info, verde,
  naranja, rojo) y el contador; las tarjetas flotan con la superficie de fila y
  se elevan 1 px al pasar el mouse.
- **Celdas de estado con control**: el `AdminSelect` acepta `tone` y se pinta
  con la superficie/texto del tono (Inventario).
- **Calendario**: celdas y filas de día con la superficie de la piel; los chips
  de evento llevan el lavado de su tono; avisos vencidos/próximos con rojo y
  naranja suaves.
- **Cuadrícula de tarjetas** (inventario, clientes, proveedores) y **detalle de
  ficha**: superficie y sombra de la piel con hover de 1 px.
- **Estados sin badge**: se alinearon al mapa único (`Pendiente` de checklist →
  naranja; `Emitida` de facturación → naranja, «por cobrar»).

Pulidos de la ronda:

- **Tipografía heredada**: `.admin-root { font-family: var(--font-body) }`
  cierra el hallazgo del QA de v2.1.42 — lo que no declara familia propia ya no
  cae al genérico del sistema (Inter llega a todo el panel; sitio y `lbprint`
  siguen igual).
- **Acciones de Finanzas**: la última columna de «cobros a plazo» pasa de 6.5 a
  10.5 rem y la de «por confirmar» de 6.5 a 11.5 rem (los cinco botones y el
  «Confirmar» con texto entran completos); el resto de las plantillas y la
  densidad no cambian.
- **Sticky (#73)**: las celdas pegadas corren 12 px hacia el borde
  (`right: -12px`), así el strip de padding del contenedor deja de mostrar la
  celda vecina al deslizar; el fondo sigue siendo el opaco de la piel.

Pendientes (próxima ronda, sin bloquear): medir el costo del `backdrop-filter`
en equipos de gama baja (riesgo declarado de C·Vitrina) y revisar si algún tono
de estado fuera de las tres canastas (p. ej. urgencias «faltan N días») merece
su propia escala.

## 13. Piel fase 3 — portal del cliente y sitio público (27-09-2026, issue #83)

La identidad de la fase 2 se extendió a las dos superficies que faltaban, sin
tocar contratos, lógica ni estructura: **portal del cliente**
(`clientes.ledbox.online`: portada, presupuesto `/p/[token]`, firma
`/firma/[codigo]`) y **sitio público** (`ledbox.online`: landing y ficha de
producto). Cada superficie tiene su voz dentro de la misma piel.

### 13.1 Qué cambió, por superficie

| | Portal del cliente | Sitio público |
| --- | --- | --- |
| Tokens | Los del panel (§12.1), sobre el contrato propio del portal (`--bg`, `--surface`, `--border`, `--led`, `--p-ok/warn/danger/info`) | Propios (`.site`): cian eléctrico de marca como luz, aurora y vidrio |
| Oscuro | **C · Vitrina**: `#0a0a13` + 3 auroras, tarjetas translúcidas, vidrio en barra y pie móvil | **C · Vitrina (sitio)**: `#08080f` + 3 auroras, cian `#00e5ff` intacto, matriz LED y esquinas cortadas |
| Claro | **C1 · Aurora viva**: `#f6f8ff` + 4 auroras, tarjetas blancas flotando, radios 18/26 | **C1 · Aurora viva (sitio)**: misma aurora, cian baja a `#085a75` para sostener AA sobre la aurora |
| Acción primaria | Degradado `#5ad9ff→#a78bfa` (oscuro) / `#0b6f8f→#4f46e5` (claro), tinta `#0d1026` / blanco, controles en píldora | Degradado `#00e5ff→#a78bfa` (oscuro) / `#0b6f8f→#4f46e5` (claro), esquina cortada de la marca |
| Tipografía | Space Grotesk display + Inter cuerpo (los `@font-face` del panel) | Igual que el portal |
| Vidrio | Barra superior, pie móvil y avisos; nunca en listas | Barra, CTA pegajoso, carrito y diálogo de consulta |
| Papel | La firma (canvas, vista previa, sellos) queda **blanca en los dos temas**; su borde se dibuja con **tinta de papel** (`rgba(16,22,26,.55)` en el punteado del canvas, ≥ 3:1 sobre el blanco) y «Limpiar»/«Firmar» miden ≥ 44 px | — |

Detalles de la ronda:

- **Control ≥ 3:1** en ambos portales: campos, botones fantasma, selector
  segmentado, steppers y tarjetas de decisión usan `--line-control`
  (`rgba(255,255,255,.40)` oscuro / `rgba(28,34,74,.55)` claro); el recuadro de
  firma, que siempre es papel blanco, usa tinta de papel para que el punteado se
  vea igual en los dos temas.
- **Impresión apagada**: `@media print` del portal fuerza `background-image:
  none` y quita sombras; las hojas `lbprint` no se tocaron.
- **Sitio**: el tema lo fija `SITE_BOOT_SCRIPT` (`lib/site-theme.ts`) antes del
  primer pintado — preferencia guardada y, si no hay, la del sistema (claro →
  C1). **No tiene toggle visible**: se resolvió así para no cambiar la
  navegación de la landing sin pedido del dueño; el mecanismo queda listo para
  agregarlo. Sin preferencia ni JS queda el oscuro de siempre.
- **`app/(product)/producto`** (landing de ventas de EventOS) queda **fuera**:
  el pedido del issue #83 apunta al sitio de LedBox (`app/(public)`); si el
  dueño quiere la misma piel ahí, es un brief aparte (hoy mantiene su stack sin
  Space Grotesk/Inter).

### 13.2 AA medido (tokens finales)

Mismo método que §12.3: tonos translúcidos compuestos sobre la base del tema y,
para el peor caso, sobre el campo más saturado de su aurora.

| Par | Portal oscuro | Portal claro | Sitio oscuro | Sitio claro |
| --- | --- | --- | --- | --- |
| Texto / fondo | 17.1 | 16.2 | 17.3 | 16.2 |
| Muted / aurora (peor campo) | 5.3 | 4.6 | 5.9 | 4.7 |
| Acento / aurora | 8.2 | 5.3 | 9.7 | 5.5 |
| Muted sobre tarjeta / aurora | 4.7 | 6.3 | — | — |
| Borde de control / fondo | 3.8 | 3.6 | 3.8 | 3.6 |
| Tinta de acción / degradado | 6.9 | 5.7 | 6.9 | 5.7 |
| Ok / warn / danger (texto o tinte) | ≥ 6.9 | ≥ 5.5 | — | — |

Ajustes de la ronda: en claro el acento del portal y del sitio bajó a su
variante de texto (`#085a75`) porque el acento base (`#0b6f8f`) no llegaba a
4.5 sobre el campo cian de la aurora; los tonos de estado del portal en claro
usan las variantes de texto del panel (`#0b6b43`, `#7a5005`, `#a82640`).

### 13.3 Verificación y evidencia

- `npm run typecheck`, `npm run test:rules`, `npm run build` en verde; sin
  marcadores de conflicto.
- 0 errores de consola, 0 scroll horizontal de página a 390 y 1440 en las cinco
  superficies (medido con CDP); fuentes reales cargadas
  (`document.fonts.check`); impresión del portal sin aurora ni sombras.
- Capturas claro/oscuro a 390/1440 en **`docs/rediseno-v2-fase3/`** (sin
  commitear): portal (portada, presupuesto, firma y firma-canvas) y sitio
  (landing, ficha, carrito y consulta), más el arranque por preferencia del
  sistema.

### 13.4 Landing de EventOS (01-10-2026, issue #133)

`app/(product)/producto` (`eventos.ledbox.online`) —que §13.1 había dejado fuera—
estrena la misma familia: oscuro **C · Vitrina** y claro **C1 · Aurora viva**,
tipografía real (Space Grotesk display + Inter cuerpo), vidrio en la barra,
matriz LED de fondo, superficies translúcidas con sombra y la acción primaria con
la esquina cortada de la marca; en claro el acento baja a `#085a75`, como en el
sitio, y los radios pasan a 18/26.

- **Tema**: `PRODUCT_BOOT_SCRIPT` (`lib/site-theme.ts`, el mismo módulo y la
  misma preferencia guardada que el sitio) fija `data-theme` en `#producto-root`
  antes del primer pintado; sin JS queda el oscuro. Sin toggle visible.
- **Patrones de la ronda**: padding de página y de sección simétrico
  (#115/#121/#124) y grillas alineadas (#102). La superficie no tiene
  estadísticas, campos ni títulos de urgencia: KPIs compactos (#113), aviso de
  privacidad (#92) y escala de urgencia no aplican.
- **Pie**: el compartido (`AppFooter variant="app"`) con la versión real de
  `lib/version.ts`. Textos y SEO (`metadata`, JSON-LD) intactos.

**2ª pasada (02-10-2026, auditoría UX de producción):** la marca del header pasa
del isotipo de LedBox al vector de EventOS (mismo `BrandMark` que el panel: dos
logos juntos se leían superpuestos); el hero se aprieta (aire 130 → 112 px a
1440) y el CTA queda sobre el pliegue (382/900 y 338/844); el hero suma el flujo
**Cotizá → Aprobá → Operá → Cobrá**; se agregan **«Lo que cambia en la
operación»** (tiempo, faltantes, margen: el mecanismo concreto, sin métricas
inventadas) y **«Para quién es»** (productoras, alquiladores, agencias); las
secciones quedan más cerca (128 → 96 px entre «Cómo funciona» y «Preguntas») y
las anclas ya no aterrizan bajo la barra pegajosa (`scroll-margin-top: 76px`).

## 14. Campos y ventanas de carga (13-10-2026)

Rediseño de `AdminFields` y de `AdminDialog`; todo el CSS vive en
`app/globals.css` bajo `.admin-*` y los tokens nuevos (`--a-field-*`,
`--a-focus-halo`, `--a-danger-halo`, `--a-ok-halo`, `--a-dialog-*`) se definen
en los dos temas. Guardas en `tests/admin-dialog-fields.test.ts`.

**Campos.**
- Alto `--a-field-h`: 40 px en escritorio y 44 px a ≤ 720 px; radio 9 px; fondo
  `--a-field-bg` (un tono más oscuro que el panel en oscuro, blanco en claro).
- Etiqueta arriba, 12 px semibold. `required` agrega «*» en el acento
  (`aria-hidden`: el input ya es `required`); `optional` agrega «opcional» a la
  derecha. Hint 11,5 px tenue.
- Foco: borde del acento + halo de 3 px. Error: borde rojo + halo + mensaje
  debajo en `--a-danger-text` (`aria-invalid` + `aria-describedby`). Válido
  (`success`, por ejemplo RUC encontrado): borde verde suave y mensaje verde
  (`data-state="valid"`). Deshabilitado o solo lectura: opacidad .55.
- Prefijo fijo con separador: «Gs» (`MoneyField`), «+595» (`PhoneField`: el
  selector de país y el número son un solo campo) y «%» (`PercentField`, detrás
  del número porque así se lee). Mismo segmento visual (`.admin-money`).
- `SegmentedField` de 40 px con la opción activa en acento suave.
- Nuevo `CheckboxField` (casilla con texto, `tone` ok/warn/danger); el checklist
  operativo y «Retirado / no incluido» de Presupuestos dejaron de usar `<input>`
  sueltos. Los filtros de barra (`.admin-toolbar`) siguen a 36 px a propósito.

**Contraste medido** (tokens reales, ventana opaca `--a-dialog-bg`): texto
16,1 (oscuro) / 17,1 (claro); hint/placeholder 7,4 / 6,7; etiqueta 11,7 / 11,0;
«*» 11,3 / 5,7; error 9,9 / 7,0; válido 13,3 / 6,6; borde de control 3,8 / 3,6;
borde de error 7,6 / 5,8; borde de foco 11,3 / 5,7. El test recalcula los
contrastes de texto ≥ 4,5 y de borde ≥ 3 desde `globals.css`.

**Ventanas (`AdminDialog`).**
- Encabezado: ícono en cuadro de 36 px (acento suave), título en display 16 px,
  `description` opcional (una línea: qué pasa al guardar) y cerrar de 30 px.
- Cuerpo con scroll propio. `AdminDialogSection` (título chico en mayúsculas) y
  `.admin-dialog-grid`: 2 columnas en escritorio, 1 en celular; `wide` en un
  campo ocupa el ancho completo.
- Pie fijo: prop `footer` (acción principal a la derecha). Los
  `.admin-dialog-foot` dentro de los hijos se estilizan igual y quedan pegados
  abajo (sticky), así que los usos existentes no cambian. Si el botón vive fuera
  del `<form>`, se enlaza con `form={id}`.
- Tamaños: default 560 px, `wide` 720 px, `xl` 960 px y `ficha` 1040 px.
  Todos son diálogos centrados de altura natural: marco visible de 16 px en
  escritorio y 12 px en móvil, ampliado por safe-area. El máximo de altura usa
  `visualViewport` (incluye teclado y desplazamiento); el cuerpo desplaza y el
  pie queda fuera de ese scroll. `ficha` sólo cambia el ancho, nunca fuerza un
  panel lateral o una hoja de alto completo (pedido #264, 16-10-2026).
- `dirty`: cerrar con X, Esc o clic afuera pide confirmación dentro del mismo
  diálogo («Seguir editando» / «Descartar»); Esc dentro de la confirmación
  vuelve a editar. Sin `window.confirm`.
- Foco al abrir (respeta `autoFocus`), trampa de foco con Tab/Shift+Tab, foco de
  vuelta al disparador, `aria-modal`, y Esc/Tab solo del diálogo de arriba. El
  diálogo se monta dentro de `.admin-root` (portal): uno abierto desde otro ya no
  queda recortado por la hoja de abajo.
- Los siete diálogos armados a mano (`Finanzas`, `Usuarios`) pasaron a
  `AdminDialog` con `footer` (y `dirty` donde hay datos cargados); Esc ya no los
  cierra sin confirmar. Alta y edición de evento y de ítem de inventario también
  son ventanas (`wide` en inventario, secciones `AdminDialogSection`). Leads
  mantiene el detalle como panel de lectura y solo la edición del seguimiento
  (estado y notas) es una ventana. Tercera tanda: Clientes (alta y edición, también
  `?editar=<id>`), Proveedores (proveedor, trabajo y estado del trabajo),
  Promotoras (alta y disponibilidad), Finanzas (cobro, cuenta, movimiento y
  gasto con «Guardar y cargar otro») y Usuarios (alta y edición) son
  `AdminDialog` con secciones, `footer` con `requestClose` y `dirty`. Solo queda
  `AdminFormPanel` en el registro de salida/devolución de equipo de Eventos
  (despacho, Fase 4); cuando ese flujo pase a ventana se borra con su CSS.
  Móvil (#159): el perfil del menú lateral conserva nombre y rol y la barra
  inferior (z 22) queda debajo de las ventanas (z 60).
- Adoptados con `description`, `footer` y `dirty`: Nuevo cliente
  (`ClientQuickForm`), Crear evento (`BudgetQuickCreate`) y Precio y condiciones
  (`BudgetPricingDialog`).

## 15. Inicio (Resumen) y demo liviana (13-10-2026)

**Inicio** (`/dashboard`, `ResumenModule`) reemplazó la grilla de 8 KPIs y las
tablas por cuatro bloques y un saludo (nombre del usuario, fecha es-PY y el botón
principal **Nuevo lead**, solo para quien puede escribir clientes):

1. **Para hacer hoy**: hasta 5 acciones por urgencia, cada una con su botón al
   lugar exacto, y «Ver todos (N)» que expande el resto. Rojo: mora
   (`ClientPayment` pendiente vencido), cheque rechazado (anulado en 30 días) y
   pagos esperados vencidos. Ámbar: leads sin contestar y checklist incompleto de
   eventos próximos. Cian: comprobantes por confirmar. Neutro: el resto de los
   avisos. La lógica es pura (`lib/resumen-actions.ts`, test en
   `tests/nav-resumen.test.ts`) y sale de `useAdminNotifications` +
   `/api/admin/resumen`; los agregados (mora, leads, comprobantes) reemplazan a
   sus avisos individuales para no duplicar. Cargando: skeleton; sin nada:
   «Todo al día».
2. **Embudo del mes**: Leads → Presupuestos → Aprobados → Eventos con cantidad y
   monto; cada etapa enlaza a su lista (`/presupuestos?estado=APPROVED`, etc.).
   «Presupuestos» cuenta los creados o aprobados en el mes, así «Aprobados» nunca
   lo supera.
3. **Plata**: Por cobrar (saldo de presupuestos aprobados), En mora y Cobrado este
   mes. Montos abreviados en millones con `Intl` es-PY (`formatMoneyCompact`,
   «Gs 47,8 M») y el exacto debajo; `white-space: nowrap`, nunca truncados.
   «Por pagar» y «Caja comprometida» quedan en Finanzas.
4. **Esta semana**: eventos de los próximos 7 días con bloque de fecha, nombre, una
   línea de detalle y un chip (checklist 0/4, seña pendiente, sin checklist).

Los listados de Leads, Presupuestos y Eventos aceptan `?estado=` (NEW, APPROVED,
CONFIRMED…) y Leads abre el alta manual con `?nuevo=1`.

**Demo.** La franja del shell es una sola línea fina: «DEMO · Datos de ejemplo: no
se guarda nada», con «Recorrido guiado» (`/demo?recorrido=1`) y «Salir».
`DemoIntro` se abre sola solo la primera vez (localStorage con try/catch, se marca
al abrir) o con «Recorrido guiado». `/demo` muestra el recorrido y los casos
fuertes como listas compactas con su conteo real; los casos salen de las mismas
reglas que Inicio (`rejectedChequeWhere`, mora, comprobantes), por eso también
aparecen en «Para hacer hoy».

## 16. Biblioteca de piezas (etapa A del rediseño, 15-10-2026)

Una pieza = un componente = un lugar del CSS. Si se edita la ventana, el campo de
precio, un desplegable o el tablero, se corrige en todas las pantallas. El CSS de la
biblioteca vive en `app/globals.css`, entre los marcadores «BIBLIOTECA DE PIEZAS» y
«FIN BIBLIOTECA» (botón, chip, campos, ancho por tipo, segmentado y menús); la ventana
y el tablero tienen su bloque propio (`.admin-dialog-*`, `.admin-board-*`). El
candado `npm run check:ui` (en `test:rules`) impide volver a controles o estilos
sueltos en `components/admin` y `app/(admin)`; los componentes de la biblioteca son
`AdminUI.tsx`, `AdminFields.tsx` y `AdminBoard.tsx`. Guardas en `tests/biblioteca-ui.test.ts`.

### 16.1 Piezas, props y cuándo usarlas

| Pieza | Props principales | Usar para |
| --- | --- | --- |
| `AdminButton` | `variant` primary · secondary (default) · ghost · danger · link; `size` md (36 px) · sm (30 px); `icon`, `iconEnd`, `iconNode`; `busy` + `busyLabel` | Toda acción. Una sola `primary` por pantalla o ventana; «Cancelar» y las terciarias, `ghost`; destructivas, `danger`; un texto clicable dentro de una frase o tabla, `link`. Sin texto + `icon` = botón de ícono (con `aria-label`/`title`). 44 px en celular |
| `AdminButtonLink` | las mismas que `AdminButton` + `href` | Navegar con cara de botón. Interno usa `next/link`; con `target`, `download`, URL absoluta, `/api/` o `/imprimir/` es un `<a>` |
| `AdminIconButton` / `AdminIconLink` | `icon` o `iconNode`, `iconSize`, `label` (obligatorio: es el `aria-label` y el `title`), `children` (contador) | Cerrar, menú, ayuda, abrir/copiar en una fila |
| `AdminBadge` | `tone` (neutral · accent · ok · warn · danger · info), `icon`, `size` md · sm, `emphasis`, `label` | Estados, etiquetas y contadores. Los estados del inventario (`lib/inventory-visual-state.ts`) pasan por `StateChip`, que lo reutiliza. El color nunca es el único canal: ícono o texto |
| `AdminTabs` | `items` (`key`, `label`, `icon`, `count`, `href`), `value`/`onChange`, `tabId`/`panelId`, `filters`, `compact` | Con `href` en todos los ítems: subnavegación entre rutas. Con `value`/`onChange`: pestañas de una ficha (`tablist`, flechas, Inicio, Fin). Con `filters`: filtros de una lista (`aria-pressed`) |
| `AdminDialog` | `size` sm 440 · md 560 · lg 720 · xl 960 · ficha 1040; `icon`, `title`, `description`, `footer`, `error`/`warning`, `dirty` | Toda ventana centrada con margen visible y máximo visualViewport; cuerpo con scroll y pie visible |
| `AdminDialogSection` | `title`, `columns` 1–4, `stack`, `collapsible` + `defaultOpen` + `hint` | Agrupar campos con título y un separador sutil. Cuerpo = grilla de 12 columnas |
| `AdminCol` | `span` 2–10 o 12 | Ancho propio de un campo suelto dentro de la grilla del diálogo |
| `AdminConfirmDialog` | `title`, `message`, `confirmLabel`, `danger`, `busy` | Acciones destructivas o irreversibles (nunca `confirm()`) |
| `AdminActionsMenu` | `items`, `label` | El «•••» de filas y tarjetas: caja opaca con sombra (`--a-pop-bg`, `--a-pop-shadow`), igual que la lista del `Combobox` |
| `AdminBoard` + `AdminViewSwitch` | ver §5 | Pipelines por estado: columnas y tarjetas con el mismo lenguaje (radio, borde, contador como chip neutro) |
| Campos (`AdminFields.tsx`) | `label`, `help`, `hint`, `error`, `success`, `required`, `optional`, `size`, `wide` | Uno por tipo de dato (abajo) |

### 16.2 Campos: una caja, un borde, un ancho por tipo

- **Caja única.** Los controles de la librería (`data-oc-control`) y los propios
  (Combobox, contraseña, PIN, buscador) miden y se pintan igual: 36 px en escritorio
  y 44 px en celular (`--a-field-h`), radio 8 px, fondo `--c-ink-800`, **un solo
  borde de 1 px** (`--a-field-border` = token `interactivo`, ≥ 3:1). Hover: borde un
  poco más marcado. **Foco: borde de acento + anillo de 3 px, solo con foco.**
  Error: borde rojo y nada más. Deshabilitado: fondo apagado; solo lectura: borde
  punteado sin fondo. Etiqueta arriba; ayuda y error debajo. Nada de sombras
  internas ni degradados.
- **Prefijo y sufijo.** `MoneyField` («Gs») y `PercentField` («%») ya los traen;
  `TextField` y `NumberField` aceptan `prefix` y `suffix` («días», «u.», «https://»).
- **Ancho por tipo (`size`).** Cada pieza trae el suyo, con tope en rem y ancho
  completo en celular:

  | `size` | Tope | Piezas (por defecto) |
  | --- | --- | --- |
  | `xs` | 8 rem | `NumberField`, `PercentField`, `SerialField` (código/SKU), `PinField`, `TimeField` |
  | `sm` | 12 rem | `MoneyField`, `DateField`, `DayField` |
  | `md` | 17 rem | `PhoneField`, `RucField`, `SelectField`, `CityField`, `BancoField`, `PasswordField`, `DateTimeField` |
  | `lg` | 24 rem | `TextField`, `EmailField`, `Combobox`, `SegmentedField` de hasta 3 opciones |
  | `full` | sin tope | `TextAreaField`, `AttachmentInput`, `FileField`, `SegmentedField` de más de 3 opciones |

  `wide` equivale a `size="full"` (dirección, URL, notas). Un nombre no lleva `wide`.
- **Grilla de 12 columnas del diálogo.** Cada campo ocupa las columnas de su tamaño:
  en `md` xs 3 · sm 4 · md 6 · lg 6; en `lg` y `xl` xs 2 · sm 3 · md 4 · lg 6; `full`
  12. `columns` en la sección (1–4) o `AdminCol` lo pisan. Celular: una columna.
- **Segmentado.** Una sola fila de opciones parejas (nunca parte en dos líneas); el
  panel no carga el preflight de Tailwind, así que el CSS resetea el `<button>`.

### 16.3 El candado (`npm run check:ui`)

Falla si, en `components/admin` o `app/(admin)`, aparece fuera de la biblioteca: un
`<input>`, `<select>` o `<textarea>` suelto; un `<button>` suelto; un `style=` no
dinámico (solo valores calculados van inline); una clase de la biblioteca a mano
(`admin-btn*`, `admin-iconbtn`, `admin-badge`, `admin-subtab`, `btn-led`…); una
utilidad de Tailwind de borde, sombra o ancho; o, en `globals.css`, un borde,
sombra o tamaño de campo fuera del bloque de la biblioteca.

Allowlist explícita en `scripts/check-ui.mjs` (archivo, tope y motivo): los
`<button>` que son un widget propio —navegación lateral y barra inferior, paleta de
comandos, celdas del calendario, mosaicos y filas clicables del inventario, muestras
de color— y la hoja imprimible (`(print)`, piel de papel propia). Si un archivo supera
su tope, falla.

### 16.4 Qué quedó fuera de esta etapa

- Superadmin (`components/platform`, `app/(superadmin)`) conserva `admin-btn` a mano.
- Hoja imprimible (`(print)`): botones y selector con piel propia (`lbprint-*`).
- Widgets propios en la allowlist: se migran cuando la biblioteca tenga el equivalente
  (tarjeta clicable, celda de calendario).
- Sitio público y portal del cliente (`cp-chip`, `portal-field`) tienen otra piel.

### Densidad de hechos y métricas en diálogos (#264, 16-10-2026)

Las grillas compartidas `admin-ficha-stats` y `admin-item-prices` alinean cada
celda al inicio y sus filas al contenido; una cifra no crece para igualar la
altura de una descripción o foto vecina. Importes y escalones se muestran
completos con ajuste de línea. Inventario usa una sola grilla (cuatro columnas en escritorio, dos en móvil
y una hasta 340 px) para precios, costos permitidos y tiempos; conserva permisos, fuentes y todas las etiquetas.
Las pestañas mantienen el componente AdminTabs y su teclado/foco; el cambio de
geometría no modifica portales, cierre, confirmación de cambios ni stack modal.
