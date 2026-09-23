# Guía de la demo — LedBox

La demo es pública, con datos simulados y **solo lectura** (no se puede romper ni tocar datos reales).

## URLs

| Superficie | URL |
| --- | --- |
| Panel (demo) | https://demo.ledbox.online |
| App y landing de EventOS | https://app.ledbox.online · https://eventos.ledbox.online |
| Portal del cliente — **autogestión** (pendiente) | https://clientes.ledbox.online/p/D3M9-F3R4-A2PY-Q7SC-K4VT |
| Portal del cliente — **aprobado** (con datos de pago) | https://clientes.ledbox.online/p/D3M9-5G97-4XKW-2M8R-T3HN |

No hace falta usuario ni contraseña: `demo.ledbox.online` abre la demo en la raíz (la URL queda limpia, sin `/demo`) y ahí el sistema crea la sesión de demostración automáticamente (también funciona un link directo a un módulo, p. ej. `demo.ledbox.online/finanzas`). La primera visita abre un **popup de bienvenida** («Recorrer la demo» o la X) que no vuelve a mostrarse en ese navegador; la barra fina de la portada lo reabre y deja a mano el portal, el resumen y el reinicio de datos. El chip **DEMO** y el aviso fijo recuerdan que es una demo.

## Recorrido de 8 minutos

1. **Resumen**: KPIs, "Qué mirar hoy" con los avisos reales (vencidos y próximos) y los próximos eventos con la ventana viva.
2. **Calendario**: mes con montajes, eventos, cobros y vencimientos; alertas de atrasados (hoy: 66 movimientos, 7 atrasados) y el cronograma hasta fin de año.
3. **Eventos**: checklist operativo por evento (avance real: completos, parciales y pendientes), con tareas vencidas a la vista.
4. **Clientes**: la lista con **Contratado · Presup. · Deuda vencida · Última actividad**; al abrir uno, la **ficha 360** con contratos, totales, frecuencia de contratación e historial. Y **Leads** para el pipeline comercial.
5. **Presupuestos → link/QR → Portal**: abrí el portal de **autogestión**: ajustar cantidad y días, ver el total en vivo, **pedir rebaja** y enviar la propuesta.
6. **Portal aprobado**: evidencia de la aprobación digital, plan de cuotas, **datos de pago** (Ueno Bank con su logo) y la **cronología completa** del presupuesto (envío, primera vista, cambios, aprobación, pagos, evento).
7. **Inventario y Proveedores**: asignaciones con disponibilidad y conflictos, equipos dañados/faltantes, trabajos en distintos estados con anticipos y saldos.
8. **Finanzas**: cobrado, por cobrar y mora, **Por confirmar** (comprobantes del cliente en revisión) y **Tesorería** por cuentas (efectivo / banco / cheques) con los saldos derivados y los **gastos** (dos "A definir" para ver la asignación desde la fila).
9. **Auditoría**: quién hizo qué y cuándo en la propia demo (resumen en la landing).

## Qué mirar para evaluar

- Los estados **no son todos verdes**: hay mora, checklist incompleto, equipos dañados, un proveedor atrasado y un evento cancelado.
- Las **fechas se mantienen vivas solas**: los eventos reales de Paraguay se proyectan a la ventana ±6 meses y los estados se derivan de la fecha (el cronograma cubre todo el año).
- Los códigos de los portales pueden cambiar si la demo se reprovisiona; siempre están publicados en la portada de la demo.
- La demo muestra también **tesorería, gastos, conciliación, invitaciones, correos, logos/avatares y la cronología** (issue #32).

## Portal de la demo: simulado y sin persistencia (issue #52)

- El modo demo ya no depende de `?demo=1`: la página detecta que el presupuesto es de la empresa de ejemplo y muestra el aviso de datos simulados. Los links viejos con el marcador siguen funcionando (compatibilidad).
- La demo **no escribe nada** en el portal: no se marca `viewedAt` y las acciones del cliente (autorizar con ajustes, pedir rebaja, pedir un cambio, subir el comprobante) se resuelven en el navegador y se guardan por sesión (`sessionStorage`, clave por token). Sobreviven la navegación de esa visita y **otro visitante ve el estado canónico**.
- Los endpoints del portal rechazan cualquier escritura sobre la demo (403 «Modo demo: solo lectura»), igual que hace el panel con la sesión demo.
- Los re-seed de `/api/portal/demo` y de la landing del panel quedan como **red de seguridad**: con el portal sin escrituras no deberían dispararse, así que más adelante se pueden simplificar.
- La cronología sigue siendo la canónica: los hitos simulados no se inventan.
