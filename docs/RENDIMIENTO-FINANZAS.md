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
