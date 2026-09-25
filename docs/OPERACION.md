# Operación — respaldos, estado del sistema y alertas (issue #43)

Cómo se respalda la base de EventOS, cómo se verifica que el respaldo esté al día y cómo se
restaura. El estado real se ve en el panel (OWNER/ADMIN) en **`/sistema`**.

## 1. Respaldo (`scripts/backup.mjs`)

Corre con Node (sin dependencias nuevas) y usa `pg_dump` del sistema:

```bash
# En el servidor, con DATABASE_URL en el entorno:
node scripts/backup.mjs
```

Qué hace, en orden:

1. `pg_dump --no-owner --no-privileges --format=plain` de `DATABASE_URL` (la contraseña viaja por
   entorno del proceso hijo, nunca por la línea de comandos ni por el estado).
2. Comprime a gzip en `<BACKUP_DIR>/<prefijo>-YYYYMMDD-HHMMSS.sql.gz` (hora de Asunción).
3. **Verifica** el archivo recién escrito: lo descomprime de punta a punta y exige el marcador de
   cierre de `pg_dump` (`PostgreSQL database dump complete`, que solo aparece en un dump completo).
   Guarda las tablas contadas y el tamaño descomprimido. Un archivo truncado falla la corrida.
4. Aplica la **retención** (borra lo más viejo que `BACKUP_RETENTION_DAYS`, sin bajar nunca de
   `BACKUP_MIN_KEEP` archivos).
5. Escribe el **log** (`backup.log`) y el **estado** (`backup-state.json`), que es lo que lee el panel.

Variables de entorno (todas opcionales salvo `DATABASE_URL`):

| Variable | Default | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | — | Base a respaldar (obligatoria) |
| `BACKUP_DIR` | `./backups` | Directorio de respaldos |
| `BACKUP_STATE_FILE` | `<BACKUP_DIR>/backup-state.json` | Estado que lee el panel |
| `BACKUP_LOG` | `<BACKUP_DIR>/backup.log` | Log de corridas |
| `BACKUP_FILE_PREFIX` | `ledbox` | Prefijo del archivo |
| `BACKUP_MAX_AGE_HOURS` | `26` | Umbral de respaldo vencido (lo comparten el script y el panel) |
| `BACKUP_RETENTION_DAYS` | `30` | Días de retención |
| `BACKUP_MIN_KEEP` | `7` | Respaldos que nunca se borran |
| `BACKUP_HISTORY` | `20` | Corridas que guarda el estado |
| `BACKUP_VERIFY` | activa | `0` desactiva la verificación del dump |
| `PG_DUMP_BIN` | automático | Binario de `pg_dump`; si no está, el más nuevo de `/usr/lib/postgresql/<N>/bin` (y si no, el del PATH) |

En el deploy de Coolify conviene fijar `BACKUP_DIR` a un volumen persistente (por ejemplo
`/data/backups`) y usar el mismo valor en el entorno de la app, que es la que lee el estado.

### Programación en producción (Coolify)

En producción no hay cron del sistema: son **dos tareas programadas de Coolify** sobre la
aplicación `ledbox:main`. La configuración vive fuera del repo y es esta:

| Tarea | Frecuencia | Comando |
| --- | --- | --- |
| `EventOS backup diario` | `0 3 * * *` | `cd /app && BACKUP_DIR=/data/backups node scripts/backup.mjs >> /data/backups/cron.log 2>&1` |
| `EventOS backup check` | `15 */6 * * *` | `cd /app && BACKUP_DIR=/data/backups node scripts/backup.mjs --check >> /data/backups/check.log 2>&1` |

Notas de la configuración (aprendidas en el incidente del 24-09-2026, ver §7):

- **`Container` va vacío** en las dos tareas: la tarea corre en el contenedor que esté
  vivo. Si se fija el nombre, Coolify v4.3.23 **no lo actualiza al desplegar** y la tarea
  queda apuntando a un contenedor muerto (con un solo contenedor corriendo igual funciona,
  por eso falla solo a veces).
- `BACKUP_DIR=/data/backups` en la tarea y en el entorno de la app (el panel lee el estado
  del mismo directorio).
- Las 03:00 son del **servidor (UTC)**: en Paraguay la corrida diaria cae a las 00:00.
- El `pg_dump` del contenedor lo instala el **hook de deploy**
  (`post_deployment_command: sh /app/scripts/install-pgdump.sh`), no la imagen base.

Fuera de Coolify (cron del sistema) es el equivalente, ajustando la hora del servidor:

```cron
# Respaldo diario a las 03:00 (hora del servidor)
0 3 * * * cd /app && BACKUP_DIR=/data/backups DATABASE_URL="postgresql://…" node scripts/backup.mjs >> /data/backups/cron.log 2>&1

# Chequeo cada 6 h: falla (exit 1) si el respaldo falta, está vencido o el último intento falló
15 */6 * * * cd /app && BACKUP_DIR=/data/backups node scripts/backup.mjs --check >> /data/backups/check.log 2>&1
```

El `--check` no necesita `DATABASE_URL`: lee el estado y el archivo real del último respaldo ok.
Sale con código 1 y un mensaje claro cuando hay problema, así el monitoreo del servidor lo detecta
sin panel. Con `--json` imprime el mismo resultado en JSON.

El panel suma su propio aviso: al abrir el dashboard o `/sistema`, un OWNER/ADMIN dispara la
evaluación del respaldo (ver §4). No hace falta cron para el correo.

## 2. Restauración

El dump es SQL plano comprimido: se restaura con `psql` en una base **limpia** (nunca sobre la
base viva sin decidirlo explícitamente).

```bash
# 1. Crear la base destino (vacía)
createdb -h <host> -U <usuario> ledbox_restore

# 2. Restaurar el dump
gunzip -c /data/backups/ledbox-YYYYMMDD-HHMMSS.sql.gz | psql -h <host> -U <usuario> -d ledbox_restore

# 3. Verificar: mismos conteos que el origen en las tablas clave
psql -h <host> -U <usuario> -d ledbox_restore -c 'select count(*) from "AdminUser";'
psql -h <host> -U <usuario> -d ledbox_restore -c 'select count(*) from "_prisma_migrations";'
```

Restauración probada (22-09-2026, PostgreSQL 17 local): dump → base limpia `ledbox_restore` →
conteos idénticos al origen en las tablas clave y comparación completa de 9 tablas
(`AdminUser` 6, `AdminMembership` 6, `Organization` 2, `Client` 18, `Event` 37, `Budget` 7,
`InventoryItem` 10, `MessageTemplate` 17, `_prisma_migrations` 24), `psql` sin errores y
`prisma migrate deploy` sobre la base restaurada sin migraciones pendientes. Para restaurar sobre
la base existente hace falta parar la app (o cortar el tráfico) y decidir el orden de los `DROP`:
el dump no trae `--clean` a propósito, para que una restauración accidental no borre datos sin
querer.

> No ejecutar migraciones ni restauraciones contra la base de producción desde un entorno local.
> Las pruebas van contra un PostgreSQL local.

## 3. Estado en el panel (`/sistema`)

Página del panel para **OWNER/ADMIN** (los demás roles reciben 404/403 y no la ven en el menú).
Muestra, siempre desde datos reales:

- **Versión** (`lib/version.ts`, fuente única del footer).
- **Base**: responde o no, latencia y tamaño (`pg_database_size`).
- **Migraciones aplicadas**: total y última con su fecha (`_prisma_migrations`).
- **Respaldo**: resultado, último ok (fecha y hace cuánto), tamaño, tablas verificadas,
  archivo, respaldos guardados y disco del volumen, retención configurada y último error.
- **Historial**: últimas corridas con resultado, tamaño, duración, archivo y error.

Si no hay respaldos, lo dice tal cual («Sin respaldos»): no se inventan fechas ni métricas.

### La demo no lo expone

`/sistema` es OWNER/ADMIN y la sesión demo es VIEWER, así que la demo no la ve; además el API
(`GET /api/admin/system`) responde 403 cuando la empresa activa es la demo, sin importar el rol.
El estado del servidor no es un dato del producto.

## 4. Alerta por correo a OWNER/ADMIN

Cuando el respaldo **falta, está vencido o falló**:

- El panel lo avisa inline en `/sistema` (alerta con el detalle real del problema).
- Se manda un correo con el mailer único de la app (`sendMail`, categoría `alert`) a todos los
  OWNER/ADMIN activos de empresas activas (la demo queda afuera), con el problema, el último
  respaldo ok, el umbral, el último error y el botón a `/sistema`.
- Queda en **Auditoría** (`System`, acción «Envió») con el actor real que abrió el panel y en el
  historial de correo (`MailLog`).
- **Idempotencia**: un aviso enviado hoy no se repite; si el envío falló o quedó a medias, se
  reintenta recién pasados 30 minutos (así una caída del proveedor no golpea en cada carga).

Se evalúa solo en entornos reales: la demo no participa. Sin `RESEND_API_KEY`, `sendMail` no
intenta el envío y la alerta queda visible igual en el panel.

## 5. Migraciones (contexto)

`npm run build` y `npm start` ejecutan `scripts/migrate-deploy.mjs`, que aplica las migraciones
pendientes antes de atender tráfico (en el build es best-effort). No hay paso manual de migración
en el deploy; la migración de este issue (`202609220001_backup_alert_mail`) es aditiva e
idempotente y solo agrega el valor `alert` al enum `MailCategory`.

## 6. Post-deploy (checklist del respaldo)

Cada deploy crea un contenedor nuevo; el volumen y la configuración de Coolify sobreviven, el
contenedor no. Cuatro verificaciones (2 minutos, en el contenedor nuevo):

1. **Cliente PostgreSQL**: `pg_dump --version` → **18.x**. El hook del deploy
   (`sh /app/scripts/install-pgdump.sh`) es el que lo instaló; si falta, se puede correr a mano.
2. **Corrida manual**: `cd /app && BACKUP_DIR=/data/backups node scripts/backup.mjs`
   → `Respaldo ok: ledbox-….sql.gz` y un archivo nuevo en `/data/backups`.
3. **Chequeo**: `cd /app && BACKUP_DIR=/data/backups node scripts/backup.mjs --check`
   → `OK: Último respaldo hace … h` y exit 0.
4. **Tareas de Coolify**: las dos siguen `enabled`, con `Container` **vacío** y la frecuencia
   de §1 (si el campo quedó con un nombre viejo, vaciarlo).

El volumen `/data/backups` no se toca en el deploy: los respaldos anteriores siguen ahí. Después
del checklist, el panel (`/sistema`) debe mostrar el respaldo al día sin alerta.

## 7. Troubleshooting (caso real, 24-09-2026)

El aviso «Sin respaldos» de `/sistema` destapó tres fallas encadenadas; esta es la causa de cada
una y su corrección, para reconocerlas rápido si vuelven.

### 7.1 El respaldo vivía dentro del contenedor

- **Síntoma**: `/sistema` dice «Sin respaldos» aunque el respaldo hubiera corrido, o desaparece
  después de un deploy.
- **Causa**: `BACKUP_DIR` con el default (`./backups`) apunta al filesystem efímero; cada deploy
  reemplaza el contenedor y se lleva los archivos.
- **Corrección**: volumen persistente de Coolify montado en `/data/backups` y `BACKUP_DIR` con
  ese valor en la tarea y en el entorno de la app.

### 7.2 pg_dump más viejo que la base

- **Síntoma** (log real): `pg_dump: error: aborting because of server version mismatch ·
  detail: server version: 18.6; pg_dump version: 15.19 (Debian 15.19-0+deb12u1)`.
- **Causa**: la imagen del contenedor trae el cliente 15 y la base corre PostgreSQL 18.6.
- **Corrección**: `scripts/install-pgdump.sh` como `post_deployment_command` en cada deploy
  (instala `postgresql-client-18` desde PGDG). `scripts/backup.mjs` elige solo el cliente más
  nuevo instalado por versión mayor, así que la tarea no queda atada a una ruta; `PG_DUMP_BIN`
  sigue mandando si se lo necesita.
- **Ojo**: Coolify **no falla el deploy** si el hook falla (solo lo loguea); la verificación es
  el checklist de §6.
- **Ventana del deploy**: Coolify marca el deploy «finished» unos segundos antes de que el hook
  termine (medido: ~20 s el 25-09-2026). Si una corrida programada cae justo ahí, `backup.mjs`
  espera y reintenta (hasta 2 veces, 20 s cada una) en vez de fallar; queda registrado en
  `cron.log`.

### 7.3 Las tareas quedaban atadas al contenedor viejo

- **Síntoma**: después de un deploy, la tarea falla con «No valid container was found» o «More
  than one container exists but no container name was provided».
- **Causa**: el nombre del contenedor cambia en cada deploy (`<uuid>-<timestamp>`); Coolify
  v4.3.23 no reescribe el campo `Container` de las tareas al desplegar. Con un solo contenedor
  corriendo la tarea igual funciona, así que el fallo es intermitente.
- **Corrección**: dejar `Container` **vacío** en las dos tareas (§1) para que el planificador
  resuelva el contenedor vigente.

### 7.4 Volumen sin permiso de escritura

- **Síntoma**: `EACCES` al crear el directorio o el archivo en `/data/backups`.
- **Causa**: el volumen quedó montado con un dueño distinto al del proceso. En este incidente no
  pasó, pero es la otra falla clásica; los procesos de Coolify corren como root.
- **Corrección**: montar el volumen escribible para el contenedor o ajustar el dueño; comprobar
  con `ls -la /data/backups` antes de dar por sano el deploy.
