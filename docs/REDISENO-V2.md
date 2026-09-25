# Rediseño visual v2 — direcciones para elegir (fase 1, 25-09-2026)

Issue **dariodeoli/ledbox#72**. El rediseño del 22-09 (`docs/DISENO-PANEL.md`)
ordenó estructura, densidad y componentes, pero la identidad visual quedó
genérica: negro casi puro + cian neón (`--a-accent #00e5ff`), fondos `#05080a` /
`#f2f6f8`, títulos y cuerpo sin tipografía propia, claro blanco/gris plano. Este
documento es la **fase 1**: tres direcciones visuales implementadas y capturadas
con tokens reales para que el dueño elija una. La fase 2 (barrido completo por
módulo) va después en `slot/panel` con la dirección elegida.

- Rama de exploración: `feat/experimento-rediseno-v2` (excluida de la
  integración automática por `scripts/orquestador.config.json`, igual que los
  pilotos). **Nada de esto entra a la rama viva hasta que el dueño elija.**
- **Resuelto el 25-09-2026**: el dueño eligió **C · Vitrina** y aprobó su
  oscuro; pidió rehacer el claro porque lo vio «muy cuadrado, muy básico». Ese
  rediseño es la **fase 1.5** (§2 bis): dos variantes nuevas, **C1 · Aurora
  viva** y **C2 · Porcelana orgánica**, solo del modo claro.
- Base: `origin/codex/ledbox-gestion-multiempresa`. La rama de exploración se
  creó sobre **v2.1.35** (fase 1) y no se reescribió: la fase 1.5 se capturó con
  la rama viva en **v2.1.37** y sus capturas se agregaron encima, sin
  `--force`. Las capturas de la fase 1 y las de la fase 1.5 son de días
  distintos y ambas están tomadas contra la rama viva del momento.
- La rama queda con **doc + capturas**: las tres direcciones se aplicaron una por
  vez sobre `app/globals.css`, se capturaron y se revirtieron. No hay CSS,
  componentes ni fuentes de la exploración commiteados.

## 1. Cómo se probó (para que las capturas sean comparables)

- Panel real con datos de la **demo** (`ensureDemoData`) en Postgres local
  (migraciones + seed), servidor Next en `http://localhost:3001`; tema claro y
  oscuro aplicados como los aplica la app (`localStorage` +
  `#admin-root[data-theme]`).
- Capturas con **Chrome headless por CDP** (sin dependencias nuevas), ventana
  1440×900 y 390×844 para mobile, esperando a que los datos reales reemplacen a
  los esqueletos. `docs/rediseno-v2/*.png`, un archivo por dirección, pantalla y
  tema.
- **Cero cambios de marcado**: las tres direcciones se lograron solo con
  `app/globals.css` (tokens `--a-*` + terminación de los componentes
  existentes). En la fase 2 no hace falta tocar ningún `.tsx` para adoptar
  cualquiera de las tres.
- Tipografías de la exploración: woff2 **OFL self-hosted** en `public/fonts`
  (temporal, no commiteado). La app hoy **no carga ninguna tipografía propia**:
  declara `--font-body: 'Space Grotesk'` y `--font-display: 'Archivo Black'`
  pero no hay `next/font`, `@font-face` ni `<link>`; verificado en el navegador
  (0 recursos de fuente pedidos y control de ancho de texto: ambas familias caen
  al genérico del sistema). Eso explica buena parte del «parece que la hizo una
  AI»: los títulos no son la display que el código cree usar.
- Límites de la fase 1: solo tres pantallas (login, shell + Resumen, lista densa
  de Eventos) y sin cambios de navegación, contratos, datos ni flujos del 22-09.

### El problema, medido sobre las capturas «antes»

| Síntoma | Evidencia |
| --- | --- |
| Sin tipografía de marca | `antes-login-oscuro.png`, `antes-resumen-claro.png`: títulos y montos en la fuente por defecto |
| Superficies planas | Todo panel es `1px + fondo`; el claro es `#f2f6f8` con tarjetas `#fff` |
| Acento en todos los roles | Cian en íconos, kickers, links, badges, valores y bordes: nada es el foco |
| Claro «aburrido» | Blanco/gris sin temperatura ni profundidad (`antes-eventos-claro.png`) |

Capturas del antes: `antes-login-claro/oscuro.png`, `antes-resumen-claro/oscuro.png`,
`antes-eventos-claro/oscuro.png`.

## 2. Las tres direcciones

| | A · Obsidiana | B · Grafito & Latón | C · Vitrina |
| --- | --- | --- | --- |
| Intención | Mate profundo, el cian vuelve a ser **luz** | Material cálido y **editorial**: reglas, papel y latón | Luz de escenario: **vidrio** y aurora |
| Oscuro | Obsidiana azulada `#06080e` | Grafito cálido `#14120e` | Índigo `#0a0a13` con aurora |
| Claro | Porcelana fría `#e8edf4` con degradé de profundidad | Papel hueso `#f2ebdd` con grano | Aurora pastel `#f6f6fd` con vidrio |
| Display | **Sora** 600 (geométrica, tensa) | **Fraunces** 600 (serif editorial) | **Space Grotesk** 600 (técnica, la que el código ya declara) |
| Cuerpo | Inter 400–600 | Inter 400–700 | Inter 400–600 |
| Acento | Cian `#2ee4ff` como luz, un solo foco por pantalla | Latón `#d9a45b`; el cian desaparece del panel | Degradado cian→violeta en acciones |
| Profundidad | Sombras largas, top-light interno, radios 12/16 | Reglas y doble filete, sin tarjetas en listas, radios 6/8 | Vidrio con blur, sombras de color, radios 14/20 |
| Movimiento | 160 ms, sin desplazamiento | 150 ms, casi estático | 180 ms, elevación de 1 px + glow |
| Logrado con | solo CSS + Sora/Inter | solo CSS + Fraunces/Inter | solo CSS + Space Grotesk/Inter |

### A · Obsidiana — «mate profundo, el cian como luz»

**Intención**: la app se ve pulida y seria, con material mate y una sola fuente
de luz (el cian) reservada a la acción y al dato que importa; el claro pasa de
blanco plano a **porcelana con profundidad**.

- **Tokens oscuro**: `--a-bg #06080e` · `--a-panel #0f1520` · `--a-panel-2
  #141c28` · `--a-line #1e2735` · `--a-line-2 #2e3d4f` · `--a-line-control
  #5a6b7c` · `--a-text #e9eef6` · `--a-muted #8697a8` · `--a-accent #2ee4ff` ·
  `--a-accent-strong #96f2ff` · `--a-accent-soft rgba(46,228,255,.10)` ·
  `--a-ok #45d79a` · `--a-warn #f3c05e` · `--a-danger #ff7386` · `--a-info
  #9aa7ff` · radios 12/16 · fondo `radial-gradient(140% 70% at 50% -25%, #131b2a,
  #0a0e17 48%, #05070c)`.
- **Tokens claro**: `--a-bg #e8edf4` · `--a-panel #ffffff` · `--a-panel-2
  #f5f9fc` · `--a-line #d5dfe9` · `--a-line-2 #b8c6d4` · `--a-text #131e29` ·
  `--a-muted #5a6a7a` · `--a-accent #0a6f86` · `--a-ok #0d7a50` · `--a-warn
  #8a5b06` · `--a-danger #b62c44` · `--a-info #4351c9` · fondo `linear-gradient(180deg,
  #dde6f1, #edf1f7 26%, #f3f6f9)` · sombra doble (contacto 1 px + ambiente 18/34).
- **Tipografía**: display Sora 600 con tracking negativo (`-0.02` a `-0.035`), sin
  mayúsculas forzadas; montos y KPIs en Sora con `tabular-nums`; micro etiquetas
  Inter 600 `0.1em`. Se cargan 3 pesos de Sora (25 KB cada uno) + 4 de Inter.
- **Color**: el cian solo en valor con tono `accent`, acción primaria y item
  activo del nav; el resto de la pantalla es neutra. Estados con semántica
  (verde/ámbar/rojo/azul lavado).
- **Profundidad**: top-light interno (`inset 0 1px 0 rgba(255,255,255,.045)`),
  sombras largas, KPI y paneles con degradé vertical sutil; en claro, sombra de
  contacto + ambiente fría para separar tarjeta de fondo.
- **Movimiento**: transiciones de 160 ms sobre fondo, borde y sombra; hover de
  fila con filete izquierdo de acento. Sin desplazamientos.
- **Evidencia**: `a-obsidiana-login-claro/oscuro.png`,
  `a-obsidiana-resumen-claro/oscuro.png`, `a-obsidiana-eventos-claro/oscuro.png`,
  `a-obsidiana-mobile-oscuro.png`.
- **Costo**: el más bajo. Solo CSS + 2 familias; mecánico de barrer (~½–1 día).
  **Riesgo**: en oscuro se parece al look actual (mismo cian, misma base): el
  salto se siente más en el claro y en la tipografía que en el color.

### B · Grafito & Latón — «material cálido y editorial»

**Intención**: el panel se lee como un **libro mayor impreso**: papel cálido,
reglas en lugar de tarjetas, serif en los títulos y latón como único metal. Es
la dirección que más se despega de «app hecha por una AI».

- **Tokens oscuro**: `--a-bg #14120e` · `--a-panel #1d1a14` · `--a-panel-2
  #242019` · `--a-line #302a20` · `--a-line-2 #473d2e` · `--a-line-control
  #6d604a` · `--a-text #f1e9db` · `--a-muted #a3967e` · `--a-accent #d9a45b` ·
  `--a-accent-strong #eec489` · `--a-ok #8db06a` · `--a-warn #dfa84b` ·
  `--a-danger #d4705a` · `--a-info #6fa9b6` · radios 6/8.
- **Tokens claro**: `--a-bg #f2ebdd` · `--a-panel #fffdf7` · `--a-panel-2
  #faf4e7` · `--a-line #e3d9c5` · `--a-line-2 #c9bda2` · `--a-text #2a251c` ·
  `--a-muted #6d6455` · `--a-accent #8a5a1d` · `--a-ok #55702f` · `--a-warn
  #8a5c10` · `--a-danger #a4392b` · `--a-info #2f6673` · fondo con **grano de
  papel** (`radial-gradient` de 4 px al 5 % sobre `#f2ebdd`) · sombras cálidas.
- **Tipografía**: display **Fraunces** 600 (serif) en títulos de pantalla, títulos
  de panel, montos y KPIs; cuerpo Inter; etiquetas micro Inter 700 `0.12em`.
  Fraunces pesa 67 KB por peso (3 pesos).
- **Color**: latón para acento y foco; los tonos de estado se recalibraron a la
  paleta cálida (sage, ocre, terracota, azul petróleo). El cian neón desaparece
  del panel (queda solo donde el dato lo pida).
- **Profundidad**: **reglas**. Los KPI dejan de ser tarjetas y pasan a columnas
  con filete superior de 2 px; la lista densa pierde el contorno por fila y usa
  filete inferior (libro mayor); el panel lleva doble filete bajo el encabezado.
  Radios chicos (6/8) y una sola sombra ambiental.
- **Movimiento**: 150 ms sobre fondo y borde; casi estático (sin glow ni lift).
- **Evidencia**: `b-grafito-login-claro/oscuro.png`,
  `b-grafito-resumen-claro/oscuro.png`, `b-grafito-eventos-claro/oscuro.png`,
  `b-grafito-mobile-oscuro.png`.
- **Costo**: medio (~1–1½ días): hay que recalibrar todos los tonos de estado y
  revisar los chips/badges en ambos temas. **Riesgo**: cambia la identidad de
  marca (serif + latón contra el ADN LED/cian de LedBox) y el claro «papel»
  convive con el badge DEMO y los estados: hay que verificar pantalla por
  pantalla que no se lea «vintage».

### C · Vitrina — «luz de escenario: vidrio y aurora»

**Intención**: el panel se ve **iluminado**, como una vitrina de escenario: fondo
aurora, superficies de vidrio con blur y el acento como degradado. El claro deja
de ser blanco: aurora pastel con tarjetas translúcidas.

- **Tokens oscuro**: `--a-bg #0a0a13` · `--a-panel rgba(255,255,255,.045)` ·
  `--a-panel-2 rgba(255,255,255,.075)` · `--a-line rgba(255,255,255,.10)` ·
  `--a-line-2 rgba(255,255,255,.20)` · `--a-line-control rgba(255,255,255,.34)` ·
  `--a-text #eceefb` · `--a-muted #9ea1c0` · `--a-accent #5ad9ff` · `--a-ok
  #52e39b` · `--a-warn #fbc35f` · `--a-danger #ff7d92` · `--a-info #a78bfa` ·
  radios 14/20 · fondo con tres auroras (cian `rgba(56,189,248,.22)`, violeta
  `rgba(167,139,250,.20)`, rosa `rgba(244,114,182,.13)`) fijas.
- **Tokens claro**: `--a-bg #f6f6fd` · `--a-panel rgba(255,255,255,.70)` ·
  `--a-panel-2 rgba(255,255,255,.92)` · `--a-line rgba(24,32,64,.09)` ·
  `--a-text #171b33` · `--a-muted #5b6189` · `--a-accent #0b6f8f` · `--a-ok
  #0b7a4b` · `--a-warn #8a5a06` · `--a-danger #bd2c47` · `--a-info #4f46e5` ·
  fondo aurora pastel (cian `rgba(125,211,252,.55)`, lila
  `rgba(196,181,253,.55)`, rosa `rgba(251,207,232,.40)`) · sombra de color
  (`rgba(79,70,229,.38)`).
- **Tipografía**: display **Space Grotesk** 600 (la familia que el código ya
  declara y nunca cargó) con tracking `-0.015/-0.04`; montos en Space Grotesk
  `tabular-nums`; el título del login usa degradado en la segunda línea. Cuerpo
  Inter. Space Grotesk pesa 22 KB por peso: la opción más liviana en fuentes.
- **Color**: el acento es un **degradado** cian → violeta para acción primaria,
  chips de ícono, avatar y valor destacado; el violeta entra como información.
  Chips/badges en píldora translúcida.
- **Profundidad**: vidrio real (`backdrop-filter: blur(18px) saturate(1.3)`),
  borde de 1 px claro, brillo interno superior y **sombra de color**; filas de
  lista con radio 14 y elevación de 1 px al pasar el mouse.
- **Movimiento**: 180 ms, elevación de 1 px + glow en filas y KPIs al hover.
- **Evidencia**: `c-vitrina-login-claro/oscuro.png`,
  `c-vitrina-resumen-claro/oscuro.png`, `c-vitrina-eventos-claro/oscuro.png`,
  `c-vitrina-mobile-oscuro.png`.
- **Costo**: el más alto (~1½–2 días) y el único con riesgo de **rendimiento**
  (`backdrop-filter` en listas largas y equipos de gama baja; hay que medirlo) y
  de **contraste** (texto sobre superficies translúcidas con aurora detrás).
  **Riesgo de percepción**: el vidrio + aurora es el look «SaaS 2026» que el
  dueño leyó como «hecho por una AI»; es el más vistoso y el más genérico a la
  vez.

## 2 bis. Fase 1.5 — el claro de C, rediseñado (mismo día, pedido del dueño)

El dueño **eligió C · Vitrina y aprobó su oscuro** («queda como está»); el claro
le resultó «muy cuadrado, muy básico»: todo cajas rectangulares con bordes
finos. Estas dos variantes reemplazan **solo el modo claro** de C y le dan su
propio lenguaje (no espejan el oscuro). El oscuro no se tocó y las dos se
aplicaron sobre la misma base C, con las tipografías ya cargadas.

| | C1 · Aurora viva | C2 · Porcelana orgánica |
| --- | --- | --- |
| Intención | La vitrina iluminada: aurora con color de verdad | Claro material: porcelana, color por áreas |
| Superficies | Flotan, sin borde, sombra de color | Porcelana sólida, luz de arriba (inset), sombra suave |
| Color | 4 campos de aurora (cian, lila, rosa, **menta**) + lavados por tono en los KPI | Áreas pastel planas (menta/ámbar/rosa/periwinkle) y cintas lavanda |
| Blur | Acotado: sidebar, topbar, menú/avisos y login | **Cero** (medido) |
| Filas | Tiras flotantes, hover con elevación de 1 px | Bandas porcelana, hover con tinte lavanda |
| Curvas | Radios 22/26/32, chips y nav en píldora, íconos redondos | Radios 24/28/36, píldoras y cintas |
| Login | Arte: blobs + anillos, tarjeta de vidrio, campos tipo hueco | Arte: campos pastel + anillos, tarjeta porcelana, campos tipo hueco |

### C1 · Aurora viva — «la vitrina, iluminada»

- **Tokens**: `--a-bg #f6f8ff` · `--a-panel rgba(255,255,255,.84)` ·
  `--a-panel-2 #ffffff` · `--a-line rgba(28,34,74,.07)` · `--a-text #141a33` ·
  `--a-text-strong #0a0e20` · `--a-muted #545a80` · `--a-accent #0b6f8f` ·
  `--a-radius 18/26` · sombra `0 34px 66px -46px rgba(76,61,186,.55)` ·
  `--a-grad-ink linear-gradient(120deg,#0b6f8f,#4f46e5)` (la tinta del degradado
  que en oscuro era clara, en claro es oscura: es lo que arregla el AA del valor
  destacado).
- **Aurora**: cuatro campos radiales (`cyan rgba(110,231,249,.58)`, `lila
  rgba(186,172,255,.5)`, `rosa rgba(251,197,232,.42)`, `menta
  rgba(167,243,208,.42)`) sobre un lavado periwinkle, fijos al scroll. El menta
  es propio del claro: le da identidad sin repetir el cian/violeta del oscuro.
- **Formas**: paneles y KPI sin borde y con radio 26/22; el sidebar termina en
  curva (`0 30px 30px 0`); la topbar pierde el borde y pasa a vidrio con sombra
  suave; el pie deja la línea; los íconos de acción son círculos; el nav activo
  es una píldora con degradado.
- **KPI**: cápsulas con lavado por tono (acento cian→lila, ok menta, warn
  ámbar, danger rosa) y luz interna; el valor destacado usa el degradado de
  tinta; el ícono vive en un chip blanco con sombra.
- **Listas sin jaula**: el contenedor pierde borde y fondo; las filas son tiras
  blancas (`rgba(255,255,255,.88)`, radio 17, sombra suave) que se elevan 1 px
  y se aclaran al pasar el mouse; los encabezados de columna viven sobre la
  aurora.
- **Login con arte**: dos blobs suaves fuera de la tarjeta (cian arriba a la
  izquierda, lila/rosa abajo a la derecha), dos anillos finos que cruzan la
  tarjeta por arriba a la derecha y abajo a la izquierda, campos tipo hueco
  pulido (`inset 0 2px 5px`), botón y Google en píldora, `01 / acceso` como chip.
- **Vidrio acotado**: `backdrop-filter` solo en sidebar, topbar, menú/avisos y
  tarjeta de login. **Medido en la pantalla con datos: 2 elementos con blur**
  (`admin-sidebar`, `admin-topbar`). Ninguna fila ni tarjeta de KPI usa blur.
- **Evidencia**: `c1-aurora-viva-login-claro.png`,
  `c1-aurora-viva-resumen-claro.png`, `c1-aurora-viva-eventos-claro.png`,
  `c1-aurora-viva-mobile-claro.png`.
- **Costo**: ~½ día sobre C (una sección de CSS, cero marcado). **Riesgo**: si
  se agregan pantallas nuevas con texto directamente sobre la aurora, hay que
  recalibrar los alphas; el blur queda en superficies fijas, nunca en listas.

### C2 · Porcelana orgánica — «material, sin efectos»

- **Tokens**: `--a-bg #f3f2fb` · `--a-panel #ffffff` · `--a-panel-2 #faf9ff` ·
  `--a-line rgba(30,32,74,.08)` · `--a-text #161a35` · `--a-muted #545a80` ·
  `--a-accent #0b6f8f` · `--a-radius 20/28` · sombra
  `0 26px 48px -38px rgba(72,62,158,.55)` · mismo `--a-grad-ink`.
- **Áreas de color**: el fondo son tres campos pastel suaves (cian, lila, rosa)
  sobre lavanda; el color de la pantalla lo ponen las **áreas**, no los bordes:
  KPI en bloques planos por tono, encabezado de panel como cinta lavanda,
  encabezado de tabla como cinta blanca en píldora, sidebar porcelana con el
  ítem activo en píldora blanca (jerarquía por luz, no por color de acento).
- **Superficies**: sólidas con `inset 0 1px 0 #ffffff` (luz de arriba) y sombra
  suave de dos capas; radios 24/28/36. Sin un solo `backdrop-filter`:
  **medido, 0 elementos con blur**.
- **Listas**: bandas porcelana con radio 18, hover lavanda (`#f6f5ff → #f1f0ff`)
  sin elevación agresiva; chips/badges en píldora con valores de color
  (`#e2f2f8`, `#e0f4e9`, `#fbefd6`, `#fbe3e8`) verificados AA.
- **Login**: tarjeta porcelana con dos anillos concéntricos como arte (arriba a
  la derecha y abajo a la izquierda) y fondo de dos campos pastel; campos tipo
  hueco (`#f6f5fd` + inset), botón en píldora con degradado de tinta.
- **Evidencia**: `c2-porcelana-login-claro.png`,
  `c2-porcelana-resumen-claro.png`, `c2-porcelana-eventos-claro.png`,
  `c2-porcelana-mobile-claro.png`.
- **Costo**: ~½ día sobre C. **Riesgo**: bajo (sin blur ni transparencias
  profundas); es la variante menos “vitrina” de las dos, a cambio de ser la más
  liviana.

### AA de las variantes del claro (medido)

| Par | C1 | C2 | Mínimo |
| --- | --- | --- | --- |
| Texto / panel | 16.2 | 16.4 | 4.5 |
| Muted / panel | 5.7 | 5.7 | 4.5 |
| Muted / aurora más fuerte (peor campo de cada una) | 4.7 | 4.9 | 4.5 |
| Acento fuerte / aurora más fuerte | 5.7 | 5.6 | 4.5 |
| Etiqueta KPI / bloque ámbar | 6.7 | 6.6 | 4.5 |
| Valor warn / bloque ámbar | 6.0 | 6.0 | 4.5 |
| Valor ok / bloque menta | — | 4.7 | 4.5 |
| Valor danger / bloque rosa | — | 5.5 | 4.5 |
| Borde de control / fondo | 3.1 | 3.2 | 3.0 |

Qué se corrigió durante la ronda: la aurora bajó de alphas (el acento y el
muted caían a 4.0–4.3 sobre los campos más saturados), el muted pasó a
`#545a80`, los textos que viven sobre la aurora (kicker, eyebrow, nota de marca,
pie y encabezado de tabla) usan tinta más firme, y el degradado del valor
destacado en claro es de tinta oscura (en la base C era claro sobre blanco:
no pasaba AA). Los controles conservan un borde de 3:1: “menos bordes” aplica a
superficies, no a campos.

### Recomendación (fase 1.5)

**C1 · Aurora viva**: es la que responde al pedido —se siente diseñada, con luz
y color con intención, curvas y profundidad— y el vidrio quedó acotado a cuatro
superficies fijas (medido: 0 blur por fila o tarjeta). Si el dueño prefiere el
panel liviano incluso en máquinas modestas, **C2** es la apuesta segura: mismo
lenguaje de curvas y color por áreas, costo de performance cero y un aire más
sobrio.

## 3. Contraste (AA) medido

Pares reales de cada dirección, calculados con la luminancia relativa de los
tokens finales (texto ≥ 4.5, controles ≥ 3):

| Dirección | Texto/panel | Muted/panel | Acento/panel | Borde de control | Tonos de estado |
| --- | --- | --- | --- | --- | --- |
| A oscuro | 16.0 | 6.2 | 12.1 | 3.5 | ≥ 4.5 |
| A claro | 16.9 | 5.6 | 5.8 | 3.3 | ≥ 4.5 |
| B oscuro | 14.4 | 6.0 | 7.8 | 3.1 | ≥ 4.5 |
| B claro | 15.0 | 5.7 | 5.8 | 3.8 | ≥ 4.5 |
| C oscuro | 15.7 | 7.2 | 11.1 | 3.0 | ≥ 4.5 |
| C claro | 16.6 | 5.8 | 5.6 | 3.4 | ≥ 4.5 |

El botón primario de C usa tinta oscura (`#0d1026`) sobre el degradado claro
cian→violeta (> 10:1). Ningún par queda bajo el mínimo.

## 4. Recomendación (fase 1, superada por la elección del dueño)

> **Actualización 25-09-2026**: el dueño eligió **C · Vitrina** (oscuro
> aprobado tal como quedó) y pidió rehacer el claro. La recomendación vigente es
> la de **§2 bis**: C1 · Aurora viva, con C2 · Porcelana orgánica como opción
> sobria y de costo cero en performance. Lo de abajo queda como registro de la
> ronda anterior.

**A · Obsidiana como base del barrido**, con dos préstamos que la propia
exploración dejó a la vista: del claro de B, la temperatura cálida del papel (es
el antídoto directo al «claro aburrido» sin cambiar la estructura); de C, el
degradado solo en la acción primaria y en los chips de ícono, que es donde el
brillo suma sin volver a pintar todo de neón. A es la de menor riesgo —mantiene
el ADN LED/cian, no toca identidad de marca y el barrido es casi mecánico— y la
que llega a «premium» por tipografía, material y jerarquía, no por efectos. Si
lo que el dueño quiere es un corte de identidad fuerte, la respuesta es B
(serif + papel), asumiendo recalibrar tonos y validar el claro pantalla por
pantalla.

## 5. Qué sigue (fase 2, rama `slot/panel`)

1. Base elegida: **C · Vitrina** (oscuro) + la variante de claro que el dueño
   elija entre **C1** y **C2**: su bloque de tokens + reglas entra en
   `app/globals.css` (una sección, como hoy) y las familias se versionan en
   `public/fonts` con `@font-face` (OFL; solo los pesos usados: Inter 3–4 pesos
   ≈ 150–190 KB + Space Grotesk 3 pesos ≈ 65 KB).
2. Barrido por módulo respetando `docs/DISENO-PANEL.md` y
   `docs/DISENO-PANTALLAS.md` (orden y densidad no cambian; esto es piel y
   terminación).
3. Verificación: `npm run typecheck`, `npm run test:rules`, `npm run build`,
   capturas claro/oscuro 1440 + 390 de los módulos, AA de los pares nuevos,
   consola sin errores, demo (VIEWER) impecable y, en C, medición de rendimiento
   antes de aceptar el `backdrop-filter`.
4. `lbprint` (hojas imprimibles) queda fuera, como pide el pedido.
