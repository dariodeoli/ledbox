# EventOS MCP OAuth authorization server (issue #368)

## Implemented flow

The MCP authorization server uses public, pre-registered OAuth clients and
Authorization Code + PKCE S256. It is separate from Google sign-in: Google
continues to create only the normal EventOS web session. That web session is
required to review and grant MCP consent; the MCP client receives a distinct
opaque access token.

- AS metadata: `/.well-known/oauth-authorization-server`
- Protected-resource metadata: `/.well-known/oauth-protected-resource/mcp`
- Authorization/consent: `/oauth/authorize`
- Token exchange: `/oauth/token`
- Revocation: `/oauth/revoke`
- Resource identifier: the canonical configured app origin plus `/mcp`
- Access token: opaque random bearer, raw value returned once, SHA-256 hash
  stored in PostgreSQL, 10-minute lifetime, revocable immediately.
- Authorization code: random, hash-only, exact-client/redirect/resource bound,
  one use, 5-minute lifetime, PKCE S256 verifier required at exchange.
- No refresh token, implicit flow, password grant, client secret, wildcard
  redirect, dynamic client registration, or authorization by tenant argument.

Each token use resolves the user and active membership again, checks that the
organization and user remain active, verifies exact client/resource binding,
expiration and revocation, and ensures the grant scopes remain allowed by the
user's current role. MCP tool dispatch checks the OAuth grant scope as well as
its existing role matrix. OAuth sessions are bound to the access-token record
and organization so another grant cannot reuse the protocol session.

## Fail-closed deployment configuration

All variables are server-side. OAuth endpoints return 503 and resource
metadata omits `authorization_servers` unless all three values are valid.
`MCP_OAUTH_ISSUER` must be the exact HTTPS origin configured as
`NEXT_PUBLIC_ADMIN_URL`; local HTTP is accepted only for localhost development.
There are intentionally no secrets in this config. Register each public client
and exact callback with its owner before enabling.

```dotenv
MCP_OAUTH_ENABLED=true
MCP_OAUTH_ISSUER=https://app.eventoss.online
MCP_OAUTH_CLIENTS='[{"clientId":"eventos-chatgpt-prod","name":"EventOS ChatGPT","redirectUris":["https://chatgpt.com/connector_platform_oauth_redirect"]}]'
```

The example client ID and callback are illustrative; use the exact values
provided by the selected MCP client and verify them before production. A client
may optionally include a `scopes` array to further restrict what it can ask
for. Never include `client_secret`, token, password, or private key. Do not put
these settings in `NEXT_PUBLIC_*`.

Changing the registry removes clients immediately from authorization, token
exchange and token validation. Removing or deactivating a user's membership
also invalidates its grants on the next MCP request. Use the revocation endpoint
for a user disconnect and database-backed revocation for incident response.

## Consent and tenant handling

The authorization request must include registered `client_id` and exact
`redirect_uri`, `response_type=code`, a client-generated state, PKCE S256
challenge, exact `resource`, and scopes. An already signed-in user sees the
client name, active organization and requested permissions, then explicitly
approves or denies. The consent form requires same-origin POST and a random
single-use server-stored CSRF token. If the session is absent, the user signs in
through the existing login page and returns to the original authorization
request; the normal login cookie is not exchanged for an MCP credential.

The browser's active organization at consent time is stored with the grant.
At token redemption and every request, EventOS checks that same organization's
membership. It never accepts an organization, role, or user from MCP tool
arguments. A changed role that no longer permits a granted scope invalidates
that access token; the user must authorize again with permitted scopes.

## Operational boundary

This is a minimal first-party authorization server for the statically
registered clients above. Before enabling publicly, the owner must obtain and
verify provider callback values, set the server environment, apply the additive
Prisma migration through the controlled deployment pipeline, and run an end-to-
end OAuth/MCP test with a QA tenant. No Google OAuth client setting is reused
for MCP and no provider dashboard was changed by this implementation.

No refresh token is issued, so clients must restart the authorization-code
flow when the 10-minute token expires. The consent/access tables contain hashes
only for bearer/code/CSRF values; periodically remove expired rows after
confirming retention requirements. OAuth endpoint rate limits use the app's
existing rate-limit bucket mechanism.

## Standards references

- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [RFC 8414: Authorization Server Metadata](https://www.rfc-editor.org/rfc/rfc8414.html)
- [RFC 9728: Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728.html)
- [RFC 7636: PKCE](https://www.rfc-editor.org/rfc/rfc7636.html)
- [RFC 8707: Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707.html)
- [RFC 7009: Token Revocation](https://www.rfc-editor.org/rfc/rfc7009.html)
- [RFC 9700: OAuth 2.0 Security Best Current Practice](https://www.rfc-editor.org/rfc/rfc9700.html)
