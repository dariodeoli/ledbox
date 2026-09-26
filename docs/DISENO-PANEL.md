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

## 6. Reordenar: navegación propuesta

| Grupo | Módulos |
| --- | --- |
| **General** | Resumen · Eventos |
| **Operación** | Inventario · Proveedores · Promotoras |
| **Comercial** | Clientes · Leads · Presupuestos · Plantillas |
| **Finanzas** | Finanzas · Facturación |
| **Sistema** | Ajustes · Estado |

> **Consolidación del 23-09-2026 (issue #56):** el nav pasó de 18 a 13 destinos.
> Calendario es una **vista dentro de Eventos** (`/eventos?vista=calendario`), el
> PIN vive solo en **Mi perfil**, **Ajustes** agrupa Empresa · Correo · Plan ·
> Usuarios y **Estado** agrupa Sistema · Auditoría. Las rutas viejas siguen
> entrando con redirect.

Reglas del reordenamiento:
- Lo que se usa todos los días arriba (Resumen, Eventos).
- Finanzas y Facturación juntas (son el mismo trabajo con dos caras).
- Sistema agrupa lo que se toca de vez en cuando y lo restringido (OWNER/ADMIN).
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
  propósito: adentro del panel son reales y el **sitio público y las hojas
  `lbprint` quedan igual que antes** (declaran `Space Grotesk`/`Archivo Black`
  por nombre y siguen cayendo al genérico del sistema). Sin librerías nuevas.
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
- **Fuera**: hojas `lbprint` y el sitio público (no cambian).

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
