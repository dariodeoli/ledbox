# Pendientes del dueño

Decisiones o acciones que dependen de Dario (el `pp` los lista tal cual).

- **Bordes de controles (AA estricto)**: hoy los bordes de campos/botones miden
  1.5–1.87 de contraste (la guía WCAG pide 3:1 para componentes). Si querés AA
  estricto, agrego un token de borde de control (más oscuro en claro, más claro
  en oscuro) y cambia un poco el look de todos los formularios.
- **Acción principal de Finanzas**: hoy es «Registrar cobro»; en la spec figura
  «Registrar gasto». Decime cuál queda como primaria.
- **Cron de backups en el servidor**: falta dejar el `cron` con `BACKUP_DIR`
  (instrucciones en `docs/OPERACION.md`, §1). Mientras no esté, `/sistema` dice
  «Sin respaldos» y llega un correo por día (es la alerta funcionando).
- **Datos fiscales**: cargar RUC/razón social/**timbrado**/establecimiento en
  `/facturacion → Datos fiscales` (sin timbrado el imprimible sale incompleto).
- **Plan de LedBox**: quedó en **Inicial** (5 usuarios / 50 eventos por mes). Si
  querés más margen, lo paso a Corporativo (sin tope).
- **Token de build para la librería**: al adoptar `owncoding-ui` (ya publicado
  v0.14.0), Coolify necesita un token de lectura del repo privado
  (`GITHUB_TOKEN`; detalle en `docs/ADOPCION-OWNCODING-UI.md`, §7).
- **Rama `lib` de la librería**: la línea de PagaYa/ScaleOS apunta a la misma
  versión siguiente; definir si sale como v0.15.0 aparte o se junta con la
  nuestra en una sola.
