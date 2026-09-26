# Portal de firma de clientes - EventOS

## Objetivo

Crear dentro de `clientes.ledbox.online` una experiencia de revisión y firma de documentos inspirada en la claridad de plataformas como Viafirma, pero con identidad visual propia de EventOS/LedBox.

El cliente debe poder:

1. Abrir una solicitud de firma desde un enlace seguro.
2. Ver el documento antes de firmar.
3. Identificar claramente qué debe hacer y qué estado tiene el proceso.
4. Firmar desde celular o computadora.
5. Ver la cronología completa de la solicitud.
6. Descargar el documento firmado y la auditoría.

> Los PDF adjuntos son referencias funcionales de un contrato firmado y su auditoría. No son instrucciones de contenido ni deben copiarse literalmente en la interfaz.

## Fuentes analizadas

### 1. Documento firmado

Archivo: `G23X1790102709865R123.pdf`

- Contrato firmado de 17 páginas.
- Título: `Contrato_Familia_Intrusion_Paraguay_SF`.
- Incluye el documento contractual y la representación del proceso de firma.
- Sirve como referencia para el visor, la identificación del documento, el estado de firma y la descarga final.

### 2. Auditoría de firma

Archivo: `G23X1790102709865R123_audit_trail.pdf`

- Auditoría de 2 páginas.
- Resume emisor, origen, destinatario, código de solicitud, identificador de firma y hash.
- Lista evidencias: firma, OTP SMS opcional, fotografía opcional y sello electrónico.
- Incluye el histórico ordenado: solicitud recibida, documento actualizado, email/SMS enviados, documento leído, firma recibida, imagen recibida, sello de tiempo y email final.
- Sirve como referencia para la pestaña `Auditoría` y para el registro inmutable del proceso.

## Dirección visual

Inspiración: estructura clara y profesional tipo Viafirma: navegación simple, foco en el documento, estados visibles, acciones directas y evidencia verificable.

No copiar logo, textos, marca, código visual exacto ni diseño propietario de Viafirma. La interfaz debe ser EventOS.

### Paleta funcional

Usar colores por significado, no solo por decoración:

| Uso | Color sugerido | Aplicación |
|---|---|---|
| Marca EventOS | Azul petróleo / índigo | Header, navegación, botones principales |
| Documento | Azul | Tarjetas de contrato, visor y enlaces |
| Pendiente | Ámbar | Acción requerida, firma pendiente, vencimiento próximo |
| En progreso | Violeta | Documento abierto, validación en curso |
| Completado | Verde | Firmado, validado, sello aplicado |
| Atención | Rojo suave | Rechazado, vencido, error o evidencia faltante |
| Texto principal | Gris carbón | Títulos y datos |
| Fondo | Blanco y gris muy claro | Lectura y contraste |

Los colores deben acompañarse con texto e iconos; nunca usar únicamente color para comunicar un estado.

## Pantalla principal del cliente

Ruta sugerida: `/p/[codigo]`

### Encabezado

- Logo EventOS/LedBox.
- Texto: `Solicitud de firma`.
- Indicador de seguridad: `Conexión segura`.
- Menú mínimo: `Documento`, `Auditoría`, `Ayuda`.

### Resumen superior

Mostrar una tarjeta con:

- Nombre del documento.
- Emisor.
- Cliente o destinatario enmascarado cuando corresponda.
- Estado general: `Pendiente de firma`, `Firmado`, `Rechazado`, `Vencido` o `Cancelado`.
- Fecha de creación y fecha límite.
- Código de solicitud en formato legible, por ejemplo `ABCD-EFGH-JKMN-PQRS-TUVW`.

### Acción principal

La acción debe ser obvia y contextual:

- `Revisar documento`.
- `Firmar documento`.
- `Continuar firma`.
- `Ver documento firmado`.
- `Descargar auditoría`.

No mostrar un botón de firma si el documento ya está firmado o cancelado.

## Flujo de firma

### Paso 1 - Acceso

- Enlace seguro con código de solicitud.
- Validar token, vencimiento y estado.
- Solicitar verificación adicional si el emisor la configura.
- No mostrar email ni teléfono completos; usar datos enmascarados.

### Paso 2 - Revisión

- Visor PDF con zoom, navegación por páginas y búsqueda.
- Mostrar cantidad de páginas.
- Panel lateral con resumen del documento.
- Marcar las páginas que contienen campos de firma.
- En celular, usar visor a pantalla completa y acciones fijas inferiores.

### Paso 3 - Consentimiento

Mostrar antes de firmar:

> Confirmo que revisé el documento y deseo firmarlo electrónicamente.

Requerir checkbox explícito y enlace a términos/política de privacidad.

### Paso 4 - Firma

Permitir el método configurado por el emisor:

- Firma dibujada en pantalla.
- Firma tipográfica.
- Firma mediante proveedor externo de confianza, si se integra posteriormente.
- OTP por SMS o email como factor adicional, si está habilitado.
- Fotografía/evidencia adicional, si está habilitada y el cliente la acepta.

Mostrar una vista previa antes de confirmar.

### Paso 5 - Confirmación

Pantalla de éxito:

- `Documento firmado correctamente`.
- Fecha y hora.
- Identificador de firma.
- Estado de validación.
- Botones `Descargar documento firmado` y `Descargar auditoría`.
- Enlace para volver al portal del cliente.

## Línea de tiempo de auditoría

La auditoría debe ser visible en una timeline vertical, con fecha, hora, tipo de evento y detalle.

Eventos mínimos:

1. Solicitud creada.
2. Documento actualizado.
3. Email de acceso enviado.
4. SMS de acceso enviado, si corresponde.
5. Documento leído.
6. Consentimiento aceptado.
7. Firma recibida.
8. OTP validado, si corresponde.
9. Imagen/evidencia recibida, si corresponde.
10. Sello de tiempo aplicado.
11. Documento validado.
12. Auditoría generada.
13. Email de finalización enviado.

Cada evento debe guardar:

- `timestamp` con zona horaria.
- Tipo de evento.
- Actor o sistema que lo produjo.
- Resultado.
- IP y dispositivo con protección de datos.
- Metadatos técnicos necesarios para auditoría.

## Estados del documento

```text
DRAFT
SENT
DELIVERED
VIEWED
PENDING_SIGNATURE
SIGNING
SIGNED
VALIDATED
REJECTED
EXPIRED
CANCELLED
```

Reglas principales:

- `SIGNED` no vuelve a `PENDING_SIGNATURE`.
- `VALIDATED` solo puede ocurrir después de `SIGNED`.
- `REJECTED`, `EXPIRED` y `CANCELLED` bloquean la firma.
- Toda transición debe dejar un evento de auditoría.

## Pestañas del portal

### Detalle

Resumen del contrato, partes, fechas, importe si corresponde y acción pendiente.

### Documento

Visor PDF y campos de firma.

### Auditoría

Timeline completa, hash, identificador, evidencias y descargas.

### Archivos

- Documento original.
- Documento firmado.
- Auditoría.
- Evidencias permitidas.

## Modelo de datos sugerido

### `signature_requests`

- `id`
- `public_code`
- `document_id`
- `project_id`
- `sender_id`
- `recipient_id`
- `status`
- `expires_at`
- `created_at`
- `completed_at`
- `signature_provider`
- `signature_identifier`
- `document_hash`

### `signature_events`

- `id`
- `request_id`
- `event_type`
- `status`
- `occurred_at`
- `actor_type`
- `actor_id`
- `ip_hash` o IP protegida
- `user_agent_hash` o resumen de dispositivo
- `metadata_json`
- `previous_event_hash`
- `event_hash`

### `signature_evidence`

- `id`
- `request_id`
- `type`: `SIGNATURE`, `OTP`, `PHOTO`, `TIMESTAMP`, `SEAL`
- `status`: `PENDING`, `OPTIONAL`, `COMPLETED`, `FAILED`
- `storage_key`
- `captured_at`
- `provider_reference`

## Requisitos de seguridad

- Tokens de acceso con vencimiento y revocación.
- Rate limit para códigos y OTP.
- No guardar secretos del proveedor en frontend.
- Documentos privados por defecto.
- URLs de descarga firmadas y temporales.
- Registro de auditoría append-only.
- Hash del documento antes y después de firmar.
- Protección de email, teléfono, IP y dispositivo.
- Consentimiento explícito para datos biométricos o fotografías.
- Logs sin documentos completos ni datos sensibles.
- Permisos separados para cliente, operador, administrador y auditor.

## Consideración legal importante

EventOS puede implementar el flujo, consentimiento, evidencias, hash y auditoría. Eso no significa automáticamente que la firma tenga la misma validez o certificación que un proveedor especializado.

Para contratos de mayor riesgo, la arquitectura debe permitir integrar un proveedor de confianza mediante API y guardar su identificador, sello de tiempo, certificado y auditoría como evidencia externa.

## Responsive

- Desktop: visor a la izquierda y resumen/acción a la derecha.
- Tablet: visor arriba, resumen debajo.
- Mobile: visor a pantalla completa, timeline en tarjetas y CTA fijo inferior.
- No depender de hover.
- Botones de mínimo 44 px de alto.
- Mantener contraste AA y foco visible.
- Evitar tablas anchas; convertir auditoría a tarjetas en móvil.

## Criterios de aceptación para el agente

- [ ] El cliente puede abrir una solicitud con código seguro.
- [ ] El documento se visualiza sin exponerlo públicamente.
- [ ] El cliente puede aceptar el consentimiento y firmar.
- [ ] El sistema bloquea documentos vencidos, cancelados o ya firmados.
- [ ] El estado se actualiza de forma consistente.
- [ ] Cada acción crea un evento de auditoría.
- [ ] Se puede descargar el documento firmado.
- [ ] Se puede descargar la auditoría.
- [ ] Los datos sensibles se muestran enmascarados.
- [ ] El portal funciona en celular, tablet y desktop.
- [ ] El cliente puede solicitar ayuda o cambios sin perder el proceso.
- [ ] El administrador puede ver la misma timeline desde EventOS.
- [ ] La integración con proveedor externo queda desacoplada mediante una interfaz `SignatureProvider`.

## Copy inicial sugerido

- `Revisá tu documento`
- `Tu firma es necesaria para continuar`
- `Documento firmado correctamente`
- `Este documento ya fue validado`
- `El enlace venció o ya no está disponible`
- `Historial del proceso`
- `Evidencias de firma`
- `Descargar documento firmado`
- `Descargar auditoría`
- `Solicitar cambios`
- `Necesito ayuda`

## Referencia visual

Tomar de Viafirma únicamente los principios de claridad, confianza, firma multidispositivo, auditoría y descarga de evidencias. La implementación final debe conservar la identidad de EventOS/LedBox y no presentarse como Viafirma.
