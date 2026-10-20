# Conectar LedBox/EventOS a clientes MCP (ChatGPT, Claude y compatibles)

**Estado: propuesta de implementación y guía de onboarding. No existe una conexión MCP/OAuth publicada ni este documento permite conectar cuentas hoy.** No se encontró servidor o endpoint MCP, metadata OAuth MCP ni paquete/route MCP en el código inspeccionado. El OAuth de Google descrito en [SSO.md](SSO.md) sólo inicia sesión en el panel: no es OAuth delegado para acceder a herramientas MCP. Verificar de nuevo antes de anunciar disponibilidad.

Esta guía define el contrato deseado y cómo preparar una futura conexión. Los endpoints, scopes y límites que siguen son propuestas que deben implementarse, probarse y aprobarse; no son endpoints ni permisos activos.

## Objetivo y modelo de confianza

Publicar un servidor remoto MCP sobre HTTPS para que cada persona vincule su propia cuenta desde ChatGPT, Claude u otro cliente compatible. El cliente no recibe credenciales del panel ni una API key empresarial. Cada invocación autentica el bearer token y valida empresa, membresía, rol y capacidad, aplicando las mismas reglas de dominio que las APIs existentes.

La autorización proviene de identidad verificada y membresía efectiva. Nunca confiar en organizationId, rol, tenant, usuario o permiso que el modelo envíe como argumento. No permitir reutilizar tokens emitidos para otra API, cliente o empresa.

### Roles actuales del panel

Fuente de verdad: lib/server/permissions.ts. Describe permisos de escritura del panel, no permisos MCP. La futura integración debe reusar requireAdminContext y roleCan, más controles de tenant, en cada herramienta.

| Membresía | Capacidades de escritura actuales | Restricciones |
|---|---|---|
| OWNER | Todas las capacidades del panel | Sólo OWNER administra API keys; aprobación «igual sin stock» sólo OWNER y ADMIN. |
| ADMIN | Todas las capacidades de módulos del panel | No administra API keys. |
| FINANCE | Presupuestos, finanzas, proveedores, costos de inventario | Sin empresa, clientes, eventos, inventario.write, promotoras, usuarios o papelera. |
| OPERATIONS | Clientes, eventos, inventario, promotoras y costos de inventario | Sin presupuestos, finanzas, proveedores, usuarios, empresa, papelera o API keys. |
| VIEWER | Sólo su propio perfil | No exponer herramientas comerciales sensibles hasta definir una matriz de lectura explícita. |

Las capacidades actuales son principalmente de escritura. No inferir permisos de lectura por el nombre del rol. Antes del piloto, crear una matriz herramienta × capacidad × rol que defina por separado lectura y escritura de clientes, eventos, catálogo, inventario, presupuestos, pagos y finanzas. Hasta entonces, mantener esas herramientas deshabilitadas.

## Catálogo futuro: empezar mínimo y de sólo lectura

Publicar inicialmente únicamente herramientas necesarias para consultar información de la empresa activa.

| Familia propuesta | Ejemplos futuros | Política requerida |
|---|---|---|
| Catálogo público | Buscar/listar productos y categorías públicas | Anónimo sólo si devuelve exactamente el catálogo publicado; nunca costos ni stock privado. |
| Identidad | who_am_i, identidad pública de la empresa conectada | Token válido; empresa inequívoca; no exponer otras membresías ni campos internos. |
| Inventario | Buscar ficha, disponibilidad resumida por fecha | Política de lectura explícita y aislamiento por empresa; ocultar costo interno salvo permiso específico. No reservar ni ajustar stock. |
| CRM/operación | Buscar clientes, eventos o leads | Permiso de lectura explícito y datos mínimos. Crear lead requiere consentimiento explícito. |
| Presupuestos | Leer o crear borrador | Lectura según matriz; crear borrador requiere budgets.write. Enviar, aprobar, firmar y cobrar son acciones separadas. |
| Escrituras sensibles | Enviar/aprobar presupuesto, mover stock, cambiar cuentas bancarias, pagos, eliminación definitiva, invitar usuarios | Fuera del primer piloto. Si se habilitan después: permiso específico, vista previa, confirmación humana, idempotencia y auditoría. |

No crear herramientas genéricas execute, sql, http, fetch_url o admin_action, ni un API passthrough. No exponer herramientas para cambiar OAuth, emitir/revocar credenciales o elevar roles.

## Confirmaciones

1. Consultas sin efectos no requieren confirmación, pero siempre requieren token y permiso. Para datos temporales (disponibilidad, stock), indicar fuente/fecha.
2. Antes de crear lead o borrador, mostrar el resumen exacto y pedir confirmación en el cliente. La API debe requerir una acción explícita e idempotency key; no enviar email/WhatsApp ni crear reserva/pago automáticamente.
3. Enviar, aprobar, firmar, cobrar, borrar definitivamente, cambiar inventario/cuenta bancaria o conceder accesos no se incluye en el piloto. Si se aprueba en una fase posterior, pedir confirmación inmediata antes de ejecutar, volver a validar datos y permisos en el servidor, y exigir confirmación de un solo uso ligada a usuario, tenant, operación y payload, con expiración breve. No reintentar una acción de resultado incierto automáticamente.
4. Auditar actor, organización efectiva, cliente MCP, herramienta, tipo de operación, resultado e idempotency key. Nunca registrar bearer/refresh token, secretos, prompt completo ni foto original.

La confirmación del cliente ayuda a la experiencia, pero no sustituye la confirmación del producto o aprobación existente que una operación requiera.

## OAuth y descubrimiento requeridos

El endpoint canónico será configurable (MCP_SERVER_URL); no fijar el dominio hasta elegirlo y verificar DNS/TLS. Ejemplo ilustrativo: https://<host-MCP-elegido>/mcp.

### Authorization Code + PKCE

- Usar Authorization Code y PKCE S256; state aleatorio de un solo uso ligado a la sesión, expiración corta y protección CSRF.
- Rechazar redirect URI que no coincida exactamente con un callback registrado. Sin redirecciones abiertas.
- Sin implicit grant, password grant, tokens en query string ni client secret en frontend/cliente público.
- Verificar en metadata code_challenge_methods_supported: ["S256"]; si falta o no anuncia S256, detener el flujo.
- El cliente envía Authorization: Bearer en cada petición. El servidor valida firma/introspección, issuer, audiencia, expiración, scopes y revocación antes del handler.
- Token de acceso corto. Refresh token sólo si hace falta: cifrado, rotado, con detección de replay y revocación/desconexión probadas. Duración/retención se deben decidir y configurar antes del piloto.
- Preferir un proveedor de identidad establecido; no implementar un authorization server improvisado dentro de una route Next.js.

### Resource, audience y tenant

Para el identificador canónico https://<host-MCP-elegido>/mcp, el cliente envía resource tanto a authorize como a token; el AS lo conserva/vincula al access token. El servidor valida que aud identifica ese recurso y rechaza tokens con audiencia ausente o de otro recurso.

El slug de empresa no es autorización. Si la persona pertenece a varias empresas, su identidad y membresía deben permitir escoger únicamente una organización autorizada. Nunca aceptar organizationId libre desde el argumento de herramienta. Revalidar membresía, estado, tenant y capacidad en cada request. Los cursores también se atan a usuario, tenant y scopes.

### Well-known, challenge y HTTPS

1. GET https://<host>/.well-known/oauth-protected-resource (RFC 9728) devuelve metadata pública no sensible con resource canónico y authorization_servers del AS real. Publicar scopes_supported únicamente cuando el catálogo de scopes esté definido.
2. Endpoint protegido sin token o con token inválido devuelve 401 y WWW-Authenticate: Bearer resource_metadata="<URL metadata>"; incluir scope mínimo cuando aplique. Token válido sin permiso devuelve 403 sin revelar datos.
3. El AS publica metadata OAuth en discovery RFC 8414 y/o OIDC: issuer, authorization_endpoint, token_endpoint, response_types_supported, grant_types_supported, code_challenge_methods_supported, token_endpoint_auth_methods_supported y capabilities reales de scopes/refresh.
4. Elegir el registro de cliente: pre-registro, Client ID Metadata Documents o Dynamic Client Registration. No habilitar DCR abierto sin anti-abuso; proteger fetch de documentos CIMD contra SSRF y destinos privados.
5. HTTPS válido para servidor MCP, AS, metadata y callbacks; host canónico y redirecciones inequívocas. CORS no reemplaza autorización.
6. Si se usa path /mcp, probar discovery raíz y path-aware, WWW-Authenticate y proxy/TLS termination. No derivar URLs confiables de un Host sin validar.

## Fotos y límites propuestos

- El primer piloto no permite buscar archivos arbitrarios, comprobantes, firmas ni fotos privadas. Para catálogo, sólo resolver fotos que la empresa ya publicó y que el usuario puede ver.
- No descargar una URL arbitraria proporcionada por modelo/usuario. Validar MIME y magic bytes, decodificar/recomprimir, quitar EXIF y bloquear SVG/HTML ejecutable. Mitigar SSRF, path traversal y hotlinks.
- Preferir miniaturas. Propuesta inicial a validar: JPEG/PNG/WebP, hasta 1 MiB por imagen entregada y hasta 1200 px por lado. No es un límite implementado hoy.
- No incrustar fotos base64 en texto por defecto. Usar recurso de imagen con MIME correcto y URL temporal opaca, restringida y de corta duración; sin token en URL ni PII en rutas.
- Propuesta de paginación: 20 resultados por defecto, máximo 100 por llamada; cursores opacos, firmados, con vencimiento y ligados a usuario/tenant/scope.
- Propuesta de respuesta: JSON hasta 64 KiB por llamada; miniatura separada hasta 1 MiB. Truncar con hasMore/cursor, nunca ocultar silenciosamente campos críticos.
- Antes del piloto definir límites configurables para herramientas activas, concurrencia, requests/minuto, intentos OAuth, timeout, body y retención de auditoría. Responder 429 con Retry-After y limitar por IP y cliente/usuario/tenant. Los valores finales no están definidos ni aplicados aquí.
- Validar argumentos con esquema en servidor. Rechazar campos desconocidos, rangos ilimitados y payloads grandes. Errores sin SQL, stack trace, tokens ni IDs de otras empresas.

## Onboarding

### Preparación EventOS (pendiente)

1. Elegir host MCP y authorization server; confirmar DNS, TLS y responsables. eventoss.online lleva doble s; eso por sí solo no decide el subdominio.
2. Implementar Streamable HTTP y fijar versión de protocolo/transport.
3. Implementar OAuth delegado y puente de identidad/membresía; mapear scopes a capacidades; añadir permisos de lectura explícitos y auditoría.
4. Preparar herramientas read-only iniciales y pruebas de cross-tenant, token inválido/audiencia/expiración/revocación/scopes/PKCE y límites de imagen/resultado.
5. Preparar tenant demo con datos ficticios; no clonar base real. Desactivar transporte de emails/WhatsApp, pagos y operaciones financieras.
6. Pilot cerrado con Owner y QA; verificar refresh y revocación, y revisar logs.
7. Publicar URL e instrucciones sólo después de pruebas, revisión de seguridad y despliegue FINISHED con versión/SHA verificados.

### ChatGPT

La interfaz y disponibilidad dependen del plan, políticas y versión de ChatGPT. Revisar la documentación oficial de conexiones MCP personalizadas antes de dar instrucciones al equipo.

Flujo previsto cuando esté habilitado: área de apps/conectores → agregar servidor MCP personalizado → ingresar nombre y endpoint HTTPS entregado por EventOS → seleccionar OAuth → autenticar en EventOS → revisar empresa y scopes → autorizar → probar primero herramientas de lectura. En un workspace empresarial, Owner/Admin debe revisar el borrador, herramientas, permisos y acceso antes de publicarlo; las acciones de escritura empiezan deshabilitadas.

No pegar password, token o clave en el chat. Login ocurre en la ventana OAuth del IdP/EventOS; el cliente autorizado gestiona el token.

### Claude, Claude Desktop y otros clientes

La disponibilidad de conectores MCP remotos depende del plan y la superficie. En equipos puede requerirse que Owner/Primary Owner habilite el conector; cada persona conecta su propia cuenta. En interfaces actuales de Claude, el recorrido documentado es Settings → Connectors → Add connector → URL remota → Connect/autorizar; puede cambiar por versión y plan.

Un cliente MCP compatible puede añadir el URL Streamable HTTP e iniciar OAuth si implementa metadata, PKCE S256 y scopes. Algunos clientes sólo admiten STDIO local o DCR legado; no asumir compatibilidad por llamarse MCP. No usar bearer fijo ni guardar secreto en configuración local.

En todos los clientes, confirmar nombre del servidor, empresa, permisos y herramientas habilitadas. Empezar en lectura. Rechazar una solicitud de escritura no esperada.

## Checklist de aceptación para declarar conexión lista

- [ ] Endpoint MCP versionado y CI verde para el SHA de integración.
- [ ] URL Streamable HTTP, versión MCP y matriz ChatGPT/Claude/otro cliente realmente probadas.
- [ ] HTTPS, health, límites y revocación/rollback operativos.
- [ ] Metadata well-known, AS discovery, challenge, resource/audience y callbacks verificados con pruebas y cliente QA.
- [ ] Authorization Code + PKCE S256, redirect exacto, state, expiración, refresh rotation/revoke y audiencia cubiertos por pruebas negativas.
- [ ] Matriz herramienta × rol × tenant revisada; cada herramienta autoriza server-side.
- [ ] Confirmaciones, idempotencia y auditoría probadas; lecturas y selecciones no hacen side effects.
- [ ] PII, costos, fotos y límites probados con fixtures, sin secretos en logs.
- [ ] Tenant demo aislado; pagos, envíos, firmas y stock real fuera de QA.
- [ ] Guía de usuario comprobada en cuenta QA; publicación sólo después de FINISHED y versión/SHA exactos.

## Fuentes oficiales para revisar antes de implementar

- [MCP Authorization, especificación 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization): discovery, PKCE, resource, audiencia, HTTPS y tokens.
- [RFC 9728: Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728), [RFC 8414: Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414), [RFC 7636: PKCE](https://datatracker.ietf.org/doc/html/rfc7636).
- [RFC 8707: Resource Indicators](https://datatracker.ietf.org/doc/html/rfc8707) y [RFC 9700: OAuth 2.0 Security BCP](https://datatracker.ietf.org/doc/html/rfc9700).
- [OpenAI: autenticación MCP](https://developers.openai.com/plugins/build/auth) y [conectar servidores MCP personalizados en ChatGPT](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt).
- [Anthropic: conectores MCP remotos](https://support.anthropic.com/en/articles/11503834-building-custom-integrations-via-remote-mcp-servers) y [configurar conectores personalizados](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp).

MCP y los clientes evolucionan. Antes de implementar, fijar una revisión concreta del protocolo y revalidar requisitos, callbacks, pantallas y planes con fuentes oficiales. Este documento no acredita una conexión habilitada o publicada.
