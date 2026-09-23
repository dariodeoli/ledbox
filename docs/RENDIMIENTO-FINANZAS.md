# Rendimiento del portal y de los módulos de finanzas (issue #59)

Medición del 23-09-2026 sobre la rama `slot/finanzas` rebasada en `5bf3ade`, con
el build de producción local (`next build` + `node .next/standalone/server.js`),
datos de demo y una sesión real, en un Chrome headless con
`Network.emulateNetworkConditions` (3G rápido: 150 ms de latencia, 1,6 Mbps de
bajada) y sin caché. Cada página: TTFB, FCP, LCP, `load`, **datos listos** (última
respuesta `/api/admin/*`), cantidad y bytes de las respuestas de API, CLS.

| Página | API antes | API después | Datos listos antes | Datos listos después | Bytes de API antes | Bytes después |
| --- | --- | --- | --- | --- | --- | --- |
| `/finanzas` | 14 | **11** | 2107 ms | **1587 ms** | 143,3 kB | **95,9 kB** |
| `/presupuestos` | 8 | **6** | 1285 ms | **892 ms** | 136,3 kB | **34,7 kB** |
| `/facturacion` | 8 | **6** | 1112 ms | **742 ms** | 62,8 kB | **41,7 kB** |
| `/p/[token]` (portal) | 0 | 0 | — | — | 0 | 0 |

En escritorio (sin throttling) los mismos tres módulos bajaron de 636/734/272 ms
a **208/128/184 ms** hasta la última respuesta de datos.

## Qué se cambió

Los tres módulos pedían **catálogos completos en el primer render** para
alimentar selects que solo viven en un diálogo:

| Módulo | Antes | Después |
| --- | --- | --- |
| Tesorería (`/finanzas`) | `/api/admin/clients` (18,9 kB) + `/api/admin/budgets` (28,0 kB) al entrar | se piden al abrir «Registrar cobro» |
| Presupuestos | `/api/admin/clients` (18,9 kB) + `/api/admin/events` (**82,6 kB**) al entrar | se piden al abrir «Nuevo presupuesto» |
| Facturación | `/api/admin/clients` (18,9 kB) + `/api/admin/suppliers` (2,2 kB) al entrar | clientes al abrir «Emitir factura»; proveedores al abrir «Registrar compra» |

`useAdminResource` sumó la opción `enabled` (issue #59): con `false` no pide nada
y `loading` queda en `false`; al pasar a `true` carga. Los selects muestran
«Cargando clientes…»/«Cargando eventos…» mientras llega la respuesta; la data y
las acciones son las mismas. Verificado abriendo los cuatro diálogos: cada uno
pide su catálogo y los selects se llenan (Cliente: 4 opciones, Evento, Proveedor…).

## Lo que queda (fuera de mi dominio o para otra ronda)

- **CLS del panel (0,98 en `/finanzas`)**: es el patrón de carga de los módulos
  (esqueleto corto → contenido alto). Los controles lo confirman: `/eventos`
  0,404 y `/dashboard` 0,47 con el mismo patrón. Es de shell/plataforma.
- **`/api/admin/events` (82,6 kB)** para un selector de eventos: el endpoint es de
  OPS; conviene un `select`/filtro por rango.
- **`/api/admin/finance` (37 kB)** incluye `client` y `budget` completos (con
  campos internos como `approvalIp`). Recortarlo toca `lib/admin-types.ts`
  compartido con la ficha de cliente (OPS): coordinar.
- **Portal `/p/[token]`**: renderizado en servidor y **sin llamadas de API**
  (LCP 112 ms en escritorio, 872 ms en 3G). Su costo restante es el JS de la
  vista (135 kB First Load), el más bajo de las cuatro pantallas.
- **Bundle global 103 kB** y shell: plataforma/PANEL.

## Ronda de plataforma (issue #64, 23-09-2026)

Medición local con build de producción (`node .next/standalone/.../server.js`),
Postgres local con datos de demo y Chrome headless por CDP (mismo host demo).

**Pedidos fijos al entrar al panel** (`/dashboard`, sesión demo):

| Métrica | Antes | Después |
| --- | --- | --- |
| Pedidos `/api/*` | **9** | **8** |
| Archivos JS | 12 | 12 |
| TTFB | 68–108 ms | 53 ms |

- El pedido duplicado era `/api/admin/notifications`: lo comparten la campana del
  topbar y el bloque del Resumen, y al montar a la vez los dos disparaban fetch
  antes de que el primero terminara. `adminApiGet` ahora comparte la **promesa en
  vuelo** para GET idénticos (ni `fresh` ni `signal`): un solo request (issue #64).

**Lecturas pesadas del índice de la demo** (server, ~30 consultas por visita):

| Métrica | Antes | Después (cache-hit) |
| --- | --- | --- |
| TTFB local de `demo.ledbox.online/` | 34,7 ms | **13,8 ms** |

- Se cachea por organización en la Data Cache de Next (`lib/server/demo-overview.ts`),
  con bucket de 2 minutos (las fechas se derivan de `now`) y tag `demo`. El
  «Reiniciar la demo» (`POST /api/demo/session?reset=1`) invalida con
  `revalidateTag("demo")`; la entrada normal no toca la caché. Nunca se cachea
  entre empresas (la organización entra en la clave).

**Estrategia conservadora** (lo demás queda dinámico a propósito): sesión, roles
y membresías no se cachean; las lecturas por organización del panel mantienen
frescura; el portal `/p/[token]` queda dinámico porque el cliente aprueba/cambia
el presupuesto. Avatares y logos ya venían con `Cache-Control: private, max-age=600`
y `?v=` de versión.

**Bundle**: el «shared by all» de 103 kB es el runtime de Next/React (no hay
imports de app ahí). `owncoding-ui` entra tree-shaken (solo los utils usados; no
quedan `DataTable`/`CeldaMoneda`/`qrDataUrl` en chunks cliente). El común del panel
(shell + paleta + primitivas) es el chunk `7521` (~63 kB sin comprimir); diferir la
paleta con `next/dynamic` solo ahorra ~2 kB de crítico y suma un request post-hidratación:
no conviene sin partir el diálogo del disparador (candidato a una ronda de PANEL).
