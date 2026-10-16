# Presupuestos: recibos de envío

El correo se previsualiza sin escribir ni enviar. Cada vista previa tiene una confirmación distinta, vinculada a empresa, usuario, presupuesto y contenido; la confirmación conserva su vencimiento original.

Antes de contactar al proveedor se confirma un recibo pendiente en `IdempotencyKey`. La llamada de red ocurre fuera de la transacción. Repetir la confirmación o consultar el recibo no vuelve a llamar al proveedor. Se conserva durante siete días y no contiene el JWT, HTML ni código público del presupuesto. Consultarlo requiere la misma empresa, usuario y permiso vigente.

Si el proveedor acepta el mensaje, se guarda primero el resultado y luego se concilia el presupuesto con el bloqueo comercial compartido. Sólo un borrador sin cambios, aprobación, archivo ni firma aceptada pasa a Enviado. Los estados posteriores se conservan. La actualización y su auditoría se confirman junto con el resultado de conciliación. Los contadores se refrescan con el mecanismo compartido del panel.

Una caída de red, un error interno del proveedor o una respuesta sin identificador no acreditan rechazo: se muestran como **Sin confirmar**. No se reenvían automáticamente ni cambian el estado comercial. Un recibo pendiente puede recuperarse al reabrir el diálogo; el navegador guarda únicamente su identificador, separado por empresa, usuario y presupuesto. Crear otro intento exige confirmación explícita y otra vista previa porque podría duplicar un mensaje ya aceptado.

La aceptación del proveedor no prueba entrega al buzón. No se promete entrega exactamente una vez: si el proceso cae después del envío y antes de guardar el resultado, queda la incertidumbre del recibo previo. Las simulaciones de demo siguen sin correo externo y no pasan el presupuesto a Enviado. Esta protección corresponde al envío de presupuestos; no convierte los demás consumidores de correo en un sistema general de reintentos.

Validación: pruebas de ruta y consumidores, SDK con resultados inciertos y transacciones PostgreSQL aisladas para concurrencia, cambios de estado durante la red, permisos, recuperación y fallos reales de persistencia. No se usan correos ni cobros reales.
