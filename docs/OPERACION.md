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
| `PG_DUMP_BIN` | `pg_dump` | Binario de `pg_dump` |

En el deploy de Coolify conviene fijar `BACKUP_DIR` a un volumen persistente (por ejemplo
`/data/backups`) y usar el mismo valor en el entorno de la app, que es la que lee el estado.

### Cron

Una corrida diaria alcanza con el umbral de 26 h (deja margen si una corrida se atrasa):

```cron
# Respaldo diario a las 03:00 (hora del servidor)
0 3 * * * cd /app && BACKUP_DIR=/data/backups DATABASE_URL="postgresql://…" /usr/bin/node scripts/backup.mjs >> /data/backups/cron.log 2>&1

# Chequeo cada 6 h: falla (exit 1) si el respaldo falta, está vencido o el último intento falló
15 */6 * * * cd /app && BACKUP_DIR=/data/backups /usr/bin/node scripts/backup.mjs --check >> /data/backups/check.log 2>&1
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
