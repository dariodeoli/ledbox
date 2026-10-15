# Panel de plataforma `/superadmin`

Panel solo para el dueño de la plataforma (Owncoding), con lectura transversal de todas las empresas.
Referencia: guía de Agendese (GUIA-PANEL-SUPERADMIN.md), adaptada. Issues relacionados: #170 (último
acceso), #171 (sesiones), #182 (PagaYa), #69 (API keys). Diseño aprobado el 14-10-2026 (arquitecto).

## 1. Qué existe hoy (auditoría)
- Auth propia: JWT (jose) → `getAuthenticatedAdmin()` ya relee `AdminSession` + `AdminUser` en la base
  (revocación, vencimiento, `active`). La API key entra solo por `requireAdminContext` (Bearer).
- **No hay correo verificado**: `AdminUser` no tiene `emailVerified`. Un ADMIN de cualquier empresa puede
  cambiar el correo de un miembro (`PATCH /api/admin/users`) o crear cuentas con contraseña.
- Demo: `Organization.slug = "demo"` (`isDemoOrganizationSlug`, id `org_demo`) con usuarios propios
  (`demo_visitor`, equipo `@ledbox.demo`) que solo tienen membresía en la demo.
- Papelera: `deletedAt`/`archivedAt` en Lead, Client, Event, Budget, Supplier, InventoryItem y Promoter;
  `$queryRaw` no los oculta. `Organization` no tiene papelera (solo `active`).
- Actividad: no hay `lastActiveAt` ni latido. Hay `AdminSession.createdAt` (inicios de sesión) y
  `AuditLog` (acciones, con `organizationId`).
- `Budget` no guarda la fecha de envío; `AuditLog` sí registra `send` y `status → SENT`.
- Planes: `Plan`, `Organization.planId`, `loadPlanUsage` (lib/server/plan-limits.ts) y `PlanChangeRequest`
  (queda `pending`, sin pantalla para resolverlo).
- CSV: `buildCsv`/`csvCell` (lib/admin-export.ts) no neutraliza fórmulas. Rate limit: `rateLimit()`
  (lib/server/rate-limit.ts). Gráficos: `components/admin/charts/ChartBars` (client).
- `isAllowedAdminEmail` (lib/server/config.ts) no se usa e incluye a otra persona: no reutilizarlo.
- La regla de Agendese «/admin redirige a /superadmin» **no aplica**: acá `/admin/*` es el prefijo viejo del panel.
- Última migración al diseñar: `202610170001_trash_archive_delete`.

## 2. Acceso
- **Correo del dueño**: constante `PLATFORM_OWNER_EMAIL = "dariodeoli@gmail.com"` en `lib/platform/access.ts`.
  Sin variable de entorno (una variable mal cargada entregaría el panel; el código pasa por revisión).
- **Correo verificado**: `AdminUser.emailVerifiedAt DateTime?`. Se marca solo con prueba real: callback de
  Google con `email_verified = "true"` (login e invitación), aceptación de invitación (link por correo) y
  reset de contraseña completado. Vuelve a `null` cuando cambia el correo de la cuenta.
  `PATCH/POST /api/admin/users` rechaza con 409 asignar el correo del dueño a otra cuenta o cambiar el
  correo de la cuenta del dueño. Sin backfill: el dueño entra una vez con Google (o completa un reset de
  contraseña) después del deploy.
- **Guard único** `requirePlatformAdmin()` (`lib/platform/guard.ts`, solo servidor):
  1. `getAuthenticatedAdmin()`: solo cookie; nunca lee `Authorization` (la API key no entra).
  2. Relee `AdminUser` por id (`active`, `email`, `emailVerifiedAt`).
  3. Decide la función pura `decidePlatformAccess({ user, session, host, isProd })` → ok/deny: `active`,
     `email === PLATFORM_OWNER_EMAIL` (exacto, normalizado), `emailVerifiedAt` no nulo, sesión sin
     `lockedAt` (PIN) y, en producción, host = host de `publicConfig.adminUrl`.
  4. Ante cualquier falla o excepción → `redirect("/")` (ni 404 ni mensajes que delaten el panel).
  Devuelve `{ userId, email }`. `export const dynamic = "force-dynamic"` en el layout.
- **Cobertura**: lo llaman el layout, cada `page.tsx`, cada server action y cada `route.ts` (el layout no
  alcanza: no se re-ejecuta al navegar entre páginas). `tests/platform-routes.test.ts` recorre
  `app/(superadmin)/**` y falla si un page/layout/route o una función exportada de un archivo
  `"use server"` no llama a `requirePlatformAdmin(`.
- **Hosts** (middleware.ts), aplicado antes de la lógica de cada host:
  - app.ledbox.online: pasa (decide el guard). `/admin/superadmin` ya se canonicaliza a `/superadmin`.
  - admin.ledbox.online: el 308 existente lo lleva a app.
  - clientes., demo., eventos. y ledbox.online: `/superadmin` y `/superadmin/*` → 307 a `/` del mismo
    host (solo en producción; en desarrollo todo es localhost).
  - No se agrega a `ADMIN_ROUTES` (el host público lo redirigiría a app y anunciaría el panel).

## 3. Etapa 1: lectura transversal, solo lectura
**Estructura**: `app/(superadmin)/layout.tsx` (envoltorio `admin-root` + `ADMIN_BOOT_SCRIPT` + noindex, sin
tocar `(admin)`) y `app/(superadmin)/superadmin/{layout,page}.tsx`, `actividad/`, `empresas/`, `usuarios/`.
Shell propio `components/platform/PlatformShell.tsx` (server) que reutiliza las clases de sidebar del
panel, no `AdminShell` (exige contexto de empresa).

**Período** (`lib/platform/periods.ts`, puro): `?p=hoy|7d|30d|90d|mes|mes-anterior`. Límites en
medianoche de America/Asuncion convertidas a UTC. Anterior de igual duración: `[inicio − (fin − inicio), inicio)`.
Delta % con anterior 0 → «nuevo» (nunca ∞). Chips como `<Link>` que conservan los demás filtros.

**Filtro de demo único** (`lib/platform/sin-demo.ts`): fragmentos `Prisma.sql`
`orgReal(alias)` = `alias."organizationId" NOT IN (SELECT id FROM "Organization" WHERE slug = 'demo')` y
`usuarioReal(alias)` = tiene membresía activa en una empresa no demo. Toda consulta de
`lib/platform/queries/*` lo usa (test de fuente). La demo se muestra aparte como contador.

**Papelera**: los conteos excluyen `deletedAt` y muestran «en papelera: N» al pie; los montos lo incluyen
con una línea «de esto, eliminado: X» (regla de docs/PAPELERA.md).

**KPIs del Resumen** (PYG `Int`, comparados con el período anterior, sparkline diaria, nota «fuente · cálculo»):

| KPI | Fuente | Existe |
|---|---|---|
| Empresas reales / nuevas / con actividad | `Organization` (active, createdAt) + `AuditLog`/actividad | sí |
| Usuarios activos | `AdminActivityDay` (distintos `userId`) | nuevo (antes del deploy: «sin datos todavía») |
| Ingresos (logins) | `AdminSession.createdAt`, distintos usuarios | sí (histórico) |
| Eventos creados / realizados | `Event.createdAt`; `startsAt` en el período y status ≠ CANCELLED | sí |
| Presupuestos enviados | `AuditLog` entity=Budget, action `send` o `status` con `detail→changes→status→to = SENT`, distintos `entityId` | sí |
| Presupuestos aprobados y monto | `Budget.approvedAt` en el período, `SUM(total)` | sí |
| Cobros | `ClientPayment` status RECEIVED, `paidAt` en el período, `SUM(amount)` | sí |

**Actividad**: por día (usuarios activos, logins, acciones de `AuditLog`) con el período anterior punteado
(`components/platform/ChartLine.tsx`, SVG server) y por hora 0–23 en hora de Paraguay (`ChartBars` con
números ya agregados). SQL: `(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Asuncion')` con
`date_trunc` + `GROUP BY`; nunca filas sueltas.

**Empresas y Usuarios**: tablas server-side por `searchParams` (`q`, filtros, `orden`, `pag`, 30 por página,
`detalle=<id>`); detalle lateral dibujado en el servidor.
- Empresas: nombre, slug, plan, activa, alta, miembros, eventos, monto aprobado del período, última
  actividad. Detalle: uso del plan (`loadPlanUsage`) y solicitudes de plan pendientes.
- Usuarios: nombre, correo, empresas y roles, activa, último ingreso, última actividad, PIN sí/no, correo
  verificado sí/no. Nunca hashes ni tokens.
- Búsqueda: `ILIKE` parametrizado, con `rateLimit("superadmin:buscar:<userId>", 120)` antes de consultar.
- CSV: `superadmin/{empresas,usuarios}/exportar/route.ts`, con guard y rate limit.

**Registro de actividad** (migración `202610180001_platform_activity`, aditiva, `IF NOT EXISTS`):
- `AdminUser.lastActiveAt TIMESTAMP(3) NULL` y `AdminUser.emailVerifiedAt TIMESTAMP(3) NULL`.
- `AdminActivityDay`: `id`, `userId` (FK cascade), `organizationId` (null), `day DATE` (Paraguay),
  `firstSeenAt`, `lastSeenAt`, `hourMask INT` (bit por hora). Única `(userId, day)`, índice `(day)`.
- Escritura: en `requireAdminContext`, rama cookie (nunca demo ni API key), con `after()` + try/catch
  (`console.warn`); solo si `lastActiveAt` es nulo o de otra hora de Paraguay (máx. una escritura por
  usuario y hora). `INSERT … ON CONFLICT ("userId","day") DO UPDATE SET "hourMask" = "hourMask" | $bit,
  "lastSeenAt" = GREATEST(...)` + `UPDATE "AdminUser" SET "lastActiveAt" = GREATEST(...)`: idempotente y
  conmutativa. Nunca frena la respuesta.
- Índices para barridos por fecha: `AuditLog(entity, createdAt)`, `AuditLog(createdAt)`,
  `AdminSession(createdAt)`, `Budget(approvedAt)`, `ClientPayment(paidAt)`, `Event(createdAt)`.

## 4. Etapa 2 (después; cada módulo con su diseño corto)
- **Solicitudes de plan** (prioridad 1): aprobar/rechazar `PlanChangeRequest` y asignar plan (`planId`,
  `planStartedAt`), compare-and-set sobre `status = pending`, `recordAudit` en la empresa (actor «Plataforma»).
- **Comunicados**: `PlatformNotice` (título ≤80, mensaje ≤500, tipo, prioridad 1–5, vence) +
  `PlatformNoticeRead` única `(noticeId, userId)`; banner en `AdminShell`; % leído sobre usuarios reales.
- **Mantenimiento**: una fila `PlatformSetting`; el middleware la lee por endpoint interno con caché ≤30 s y,
  si falla, queda abierto. Siempre pasan `/superadmin`, `/api/health`, `/login`, `/api/auth/*`, `/_next/*`,
  estáticos, el webhook de PagaYa (cuando exista, #182) y el portal del cliente (`/p/*`, `/portal`,
  `/firma/*`, host clientes.) salvo que se marque «incluir portal».
- **Errores**: `instrumentation.ts` (`onRequestError`) + `app/error.tsx` y `global-error.tsx`; agrupados por
  huella (mensaje + primer frame normalizado), sin query string, correos ni tokens; tope por huella y hora.
- **Reportes de usuarios**: «Reportar un problema» en el panel, con sesión, ≤1000 caracteres, 5 por hora
  por usuario; listado con estados.
- **Cupones y gracia**: no aplica hasta #182 (no hay cobro de suscripciones). Se diseña con PagaYa sobre
  `Plan`/`plan-limits`, sin sistema de planes paralelo.

## 4b. Alta de empresa («Nueva empresa»)
Primera escritura del panel. `/superadmin/empresas/nueva` (page + server action `crearEmpresaAction`, ambas con
`requirePlatformAdmin()` y rate limit de 10 altas por 15 min) pide nombre, slug (sugerido desde el nombre, único,
sin reservados como `demo`/`admin`/`api`), plan vigente y una lista de **invitados** (1 a 10; cada fila con correo y rol dueño o administrador, se agregan y quitan filas). Sin ningún dueño, la empresa queda con los administradores invitados. `lib/platform/alta-empresa.ts` es la parte pura
(slug y validación) y `alta-empresa-server.ts` escribe.
- **Una transacción**: `Organization` (activa, plan y `planStartedAt`, plantillas de mensajes de arranque como el seed; sin
  inventario ni datos de pago de LedBox), una invitación por persona con `upsertInvitation` (la misma de `lib/server/invitations.ts`:
  token de 24 caracteres, solo su hash en la base, 7 días) y auditoría con actor «Plataforma». El correo sale **después** de
  confirmar; si el proveedor falla, el alta queda y se avisa para reenviar.
- **Sin contraseñas**: no se crea `AdminUser` ni membresía. La persona acepta con el link (cuenta nueva) o, si el correo ya
  tiene cuenta, `joinTeam` solo suma la membresía con el rol invitado (verifica su contraseña o su Google).
- **El link no se muestra**: el panel de equipo tampoco lo muestra (solo viaja por correo y en la base queda el hash), así que
  el resultado muestra el estado real del correo (enviado / falló / no configurado). «Reenviar invitación» (detalle de la
  empresa, una por invitación sin aceptar) genera token nuevo y 7 días más; el link viejo deja de servir. Rate limit propio (10 por 15 min).
- **Correo del dueño de la plataforma**: la alta SÍ permite invitar a `PLATFORM_OWNER_EMAIL` como dueño de otra empresa,
  porque lo decide el propio dueño de la plataforma desde un panel que ya exige su sesión verificada. `ownerEmailConflict`
  sigue bloqueando a las empresas (`/api/admin/users`) y la cuenta del dueño no cambia de correo: aceptar solo le suma membresía.

## 4c. Empresa predeterminada
`AdminUser.defaultOrganizationId` (migración `202610200001_user_default_organization`, sin FK: se valida en código). Mi perfil
tiene el selector «Empresa predeterminada» (`PATCH /api/admin/profile/default-organization`). Solo vale una empresa con
membresía activa, empresa activa y que no sea la demo (`selectableMembershipWhere` en `lib/server/tenancy.ts`, el único lugar
donde sumar `isDemo: false` cuando entren las sandboxes de la demo interactiva); una ajena responde 403. Al iniciar sesión
(`resolveActiveOrganizationId`, también el callback de Google) se abre esa empresa; si dejó de valer, la primera membresía activa.
Cambiar de empresa dentro del panel no modifica la predeterminada. `resolveDefaultOrganizationId` es otra cosa (empresa que
recibe los leads públicos) y no se toca.

## 5. Seguridad
- CSV: `csvCell` neutraliza las celdas de texto que empiezan con `= + @ \t \r`, o con `-` seguido de algo
  que no sea número, anteponiendo `'` (vale para todos los CSV del panel).
- Rate limit antes de cualquier búsqueda o export por correo o nombre.
- Sin API JSON de superadmin: páginas server; los componentes cliente reciben solo números y textos ya
  agregados. Ningún `'use client'` importa `lib/platform/{guard,queries}` ni la base (test).
- Multiempresa intacta: `requireAdminContext` solo suma el `after()`; en la etapa 1 no hay escrituras salvo
  el registro de actividad.

## 6. Etapas
- **E0 (ledbox-infra)**: migración, `emailVerifiedAt` (Google/invitación/reset y borrado al cambiar correo),
  reserva del correo en users, registro de actividad, guard + `decidePlatformAccess`, hosts en el
  middleware, CSV seguro y tests. Publicable sola (sin páginas todavía).
- **E1a (ledbox-ui)**: layouts, shell, chips de período, Resumen y Actividad (`lib/platform/queries`).
- **E1b (ledbox-ui)**: Empresas y Usuarios (tablas, detalle lateral, CSV). QA revisa E0 y E1.

## 7. Criterios de aceptación de QA (etapa 1)
1. Sin sesión, `/superadmin` y cualquier subruta redirigen a `/` (nunca 404 ni 200).
2. Con sesión de otro usuario (aunque sea OWNER de una empresa): redirige a `/`.
3. Cuenta del dueño sin `emailVerifiedAt`: redirige; tras entrar con Google, accede.
4. Cuenta del dueño con `active = false` o sesión bloqueada por PIN: redirige.
5. `Authorization: Bearer lbx_…` válido sin cookie: redirige (también en `exportar`).
6. En producción, `/superadmin` en clientes., demo., eventos. y ledbox.online → 307 a `/` del mismo host; admin. → 308 a app.
7. Una página o route nueva sin `requirePlatformAdmin(` hace fallar `tests/platform-routes.test.ts`.
8. `PATCH /api/admin/users` que pone o cambia el correo del dueño → 409; cambiar el correo de cualquier cuenta deja `emailVerifiedAt = null`.
9. Con `ensureDemoData({ reset: true })` y sin empresas reales, todos los KPIs dan 0 y el contador de demo es > 0 (pg).
10. Un evento creado a las 02:30 UTC cuenta en el día anterior de Paraguay (pg).
11. Los 6 períodos dan límites en medianoche de Asunción y un anterior de igual duración; anterior 0 → «nuevo» (puro).
12. «Enviados» cuenta una vez un presupuesto enviado dos veces; «Aprobados» suma `total` PYG; lo eliminado va en «de esto, eliminado» y no en el conteo.
13. 50 requests del mismo usuario en la misma hora = 1 fila y 1 bit; 2 simultáneos en hora nueva no fallan; con la base caída en el `after()` la página responde igual.
14. La demo y las API keys nunca escriben `AdminActivityDay`.
15. Tablas: 30 por página; búsqueda, filtros y orden por URL; detalle por `?detalle`; la búsqueda 121 en 15 min responde «demasiados intentos» sin consultar.
16. CSV: `=HYPERLINK(...)` sale `'=HYPERLINK(...)`; los montos negativos quedan numéricos.
17. Ningún HTML ni payload RSC de `/superadmin` contiene hashes, tokens ni `passwordHash`/`pinHash`.
18. build, typecheck, test:rules, check:fields, check:contexto, prisma validate y pg tests en verde; la migración corre dos veces sin error.

## 8. Riesgos y vuelta atrás
- Datos de zona horaria viejos en Postgres (Paraguay UTC−3 fijo desde 2024): el pg test de borde lo
  detecta; si falla, agrupar con offset fijo `-03`.
- «Enviados» depende de que cada envío audite: queda en la nota de fuente.
- Vuelta atrás: revertir el commit; la migración es aditiva (columnas y tabla quedan sin uso).

## 9. Tráfico (métricas propias)
Captura propia de visitas y uso de la demo, sin servicios externos. Migración `202610180002_web_metrics`
(aditiva, `IF NOT EXISTS`). La página «Tráfico» consume `lib/platform/queries/trafico.ts`.

**Qué se mide**
- Vistas en `ledbox.online`/`www` (se guardan como `ledbox.online`), `eventos.`, `demo.` y `clientes.` (portal, contado aparte);
  catálogos y tiendas públicas por empresa cuando viven en esos hosts. `app.ledbox.online` (y `admin.`) NO se mide: ya tiene
  `AdminActivityDay`. `/superadmin` y `/api` tampoco, en ningún host.
- Por vista (`WebView`): host, path normalizado, dominio del referrer, `mobile`/`desktop`, país (solo si el proxy manda
  `cf-ipcountry`, `x-vercel-ip-country` o `x-country-code`; si no, nulo), duración visible en segundos (tope 1800), scroll
  máximo 0–100 %, si es la primera vista de la sesión y un hash diario del visitante.
- Demo (`DemoSession`): evento `demo_start` en el servidor (`/api/demo/session`, una por visitante cada 30 min; «Reiniciar la
  demo», bots y DNT no cuentan), duración total y módulos visitados (primer segmento del path). Hay una sola demo: no hay
  variantes. «Cuál demo se usa más» = módulos más visitados del host de la demo.

**Qué NO se guarda**: IP, user agent, cookies, query string, fragmento, ni tokens/ids (`/p/:token`, `/firma/:token/documento`,
`/tienda/<slug>/mayorista/:token`, `/pedido/:token`, ids del panel demo → `:id`). El referrer queda en el dominio. El
visitante es `sha256(sal_del_día + ip + ua)` truncado a 16 hex; la sal es un HMAC del día de Paraguay con el secreto del
servidor, rota todos los días y no se guarda. Una misma persona en dos días son dos hashes: «visitantes» es la suma de
visitantes por día, no personas únicas.

**Por qué no hace falta banner**: no hay cookies ni almacenamiento persistente (el id de navegación vive en `sessionStorage`
y muere con la pestaña), no hay identificador entre días ni dato personal, y se respeta «No rastrear» (`navigator.doNotTrack`
y header `DNT`: no se manda ni se guarda nada). Es medición propia agregada, sin terceros.

**Cómo funciona**: `components/analytics/PageBeacon.tsx` (cliente, sin librerías) está en el layout raíz salvo en el panel real
(en la demo sí). Manda la vista al cargar y, al ocultarse la pestaña o `pagehide`, la duración visible y el scroll con
`sendBeacon`. Solo en producción (o con `NEXT_PUBLIC_WEB_METRICS_DEBUG=1`). `POST /api/metrics/view`: valida estrictamente
(claves, tipos, tamaños ≤ 2 KB, host en lista cerrada), filtra bots, rate limit por visitante (240 en 15 min), sin CORS (si
el `Origin` no es el host de la vista se ignora), responde siempre 204 y escribe en `after()`. El `UPSERT` por `viewId` es
idempotente (duración y scroll toman el máximo) y solo el mismo visitante actualiza su vista.

**Retención**: purga perezosa (≈1 de cada 500 beacons) de lo de más de 400 días, en lotes de 5000.

**Consultas** (`lib/platform/queries/trafico.ts`, agregadas, días de Paraguay, rango de `lib/platform/periods.ts`):
`getTraficoPorHost` (vistas, visitantes, sesiones, tiempo promedio y mediana, scroll, rebote, vistas del período anterior),
`getVistasPorDia`, `getTopPaginas`, `getTopReferrers`, `getDispositivos`, `getHoy` (hoy vs. mismo tramo de ayer) y `getDemo`
(demos iniciadas por día, duración promedio y mediana, módulos por sesión, módulos más usados). Rebote = sesión de una sola
vista con menos de 10 s (sin duración reportada cuenta como 0). La duración solo existe si el navegador alcanzó a mandar el
beacon de cierre.
- **Conversión demo → registro o lead: «sin datos».** La demo no comparte identificador con leads ni registros; no se mide
  adivinando. `getDemo().conversion` devuelve `{ available: false, reason }`.
- Las vistas del host de la demo salen en `getTraficoPorHost` marcadas `isDemo`; la página debe mostrarlas en la sección
  Demo, aparte de las del negocio.
- El rango es el de `lib/platform/periods.ts` (`resolvePeriod`); los deltas son `Delta` (`nuevo` / `igual` / `pct`).
- **Abuso del beacon**: además del tope por visitante hay un tope global de 600 por host y minuto
  (`metrics:view:global:<host>:<minuto>`); rotar UA o `X-Forwarded-For` no lo evita. Un tope global de filas por día
  no se agregó: `rateLimit()` tiene ventana fija de 15 min y contar filas por request no es barato.
- **IP del hash**: el último valor de `X-Forwarded-For` (lo agrega el proxy de confianza, Traefik/Coolify; el primero lo
  escribe el cliente y se puede falsear) y, si no hay, `X-Real-IP`. Si hubiera otro proxy delante de Traefik, el último
  valor sería ese proxy: verificar en producción que cada visitante da una IP distinta.
- **Fallo cerrado**: en producción, sin `AUTH_SECRET` ni `JWT_SECRET` no se registra nada (warn en el log).
- **Paths**: cualquier segmento con `@` o `%` pasa a `:id`, y bajo una raíz que no es una ruta pública ni del panel todo
  lo que sigue pasa a `:id`.
