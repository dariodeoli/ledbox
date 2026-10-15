# Demo interactiva por visitante

Pedido del dueño: «que en la demo funcione todo, pueda hacer reservas, mover, ver todo, pero que se quede en
mi sesión». Diseño del arquitecto (14-10-2026) con las decisiones del dueño:
**dura solo mientras está abierta (se borra a 1 h sin uso; tope absoluto 24 h)**, **el visitante es dueño (OWNER)**
y **con la demo llena se muestra «Volvé en unos minutos»** (sin vitrina de reemplazo).

Hoy: `org_demo` (slug `demo`), usuario VIEWER `demo_visitor`, `/api/demo/session`, `ensureDemoData`; solo
lectura (403 en `requireAdminContext`).

## 1. Aislamiento: una empresa sandbox por visitante
Descartadas: transacción con rollback (no puede quedar abierta entre pedidos), copia en memoria (duplicar
Prisma en +100 rutas), navegador (reescribir cada pantalla; portal/firma imposibles), esquema por visitante
(migraciones por esquema). **Elegida: empresa sandbox**, aislada por el `organizationId` que ya filtra todo.
- **Seed único**: `seedDemoData(organizationId, base, ns)`; `sid(k)` da `demo_<k>` (vitrina) o `sbx_<ns>_<k>`
  (sandbox). Tokens y códigos públicos al azar por sandbox; colaboradores `nombre+<ns>@ledbox.demo`;
  `ns` = 10 caracteres base32. La vitrina `org_demo` no cambia (mismos ids).
- **Costo**: ~1.500–2.000 filas y <400 KB de imágenes en una transacción con `createMany` (PNG en memoria
  del proceso). Objetivo p95 < 2,5 s (se mide en E0). Copiar por SQL desde `org_demo` se descarta (frágil).
- **Visitante**: `AdminUser` `sbx_<ns>_visitor`, correo `visitante+<ns>@ledbox.demo`, clave al azar, sin
  PIN, `demoOrganizationId = sandbox`, membresía **OWNER**; lo peligroso se corta en §3.
- **Vencimiento**: **1 h sin uso** (`demoLastSeenAt`, escrito como máximo cada 2 min en `after()`) o 24 h
  desde la creación (`demoExpiresAt`), lo que llegue primero.
- **Purga perezosa** (sin cron): cada entrada a `/api/demo/session` purga hasta 5 sandboxes vencidas en
  `after()` con `FOR UPDATE SKIP LOCKED`; antes de borrar anota en `DemoSession` las acciones (desde
  `AuditLog`); luego `wipeDemoData(tx, id)`, borra los usuarios con `demoOrganizationId = id` y la empresa.
  Repetible. `scripts/demo-purge.mjs` para correrla a mano.
- **Topes** (constantes en código): 150 sandboxes activas (~300 mil filas); 4 nuevas por IP por hora (reiniciar
  cuenta); 60 creaciones en total cada 15 min.
- **Alta en dos pasos**: (1) transacción corta con `pg_advisory_xact_lock(hashtext('demo-sandbox'))` que
  cuenta las activas e inserta la empresa con `demoReady=false`; (2) seed y `demoReady=true`. Si el seed
  falla, queda para la purga y el visitante ve «No pudimos preparar tu demo, probá de nuevo».
- **Si se llena**: purga las vencidas; si sigue llena, borra la más ociosa (>30 min sin uso); si aun así no hay
  lugar → página **«La demo está llena, volvé en unos minutos»** (con link a la landing), sin acceso.

## 2. Identidad de la sesión demo
- Cookie propia `ledbox_demo` (httpOnly, Secure, Lax), solo del host demo, vence con la sandbox. En
  desarrollo la demo vive en `demo.localhost:3000`.
- `getAuthenticatedAdmin` lee `ledbox_demo` en el host demo y `ledbox_session` en los demás;
  `requireAdminContext` da 401 a una sesión de empresa `isDemo` fuera del host demo y a una sesión real dentro
  del host demo. Las dos cookies nunca se mezclan.
- Otra pestaña = misma cookie = misma sandbox. Si vuelve y la sandbox venció → nueva, con el aviso
  «Tu demo anterior venció; empezaste una nueva».
- «Reiniciar la demo» (`POST reset=1`) purga la actual, crea otra y reemplaza la cookie (doble clic
  inofensivo; lo frena el rate limit). `DELETE` purga, revoca la sesión y borra la cookie.

## 3. Bloqueos obligatorios (punto central)
`lib/server/demo-sandbox.ts`: `isSandboxOrg(orgId)` (lee `isDemo`, caché 60 s),
`salidaPermitida({ organizationId, canal, destino })` → `{ ok } | { simulado: true }`,
`cuotaArchivosOk(orgId, bytes)`; en el contexto, `context.sandbox` (escritura permitida) y `context.demo`
(vitrina de solo lectura, como hoy).
- **Correo**: `sendMail` llama a `salidaPermitida` antes de `sendThroughProvider`; en sandbox no envía y
  registra `MailLog` `skipped` «Demo: simulado» con vista previa. Ningún correo sale a destinos `*.demo`
  en ninguna empresa. Los recordatorios automáticos pasan por el mismo punto.
- **WhatsApp**: un solo helper arma los `wa.me`; en sandbox devuelve `null` y la UI muestra «Así se vería el mensaje».
- **Pagos (PagaYa #182), SIFEN, webhooks**: hoy no existen; cuando se agreguen deben pasar por `salidaPermitida` (lo exige el test).
- **Portal y firma**: `/p/:token`, `/firma/*`, comparativas y mayorista de una sandbox solo en el host demo
  (404 en otros), con franja «DEMO: no es un presupuesto real» y `noindex`. Aprobar, firmar y subir
  comprobantes funciona dentro de la sandbox; el OTP se muestra en pantalla en vez de enviarse.
- **Prohibido en sandbox** (`requireAdminContext(cap, { sandbox: "deny" })` → 403 «En la demo esto está
  desactivado»): crear API keys, invitaciones o usuarios; cambiar correo, clave, PIN o Google; cambiar slug;
  pedir cambio de plan.
- **Planes**: `planLimitViolation` → `null` en sandbox.
- **Archivos**: topes por archivo actuales + total 15 MB por sandbox (suma de `octet_length` de las columnas `Bytes`); todo se borra en cascada.
- **Test `tests/demo-salidas.test.ts`** (fuente): solo `mail/transport.ts` importa `resend`; solo
  `mail/send.ts` llama a `sendThroughProvider` y siempre después de `salidaPermitida(`; todo `fetch(` de
  `lib/server` y `app/api` está en una lista cerrada (`ruc.ts`, callback de Google); `wa.me` en un solo
  helper; las rutas prohibidas pasan `sandbox: "deny"`; toda ruta que escribe `Bytes` llama a `cuotaArchivosOk(`.

## 4. Superadmin y métricas
- `lib/platform/sin-demo.ts` filtra `"isDemo" = false` (no `slug = 'demo'`); `usuarioReal` exige una empresa `isDemo = false`.
- `trackAdminActivity` recibe `demo: true` también en sandboxes.
- `resolveDefaultOrganizationId`, sitemap y catálogo/tienda pública por slug excluyen `isDemo`.
- Tráfico → Demo (`getDemo`): sandboxes creadas por día y activas ahora, reinicios, % con al menos una
  escritura, acciones promedio y entidades más tocadas (vivas desde `AuditLog`, purgadas desde `DemoSession`).

## 5. Seguridad multiempresa
Toda consulta ya filtra por `organizationId`. Únicos globales: `slug = demo-<ns>`, ids `sbx_<ns>_*`, tokens al
azar, correos `+<ns>`. Únicos por empresa (SKU, numeración, períodos, plantillas) no chocan. Phishing con
presupuestos falsos: mitigado con host demo, franja visible y borrado a la hora sin uso.

## 6. Migración `202610190001_demo_sandbox` (aditiva, `IF NOT EXISTS`; verificar número mayor que el último)
- `Organization`: `isDemo BOOLEAN NOT NULL DEFAULT false`, `demoParentId TEXT NULL`, `demoExpiresAt`,
  `demoLastSeenAt` (TIMESTAMP(3) NULL), `demoReady BOOLEAN NOT NULL DEFAULT true`, índice `(isDemo, demoExpiresAt)`;
  `UPDATE "Organization" SET "isDemo" = true WHERE slug = 'demo' AND NOT "isDemo"`.
- `AdminUser.demoOrganizationId TEXT NULL` con índice.
- `DemoSession`: `sandboxOrgId TEXT NULL`, `actions INT NOT NULL DEFAULT 0`, `actionsByEntity JSONB NULL`, `resets INT NOT NULL DEFAULT 0`.

## 7. Etapas (cada una publicable sola)
- **E0 (ledbox-infra)**: migración, `isDemo` en sin-demo/tenancy/vistas públicas, seed con `ns`. Después de
  integrar `agent/demo-completa`. Sin cambios visibles.
- **E1 (ledbox-pay + ledbox-crm)**: `demo-sandbox.ts`, `salidaPermitida` en correo y WhatsApp,
  `sandbox: "deny"`, cuota de archivos, planes sin tope, test de salidas. Nada cambia hasta E2.
- **E2 (ledbox-infra)**: crear/purgar sandboxes, cookie `ledbox_demo` con separación por host, topes, rate
  limit, página «volvé en unos minutos», `/api/demo/session`, `DemoSession.sandboxOrgId`. Acá se habilita la escritura.
- **E3 (ledbox-ui)**: franja «Demo: tus cambios se borran si no la usás por 1 hora» con Reiniciar, avisos
  (vencida, llena, simulado), vista previa de correo y WhatsApp, OTP en pantalla, franja en el portal.
- **E4 (ledbox-ui)**: métricas de sandboxes en Tráfico → Demo.

## 8. Criterios de QA
E0: 1. La migración corre dos veces y `org_demo` queda `isDemo = true`. 2. Una empresa `isDemo = true` con otro
slug no cuenta en KPIs ni usuarios reales (pg). 3. `seedDemoData` con dos `ns` en la misma base: ambos completan
`DATASET_MINS` sin choques de únicos (pg). 4. Seed de sandbox p95 < 2,5 s en 10 corridas (pg local, tiempo en el
reporte). 5. Sin `ns`, la vitrina queda idéntica (mismos ids).
E1: 6. En sandbox, enviar presupuesto, recordatorio, correo de prueba y OTP de firma: 0 llamadas al mock
`RESEND_BASE_URL` y un `MailLog` `skipped` «Demo: simulado» por cada uno (pg). 7. En empresa real se envía igual;
un destino `*.demo` nunca sale. 8. Un `fetch(` o import de `resend` nuevo hace fallar `demo-salidas.test.ts`.
9. API keys, invitaciones, alta de usuarios, cambio de correo/clave/PIN, Google, slug y plan → 403 en sandbox.
10. Sandbox sin `plan_limit`; pasar 15 MB → 413; identidad de 1,1 MB sigue con el error actual.
E2: 11. Dos navegadores → dos sandboxes; lo de A no aparece en B (eventos, reservas, búsqueda, notificaciones)
ni en `org_demo`. 12. Cookie demo en app. → 401; cookie real en demo. → 401. 13. Otra pestaña = misma sandbox;
con `demoLastSeenAt` de hace más de 1 h, la entrada crea una nueva con aviso. 14. Reiniciar deja en 0 las filas
`sbx_<ns>_*`, usuarios y archivos de la anterior (pg). 15. Con 150 activas no ociosas, la 151 ve «volvé en unos
minutos»; la 5.ª creación por IP en una hora → 429. 16. 20 entradas simultáneas: ninguna queda `demoReady=false`
sin purgar y nunca se pasa el tope (pg). 17. La purga corre dos veces y guarda `DemoSession.actions` antes de
borrar. 18. Portal y firma de sandbox: 404 en clientes.; en demo. se aprueba y firma con la franja visible.
E3/E4: 19. La franja y Reiniciar (con `AdminConfirmDialog`) a 390 y 1280 px. 20. Tráfico → Demo muestra
creadas, activas, reinicios y acciones; ninguna sandbox cuenta como empresa real. 21. build, typecheck,
test:rules, check:fields, check:contexto, prisma validate y pg en verde.

## 9. Riesgos y vuelta atrás
Crecimiento de la base (tope 150; `scripts/demo-purge.mjs`); una salida nueva sin bloqueo (test de salidas);
choque con `agent/demo-completa` (E0 va después). Vuelta atrás: `DEMO_SANDBOX_ENABLED = false` vuelve a la
vitrina de solo lectura; migración aditiva; las sandboxes que queden se purgan solas.
