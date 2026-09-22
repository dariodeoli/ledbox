# Piloto `owncoding-ui` en LedBox/EventOS

Resultado del piloto pedido el 22-09-2026: instalar la librería compartida
(`github.com/dariodeoli/owncoding-ui`, **v0.12.0**) al lado del panel actual,
medir la convivencia con los tokens `--a-*` y el CSS propio, y decidir qué
conviene adoptar. **No es una migración**: nada del panel cambió y la rama es un
piloto (`feat/piloto-owncoding-ui`) que no se mergea hasta que el dueño decida.

- Pantalla del piloto: **`/piloto-ui`** (sin link en el nav, `noindex`, no está
  en `lib/admin-routes`).
- Evidencia visual: `docs/piloto-owncoding-ui/*.png`.
- Plan de adopción del dueño (prioridades 1–3): `docs/ADOPCION-OWNCODING-UI.md`
  (vive en la rama viva, no en la base de este piloto). Este piloto lo valida y
  agrega los datos duros que faltaban.

## 1. Cómo se instala (comandos exactos)

```bash
# Librería (repo privado: en esta máquina `gh auth setup-git` ya deja git con credenciales).
# `qrcode` es peer "opcional" de nombre, pero en la práctica es obligatoria: el bundle
# publicado tiene un `import QRCode from "qrcode"` estático (dist/index.js:2944) y el
# bundler no resuelve el paquete sin ella.
npm install github:dariodeoli/owncoding-ui#v0.12.0 qrcode

# Tailwind 3.4 (requisito de la librería: preset + utilidades). No hay Tailwind hoy en el panel.
npm install -D tailwindcss@^3.4 postcss@^8.4 autoprefixer@^10.4
```

En CI/Coolify (repo privado) la instalación necesita un token de lectura:

```bash
npm install "git+https://x-access-token:$GITHUB_TOKEN@github.com/dariodeoli/owncoding-ui.git#v0.12.0"
```

Archivos que agrega el piloto (nada más):

| Archivo | Para qué |
| --- | --- |
| `tailwind.config.mjs` | `presets: [preset]`, **`preflight: false`** y `content` acotado al piloto + `node_modules/owncoding-ui/dist/**` |
| `postcss.config.mjs` | `tailwindcss` + `autoprefixer` (Next pasa todo el CSS por PostCSS) |
| `types/owncoding-ui.d.ts` | Shim de tipos: la librería publica JS sin `.d.ts` y el repo usa `strict` + `allowJs: false` |
| `app/(admin)/(panel)/piloto-ui/owncoding.css` | `@import "owncoding-ui/styles.css"` + directivas de Tailwind + **contención** del shell |
| `app/(admin)/(panel)/piloto-ui/page.tsx` + `PilotoUiBoard.tsx` + `PilotoControles.tsx` | La pantalla comparativa (datos reales de tesorería de la demo) |

`owncoding.css` se importa desde la ruta, así que Next lo sirve como chunk de
esa ruta: el resto del panel no descarga Tailwind ni el CSS de la librería.
Verificado en el build (§6.4).

## 2. Conflictos encontrados y cómo se resolvieron

### A. Preflight de Tailwind (previsto)
El reset de Tailwind reescribiría el panel entero (márgenes, bordes, tipografías,
botones). Se apaga con `corePlugins: { preflight: false }`. Verificado en el CSS
generado: no aparece el reset; solo el bloque de variables `--tw-*` que Tailwind
emite para sus utilidades (no pinta nada).

### B. `styles.css` trae base global, no solo tokens
`owncoding-ui/styles.css` define los tokens `--c-*` **y** reglas globales:
`html { color-scheme }`, `body { background, color, font-smoothing, min-height }`,
`h1,h2,h3,nav,button,label { font-family }`, `:focus-visible`, placeholders y
`input,[data-money]{ tabular-nums }`. Como el CSS de la ruta se carga después de
`app/globals.css`, esas reglas pisan el shell del panel (fondo del `body`, foco,
tipografía de botones).

Resolución en el piloto: un bloque de **contención** en `owncoding.css` que
devuelve `body` y las tipografías a los valores de `globals.css`, y un
contenedor `.piloto-oc` que re-aplica la base de la librería **dentro** de la
columna de la librería (para verla como en su app de origen). Con eso, el panel
no cambia ni un píxel (§6).

Para adopción real alcanza con un shim de tema (el que ya prevé
`ADOPCION-OWNCODING-UI.md` §4): mapear `--c-*` a los `--a-*` del panel. Pero el
mapeo **no** cubre `html/body/h1..h3/:focus-visible`: eso es base global y pide
un cambio en la librería (§5.4).

### C. Modo oscuro: `html.dark` vs `#admin-root[data-theme]` (previsto)
La librería usa la clase `dark` en `<html>`; el panel usa `data-theme` en
`#admin-root`. Conviven porque no comparten selector, pero **son dos verdades**:

- El piloto escribe `dark` en `<html>` (contrato de la librería) con un
  interruptor propio; el tema del panel se sigue manejando con su botón.
- Si el panel está claro y la librería oscura (o al revés), la pantalla queda
  partida: es el conflicto real, visible en
  `docs/piloto-owncoding-ui/conflicto-tema.png`.
- Al desmontar la ruta del piloto, la clase `dark` se saca (cleanup del efecto),
  así que un módulo real no queda marcado.
- `styles.css` también fija `html { color-scheme }` / `html.dark {
  color-scheme: dark }`; el panel fija su `color-scheme` en `.admin-root`, así
  que los controles nativos del panel no cambian (solo el color de la barra de
  scroll del documento, cosmético).

Decisión para el rediseño: **una sola fuente de tema**. La propuesta es aplicar
`dark` en `<html>` desde el mismo lugar donde hoy se escribe `data-theme` (y
dejar `data-theme` como alias un tiempo), o mover el tema del panel a `html.dark`.

### D. El `content` del preset lo ignora Tailwind 3.4 (no previsto)
El preset declara `content: ['./node_modules/owncoding-ui/dist/**/*.js']` con un
comentario que dice que Tailwind lo combina con el de la app. **No es así**: en
`normalizeConfig`, `content.files` sale solo del config del proyecto y el del
preset se descarta. Resultado: los componentes renderizaban a medias (los íconos
salían gigantes porque `h-3 w-3`, `inline-flex` o `gap-1.5` no existían).
Solución en el piloto: repetir la ruta en el `content` de `tailwind.config.mjs`.
Es un bug de documentación/diseño de la librería → fix upstream (§5.2).

### E. La librería no publica tipos (no previsto)
`package.json` no tiene `types`/`dist/index.d.ts` y el repo compila con
`strict` + `allowJs: false`: importar `owncoding-ui` falla con TS7016. Se agregó
`types/owncoding-ui.d.ts` con lo que usa el piloto (no es la API completa). Para
adoptar de verdad, la librería debe publicar sus tipos (§5.3).

### F. Tailwind es obligatorio para los componentes, no para las utilidades
`formatGs`, `montoTexto`, `parseGsInput`, `normalizarBanco`, `parseTelefono`,
`buscarCiudad`, etc. son JS puro: no emiten CSS y **no necesitan Tailwind**.
Coincide con la prioridad 1 de `ADOPCION-OWNCODING-UI.md` ("sin Tailwind, ya
usable"). El piloto lo confirma: esas funciones se usan en la pantalla sin
ninguna clase de la librería y devuelven los mismos valores que los helpers del
panel (salvo el formato del símbolo, ver G).

### G. Formatos: el mismo número no se escribe igual
| Dato | Panel (`lib/admin-format.ts`) | Librería | Diferencia |
| --- | --- | --- | --- |
| Monto | `Gs. 18.994.000` | `Gs 18.994.000` | punto tras `Gs` |
| Fecha | `22 sept. 2026` (America/Asuncion) | `22/9/2026` (huso del navegador) | formato + huso |
| Fecha y hora | `22 sept. 2026, 10:45` (24 h, Asunción) | `22/9/26, 10:45` (24 h, navegador) | idem |
| Cantidad | `formatNumber` | — (no hay helper de enteros) | falta |
| Vacío | `formatMoney(undefined)` → `Gs. 0` | `montoTexto(undefined)` → `—` | el del panel inventa 0 |

No es un obstáculo técnico, pero **cambiarlo se ve en toda la app**: hay que
decidir si LedBox adopta el formato de la librería (y se unifica con las otras
apps) o si la librería parametriza símbolo/huso. `montoTexto(undefined) → "—"`
es mejor que el `Gs. 0` actual.

### H. El CSS de la ruta queda cargado al navegar del lado del cliente (medido)
Next no descarga la hoja al salir de la ruta: si el usuario entra al piloto y
después navega a un módulo, el CSS de Tailwind + librería sigue aplicado. Con la
contención de `owncoding.css` esto **no se ve**: la prueba de fuga (§6.3)
compara `/finanzas` y `/clientes` después de navegar desde `/piloto-ui` contra
la carga directa: 0 píxeles de diferencia (salvo el avatar de la demo, que
cambia de bytes entre requests). Si alguien importa `styles.css` en
`app/layout.tsx`, el problema deja de ser teórico y afecta al panel completo.

## 3. Veredicto componente por componente

Con lo probado en `/piloto-ui` (mismos datos reales a los dos lados):

| Objeto de la librería | Reemplaza a | Veredicto | Nota |
| --- | --- | --- | --- |
| `formatGs`, `montoTexto`, `montoGs`, `formatPercent` | `formatMoney` y helpers | **Usar** (decidir formato) | JS puro, sin Tailwind. Cambia `Gs.` → `Gs`; `undefined → —` es mejor que `0` |
| `parseGsInput`, `excedeMonto`, `LIMITE_MONTO_*` | validación de montos | **Usar** | El tope y `aria-invalid` no existen en el panel |
| `BANCOS_PARAGUAY`, `normalizarBanco`, `logoDeBanco`, `sugerenciasDeBanco`, `BancoCombobox`, `BancoLogo` | `lib/bank-mark.ts` + texto libre | **Usar** | Prioridad 1; Tesorería y Conciliación |
| `parseTelefono`, `componerTelefono`, `telefonoVisible`, `PhoneField` | `lib/field-rules.ts` | **Usar** | Ojo: el panel guarda teléfonos normalizados; hay que migrar datos y no solo el campo |
| `CIUDADES_PARAGUAY`, `buscarCiudad`, `departamentoDe`, `CityAutocomplete` | ciudad libre | **Usar** | Clientes/Eventos/Leads |
| `fechaDia`, `fechaHora`, `fechaCorta`, `fechaHoraCorta` | `formatDate*` | **Adaptar** | Falta huso horario (o mantener los del panel) |
| `Input`, `Label`, `FormField`, `Textarea`, `Select` | `TextField`, `SelectField`, `TextAreaField` | **Usar** | 1:1, mismo contrato (label arriba, error `role="alert"`, hint o error) |
| `MoneyInput` | `MoneyField` | **Usar** | Igual + tope de monto |
| `SearchField` | `SearchField` | **Usar** | Igual (lupa + limpiar) |
| `Switch` | `SwitchField` | **Usar** | Igual (checkbox real con `role="switch"`) |
| `SegmentedField`, `Subtabs` | `SegmentedField` | **Usar** | Misma idea; `Subtabs` para subnavegación ancha |
| `PercentField`, `PhoneField`, `EmailField`, `SerialField`, `PinInput`, `PasswordInput`, `CurrencySelect` | campos del kit | **Usar** | Cubren los tipos que el panel ya tiene |
| `EmptyState`, `ErrorState`, `Skeleton` | `AdminEmpty`, `AdminErrorState`, `AdminLoadingRows` | **Usar** | 1:1; `Skeleton` además trae el placeholder real |
| `Aviso`, `Nota` | `AdminNote`, `AdminError`, `AdminSuccess` | **Usar** | 1:1, con `role` correcto |
| `ToastProvider`, `useToast` | — (el panel no tiene toasts) | **Usar** | Capacidad nueva, no migración |
| `Modal`, `ConfirmDialog`, `Drawer` | `AdminDialog` | **Adaptar** | Ganancia real: **foco atrapado** y `body` bloqueado; el `AdminDialog` no los tiene (probado). Tamaños por tipo (`corto/formulario/amplio/completo`) vs `default/wide/ficha` |
| `Button`, `IconAction` | `AdminButton`, `AdminIconLink` | **Adaptar** | Colores salen de `--c-*`: hay que mapear `--c-fono → --a-accent` o el primario sale verde |
| `Stat` | `AdminKpi` | **Adaptar** | Falta `tone`/`note`; `delta` no aplica (LedBox no calcula series históricas) |
| `Badge` | `AdminBadge` | **Adaptar** | Otro mapa de tonos (`blue/green/red/orange/slate` vs `neutral/accent/ok/warn/danger/info`) |
| `ChipEstado` + `ESTADOS_CHIP` | `AdminBadge` de estado | **Adaptar / no usar tal cual** | Es de dispositivos (`certificado / en revisión / pendiente / con fallas`). Para LedBox hacen falta estados de negocio (Activa, Cobrado, Por cobrar, Vencido, Activo/Pausado) → objeto genérico con mapa por app (§5.7) |
| `CeldaMoneda`, `Money` | celdas de dinero | **Usar** | Sirven dentro de nuestro `AdminCell` |
| `DataTable`, `CELDA_*`, `ROTULO_*` | `AdminTable`, `AdminRow`, `AdminCell` | **No usar tal cual** | Falta la plantilla de columnas `--<vista>-cols` (encabezado y fila comparten plantilla) y el scroll horizontal silencioso; en mobile cae a `EmptyState` si no se pasa `mobileCard`. Las `CELDA_*` son strings de Tailwind: obligan a que la vista use Tailwind |
| `PageHeader`, `Eyebrow`, `FilaDato`, `BarraProgreso`, `Dot` | cabeceras y celdas | **Usar / adaptar** | `BarraProgreso` sirve para avances (presupuestos, tesorería) |
| `qrDataUrl`, `QR_OPCIONES`, `CodigoQr` | `lib/qr.ts` | **Usar** | Mismo QR (nivel M, margen 1) |
| `Icon` (55 glifos) | `AdminIcon` (46 glifos) | **Adaptar** | Solo **24 nombres coinciden**; los 22 íconos de módulo del panel (eventos, finanzas, inventario, proveedores, promotoras, plan, banco, auditoría…) no existen. Cambiar el glifo cambia toda la app: hay que ampliar el set o permitir íconos por app |
| `nombrePartes`, `primerNombre`, `normalizarNombre`, `inicialesDeBanco` | helpers de nombres | **Usar** | |
| `esToken`, `extractTokenFromUrl`, `PegarEnlaceToken` | validación de códigos | **Usar** | |
| `AuthLayout`, `GoogleButton`, `ProductFooter`, `LoadingScreen`, `NavLateral`, `PanelDerecho` | shell propio | **No usar** | El panel tiene su shell y su marca; son para apps nuevas |
| Checklist de dispositivos, locks, batería, iPhones, ESC/POS, impresoras LAN | — | **No aplica** | Dominio de MobOS |

Lo que **no conviene** tocar en este piloto: `AdminTable`/plantillas de columnas,
`AdminIcon`, el shell (`AdminShell`, `NavLateral`), el tema `data-theme` y la
impresión (`lbprint`).

## 4. Esfuerzo estimado para adoptarlo en el rediseño

| Etapa | Alcance | Estimación |
| --- | --- | --- |
| 0. Base | Tailwind + preset + contención + shim de tema (`--c-*` → `--a-*`) + tipos | **0,5 día** |
| 1. Prioridad 1 sin Tailwind | montos (`formatMoney` es un solo punto, pero se ve en todo el panel), bancos (Tesorería, Conciliación, datos de pago), teléfono (Clientes, Promotoras, Invitaciones), ciudades (Clientes, Eventos, Leads) | **2–3 días** |
| 2. Prioridad 2 (dentro del rediseño) | `Stat`→KPI, `EmptyState`/`ErrorState`/`Skeleton`, `Aviso`/`Nota`, `Button`/`IconAction`, `Badge`/chip de estados, toasts | **3–5 días** |
| 3. Prioridad 3 | `Modal`/`ConfirmDialog` (12 archivos usan `AdminDialog`), campos (16 usan `TextField`, 15 `SelectField`, 15 `SearchField`), tablas (18 módulos usan `AdminTable`) | **5–8 días** |
| **Total** | migración dentro del rediseño, sin pantallas nuevas | **≈ 2–3 semanas** de una persona |

Datos de tamaño que sostienen la estimación: `AdminUI.tsx` exporta **29
primitivas** y `AdminFields.tsx` **18 campos**; `AdminButton` se usa en 27
archivos, `AdminNote` en 26, `AdminBadge` en 25, `AdminPanel` en 24,
`AdminEmpty` en 23, `AdminTable` en 21, `AdminKpi` en 20, `AdminDialog` en 12.

Riesgo principal: no es el código, es el **formato** (G) y el **tema** (C). Los
dos se deciden una vez y se propagan.

## 5. Fixes upstream propuestos (texto para la librería)

Según `ALIMENTAR.md` (buscar antes de crear, extraer sin acoplar, release con
`CHANGELOG` + tag), esto es lo que le pediría a `owncoding-ui` antes de adoptar:

1. **`qrcode`: import dinámico o dependencia normal.**
   «En `src/utils/qr.js` el `import QRCode from 'qrcode'` es estático y queda en
   el bundle raíz (`dist/index.js`), así que cualquier app que importe
   `owncoding-ui` —aunque no use QR— no compila si `qrcode` no está instalada,
   pese a ser peer *opcional*. Propuesta: `const { default: QRCode } = await
   import('qrcode')` dentro de las funciones async de `qr.js` (o mover
   `CodigoQr`/`qrDataUrl` a un entrypoint `owncoding-ui/qr`), y documentar en el
   README que `qrcode` solo se necesita para QR.»
2. **El `content` del preset no se aplica (Tailwind 3.4).**
   «El preset declara `content: ['./node_modules/owncoding-ui/dist/**/*.js']`
   con el comentario de que Tailwind lo combina con el de la app. En Tailwind
   3.4 `content` de un preset se descarta (`normalizeConfig` arma
   `content.files` solo con el config del proyecto): las clases de los
   componentes no se generan y los íconos salen gigantes (`h-3 w-3`,
   `inline-flex`, `gap-1.5` ausentes). Propuesta: sacar el `content` del preset,
   exportar `owncodingContent` (array de rutas) desde el paquete y documentarlo
   en el README, o generar un safelist.»
3. **Tipos.** «Publicar `dist/index.d.ts` (o JSDoc + `tsc --emitDeclarationOnly`)
   y declarar `types` en `package.json`. Hoy una app TypeScript `strict` con
   `allowJs: false` necesita un shim propio.»
4. **`styles.css` sin base global.** «Separar tokens de base:
   `owncoding-ui/tokens.css` (solo variables, importable siempre) y
   `owncoding-ui/base.css` (html/body/h1–h3/nav/button/label/:focus-visible,
   opt-in). O acotar esas reglas a `.oc-root`. Hoy importar `styles.css` cambia
   el `body` y las tipografías de cualquier app: es lo único que impide un shim
   de tema limpio.»
5. **Fechas con huso.** «Agregar `timeZone` (o aceptar un `Intl.DateTimeFormat`
   externo) en `fechaHora`/`fechaDia`/`fechaCorta`: hoy usan el huso del
   navegador y una app multiempresa necesita fijarlo (LedBox usa
   `America/Asuncion` para que el servidor y el cliente dibujen el mismo día).»
6. **`formatGs` con símbolo configurable.** «`formatGs` devuelve `Gs 1.000`;
   LedBox escribe `Gs. 1.000`. Propuesta: `formatGs(valor, { simbolo })` o un
   `formatMoneda({ simbolo, decimales })` genérico. También conviene un helper
   de enteros (`formatNumero`) y un `montoTexto` que documente el vacío `—`.»
7. **`ChipEstado` genérico.** «Hoy está atado a estados de dispositivo
   (`ESTADOS_CHIP`: certificado/en revisión/pendiente/fallas). Para adoptarlo en
   las otras apps hace falta un mapa de estados por app (p. ej.
   `<ChipEstado mapa={ESTADOS_EVENTO} estado="cobrado" />`) o un `tono`
   explícito.»
8. **Íconos.** «El set cubre 55 glifos pero solo 24 coinciden con los 46 del
   panel; faltan los íconos de módulo (eventos, finanzas, inventario,
   proveedores, promotoras, plan, banco, auditoría, resumen). Propuesta:
   `Icon` con un mapa adicional por app, o ampliar el set con esos nombres
   (el glifo es lo que el dueño quiere unificar, no solo el nombre).»
9. **Candidatos a cosechar** (van al revés, de LedBox a la librería, y están en
   `ADOPCION-OWNCODING-UI.md` §3): `TableroKanban` (`AdminBoard`), `Cronologia`
   (`AdminTimeline`), `PlanPagos`, `DocumentoImpresion`, `SubidaImagen`,
   `ProgresoChecklist`.

## 6. Verificación y evidencia

Entorno: Postgres local en `localhost:55771` (`ledbox_piloto`), `prisma migrate
deploy` + `prisma:seed`, `npm run dev -- -p 3371`. Para la comparación
antes/después se levantó el commit base (`957c4ec`, v2.1.17) en un worktree
temporal en `-p 3372`, con la **misma base** y la misma sesión de demo, para que
la única variable fuese el piloto.

### 6.1 Checks

| Check | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ sin errores |
| `npm run build` | ✅ (incluye `prisma generate`; `/piloto-ui` = 22,3 kB / 162 kB First Load JS) |
| `npm run test:rules` | ✅ 81/81 |
| `npm run check:fields` | ✅ sin inputs sueltos ni `type="number"` |
| `npx prisma validate` | ✅ (no se tocó el schema) |

Consola del navegador en `/piloto-ui` (desktop 1440 y mobile 390, claro y
oscuro): **0 errores** en las capturas (el entorno de verificación guarda el
JSON de consola de cada una).

### 6.2 `/finanzas` y `/clientes`: antes (base) vs después (piloto)

Capturas full-page y viewport, claro y oscuro, con la demo:

| Comparación | Píxeles distintos | Resultado |
| --- | --- | --- |
| `/finanzas` oscuro (viewport) | **0** de 1.296.000 | `sha256` idéntico |
| `/clientes` oscuro (viewport) | **0** | `sha256` idéntico |
| `/finanzas` claro (full y viewport) | **0** | `sha256` idéntico |
| `/clientes` claro (full y viewport) | **0** | `sha256` idéntico |
| `/finanzas` oscuro (full) | 25 de 6.579.360 | solo el avatar de la demo (28×28 px) |
| `/clientes` oscuro (full) | 7.576 de 2.050.560 | solo los 20 logos de clientes (22×22 px) |

Los dos casos con diferencia son **imágenes generadas por la demo** (avatar y
monogramas de logos): los píxeles cambian ±1 en RGB entre requests, no son CSS.
Prueba independiente y más fuerte: la **huella de DOM y estilos** de cada
elemento (posición, tamaño, color, tipografía, bordes, grillas) es idéntica —
1.451 elementos en `/finanzas` y 1.086 en `/clientes`, con la única diferencia de
un `<script>` de dev (HMR) que aporta el segundo servidor.

Capturas del par: `docs/piloto-owncoding-ui/finanzas-antes.png` y
`finanzas-despues.png` (byte a byte iguales, `sha256 110be7a67dec3b92…`).

### 6.3 Fuga de CSS al navegar (cliente) desde `/piloto-ui`

Desde `/piloto-ui` (con Tailwind y la librería cargadas) se navegó por click a
`/finanzas` y `/clientes`. Resultado contra la carga directa del mismo servidor:
**0 píxeles** salvo el avatar de la demo (25–29 px). Es decir, la contención
funciona también cuando la hoja de la librería queda cargada.

### 6.4 Aislamiento en el build

`app-build-manifest.json` del build de producción:

- `/(admin)/(panel)/piloto-ui/page` → `static/css/d7ba7b23fe7204f5.css` (33,8 kB: Tailwind + tokens de la librería).
- `/finanzas`, `/clientes` y el resto de los módulos → **sin CSS propio**.
- `app/layout.css` (global, todas las rutas) → `3778f55acbf3dcde.css` (154,9 kB) **sin** tokens ni utilidades de la librería.

### 6.5 Capturas del piloto

| Archivo | Qué muestra |
| --- | --- |
| `desktop-oscuro.png` | `/piloto-ui` a 1440, panel oscuro + librería oscura (`html.dark`) |
| `desktop-claro.png` | `/piloto-ui` a 1440, panel claro + librería clara (`?oc=light`) |
| `conflicto-tema.png` | panel oscuro con librería clara: el conflicto de tema (§2 C) |
| `mobile-oscuro.png`, `mobile-claro.png` | `/piloto-ui` a 390 (sin scroll horizontal: `scrollWidth == 390`) |
| `mobile-tabla-oscuro.png` | mobile con las tarjetas de `DataTable.mobileCard` y nuestra tabla con scroll |
| `finanzas-antes.png`, `finanzas-despues.png` | `/finanzas` en el commit base y en el piloto (idénticas) |

### 6.6 Cómo se reproduce

```bash
export PGDATA="$(mktemp -d)/pgdata"
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$PGDATA" -o "-p 55771" -l "$PGDATA/log" start
createdb -p 55771 -U postgres ledbox_piloto
export DATABASE_URL="postgresql://postgres@localhost:55771/ledbox_piloto?schema=public"
export AUTH_SECRET="dev-secret-dev-secret-dev-secret"
export LEDBOX_ADMIN_DARIO_PASSWORD="dev-password-1234"
export LEDBOX_ADMIN_SANTIAGO_PASSWORD="dev-password-1234"
npx prisma migrate deploy && npm run prisma:seed
npm run dev -- -p 3371
# entrar a la demo con datos: http://localhost:3371/api/demo/session?next=/piloto-ui
```

La pantalla del piloto tiene un interruptor de tema de la librería y acepta
`?oc=light` / `?oc=dark` para fijarlo.

## 7. Pendientes y decisiones para el dueño

1. **Formato de dinero y fechas** (§2 G): ¿LedBox adopta `Gs 18.994.000` y el
   formato numérico de fecha, o la librería parametriza símbolo y huso?
2. **Tema único** (§2 C): mover el tema del panel a `html.dark` (con `data-theme`
   como alias) o mantener los dos.
3. **`/piloto-ui`**: si el piloto sigue vivo hasta la decisión, hay que sumarlo a
   `lib/admin-routes.ts` (para que el host público lo redirija al subdominio del
   panel) o borrarlo antes de la entrega; hoy es una ruta suelta e interna.
4. **Token de CI** para el repo privado en Coolify (§1).
5. Tailwind en LedBox: hoy entra solo por la ruta del piloto. Si se adopta la
   librería, decidir si el rediseño usa Tailwind o si se adopta solo la parte sin
   CSS (prioridad 1) y el resto se re-escribe con los tokens del panel.
