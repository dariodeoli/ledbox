# Pendientes del dueño

Decisiones o acciones que dependen de Dario (el `pp` los lista tal cual).
El 22-09-2026 el dueño dijo «hacé como creas mejor» y estos quedaron resueltos
o encaminados.

## Resueltos por el integrador (decidido)

- **Bordes de controles (AA estricto)**: **se hace** — se agrega un token de
  borde de control con contraste ≥ 3:1 (más oscuro en claro, más claro en
  oscuro) y se aplica a campos, botones y controles; los separadores
  decorativos siguen finos.
- **Acción principal de Finanzas**: queda **«Registrar cobro»** (es lo que el
  módulo resuelve todos los días, alineado con «Por confirmar»); «Registrar
  gasto» pasa a secundaria.
- **Plan de LedBox**: se mantiene **Inicial** (5 usuarios / 50 eventos por mes).
  Se pasa a Corporativo (sin tope) si el volumen lo pide.
- **Rama `lib` de la librería**: nuestra línea queda en **v0.14.0** (publicada);
  la cosecha de PagaYa/ScaleOS sale como **v0.15.0** cuando su dueño la cierre.
- **Token de build para la librería**: **resuelto** — `dariodeoli/owncoding-ui`
  es público: v0.14.0 se instaló sin token (`e1fae8b`) y el build de Coolify
  tampoco lo necesita (detalle en `docs/ADOPCION-OWNCODING-UI.md`, §7).

## Resueltos (operación)

- **Respaldo de la base**: **resuelto** (25-09-2026) — volumen persistente
  `/data/backups`, cliente PostgreSQL 18 instalado en cada deploy por
  `scripts/install-pgdump.sh` (hook de Coolify), `BACKUP_DIR` en la app, y las dos
  tareas de Coolify (diario 03:00 UTC + chequeo cada 6 h) **sin contenedor fijo**,
  así siguen solas al contenedor vigente. Primera corrida automática confirmada
  (25-09 03:00 UTC, success) y respaldo verificado post-deploy. Detalle, checklist
  y troubleshooting: `docs/OPERACION.md` §1, §6 y §7.

## Pendientes del dueño (acción tuya)

- **Datos fiscales**: cargar RUC/razón social/**timbrado**/establecimiento en
  `/facturacion → Datos fiscales`. Mientras falten, el módulo muestra un aviso
  con el paso a paso (y el imprimible sale incompleto).
