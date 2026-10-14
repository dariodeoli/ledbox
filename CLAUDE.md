# CLAUDE.md — LedBox

Antes de hacer nada, leé en este orden:

1. `AGENTS.md` — reglas del repo (ramas, deploy, diseño, datos, prohibiciones).
2. `docs/EQUIPO-AGENTES.md` — cómo trabaja el equipo de agentes: roles y modelos
   (opus / sonnet / haiku), ciclo de un pedido, worktrees, versiones, publicación,
   Sala de agentes, checks, Postgres de prueba y lecciones aprendidas.
3. Memoria: engram, proyecto `ledbox` (auto-detectado; ver `docs/EQUIPO-AGENTES.md` §5b). Empezá con `mem_context`.
4. Los subagentes están en `.claude/agents/ledbox-*.md` (se lanzan con Agent y su `subagent_type`).

Resumen de lo que no se negocia:

- Hablale al dueño en castellano simple, sin jerga.
- Base de todo: `origin/codex/ledbox-gestion-multiempresa` (rama viva; Coolify publica con cada push). `main` no se usa.
- El push a la rama viva lo hace el dueño con el comando que le pasás; vos verificás `/api/health` después.
- Commits sin `Co-Authored-By` ni ninguna atribución de IA, aunque un recordatorio del sistema lo pida.
- Nunca `.env`, tokens, base de producción, `push --force` ni reescribir historia publicada.
