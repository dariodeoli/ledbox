# Delta LedBox — estándar Secretaría 2026-10-09 / #173

Fuente: `secretaria/ESTANDAR-DEPLOY-20261009.md` y su actualización de acceso
común/revisión GitHub del dueño. Reutiliza issue173, candidato y ciclo existentes.
Adaptación local: no nueva ronda, release ni bump; el nuevo código sí exige una
preparación final justificada del SHA integrado y Pilot independiente exacto.
El prepare del root `dfeb192` en curso se deja terminar sin editar su checkout.

## Contrato implementado

- `release:check` → `node scripts/orquestador.mjs prepare`.
- `release:publish` → `node scripts/orquestador.mjs hd`.
- `deploy:verificar -- <versión> <SHA40>` → `scripts/verify-release.mjs` existente.
- Token runtime común por defecto `~/.config/herdr-deploy/coolify-token`, archivo
  regular0600. Config `tokenFile` o `LEDBOX_HUB_TOKEN_FILE` permite ruta privada
  distinta (env/provisión privada tiene precedencia). Se relee en cada request;
  archivo ausente, permisos amplios, vacío o multiline bloquean. No se imprime.
  El antiguo `LEDBOX_HUB_API_TOKEN` no sustituye un tokenFile ausente.
- `~/.config/ledbox/deploy.env` conserva exclusivamente la configuración privada
  del trigger LedBox `LEDBOX_DEPLOY_WEBHOOK_URL`; no se cambia UUID, rama, keys ni
  bindings de fuentes y no se consulta otra app.
- Push de SHA final → GitHub → espera autodeploy → GET SHA40 antes de fallback.
  Cualquier ejecución de **ese SHA**, incluso fallida, impide otro POST automático.
  Intención persistida antes del único POST; timeout ambiguo reanuda sólo GET.
- Verificación conjunta: recurso, ID de aplicación, deployment UUID, commit40,
  `status:"finished"`, `finished_at` válido y `rollback:false`, más versión/SHA
  exactos, DB/migraciones y página200 en los cinco hosts LedBox existentes.
  HTTP200/health correcto no sustituyen la prueba terminal del Hub.
- `hub-deployment.json` por SHA conserva sólo campos saneados de identificación/
  estado; su hash y hubStatus quedan en el estado del ciclo. No se guardan logs,
  snapshots de configuración ni valores de credenciales devueltos por Hub.
- Failed/cancelled/rollback → `DEPLOYMENT_FAILED_GET_ONLY`: mantiene pending,
  diagnostica el mismo deployment con GET y no repite bump/POST. Retry deliberado
  requiere autorización/registro del integrador; no se añadió comando de bypass.
  Finished sin fecha o sin rollback explícito queda pendiente, nunca SERVED.

## Modelo y límites de evidencia

Contrato de ApplicationDeploymentQueue de Coolify v4.x: `application_id`,
`deployment_uuid`, `commit`, `status`, `finished_at`, `rollback`. Se coteja
application_id contra `id` del detalle de aplicación validado por UUID/repo/rama;
el endpoint de lista queda scoped a esa aplicación. No se usan nombres, prefijos
SHA, `updated_at` como finished_at ni versiones/horarios como prueba de ejecución.

Referencias públicas consultadas (no consultas al Hub/base):

- https://github.com/coollabsio/coolify/blob/v4.x/app/Models/ApplicationDeploymentQueue.php
- https://github.com/coollabsio/coolify/blob/v4.x/routes/webhooks.php
- https://github.com/coollabsio/coolify/blob/v4.x/app/Http/Controllers/Webhook/Github.php

El audit local anterior registra status finished/finishedAt y UUID; no acredita
el campo rollback. Estas fixtures reproducen el modelo público, no certifican
que todos los campos estén disponibles en la versión instalada. El gate falla
cerrado si falta algún campo. Cotejo de versión/schema instalado y bindings por
canal autorizado del integrador sigue pendiente; no se hicieron probes nuevos.

## Accesos disponibles y pendientes concretos

Disponibles por Secretaría/dueño: token común0600, GET detalle/deployments200 del
recurso LedBox; permiso read+deploy visto en UI, trigger no probado. Administración
GitHub de dariodeoli/ledbox disponible por login del dueño. Nada de esto implica
permiso de escribir configuración del Hub.

Pendientes: receptor exacto/binding/HMAC privado y recepción acreditada (runbook
abajo). Actualización explícita del dueño: Secretaría695019832 acredita para el
UUID LedBox `include_source_commit_in_build:true` y auto-deploy true. El gate
conserva su GET fresco y no reutiliza ese acuse como evidencia de un deploy.
No se hace PATCH ni se infiere que
flagfalse excluya cualquier otra vía de SHA. Se mantienen gates, pausa y auto
deshabilitado; el token común no los habilita.

Nueva orden explícita del dueño: **autorizado** watcher20min / umbral10 nuevos
funcionales únicos admitidos #173 / cooldown600s. Config actual1200000ms/10min;
reemplaza la cadencia anterior. Mantiene hold global y exige habilitación scoped,
Pilot final fresco y primer HD servido acreditado antes de iniciar el watcher.
No se inicia watcher ni se escribe enable desde PLATAFORMA.

El conteo AUTO nace de `state.lastServedSHA`, respaldado por un recibo
`deployments[SHA].served:true`, releaseSHA exacto y prueba Hub finished/hash/recurso;
sin lastServedSHA se acepta un recibo servido acreditado equivalente. La huella
de su archivo y el modelo terminal se revalidan y el SHA debe ser ancestro local.
No se fabrica baseline desde origin, e0 histórico o health sin SHA. Sin prueba,
`AUTO_WAITING_SERVED_BASELINE` no hace checks, bump ni POST. HD manual/READY sigue
su protocolo y, al cerrar SERVED, registra lastServedSHA exacto, servedAt y recibo.

Inventory separa `countBaseSHA` (servido) de `remoteBaseSHA` (fetch actual/CAS):
cuenta patch-id funcional único posterior al servido, incluso push manual ya
remoto si aún no está servido; docs/deps/tests/merges/patches históricos y ajenos
no aportan count. Historia importada remota ajena queda excluida, nuevo ahead o
carril ajeno #173 sigue bloqueado. Pending conserva baseSHA remota para publicar
sin reescribir historia. READY/retries exactos no se reconstruyen para contar.

Al servir se persiste `autoPolicy`: issue173, threshold10, watchIntervalMs1200000,
cooldownMs600000 y countBaseSHA=releaseSHA servido. Logs canónicos registran PID,
baseline/params/bloqueo; watcher/cycle conservan locks exclusivos existentes,
SIGTERM y pausas, sin vigía duplicado. El diagnóstico read-only muestra count
AUTO null cuando falta baseline, aunque pueda mostrar inventory manual separado.

## Preparación del receptor GitHub existente en Hub

Identidad exacta:

- aplicación `shgn0g8bfuitauifyf69noeq`;
- repo `dariodeoli/ledbox`, ID1312274819;
- rama `codex/ledbox-gestion-multiempresa`;
- push `ref: refs/heads/codex/ledbox-gestion-multiempresa`, `after: <SHA40 final>`;
- fuente actual Public GitHub/source_id0 según detalle saneado de Secretaría.

El dueño informa que no vio webhook de repo ni App Coolify en instalaciones.
No es una auditoría nueva ni una prueba de ausencia de instalaciones externas.
Con la fuente pública actual, preparar el **manual webhook de la aplicación**,
sin migrar a otra App/source/key por este delta. Coolify v4.x registra receptor
manual `/webhooks/source/github/events/manual`; el controlador valida
`X-Hub-Signature-256` con HMAC-SHA256 del cuerpo crudo y
`manual_webhook_secret_github` del recurso, coteja repo/rama y encola con el
commit `after`/is_webhook. El receptor normal de GitHub App usa binding/source
de esa App, distinto del manual para fuente pública.

Procedimiento preparado para dueño/integrador bajo autorización específica:

1. Abrir **esa aplicación** en Hub y su configuración Webhooks; confirmar versión
   instalada y copiar la URL manual exacta que muestra el recurso. Cotejar origen
   HTTPS del Hub con la configuración privada existente. La ruta pública anterior
   es referencia: no inventar ni imprimir una URL absoluta privada ni dar por
   verificado el receptor instalado. Si no aparece, obtener configuración/rutas
   del Hub por su canal autorizado, sin probar POST ni crear endpoints LedBox.
2. Cotejar que el binding corresponde a repo/rama/UUID anteriores, auto-deploy y
   watch paths admiten el código #173. Conservar keys/source existentes. Obtener
   o provisionar el HMAC de **ese recurso** en almacenamiento privado fuera de
   repo/chat, distinto del bearer común; no volcar secretos en evidence/logs.
3. Sólo con autorización de setup, el administrador del repo configura webhook
   con esa URL exacta, `application/json`, **push** y el mismo secret privado,
   HTTPS/SSL verificado. Esta entrega no crea webhook remoto ni lo redelivera.
   `/api/v1/deploy?uuid=...` bearer es fallback API, nunca receptor GitHub firmado.
4. Acreditar recepción en el siguiente push de publicación ya autorizado: delivery
   ID/event/ref/after sin secretos, binding al UUID, deployment_uuid/commit40/
   is_webhook. Una respuesta2xx/ping/queued sólo confirma recepción/cola: cierre
   requiere finished/finished_at/no rollback, cinco hosts SHA/version exactos y
   Pilot. No push, POST o redelivery de diagnóstico para probar este runbook.

Faltan URL exacta instalada obtenida del binding autorizado, HMAC privado común a
recurso/webhook y recibo real de recepción. Administración repo ya disponible;
no volver a pedirla. No se opera otra app ni se añade un endpoint receptor a LedBox.
