# Extracción de identidad fiscal con OwnData

Contrato contrastado el15/10/2026 con https://app.controlaria.online/docs. La URL antigua de marca no modifica el protocolo: base `https://app.controlaria.online`, `GET /api/v1/ruc/{ruc}`, encabezado `X-API-Key`, respuesta `data.nameOfficial/fullRuc/dv` y `meta.environment/quota/provenance`.

## Configuración del servidor

`OWNDATA_API_URL=https://app.controlaria.online`, `OWNDATA_API_KEY` mediante el gestor de secretos del servidor, `OWNDATA_ENVIRONMENT=test` o `live` según la clave. La URL es raíz, sin `/api/v1`. No poner una clave secreta en `NEXT_PUBLIC_*`, repositorio, mensajes ni capturas.

La documentación distingue la API free con clave de cuenta (cupo compartido100/día) de la API comercial, declarada deshabilitada hasta habilitación de la fuente. Un contrato compatible no acredita clave activa, autorización del proveedor ni consulta real exitosa. LEDBOX muestra la causa si el proveedor devuelve COMMERCIAL_API_DISABLED y conserva carga manual. No sustituir por sesión web ni usar claves publicables en el backend.

## Datos aplicados

RUC/DV y razón social oficial. El contrato documentado no ofrece un nombre comercial/fantasía separado, correo ni contactos: no inventarlos ni sobrescribirlos. El resultado se revisa y aplica explícitamente al guardar, con procedencia y fecha; no representa conexión DNIT en vivo ni verificación de identidad.

## Prueba y operación

Una consulta por clic, bloqueo de doble clic y descarte si se edita el RUC mientras responde. Sin reintento automático; 404/cuota/clave revocada/vencida/servicio deshabilitado tienen salida manual. El test usa transporte simulado con el adaptador real y el contrato publicado. Una consulta real queda pendiente hasta configurar una clave válida del proveedor. No se creó/rotó ninguna clave ni se cambió el acceso de OwnData durante esta implementación.

Seguimiento #266; integración compartida existente, sin endpoint paralelo.
