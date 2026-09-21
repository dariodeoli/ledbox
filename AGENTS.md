# AGENTS.md — LedBox

Reglas para agentes que trabajan en este repositorio. Leer antes de tocar código.

## Contexto

- Producto, módulos y pendientes: `docs/CONTEXTO-LEDBOX.md`.
- Stack, estructura y puesta en marcha: `README.md`.

## Ramas, entrega y deploy

- Rama viva y de deploy: `codex/ledbox-gestion-multiempresa` (Coolify la publica en ledbox.online y admin.ledbox.online). Solo el integrador mergea ahí; ningún workstream pushea directo a esa rama ni a `main`.
- Cada workstream trabaja en su propio worktree y rama `feat/<slug>`, con commits convencionales por unidad de trabajo y sin atribución de IA.
- Antes de empezar: `git fetch origin --prune` y partir de la rama base indicada en el brief.
- Entrega: `npm run typecheck` y `npm run build` en verde; `npx prisma validate` si se tocó el schema; sin marcadores de conflicto; handover con rama, commits, rutas tocadas y verificaciones.
- No hay deploy manual: al integrar a la rama viva, Coolify reconstruye.
- No tocar el worktree ni la rama de otro agente.

## URLs del panel (regla del 21-09-2026)

- En producción el panel vive en `admin.ledbox.online` y las rutas **no llevan** `/admin`: `/login`, `/dashboard`, `/eventos`, `/finanzas`, etc.
- Las páginas del panel son rutas raíz reales en `app/(admin)/*` (el route group no cambia la URL); el sitio público vive en `app/(public)/*`.
- En el host admin (`NEXT_PUBLIC_ADMIN_URL`, default `https://admin.ledbox.online`), `/` muestra el dashboard (`app/(admin)/dashboard`). En el host público, `middleware.ts` redirige las rutas del panel al subdominio y `/admin/*` se canonicaliza a la ruta limpia.
- Al crear una página o módulo del panel, agregarlo a `lib/admin-routes.ts` (lista que usa el middleware del host público).
- En el código, links y redirects del panel usan rutas limpias (`/login`, `/dashboard`, `/eventos`). URLs absolutas del panel (emails, callbacks) se arman con `publicConfig.adminUrl`.
- Desarrollo: `npm run dev` deja el panel en `http://localhost:3000/dashboard` y el sitio público en `http://localhost:3000`; no hace falta configurar hosts.
- Nunca hardcodear el dominio admin en componentes.

## Diseño del panel (rediseño general 21-09-2026)

- Identidad: negro + cyan eléctrico, tipografía fuerte; modo claro/oscuro persistente por usuario.
- Densidad: sin espacios vacíos. Listas con encabezado de columnas, filas finas (~44–52 px, una sola línea de contenido principal), toda la información en columnas alineadas, acciones compactas con `title` + `aria-label`.
- Una plantilla de columnas por vista (variable CSS `--<vista>-cols`) compartida por encabezado y filas; nada de dos plantillas paralelas ni columnas que colapsan.
- Grillas de tarjetas solo donde aporta (dashboard, resumen); tarjetas con pie anclado y misma altura por fila.
- Montos `Int` en PYG sin decimales (`Intl.NumberFormat("es-PY")`), fechas/horas es-PY en 24 h (`hourCycle: "h23"`), `tabular-nums` + `nowrap` en montos, fechas y códigos.
- Responsive real: sidebar colapsable en mobile, listas con scroll horizontal silencioso, formularios usables a 360 px.
- Un solo componente/estilo por tipo; CSS en `app/globals.css` (sin estilos inline salvo valores dinámicos); no agregar librerías de UI.
- Los datos que se muestran salen del API real; no inventar estados ni métricas.

## Datos y API

- Contratos públicos estables: `/api/leads`, `/api/quotes`, `/api/health` y el sitio público no se rompen.
- `/api/admin/*` exige sesión; a partir de `feat/multiempresa` además exige membresía en la organización activa y permiso por rol (server-side, 403).
- Roles: `OWNER`, `ADMIN`, `FINANCE`, `OPERATIONS`, `VIEWER`. `VIEWER` nunca ve acciones mutantes.
- Los montos se guardan enteros (PYG), normalizados; el formato lo dibuja la UI.
- Migraciones Prisma: archivos en `prisma/migrations`, aditivos, idempotentes y re-ejecutables (nunca editar una aplicada). No ejecutar migraciones contra la base de producción.

## Verificación

- `npm run typecheck` y `npm run build` (el build incluye `prisma generate`).
- Migraciones: se aplican solas al build y al arranque del servidor (`scripts/migrate-deploy.mjs`); no hay paso manual en el deploy. No ejecutes migraciones contra la base de producción desde tu entorno; probalas siempre en un Postgres local.
- `npx prisma validate` si se tocó el schema; `npx prisma format` opcional.
- Postgres local para probar API/migraciones (sin tocar producción):

```bash
export PGDATA="$(mktemp -d)/pgdata"
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
pg_ctl -D "$PGDATA" -o "-p 55432" -l "$PGDATA/log" start
createdb -p 55432 -U postgres ledbox_dev
export DATABASE_URL="postgresql://postgres@localhost:55432/ledbox_dev?schema=public"
export AUTH_SECRET="dev-secret-dev-secret-dev-secret"
export LEDBOX_ADMIN_DARIO_PASSWORD="dev-password-1234"
export LEDBOX_ADMIN_SANTIAGO_PASSWORD="dev-password-1234"
npx prisma migrate deploy && npm run prisma:seed
npm run dev -- -p 3001   # panel en http://localhost:3001
pg_ctl -D "$PGDATA" stop  # al terminar
```

## Prohibiciones

- No commitear secretos ni `.env` reales; no tocar la base de producción.
- No crear componentes, estilos o endpoints muertos/paralelos.
- No eliminar funcionalidad existente sin reemplazo verificado por el contrato real.
- No hacer `push --force` ni reescribir historia de ramas compartidas.
- Estado raro de git (refs rotas, merge ajeno): parar y avisar.
