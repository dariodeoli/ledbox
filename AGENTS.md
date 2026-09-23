# AGENTS.md — LedBox

Reglas para agentes que trabajan en este repositorio. Leer antes de tocar código.

## Contexto

- Producto, módulos y pendientes: `docs/CONTEXTO-LEDBOX.md`.
- **Reglas generales de la app (obligatorias)**: `docs/REGLAS-GENERALES.md` — buscar antes de crear, un objeto por tipo, formatos normalizados, estados honestos, endpoints públicos con token, versionado y publicación. Ningún cambio nuevo puede contradecirlas.
- Stack, estructura y puesta en marcha: `README.md`.

## Topología: orquestador + implementador + 3 slots (23-09-2026)

Runtime **herdr**: un agente por rol, cada uno en su workspace. Fuente operativa: `~/.herdr/worktrees/ledbox/orquestador/` (`PLAYBOOK.md`, `SLOTS.md`, `BRIEF.md`, `COMANDOS.md`).

| Agente | Workspace | Rol |
| --- | --- | --- |
| `lbx-orquestador` | `LedBox · Orquestador` | Interlocutor único del dueño: abre issues, elige slot por dominio, briefea con `herdr agent prompt`, verifica handovers y ordena la integración. No mergea, no pushea, no despliega, no edita código. |
| `lbx-implementador` | `LedBox · Implementador` (`~/Documents/GitHub/ledbox`) | Implementa lo transversal/plataforma, integra las ramas de los slots con `npm run ht`/`hd` y despliega. Único que toca la rama viva. |
| `lbx-panel` | `LBX-PANEL · Panel/UX` | Slot `slot/panel` — Panel/UX/diseño. |
| `lbx-ops` | `LBX-OPS · Operación` | Slot `slot/operacion` — Operación (eventos, inventario, proveedores, clientes). |
| `lbx-fin` | `LBX-FIN · Finanzas` | Slot `slot/finanzas` — Finanzas/fiscal/portal cliente. |

- Worktrees de slots: `~/.herdr/worktrees/ledbox/{LBX-PANEL,LBX-OPS,LBX-FIN}`.
- **Base de todo trabajo: `origin/codex/ledbox-gestion-multiempresa`** (la rama viva). `main` no se usa como base.
- Ciclo de un pedido: dueño → orquestador (issue + brief) → slot (`git fetch origin --prune` + rebase sobre la rama viva → implementación → checks → push de **su** rama → handover) → orquestador verifica el handover → implementador integra (`npm run ht`/`hd`).
- Guardas: solo el implementador toca la rama viva; cada slot pushea únicamente su rama; prohibido `push --force` y reescribir historia compartida; no se toca el worktree ni la rama de otro agente.
- Automatización: el auto-HD (`npm run watch-hd`) corre de fondo en el checkout del implementador (≥15 commits sin integrar, cooldown 20 min); `vigia.sh` del orquestador reparte `cola.tsv` a los slots libres — disponible, sin arrancar.

## Ramas, entrega y deploy

- Rama viva y de deploy: `codex/ledbox-gestion-multiempresa` (Coolify publica ledbox.online, app.ledbox.online, eventos.ledbox.online, clientes.ledbox.online y demo.ledbox.online). Solo el implementador/integrador mergea y pushea ahí; ningún otro agente pushea directo a esa rama ni a `main`.
- Cada workstream trabaja en su propio worktree y rama: los slots en su rama persistente (`slot/panel`, `slot/operacion`, `slot/finanzas`), el resto en `feat/<slug>` según el brief. Commits convencionales por unidad de trabajo y sin atribución de IA.
- Antes de empezar: `git fetch origin --prune` y partir de `origin/codex/ledbox-gestion-multiempresa` (o de la rama base indicada en el brief; `main` no se usa como base).
- Entrega: `npm run typecheck` y `npm run build` en verde; `npx prisma validate` si se tocó el schema; sin marcadores de conflicto; handover con rama, commits, rutas tocadas y verificaciones.
- No hay deploy manual: al integrar a la rama viva, Coolify reconstruye.
- No tocar el worktree ni la rama de otro agente.

## URLs del panel (regla del 21-09-2026)

- En producción el panel (app **EventOS**) vive en `app.ledbox.online` y las rutas **no llevan** `/admin`: `/login`, `/dashboard`, `/eventos`, `/finanzas`, etc. `admin.ledbox.online` redirige 308 al host nuevo y `eventos.ledbox.online` sirve la landing de ventas del producto.
- Las páginas del panel son rutas raíz reales en `app/(admin)/*` (el route group no cambia la URL); el sitio público vive en `app/(public)/*`.
- En el host de la app (`NEXT_PUBLIC_ADMIN_URL`, default `https://app.ledbox.online`), `/` muestra el dashboard (`app/(admin)/dashboard`). En el host público, `middleware.ts` redirige las rutas del panel al subdominio y `/admin/*` se canonicaliza a la ruta limpia.
- Al crear una página o módulo del panel, agregarlo a `lib/admin-routes.ts` (lista que usa el middleware del host público).
- En el código, links y redirects del panel usan rutas limpias (`/login`, `/dashboard`, `/eventos`). URLs absolutas del panel (emails, callbacks) se arman con `publicConfig.adminUrl`.
- Desarrollo: `npm run dev` deja el panel en `http://localhost:3000/dashboard` y el sitio público en `http://localhost:3000`; no hace falta configurar hosts.
- Nunca hardcodear el dominio admin en componentes.

## Diseño del panel (rediseño general 21-09-2026)

- **Guía del rediseño completo (22-09-2026): `docs/DISENO-PANEL.md`** — tokens, shell, componentes y el orden de la navegación. Toda pantalla nueva o tocada la respeta.
- **Orden por pantalla (22-09-2026): `docs/DISENO-PANTALLAS.md`** — qué bloque va primero en cada módulo y cuál es la acción principal. **Adopción de la librería compartida: `docs/ADOPCION-OWNCODING-UI.md`**.

- Identidad: negro + cyan eléctrico, tipografía fuerte; modo claro/oscuro persistente por usuario.
- Densidad: sin espacios vacíos. Listas con encabezado de columnas, filas finas (~44–52 px, una sola línea de contenido principal), toda la información en columnas alineadas, acciones compactas con `title` + `aria-label`.
- Una plantilla de columnas por vista (variable CSS `--<vista>-cols`) compartida por encabezado y filas; nada de dos plantillas paralelas ni columnas que colapsan.
- Grillas de tarjetas solo donde aporta (dashboard, resumen); tarjetas con pie anclado y misma altura por fila.
- Montos `Int` en PYG sin decimales (`Intl.NumberFormat("es-PY")`), fechas/horas es-PY en 24 h (`hourCycle: "h23"`), `tabular-nums` + `nowrap` en montos, fechas y códigos.
- Responsive real: sidebar colapsable en mobile, listas con scroll horizontal silencioso, formularios usables a 360 px.
- Un solo componente/estilo por tipo; CSS en `app/globals.css` (sin estilos inline salvo valores dinámicos); no agregar librerías de UI.
- Los pipelines por estado usan el **tablero único** `AdminBoard` con `AdminViewSwitch` (vista lista/tablero recordada por usuario, arrastre HTML5 + "Mover a…", optimismo con revert); no crear tableros paralelos por módulo.
- Los datos que se muestran salen del API real; no inventar estados ni métricas.

## Datos y API

- Contratos públicos estables: `/api/leads`, `/api/quotes`, `/api/health` y el sitio público no se rompen.
- `/api/admin/*` exige sesión; a partir de `feat/multiempresa` además exige membresía en la organización activa y permiso por rol (server-side, 403).
- Roles: `OWNER`, `ADMIN`, `FINANCE`, `OPERATIONS`, `VIEWER`. `VIEWER` nunca ve acciones mutantes.
- Los montos se guardan enteros (PYG), normalizados; el formato lo dibuja la UI.
- Migraciones Prisma: archivos en `prisma/migrations`, aditivos, idempotentes y re-ejecutables (nunca editar una aplicada). No ejecutar migraciones contra la base de producción.

## API keys de servicio (issue #69)

- Se crean en **Mi perfil → Seguridad** (solo `OWNER`): nombre + rol acotado (`ADMIN`, `FINANCE` u `OPERATIONS`; nunca `OWNER`). El **token se muestra una sola vez**; en la base vive solo su hash SHA-256 y un prefijo para listarlo. Revocación inmediata desde la misma sección.
- Entran por `Authorization: Bearer <token>` en cualquier `/api/admin/*`, en lugar de la cookie: la clave resuelve a **su empresa** y a su rol (misma matriz de permisos, rate-limit por clave y auditoría con actor `API · nombre` + `lastUsedAt`). La cookie del panel sigue funcionando igual.
- **CLI de cargas** (cliente + presupuesto + adjunto opcional), reutilizando la aritmética de costos/margen del panel:
  ```bash
  node --import tsx scripts/admin-api.mjs \
    --token lbx_... --file scripts/admin-api.example.json [--attachment ./plano.pdf]
  # URL por defecto https://app.ledbox.online (o --url / LEDBOX_API_URL)
  ```
- Seguridad: nunca se exponen costos internos al portal (los protege el API), el token no se puede administrar desde una clave y todo queda auditado.

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

## CI (GitHub Actions, 23-09-2026)

- Workflow: `.github/workflows/ci.yml`; corre en **push y PR** a `codex/ledbox-gestion-multiempresa`.
- Pasos (Node 22 + caché de npm, timeout 20 min): `actions/checkout` → `actions/setup-node` → `npm ci` → `npx prisma generate` → `npm run typecheck` → `npm run test:rules` → `npm run build`.
- `owncoding-ui` es pública: `npm ci` no necesita token ni `--legacy-peer-deps` (verificado en limpio).
- El build no necesita base de datos: `migrate-deploy.mjs` corre con `--best-effort` cuando falta `DATABASE_URL`.

## Prohibiciones

- No commitear secretos ni `.env` reales; no tocar la base de producción.
- No crear componentes, estilos o endpoints muertos/paralelos.
- No eliminar funcionalidad existente sin reemplazo verificado por el contrato real.
- No hacer `push --force` ni reescribir historia de ramas compartidas.
- Estado raro de git (refs rotas, merge ajeno): parar y avisar.
