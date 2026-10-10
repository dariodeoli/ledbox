# Automatización scoped #173

Este ciclo reemplaza la automatización general de LedBox por la autorización
limitada a **#173**. Implementación en `scripts/automation-*.mjs`; los entrypoints
`orquestador.mjs` y `deploy.mjs` comparten el mismo ciclo. La entrega del código
no activa el watcher ni publica una versión.

## Comandos y guardas

| Comando | Contrato |
| --- | --- |
| `npm run pp` | GET de health/superficies, versión/SHA local y remoto, candidato pendiente, issue #173, pendientes del dueño referidos a #173 y slots autorizados. |
| `npm run pd` | Commits funcionales pendientes: SHA, tipo, asunto y patch-id; conteo deduplicado, ramas propuestas y excluidas. |
| `npm run al` | Roles, ramas actuales, worktrees y cambios sin commit de los cuatro slots; consulta sólo issue #173. No despacha trabajo. |
| `node scripts/orquestador.mjs prepare` | Integración autorizada + checks + candidato `READY`; nunca versiona, pushea ni dispara Hub. |
| `node scripts/orquestador.mjs --prepare` | Alias de `prepare`. También `ht --prepare`, `hd --prepare` y `node scripts/deploy.mjs --prepare`. |
| `node scripts/orquestador.mjs reject` | Archiva un READY rechazado por Pilot FAIL exacto, sólo sin release/publicación; no construye ni publica. |
| `npm run ht` / `npm run hd` / `npm run deploy:patch` | Produce `READY` si no hay candidato; en la siguiente ejecución exige gate independiente antes de publicar. |
| `npm run auto-hd` | Umbral10 nuevos funcionales únicos #173 desde último SHA servido acreditado; cooldown600s. Sin baseline: AUTO_WAITING_SERVED_BASELINE. |
| `npm run watch-hd` / `-- --interval 20` | Singleton; auto cada20min. Sólo20 autorizado. Requiere primer HD servido acreditado, Pilot final y sin pending al inicio; no activa gates. |
| `node scripts/orquestador.mjs ht --dry-run` | Sólo inventario Git local. No mergea, construye, activa ni publica. |

Los diagnósticos no necesitan habilitación. `pp` hace GET con `redirect:manual`,
sin cookies ni sesión demo; un 3xx queda visible como no saludable. `pp`/`al`
usan `gh issue view 173`; si no está disponible lo informan, sin buscar backlog.
Las referencias Git usadas son locales; actualizar con `git fetch origin --prune`
cuando corresponda. Los ciclos hacen su propio fetch antes de integrar/publicar.

Todos los ciclos, incluidos `prepare` y `reject`, exigen checkout principal limpio del
integrador (`~/Documents/GitHub/ledbox`), rama
`codex/ledbox-gestion-multiempresa` y ausencia de merge en curso. Un carril no
puede preparar ni publicar. No existen flags `--no-trigger`/`--prepared` para
eludir gates. `package.json` y `package-lock.json` se modifican únicamente en
el commit de metadata de una release aprobada, desde el integrador.

## Autorización y conteo

- Allowlist única: `slot/panel`, `slot/operacion`, `slot/finanzas`, `slot/plataforma`.
- Toda historia no-merge que se importe debe llevar `Refs #173` en el asunto.
  Una rama con commits fuera de scope queda excluida completa, sin cherry-picks
  automáticos. Ahead local ajeno a #173 bloquea el ciclo.
- Unión de ahead local y ramas allowlist pendientes, primero por SHA y luego
  por `git patch-id --stable` de su diff funcional. Patches ya presentes en la
   base de conteo tampoco cuentan. AUTO usa último servido acreditado, manual usa
   remoto actual; la base CAS de publicación siempre es el remoto actual. Tips ancestros de `HEAD` no se proponen para merge;
  sus commits ahead siguen contando.
- Merges, documentación, tests y cambios exclusivamente en package/lock no
  suman. Código de app/UI/API/Prisma/scripts/assets/config runtime sí suma;
  un commit con código UI y dependencias cuenta por su código, una sola vez.
- Sin diff funcional neto contra la base de conteo no hay release. El umbral auto
  es **10**; el cooldown entre intentos nuevos es **600 segundos**. Un candidato
  pendiente se retoma por su SHA, sin iniciar otra ronda ni volver a versionar.
- AUTO cuenta también cambios admitidos ya pusheados pero aún no servidos;
  importados históricos ajenos se excluyen, nuevo ahead/carril ajeno bloquea.
  Sin recibo servedtrue/huella Hub finished/recurso/SHA exacto y ancestro local,
  no se fabrica baseline (ni origin ni e0 con healthSHA null). HD manual puede
  establecerlo; al cerrar SERVED guarda lastServedSHA exacto y autoPolicy.
  Detalle del conteo/params y actualización de SOURCE flag acreditado por Secretaría
  en `docs/DELTA-DEPLOY-UNIFORME-LEDBOX.md`; preflight GET fresco sigue obligatorio.
- Conflictos abortan sólo el merge actual y conservan los merges anteriores.
  Fallos de checks conservan la historia para resolución manual; nunca reset hard,
  rebase/force, espejo de `main` o recuperación de históricos.

## Pausa y habilitación

La barrera `~/.herdr/worktrees/ledbox/orquestador/.operacion-pausada` se conserva
íntegra. El script no la elimina. Sólo este ciclo admite la excepción scoped:

```json
{"enabled": true, "scope": "#173"}
```

Archivo: `~/.config/ledbox/auto-hd-enabled.json`. **Sólo el integrador lo escribe
tras los gates y autorización operativa**. No habilita otros watchers ni la cola
global. `prepare` puede generar un candidato local con la barrera y sin ese
archivo; `reject` tampoco lo exige y conserva la pausa. `ht/hd/auto/watch/deploy`
lo exigen. Se relee antes de cada push/POST;
eliminarlo o poner `enabled:false` bloquea la próxima acción de publicación.

Locks separados de ciclo y watcher: creación atómica `fs.open(...,"wx")`, PID,
hostname y token del dueño. Un PID vivo bloquea; uno muerto del host local se
recupera bajo mutex `.reclaim`. Dueño corrupto, otro host o reclaim huérfano
requieren inspección manual. SIGINT/SIGTERM paran el watcher y los subprocesos
del ciclo, liberando sólo locks propios. No borrar un lock de PID vivo.

## Candidato, checks y Pilot

El ciclo ejecuta, con `DATABASE_URL=''` y las tres variables SHA fijadas al HEAD
real (`SOURCE_COMMIT`, `GITHUB_SHA`, `LEDBOX_BUILD_SHA`):

1. `npm ci`
2. `npx prisma generate`
3. `npm run typecheck`
4. `npm run test:rules`
5. `node --test tests/automation.test.mjs`
6. `npm run build`

La suite `.mjs` se ejecuta explícitamente y su label de evidencia es
`test:automation`. Desde la base integrada `b582d0e`, el integrador también la
añadió a `test:rules` mediante `npm run test:automation`; no está en el glob
`.test.ts`. El ciclo conserva su invocación directa y evidencia propia.

Se verifica HEAD limpio después de cada check y el standalone real: versión,
SHA inyectado en `server.js` y manifest SHA-256 de todos sus archivos. Symlinks
sin sellar bloquean. Se guardan logs y `checks.json` por SHA fuera del repo.
`qa-candidate.json` anuncia `READY`; el ciclo **se detiene** y jamás fabrica una
aprobación de Pilot. Repetir prepare con ese candidato no reconstruye durante QA.

El integrador referencia el informe independiente de `lbx-pilot` en
`~/.config/ledbox/qa-approved.json`:

```json
{
  "schema": 1,
  "issue": 173,
  "approvedCandidateSHA": "<SHA completo de 40 caracteres>",
  "pilot": {
    "role": "lbx-pilot", "status": "PASS", "sha": "<mismo SHA>",
    "evidence": {"path": "<informe JSON independiente>", "sha256": "<hash del archivo>"}
  },
  "checks": {
    "status": "PASS", "sha": "<mismo SHA>",
    "evidence": {"path": "<checks.json emitido>", "sha256": "<hash del archivo>"},
    "artifact": {"sha": "<mismo SHA>", "version": "<versión candidata>", "manifestSha256": "<sello emitido>"}
  }
}
```

El informe Pilot JSON debe tener `role:"lbx-pilot"`, `status:"PASS"`, `sha` exacto.
No puede ser el mismo archivo real de checks, ni una evidencia alterada. Checks
debe acreditar PASS de los seis comandos y el artefacto emitido. Estos archivos
son una frontera de confianza local administrada por integrador/Pilot, no una
firma criptográfica de identidad. No rellenarlos con evidencia simulada.

Si cambió código (incluida validación FIN o estos scripts), el candidato final
necesita checks y **QA retarget de Pilot al nuevo SHA**. No reutilizar el PASS de
un candidato anterior. Para sustituir un READY que falló, usar el contrato
`reject` de abajo y luego `prepare` sobre el HEAD final limpio; no editar un
pending para hacer coincidir un PASS viejo.

### Rechazo canónico de READY por FAIL de Pilot

El integrador referencia evidencia real de Pilot en
`~/.config/ledbox/qa-rejected.json` (config `rejectedGate`):

```json
{
  "schema": 1,
  "issue": 173,
  "rejectedCandidateSHA": "<SHA completo del pending>",
  "pilot": {
    "role": "lbx-pilot", "status": "FAIL", "sha": "<mismo SHA>",
    "evidence": {"path": "<informe JSON Pilot>", "sha256": "<SHA-256 del archivo>"}
  }
}
```

Informe JSON mínimo: `{"role":"lbx-pilot","status":"FAIL","sha":"<mismo SHA>"}`;
puede incluir `findings`/rutas de pruebas. No puede ser el informe de checks ni
evidencia inventada. El comando valida SHA/issue/role/FAIL/hash, relee gate y
evidencia antes de invalidar, y usa el mismo lock exclusivo de ciclo.

`node scripts/orquestador.mjs reject` sólo acepta pending sin releaseSHA,
versión de release, push, intención/aceptación de trigger ni servido. También
bloquea registros deployments del candidato, metadata release commiteada antes
de persistir y candidatos que el fetch muestra publicados en la rama viva.
No hace push, POST, build, aprobación ni cambio de Git; sí un fetch de lectura
para verificar que el candidato no fue publicado.

Archiva pending completo, gate/FAIL/evidencia y HEAD en
`auto-hd-artifacts/<SHA>/rejection.json`; registra el SHA en
`state.rejectedCandidates`, marca `qa-candidate.json` REJECTED y deja pending
vacío. Evidencias previas y gates no se borran. Mientras ese FAIL existe, no
se acepta PASS del mismo SHA ni se recupera un fix como commit de release.

Después se integra el fix autorizado y se ejecuta `prepare` (también se admite
`reject` desde un HEAD descendiente que ya contiene ese fix). El mismo SHA
rechazado no se reconstruye ni se reaprueba; el HEAD nuevo debe pasar scope,
checks y Pilot independiente. No se usa `assertReleaseOnly` para legitimar
código después de FAIL. Rechazo no autoriza migrar la base que Pilot está
usando: para A15 b582, conservar PG55473/DB45 durante QA y probar la migración
sortOrder sólo en PostgreSQL aislado hasta orden de consumo del integrador.

Si la rama viva recibió externamente el candidato, `reject` también bloquea
aunque el pending local siga READY y no se vea deployment/health de ese SHA.
No hay override para borrar ese historial publicado: conservar estado y
coordinar con el dueño antes de otra acción operativa. La entrega de este
comando no ejecuta rechazo sobre el pending real ni autoriza tocar la rama viva.

### Supersesión explícita de READY fallido publicado manualmente

Tras atribución del dueño a GitHub Desktop y autorización de fixes hacia adelante,
el integrador puede ejecutar `node scripts/orquestador.mjs supersede-published-failed-ready`.
No es un override de `reject`: exige el FAIL independiente anterior y un ACK local
en `~/.config/ledbox/manual-push-ack.json` (`manualPushAckFile`):

```json
{
  "schema": 1,
  "issue": 173,
  "sha": "<SHA completo exacto del pending READY fallido>",
  "attribution": "owner:GitHub Desktop",
  "allowForwardFixes": true
}
```

El HEAD debe estar limpio, ser descendiente y contener un nuevo diff funcional
autorizado #173. Dos fetch comprueban que la rama viva remota sigue exactamente en
el SHA del ACK. Un GET autenticado Hub debe confirmar que no hay deployment para
ese SHA; errores o resultados inciertos bloquean. No se permite release/push/trigger
registrado en el ciclo, metadata de release commiteada ni replay de un SHA rechazado.
FAIL, bytes de evidencia y ACK se releen tras el GET para detectar cambios concurrentes.
El ACK no tiene TTL: su vigencia está acotada por el SHA remoto/pending exacto,
descendencia, diff funcional y relectura de su hash.

Se archiva pending completo, FAIL y ACK con sus hashes en
`auto-hd-artifacts/<SHA>/supersession.json`, se registra el SHA rechazado, se vacía
pending y se marca el candidato `SUPERSEDED_PUBLISHED_FAILED_READY`. No se borra
historial Git/remoto/deployments ni se hace rollback, reset, push, POST, build o PASS.
Un `prepare` separado emite un READY nuevo tras checks; necesita Pilot independiente
del SHA nuevo y mantiene la barrera SOURCE_COMMIT para cualquier publicación.
La entrega del comando no lo ejecuta sobre el estado operativo real.

## Release y Hub

Tras PASS exacto, el preflight autenticado GET comprueba el detalle de
`/api/v1/applications/shgn0g8bfuitauifyf69noeq`, UUID, rama viva y repo. Acepta
`dariodeoli/ledbox` como canónico o el alias histórico `OwnCoding/ledbox`, cotejado por el
integrador con GitHub repo ID **1312274819**. Hub 4.4.6 devuelve flags sólo en
`app.settings`: ambos deben ser booleanos y `include_source_commit_in_build`
debe ser **true**. La lista de aplicaciones no es fuente de esos flags.

Con el flag false falta un anclaje remoto verificable: **se bloquea antes de
crear metadata/publicar**. El script no hace PATCH ni infiere un SOURCE_COMMIT
heredado. La habilitación del flag corresponde al dueño/integrador por su canal
autorizado. El estado auditado durante implementación era false.

### Transferencia de repositorios — 2026-10-09

El canónico vuelve de OwnCoding a **dariodeoli**; origin principal es
`https://github.com/dariodeoli/ledbox.git`. El integrador valida vía API la
identidad persistente `1312274819`; el alias `OwnCoding/ledbox` sólo se acepta
con ese ID cotejado en configuración. Este script no deduce identidad por redirects.

La dependencia `owncoding-ui` también cambia de propietario a `dariodeoli`,
conservando **el mismo SHA completo** `9dc9ec44216d22e92fad72fc1ad08bf3296a8da2`; no se actualiza
el código del kit. PANEL es dueño de package.json/package-lock.json para esa
migración. Plataforma entrega este ajuste local commiteado, sin push ni cambios
de package/lock, CI o Docker. Después de integrar PANEL, el integrador añade
su script de testautomation. El gate final queda bloqueado hasta los checks y
QA del SHA integrado; la barrera SOURCE_COMMIT sigue vigente.

Luego crea un único commit hijo del candidato, `chore(release): vX.Y.Z (Refs #173)`:
sólo versiones de package/lock y `docs/NOVEDADES.md`. Rechaza cambios de código
o dependencias posteriores al PASS. Repite checks/build en el SHA de release y
sella ese artefacto. Revalida gate, sello, destino Hub y base remota antes de push.
Un remoto distinto de la base aprobada/release bloquea sin force ni rebase.

`deploy.env` se relee por request para el trigger privado LedBox. El token se
relee del archivo común0600 `~/.config/herdr-deploy/coolify-token`; `tokenFile`
o `LEDBOX_HUB_TOKEN_FILE` configura la ruta. No se usa el bearer antiguo de env
como fallback a archivo ausente. Contrato y receptor GitHub preparado en
`docs/DELTA-DEPLOY-UNIFORME-LEDBOX.md`.
No registra tokens ni bodies Hub. Requiere HTTPS, webhook `/api/v1/deploy` con
UUID exacto y sin `force=true`. Tras push, consulta
`/api/v1/deployments/applications/<uuid>` (envelope `count/deployments`) buscando
SHA completo; espera autodeploy y hace un último GET antes del eventual POST.
Cualquier deployment existente de ese SHA, incluso fallido, evita otro POST.

Persiste intención antes del POST. Crash/timeout ambiguo implica retries **sólo
GET/smoke**, sin POST duplicado ni bump adicional. `triggerAccepted` no significa
servido. No hay test trigger, E2E mutante de producción ni espejo de main.

## Smoke y recuperación

`node scripts/verify-release.mjs <versión> <SHA completo>` hace GET autenticado
del recurso y sus deployments, más health y superficies de los cinco hosts, sin
seguir redirects. Exige recurso/application_id/deployment_uuid/commit40 exactos,
status finished, finished_at válido y rollback false; además health/version/SHA
exactos, base disponible y páginas HTTP200; un redirect no es éxito. Sólo ese
PASS marca `served` y cierra el pending. Timeout deja el mismo SHA pendiente.
Failed/cancelled/rollback devuelve `DEPLOYMENT_FAILED_GET_ONLY`, mantiene pending
y evidencia saneada `hub-deployment.json`, sin retry POST automático.

Estado: `~/.config/ledbox/auto-hd-scoped.json`, registros `deployments[SHA]` con
`pushed`, `triggerIntent`, `triggerAccepted`, `served`, checks y sello. Logs,
locks, gate y evidencia están en `~/.config/ledbox/`; rutas en
`scripts/orquestador.config.json`.

- READY sin gate: ejecutar QA independiente, completar gate; no reconstruir
  mientras Pilot esté verificando ese candidato.
- READY con Pilot FAIL: completar qa-rejected.json, ejecutar reject y preparar
  un nuevo SHA autorizado; no archivar/editar state manualmente.
- Build de release fallido: corregir el entorno y retomar el mismo release SHA;
  si cambia código, detener y coordinar candidato/Pilot nuevo.
- Crash tras commit metadata: se recupera sólo un hijo con diff de release permitido.
- Artefacto alterado: bloquea. Restaurar/reconstruir y verificar exactamente la
  misma manifest aprobada; no cambiar el sello a mano.
- Push ocurrido antes de persistencia: remoto igual al release permite retomar.
- POST incierto: GET deployments y smoke del mismo SHA; no reenviar trigger.
- Smoke pendiente: repetir el comando del ciclo; sólo GET, sin bump/push/POST.

## Verificación de entrega

```bash
node --test tests/automation.test.mjs
npm run typecheck
npm run test:rules
DATABASE_URL='' npm run build
```

Los tests usan repos Git/bare temporales y transportes falsos sin red real.
Cubren scope, union/dedup, tips integrados, nodiff, cooldown, locks wx/PID muerto,
dos procesos watcher/SIGTERM, guardas CLI/enable, Pilot independiente, artefactos
alterados, build fallido/retry, autodeploy y POST incierto. Activación y deploy
son pasos posteriores del integrador; no forman parte de la entrega del carril.
