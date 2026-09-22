# Comandos del orquestador — LedBox/EventOS

Adaptación local del estándar del grupo (`owncoding-ui/docs/COMANDOS.md`).
El dueño ordena con estos comandos; el ciclo de integración es el mismo en
todas las apps.

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

- **Nada se mergea, pushea ni despliega fuera de `ht`/`hd`** (o de una ronda
  explícitamente ordenada). El único que toca la rama viva es el integrador.
- No se reescribe historia compartida: ni `push --force`, ni tags movidos, ni
  merges silenciosos. Si el diff neto de una rama queda vacío, se descarta y se
  avisa.
- Los conflictos se resuelven a mano (en el slot o en el checkout del
  integrador) y se cuentan en el handover; el ciclo automático solo deshace y
  avisa.
- Cada release escribe su bloque en `docs/NOVEDADES.md` (2–5 bullets de
  producto) y sube la versión con `deploy:patch`.

Referencia: `AGENTS.md` (ramas, entrega y deploy), `docs/DISENO-PANEL.md` y
`docs/DISENO-PANTALLAS.md` (diseño) y `docs/ADOPCION-OWNCODING-UI.md` (librería).
