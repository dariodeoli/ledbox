# Rendimiento del portal y de los módulos de finanzas (issue #59)

## Ronda 2 (issue #63): islas en el portal y recorte de payloads

**Portal del cliente (`/p/[token]`)** — se separó lo que no necesita hidratar:

| Métrica | Antes | Después |
| --- | --- | --- |
| First Load JS (build) | 136 kB | **135 kB** |
| Página (build) | 14 kB | **12.9 kB** |
| Chunk de la página (sin comprimir) | 51.644 B | **47.454 B (−8 %)** |
| HTML visible (demo abierta / aprobada) | — | **idéntico** (solo cambia el hash de webpack) |

- El aviso de demo, el encabezado (referencia, título, metadatos) y la
  **cronología** se dibujan ahora en el servidor (`PortalBudgetStatic.tsx`) y
  viajan como nodos al componente cliente: el navegador no los hidrata.
- El pipeline de imagen del comprobante (canvas + magic bytes) vive en
  `portal-proof-image.ts` y se importa **recién al enviar** el comprobante
  (chunk diferido de 1,6 kB).
- Lo interactivo (chips, ítems, acción, comprobante y pedidos) sigue en el
  cliente porque cambia con lo que hace el visitante —y, en la demo, con la
  simulación por sesión—. Lo que queda del First Load del portal: 103 kB de
  framework compartido (plataforma), `admin-format` (27 kB sin comprimir, mapa de
  etiquetas compartido con el panel) y `owncoding-ui` (21 kB) que resuelve la
  marca del banco: ese último **no se puede diferir sin sacar el logo del HTML**
  inicial de los presupuestos aprobados, así que se mantiene (trade-off
  documentado).

**`/api/admin/finance`** — 36.780 B → **16.195 B (−56 %)** con las mismas filas:

- `client`: 18 campos → 6 (`id`, `name`, `company`, `type`, `email`, `phone`,
  justo `AdminClientRef`); fuera notas, RUC, dirección, contacto y métricas de la
  ficha que la lista no dibuja.
- `budget`: 29 campos → 3 (`id`, `title`, `publicToken`); fuera `costEstimate`,
  `notes`, `installmentsJson` y la **evidencia interna** (`approvalIp`,
  `approvalUserAgent`).
- `supplierJob.supplier`: 11 → 4; `supplierJob.event`: 14 → 4 (`AdminEventRef`).
- Sin cambios de tipo: el recorte coincide con lo que ya declaraba
  `lib/admin-types.ts` (`AdminPaymentRow`, `AdminClientRef`, `AdminSupplierJobRow`),
  así que la ficha de cliente de OPS no se toca.

---

## Ronda 1 (issue #59)

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
  **Resuelto en #61** (PANEL): sesión embebida por SSR + GET en vuelo
  compartidos; con la misma metodología quedó 0,028 / 0 / 0
  (`docs/DISENO-PANEL.md` §9).
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

**Lecturas pesadas del índice de la demo** (~30 consultas por visita): se probó
cachearlas por organización en la Data Cache de Next (`unstable_cache`, tag
`demo`), pero **se revirtió en el hotfix del 23-09-2026 (v2.1.30, incidente #66)**:
la Data Cache serializa el resultado con el formato de flight y las `Date` vuelven
codificadas, lo que rompía el render con `RangeError: Invalid time value`
(`demo.ledbox.online/` → 500, también en el primer request: el round-trip es
siempre; el error del proxy mostraba `NEXT_REDIRECT;...;/api/demo/session` como
digest porque el layout redirigía mientras la página reventaba). Queda como
lectura directa: se pierde el recorte de ~21 ms de TTFB local (34,7 → 13,8 ms) y
el ahorro de las ~30 consultas por visita del índice. Si se retoma: el loader debe
devolver **JSON puro** (todas las `Date` → ISO strings y el render parsea en el
borde), con un test que verifique que la salida sobrevive
`JSON.parse(JSON.stringify(...))` sin `Date`/`Map`/`Set`; y validar en build de
producción contra el host demo (primer request y repetido).

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
