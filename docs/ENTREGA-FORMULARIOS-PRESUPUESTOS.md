# Formularios y presupuestos — entrega #173

Alcance autorizado el 09/10/2026: [dariodeoli/ledbox#173](https://github.com/dariodeoli/ledbox/issues/173).
Plan fuente: `/Users/fredd/.opencode/plan/ledbox-formularios-presupuestos.md`.

## Base y recuperación (fase 0)

- Rama viva: `codex/ledbox-gestion-multiempresa`, base `e0f133c04c06c8bb505365921b6ec2ea77744e7f`, versión 2.1.73, árbol limpio y ref remota cotejada.
- Producción cotejada el 09/10: login v2.1.73; `/api/health` responde `ok`, base `ok`, 44 migraciones. Esto no certifica el SHA de ejecución.
- Los siete commits de las entregas #141, #150, #151, #154, #168 y #169 ya están integrados. Las entregas posteriores hasta v2.1.73 se conservan, incluyendo exclusión de ítems, comparaciones y correcciones del documento/fechas.
- Históricos `LBX-*` preservados, con respaldos y hashes en Secretaría `resguardos/ledbox-20261009/inventario.json`. El WIP histórico de dashboard, detalles operativos, finanzas y equipos no se importa por inferencia.
- Las sesiones de los carriles se trasladan mediante `session_move`; se verifica `pwd` y rama antes de editar. `foreground_cwd` de Herdr puede reflejar el directorio heredado del proceso anterior.
- No se habilitan cola, rondas generales ni vigías. Migraciones y seed de verificación solo en Postgres local.

## Responsabilidad por fases

| Fase | Responsable | Límite de archivos y gate |
|---|---|---|
| 1, 6: kit/compatibilidad | panel (`slot/panel`) | Dependencia/lock/runtime/CI, kit `AdminFields`/`AdminUI`, reglas y estilos base; conserva firmas de consumidores |
| 2: datos/OwnData | plataforma (`slot/plataforma`) | Schema/migraciones aditivas, API clientes/eventos, contratos Client/Event, proveedor RUC y documentación |
| 2: formularios | ops (`slot/operacion`) | Clientes, eventos y altas rápidas; consume contratos de plataforma y kit de panel |
| 3, 4, 5: presupuestos | fin (`slot/finanzas`) | Presupuestos, aritmética/condiciones, API budgets, portal e impresión; contratos Budget sin tocar Client/Event |
| 7: QA | pilot (`slot/pilot`) | Candidato fijado por SHA; pruebas independientes, escritorio/360/390, contratos, pagos, permisos e impresión |
| Integración/publicación | integrador | Único que mergea/pushea la viva; reúne CSS y pruebas, valida migraciones locales, checks, release y smoke |

Los carriles guardan fragmentos CSS fuera del repo hasta liberar `app/globals.css`.
No editan en paralelo el listado de pruebas de `package.json`: el integrador reúne los tests nuevos.
Las ramas compartidas se actualizan por merge sin force ni reescritura de historia.

### Contratos acordados durante la ejecución

- El dueño aprobó conservar el Combobox canónico de LedBox: la ref publicada de
  owncoding-ui no cubre todavía búsqueda secundaria, alta rápida y
  `required`/`name`. Se adoptan los demás campos compatibles y se documenta la
  brecha, sin duplicar el selector ni bloquear el resto.
- Teléfonos: kit compartido; +595 por defecto solo al crear un valor vacío.
  Editar conserva el país previamente cargado.
- Cliente nuevo: `tradeName` comercial explícito admite 200 caracteres; POST
  puede omitir `name` y el backend inicializa el campo histórico por compatibilidad
  de esa nueva fila. PATCH de fantasía no cambia `name/company`. Un `name` enviado
  explícitamente se valida como texto comercial, sin truncamiento ni reglas de
  nombre humano. Contactos sí conservan validación de persona y máximo 20.
- `clientDisplayName` y `clientLegalName` de `lib/client-identity.ts` son la fuente
  única. `company` no se convierte en razón social oficial.
- OPS posee `ClientQuickForm`, campos rápidos del evento y wrapper de alta desde
  presupuesto; FIN los consume, no los edita. El alta de cliente respeta
  `canWriteClients`.

El contrato definitivo y la confirmación RUC se documentan en
`docs/CONTRATO-CLIENTES-EVENTOS-OWNDATA.md` al integrar la entrega de plataforma.

## Entregas incorporadas

- Plataforma fase 2: `9ef5c19`, corrección de validación destructiva `f4529a2`.
  Integradas con `6d3c005` y `fb530b6`. El payload mal tipado se rechaza sin
  borrar u omitir intención; la URL OwnData debe ser raíz HTTPS.
- Panel fases 1 y 6: `73f9798`, integrado con `2cb7e51`. Ref UI publicada
  v0.67.1 (`9dc9ec44216d22e92fad72fc1ad08bf3296a8da2`), Node 24.21.0
  local/CI/Docker, rango `>=24.15.0 <25`. Kit/browser claro y oscuro a
  360/390/1440; Combobox compatible conservado.
- Integrador: identidad canónica `92a14f0`; health y sonda multihost por SHA
  `4d2d4b6`/`49199a5`. El merge conserva tanto el anclaje SHA como
  `transpilePackages: ["owncoding-ui"]` (necesario para compartir React en SSR).
- Postgres local aislado `127.0.0.1:55473/ledbox_quote_qa`: 44 migraciones base
  y migración aditiva de identidad aplicada (45). Prisma validate/typecheck en
  verde. Con kit/backend reunidos: 493 pruebas, 484 pass, 9 skips con gates
  locales, cero fallos. No es todavía QA final de presupuestos/operación.

### Gates detectados por QA temprano

Pilot identificó una carrera de sincronización contra confirmación de pago y
aceptación legacy de IDs de ítems duplicados. Se asignaron a FIN como P1
bloqueantes para el candidato, con regresiones de concurrencia/consistencia.
No se declara PASS por el diagnóstico ni por corregir solo el editor.

FIN `9a8da79` integrado con `83a68a9`; OPS `459028e` integrado con
`c9a5bf4`. Sus pruebas de carril no sustituyen la QA independiente del
candidato conjunto. Identidad en `event-ops?fields=panel`: incremental
plataforma `905861c`, integrado con `96221d2`, expone fantasía y razón social
sin transformar históricos; typecheck y build integrados en verde (sin DB).
Con FIN y OPS reunidos: 509 pruebas, 498 pass, 11 skips, cero fallos;
no es PASS independiente final. En esa revisión se detectaron pendientes de
cuenta predeterminada PYG, conflicto ledger 409 y preview provisional.

Esos tres incrementales FIN quedaron en `8c8d6c2`, integrado con `46c2657`.
Pilot evaluó exclusivamente ese SHA: **FAIL**, contrato SHA256
`7ec0319dfb47ff5438f47dd93d9b16c32d00f50e802e7d0421cb0fdd9d50929e`.
F01/F02 pasaron en PostgreSQL real; faltaba rechazar descuento negativo
(A04/F05) y evitar desborde del KPI agregado en 360 px (F06). El contrato
registra además cobertura parcial/bloqueada: no es aprobación global.

- FIN `1c4d699`: descuento numérico entero no negativo, sin coerción ni clamp;
  integrado con `f35d57b`.
- PANEL local `dbe6f97`: fix canónico F06 y alias de dependencia; integrado
  desde `slot/panel` con `ec6bc5d`, sin push del alias.
- PLATAFORMA local `35effc8`: automatización scoped a umbral 10 y canónico
  GitHub vigente; integrado desde `slot/plataforma` con `6fa42cf`.
- El integrador incluye `test:automation` en `test:rules` después del handoff
  PANEL: las pruebas de locks, scope, gates y retries forman parte del CI.

La nueva QA requiere SHA integrado, checks sellados y revalidación afectada
API/KPI/alias/automatización, además de cerrar los vectores ejecutables parciales.
No se hereda PASS del candidato anterior ni de los checks de los carriles.

### Transferencia GitHub y barrera vigente

El dueño restituyó el owner **dariodeoli**. Repo LedBox ID `1312274819`
conservado; los seis worktrees comparten origin HTTPS
`https://github.com/dariodeoli/ledbox.git`. UI es pública, ID `1380660800`;
`v0.67.1` conserva SHA `9dc9ec44216d22e92fad72fc1ad08bf3296a8da2`.
Package y lock cambian únicamente el owner del alias; no la versión de UI.
Issues/PR/releases/consultas gh usan `dariodeoli/ledbox`. No hay referencias
OwnCoding en CI ni cambio de Docker por esta transferencia.

La pausa global se conserva. La orden posterior explícita **HD** permite publicar
únicamente #173 después de checks, PASS independiente de Pilot y gates Hub;
no autoriza publicar el candidato FAIL ni activar backlog general.
No hay watcher activo, PID de ciclo publicado ni primer deployment #173.
`docs/AUTOMATIZACION.md` documenta comando, locks, logs, gate y estado; activar
requiere completar checks/Pilot y verificar permisos y sello del build.
La lectura Hub volvió a 200 con la credencial renovada; el ajuste autorizado
`include_source_commit_in_build=true` fue rechazado con PATCH 403 y GET posterior
confirmó `false`. No confundir acceso de lectura con permiso de cambio/trigger.
Auditoría externa: `evidencia/plan-formularios/AUDITORIA-DEPLOY-173.md`.

La selección pública **no necesita un hook persistente nuevo**: `propose`
solo crea una solicitud pendiente; la aceptación en
`app/api/admin/budgets/requests/route.ts` ya recalcula las condiciones en la
misma transacción. El preview de `PortalBudgetView` debe proyectar el plan
dinámico sobre el total del borrador, identificándolo como provisional y
sin cambiar la oferta guardada. Gate: total `1000001`, plan 30 % + fijo
`200000` + restante; excluir alquiler `600000` debe mostrar total `400001`
y cuotas `120000`, `200000`, `80001`. Una reducción incompatible con el
fijo exige error honesto, nunca truncamiento. Pilot revalida A28–A30,
V10 e I06 por SHA final (incluidos rollback y documento postaceptación).

La lectura autenticada actual del Hub devuelve 401; configuración efectiva de
runtime/auto-deploy no verificable por ese canal. No se traslada el diagnóstico
histórico a este estado. La verificación del rollout del alcance requiere
gates finales y la versión/SHA realmente servidos.

## Gates de cierre

1. Kit compatible con ref publicada verificable y runtime local/CI/deploy coherentes.
2. Identidad comercial preservada, razón social fiscal separada, localidades y contactos coherentes; OwnData sin credencial admite entrada manual y estados honestos.
3. Alta/edición compactas, sugerencias plegadas, aritmética alquiler/servicios conservada, evento editable con permiso servidor.
4. Condiciones porcentuales/fijas/restantes cierran en PYG sobre el total final; cobros y comprobantes permanecen intactos; documentos aceptados no cambian silenciosamente.
5. Portal e impresión mantienen datos comerciales sin costos internos, con jerarquía de ítems y A4 multipágina.
6. Checks y QA independiente por SHA candidato. Verificaciones mutantes solo en base local.
7. Publicación solo después de gates aprobados; distinguir push, aceptación del Hub y versión/SHA realmente servidos.

## Dependencia externa

OwnData: credencial no provista. Revisar contrato local/documentación; no inventar URL, claves, respuestas ni datos fiscales. La consulta real requiere configuración backend y verificación del proveedor. No bloquea las fases independientes ni la entrada manual.

## Evidencia

Handoffs y resultados por carril: `~/.herdr/worktrees/ledbox/evidencia/plan-formularios/`.
Los resultados finales, SHA candidato y deploy se añaden luego de ejecutar sus gates.

Sonda de publicación (lectura, sin trigger):

```bash
node scripts/verify-release.mjs <versión> <SHA completo>
```

`/api/health` conserva su contrato y añade `version` y `sha` del build. El SHA se
sella desde `SOURCE_COMMIT`/`GITHUB_SHA` o Git durante el build; si no existe
fuente verificable, responde `null` y la sonda falla. No se usa el SHA del
checkout local como evidencia de lo servido.
