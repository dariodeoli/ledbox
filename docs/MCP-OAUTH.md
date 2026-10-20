# OAuth para MCP: base de descubrimiento (issue #362)

## Estado

Esta entrega prepara la metadata del recurso MCP, el URI canónico, la lista de
scopes y helpers server-side para audiencia y PKCE S256. **No habilita todavía
conexiones MCP de producción.** El login actual con Google es un proveedor de
identidad para la sesión web del panel; no emite access tokens OAuth de
EventOS y no debe publicarse como `authorization_server` de MCP.

El endpoint `/.well-known/oauth-protected-resource/mcp` sirve Protected
Resource Metadata (RFC 9728) desde el origen canónico configurado en
`NEXT_PUBLIC_ADMIN_URL` (por ejemplo,
`https://app.eventoss.online/.well-known/oauth-protected-resource/mcp`).
Anuncia `resource` como el URI canónico `/mcp`, los scopes admitidos y el método
Bearer por header. Deliberadamente no anuncia `authorization_servers`: no hay
un authorization server/token exchange implementado y un valor ficticio
induciría a los clientes a un flujo imposible. Por esa razón, clientes MCP que
exigen un AS anunciado aún no podrán completar el descubrimiento.

## Scopes y límites

Los scopes de escritura se derivan de `ROLE_CAPABILITIES` mediante `roleCan`; no
duplican la matriz de roles. `mcp:connect` es el scope base. Los scopes son un
límite de consentimiento, no sustituyen autorización: cada futura llamada de
herramienta debe resolver nuevamente la sesión, membresía activa, empresa y rol
en servidor. No confiar en un `organizationId` suministrado por el modelo, el
cliente MCP o el prompt. No se publican scopes de perfil, API keys ni papelera.

`mcpAudienceMatches` compara el `resource`/audience exactamente contra el URI
canónico; no acepta coincidencias parciales de host. `pkceS256Challenge` y
`verifyMcpPkce` aceptan únicamente el método S256 y validan el formato del
verifier/challenge según RFC 7636. Estos helpers son preparación para un AS; por
sí solos no validan ni emiten tokens.

## Trabajo necesario antes de producción

1. Implementar y operar un authorization server OAuth 2.1 real con metadata de
   autorización (RFC 8414 u OIDC), registro/identificación del cliente,
   autorización/consentimiento, endpoint de token y redención de códigos de un
   solo uso.
2. Atar autorización y tokens al usuario, membresía/empresa activa, URI de
   recurso y scopes consentidos; validar firma, expiración, issuer, audience,
   scopes, revocación y PKCE en el endpoint MCP.
3. Publicar `authorization_servers` en esta metadata únicamente cuando el AS
   real esté desplegado y su metadata sea comprobable. Añadir el desafío `401`
   `WWW-Authenticate` con `resource_metadata` y los scopes requeridos.
4. Implementar `/mcp`, autorización por herramienta y permisos revalidados en
   cada operación; definir idempotencia, auditoría, política de refresh y
   revocación, y probar aislamiento multiempresa.
5. Verificar interoperabilidad con clientes MCP compatibles antes de anunciar
   soporte a usuarios.

No se deben colocar secretos, client secrets, tokens ni datos privados en esta
documentación o en variables `NEXT_PUBLIC_*`.

## Referencias

- [MCP Authorization, revisión 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [RFC 9728 — OAuth 2.0 Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728.html)
- [RFC 8414 — OAuth 2.0 Authorization Server Metadata](https://www.rfc-editor.org/rfc/rfc8414.html)
- [RFC 8707 — Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707.html)
- [RFC 7636 — PKCE](https://www.rfc-editor.org/rfc/rfc7636.html)
