# Comandos del orquestador — LedBox/EventOS

Adaptación local del estándar del grupo (`owncoding-ui/docs/COMANDOS.md`).
El dueño ordena con estos comandos; el ciclo de integración es el mismo en
todas las apps.

## Topología (herdr)

Un agente por rol, cada uno en su workspace. Detalle operativo:
`~/.herdr/worktrees/ledbox/orquestador/` (`PLAYBOOK.md`, `SLOTS.md`, `BRIEF.md`).

| Agente | Workspace | Rol | Worktree / rama |
| --- | --- | --- | --- |
| `lbx-orquestador` | `LedBox · Orquestador` | Interlocutor único del dueño: abre issues, elige slot por dominio, briefea (`herdr agent prompt`), verifica handovers y ordena la integración. No mergea, no pushea, no despliega, no edita código. | `~/.herdr/worktrees/ledbox/orquestador/` (sin repo) |
| `lbx-implementador` | `LedBox · Implementador` | Implementa lo transversal/plataforma, integra las ramas de los slots (`npm run ht`/`hd`) y despliega. Único que toca la rama viva. | `~/Documents/GitHub/ledbox` · `codex/ledbox-gestion-multiempresa` |
| `lbx-panel` | `LBX-PANEL · Panel/UX` | Slot Panel/UX/diseño. | `LBX-PANEL` · `slot/panel` |
| `lbx-ops` | `LBX-OPS · Operación` | Slot Operación (eventos, inventario, proveedores, clientes). | `LBX-OPS` · `slot/operacion` |
| `lbx-fin` | `LBX-FIN · Finanzas` | Slot Finanzas/fiscal/portal cliente. | `LBX-FIN` · `slot/finanzas` |

- Worktrees de slots: `~/.herdr/worktrees/ledbox/{LBX-PANEL,LBX-OPS,LBX-FIN}`.
- **Base de todo: `origin/codex/ledbox-gestion-multiempresa`** (rama viva); `main` no se usa como base.
- Ciclo: dueño → orquestador (issue + brief con `herdr agent prompt`) → slot (`git fetch origin --prune` + rebase → implementación → checks → push de su rama → handover) → orquestador verifica → implementador integra (`npm run ht`/`hd`).

| Comando | Cómo se corre | Qué hace |
| --- | --- | --- |
| **`pp`** | `npm run pp` | Resumen de pendientes: producción (versión, health, superficies), ramas sin integrar con su cantidad de commits, slots (worktrees) y su estado, issues abiertas y pendientes del dueño (`docs/PENDIENTES-DUENO.md`). |
| **`pd`** | `npm run pd` | Pendiente de deploy: tabla **commit → qué cambia** con el tipo (`feature` / `fix` / `test` / `docs` / `chore` / `refactor` / `otros`). |
| **`al`** | `npm run al` | Slots (worktrees) y su estado (libre/ocupado), trabajo pendiente en issues y la regla de reparto por dominio. |
| **`ht`** | `npm run ht` | Ciclo completo: **merge → suite → push → `NOVEDADES.md` → release + smoke**. |
| **`hd`** | `npm run hd` | Alias de `ht`. |
| `auto` | `npm run auto-hd` | Una pasada del disparo automático (ver abajo). |
| `watch` | `npm run watch-hd` | Queda corriendo y dispara `auto` cada 10 minutos. |
| — | `node scripts/orquestador.mjs ht --dry-run` | Muestra qué mergearía sin tocar nada. |

## Política automática de integración

- **Umbral**: ≥ **15 commits** nuevos sin integrar (suma de
  `git log --oneline <rama viva>..<rama>` de los slots) → dispara `hd`.
- **Integrador libre**: sin merge en curso, sin cambios sin commitear y sin otro
  ciclo corriendo (lock en `~/.config/ledbox/auto-hd.lock`).
- **Cooldown**: 20 minutos entre disparos (estado en
  `~/.config/ledbox/auto-hd.json`).
- **Exclusiones**: `scripts/orquestador.config.json` (`exclude`) deja afuera
  pilotos y experimentos —hoy `feat/piloto*`— que nunca se integran solos.
- El dueño puede adelantarlo con `ht`/`hd` a mano; el automático se suma, no
  reemplaza.
- El auto-HD corre en el checkout del implementador (`npm run watch-hd`, ya
  activo). Además, el orquestador tiene `vigia.sh`: reparte una vez cada tarea
  de `cola.tsv` al slot libre (`herdr agent prompt`) sin interrumpir slots
  trabajando — **disponible, sin arrancar**.

### Qué hace el ciclo, paso a paso

1. `git fetch` y lista de ramas con commits nuevos (menos las excluidas).
2. Por rama: si su slot está ocupado (cambios sin commitear) se saltea; si el
   merge da conflicto, se **deshace** y se informa (nunca en silencio).
3. Suite de checks sobre el merge: `typecheck` → `test:rules` → `check:fields`
   → `build`. Si algo falla, el merge se **revierte** (`reset --hard` al commit
   previo) y la rama queda pendiente.
4. Con los merges sanos: commit de `docs/NOVEDADES.md` (bullets en lenguaje de
   producto generados de los commits), `push` a la rama viva y
   `npm run deploy:patch` (bump de parche + commit + push + deploy del Hub).
5. **Smoke**: espera la versión nueva en `app.ledbox.online/login` (~9 min) y
   comprueba las 5 superficies.

Log: `~/.config/ledbox/auto-hd.log`.

### Dejarlo corriendo

```bash
# Vigilante en primer plano (o con nohup para dejarlo de fondo)
npm run watch-hd
nohup npm run watch-hd > /tmp/ledbox-auto-hd.out 2>&1 &

# Alternativa por cron (cada 10 minutos, una pasada)
*/10 * * * * cd /Users/fredd/Documents/GitHub/ledbox && /usr/local/bin/npm run auto-hd >> /tmp/ledbox-auto-hd.cron.log 2>&1
```

## Reglas

- **Nada se mergea, pushea ni despliega fuera de `ht`/`hd`** (manual o del
  auto-HD; o de una ronda explícitamente ordenada por el orquestador). El único
  que toca la rama viva es el implementador/integrador.
- Los slots solo pushean su rama (`slot/panel`, `slot/operacion`,
  `slot/finanzas`): no mergean, no pushean a la rama viva y no tocan worktrees
  ajenos.
- No se reescribe historia compartida: ni `push --force` (tampoco
  `--force-with-lease` sobre la rama viva), ni tags movidos, ni merges
  silenciosos. Si el diff neto de una rama queda vacío, se descarta y se avisa.
- Los conflictos se resuelven a mano (en el slot o en el checkout del
  implementador) y se cuentan en el handover; el ciclo automático solo deshace y
  avisa.
- Cada release escribe su bloque en `docs/NOVEDADES.md` (2–5 bullets de
  producto) y sube la versión con `deploy:patch`.

Referencia: `AGENTS.md` (ramas, entrega y deploy), `docs/DISENO-PANEL.md` y
`docs/DISENO-PANTALLAS.md` (diseño) y `docs/ADOPCION-OWNCODING-UI.md` (librería).
