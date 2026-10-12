# Eventos · calendario operativo · #56 / #119

Unidad admitida por `PLAN-UX-CALENDARIO-RESPONSIVE.md`, base explícita `bc0619eca31177cd2c1f291d72c38b49fd82a417`. Selector único `AdminViewSwitch`: Lista · Tarjetas · Calendario, vista recordada por el hook existente; `?vista=calendario` mantiene su entrada histórica. El dueño autorizó la prop aditiva `labels` para nombrar Tarjetas sin alterar los rótulos predeterminados del resto de módulos.

## Un calendario, cuatro períodos

- **Mes**: grilla completa lunes–domingo; en móvil, agenda de días con movimientos y hoy.
- **Semana**: agenda completa de siete días, incluidos los vacíos.
- **Próximos 30 días**: treinta días inclusivos desde el ancla; Hoy vuelve al día actual de Asunción.
- **Dos meses**: dos grillas del objeto existente lado a lado en escritorio, apiladas en ancho compacto; agenda unificada en móvil. Los días vecinos de cada grilla no duplican la consulta ni los indicadores.
- Anterior/Siguiente desplazan una semana, treinta días, uno o dos meses según la vista. Cambiar período cierra la selección previa.

## Contrato real y detalle

Dependencia exclusiva PF `b3d8af5fabd61befb13a9fc88bf8a5d5f20d1b39`, recibo autoritativo `evidencia/ronda-al/plataforma/calendar-overlap/HANDOFF.md`. No arrastra archivo #161, FIN ni firma/drag.

`GET /api/admin/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` consulta días inclusivos de Asunción. El intervalo de duración es **[at, endAt)**; `date` puede ser el primer día visible del rango consultado y **no sustituye el inicio real**. La UI distribuye un marcador event en los días ocupados recortados al período, con el último milisegundo anterior a endAt para excluir la medianoche final. Sin fin válido se conserva sólo el hito conocido; nunca se inventan duraciones abiertas. El marcador event_end independiente permanece visible en su fecha real.

Los indicadores cuentan ítems originales del API, no repeticiones visuales por día. Cobros y alertas conservan sus contratos. El resumen se abre al seleccionar cualquier marcador, muestra datos reales y tiene enlace al módulo origen. Para eventos, la ficha usa el **recurso existente `event-ops?fields=panel`** de Eventos: fechas completas, cliente, lugar, montaje/desmontaje incluso fuera del período. No añade campos ni endpoints. Si ese recurso no contiene la ficha, muestra carga/error/no disponible honestamente.

Selección por Enter o toque; el resumen inline recibe foco. Escape dentro del resumen o Cerrar devuelve el foco al marcador. No se crea otro diálogo/calendario/helper de campos. Todos los cambios CSS están acotados a `.admin-events-calendar .admin-cal-*`; no alteran las dependencias selladas de ayuda/moneda/columnas.

## Verificación reproducible

`tests/calendar-ui.integration.test.ts` requiere `CALENDAR_UI_BASE_URL` localhost y `DATABASE_URL` Postgres local con base `ledbox_quote_qa`. Crea usuario VIEWER, cliente y eventos sintéticos en una organización aislada; navega la página real con sesión real y consulta el API real. Matriz dark/light ×360/390/1440 × cuatro vistas, evento contenedor, fin exclusivo medianoche, resumen comparado con fechas originales y campos de event-ops, foco/Escape, dos meses lado a lado, persistencia del selector y overflow de página. La fuente de QA es sintética identificada, nunca datos ni métricas inventadas para el producto.

La prueba PF `tests/calendar-overlap.integration.test.ts` conserva su oracle HTTP/PG de límites, nulos, rangos invertidos, tenancy y sesión. El handoff final identifica el SHA exacto, artefacto exportado, runtime/PG propios, verificaciones y evidencia por caso. Una QA local no acredita publicación ni un candidato integrado distinto.
