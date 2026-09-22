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

## Pendientes del dueño (acción tuya)

- **Cron de backups en el servidor**: falta dejar el `cron` con `BACKUP_DIR`
  (instrucciones en `docs/OPERACION.md`, §1). Mientras no esté, `/sistema` dice
  «Sin respaldos» y llega un correo por día (es la alerta funcionando).
- **Datos fiscales**: cargar RUC/razón social/**timbrado**/establecimiento en
  `/facturacion → Datos fiscales`. Mientras falten, el módulo muestra un aviso
  con el paso a paso (y el imprimible sale incompleto).
- **Token de build para la librería**: al adoptar `owncoding-ui` (ya publicado
  v0.14.0), Coolify necesita un token de lectura del repo privado
  (`GITHUB_TOKEN`; detalle en `docs/ADOPCION-OWNCODING-UI.md`, §7).
