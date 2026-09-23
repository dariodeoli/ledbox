# Rediseño completo del panel (EventOS) — guía de diseño

Guía para el rediseño integral de la UI del panel, pedido por el dueño el
22-09-2026 («rediseñar la UI de la app, completa, y reordenar todo»). Es la
fuente única del lenguaje visual: todo componente nuevo o tocado la respeta.
No contradice `docs/REGLAS-GENERALES.md` ni `AGENTS.md`: los completa.

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
  cabeceras de tabla). Nada intermedio suelto.
- **Espaciado**: 4 · 8 · 12 · 16 · 24 · 32 (todo padding/gap sale de acá).
- **Radios**: 8 (controles) · 10 (paneles/chips) · 14 (tarjetas y diálogos).
- **Sombras**: una sola (`--a-shadow`) para paneles flotantes y diálogos.
- **Bordes**: `--a-line` para separadores internos, `--a-line-2` para el borde
  de los objetos; en modo claro marcan el objeto (calibrados el 22-09-2026).
- **Estados**: hover (acento suave), activo/seleccionado (acento), foco visible
  (`:focus-visible` con acento), deshabilitado (opacidad .5).
- **Modo claro/oscuro**: mismos tokens, dos valores; cualquier color nuevo se
  define en ambos temas y se verifica contraste AA (texto ≥ 4.5, UI ≥ 3).

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
