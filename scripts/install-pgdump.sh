#!/bin/sh
# Instalador del cliente PostgreSQL del contenedor de EventOS (issue #71).
#
# Coolify lo corre como `post_deployment_command` **después de cada deploy**, ya
# dentro del contenedor nuevo; por eso no hay que instalarlo a mano ni escribirlo
# en el volumen: el binario queda disponible apenas el contenedor arranca.
#
#   sh /app/scripts/install-pgdump.sh
#
# Es idempotente: si el `pg_dump` de la versión mayor ya está, no toca nada.
# Requiere salida a internet (repo PGDG) durante el deploy. Ojo: Coolify NO
# falla el deploy si este hook falla (solo loguea el error), así que la
# verificación real está en el checklist post-deploy de `docs/OPERACION.md`.
#
# Variables:
#   PG_MAJOR  versión mayor del cliente a instalar (default 18, la de la base).
set -eu

PG_MAJOR="${PG_MAJOR:-18}"
PG_DUMP="/usr/lib/postgresql/${PG_MAJOR}/bin/pg_dump"

if [ -x "$PG_DUMP" ]; then
  echo "[install-pgdump] ya está: $("$PG_DUMP" --version)"
  exit 0
fi

CODENAME="$(. /etc/os-release 2>/dev/null && echo "${VERSION_CODENAME:-}")"
if [ -z "$CODENAME" ]; then
  echo "[install-pgdump] no pude leer el codename de Debian; uso bookworm." >&2
  CODENAME="bookworm"
fi

echo "[install-pgdump] instalando postgresql-client-${PG_MAJOR} (PGDG ${CODENAME})…"
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg
mkdir -p /usr/share/keyrings
curl -fsSL -o /tmp/pgdg.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
gpg --dearmor --batch --yes -o /usr/share/keyrings/postgresql.gpg /tmp/pgdg.asc
rm -f /tmp/pgdg.asc
echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt ${CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y --no-install-recommends "postgresql-client-${PG_MAJOR}"

"$PG_DUMP" --version
echo "[install-pgdump] listo."
