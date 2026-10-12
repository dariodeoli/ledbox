# Contrato móvil LedBox — primera vertical API v1

Owner PF; cliente PANEL. Unidad móvil separada de SIGPDF/servicios/RUC/HD.
Referencia integrada local `dd396fb76ae2b71b3014a332149a5a4855ed0596`;
rama propia `feat/mobile-api-platform`. Integrador confirma base de consumo/repin
antes integrar; ninguna ref correctora0ce/fa6/6948 se mueve o importa.

## Transporte cerrado para cliente nativo

HTTPS al host del panel configurado por cliente (no dominio hardcodeado).
`Content-Type: application/json` para cuerpos. Login devuelve sesión PERSONAL
`{version:1,session:{accessToken,tokenType:"Bearer",expiresAt},organizationId}`.
Requests posteriores: `Authorization: Bearer <accessToken>`. Guardar exclusivamente
en SecureStore/Keychain, no AsyncStorage/logs/URL/analytics. No keys de empresa.

Token producido por `createSession` existente: JWT HS256 con sub/JTI, mismo plazo,
misma fila AdminSession/JTI hash. Adaptador móvil valida firma/expiración Y consulta
fila no revocada/no vencida, usuario activo en CADA request. No JWT autónomo ni
refresh token nuevo. Logout invalida servidor antes borrado local;401 borra token
local y exige login. No fallback de Bearer inválido a cookie/API key. Cookie web
existente intacta; no CORS cross-origin habilitado por esta vertical.

## Rutas y DTO

Implementadas en fuente (gates pendientes, NO producción/AppStoreREADY):
- `POST /api/mobile/login`: `{email,password}` estrictos; rate limit10/15min porIP,
  credenciales activas y membresía activa requeridas.401 credenciales genérico,
  403 sin empresa. Nunca devuelve passwordHash/JTI hash/rol global efectivo.
- `POST /api/mobile/logout`: revoca sesión presente;200 `{loggedOut:true}`.
- `GET /api/mobile/me`: `{version:1,user:{id,name,email},organizations:[{id,name,
  slug,role}],activeOrganization:obj|null,capabilities:[],session:{expiresAt}}`.
  Rol/capacidades de membresía actual, no claims de token ni rol global.
- `POST /api/mobile/active-organization`: `{organizationId}`; sólo membresía activa
  propia en empresa activa;200 `{organizationId}`,403 ajena/desactivada.

- `GET /api/mobile/events?limit=50&after=<id>`: `{version:1,events:[{id,name,
  status,location,city,startsAt,endsAt,setupAt,strikeAt}],page:{hasMore,nextAfter}}`.
  Campos fecha ISO/null; orden estable porID, limit1..100. nextAfter null al terminar.
- `GET /api/mobile/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50&after=<id>`:
  mismos eventos más `{from,to,timeZone:"America/Asuncion",items:[{id,eventId,
  kind:"event"|"setup"|"strike",date,at,endAt}]}`. Sólo eventos no cancelados;
  cliente recorre páginas de EVENTOS y une items porID para calendario completo.
  duration overlap real; date ancla visible sin truncar at/endAt originales.
  Si from/to faltan, mes actual Asunción; máximo400 días. Parámetros extra/duplicados
  rechazados, incluido organizationId; company sólo viene de membresía server.
- `DELETE /api/mobile/account`: `{password,confirmation:"DELETE_ACCOUNT"}`;
  reautenticación actual, límite5/15min por identidad, transacción SERIALIZABLE.
  200 `{deleted:true,retained:["organization_records","financial_records",
  "signed_documents","audit_history"]}`.409 OWNER_TRANSFER_REQUIRED último OWNER,
  409 account_changed conflicto serializable,401 reauthentication_required.
- `POST /api/mobile/account/transfer-ownership`: `{password,targetUserId,
  confirmation:"TRANSFER_OWNERSHIP"}`. OWNER de empresa activa no-demo solamente,
  reauth/límite5 y transacción SERIALIZABLE; sucesor distinto activo same-company.
  Promueve sucesor OWNER y pasa actor a ADMIN atómicamente;200
  `{transferred:true,organizationId}`,409 ownership_changed ante conflicto/cambio.
  No acepta organizationId arbitrario, cambio de rol global ni miembro ajeno.
Todos errores `{error,code}` sin eco del payload privado; JSON no-store.
401 sesión inválida/revocada,423 bloqueada; logout admite sesión bloqueada.
me permite activeOrganization null para selector/recuperación, sin datos tenant.

## Empresa, permisos y privacidad

Cada lectura operativa revalida membresía/empresa activa; ningún organizationId
cliente filtra consulta de datos salvo selección validada. Roles/capacidades
canónicos `lib/server/permissions.ts`. VIEWER puede leer/gestionar su sesión y
eliminar identidad propia reautenticada, no mutar datos empresariales.
Calendario móvil será exclusivamente eventos/setup/strike: no calendario financiero
general ni costos/contactos/notes/documentos. Días inclusivos Asunción y duración
válida `[startsAt,endsAt)`; rangos truncados deben indicar paginación real.

## Eliminación y límites Apple

Eliminar identidad AdminUser propia, sesiones, PIN/credencial/avatar/reset tokens/
membresías por cascades verificadas; no desactivación simulada. Exigir contraseña
actual + confirmación DELETE_ACCOUNT. Guarda último OWNER en TODAS sus empresas:
409 OWNER_TRANSFER_REQUIRED antes de borrar; transferencia guardada por endpoint
móvil propio, pues matriz de asignación del panel no permite otorgar OWNER nuevo.
No borrar empresa/clientes/finanzas/adjuntos/documentos/cadena de firma. Históricos
empresariales cuya retención es necesaria no se reescriben; informar categorías.
Sesiones revocadas y API keys creadas por identidad revocadas; no wipe tenant.
Ruta implementada en fuente; pruebas de integridad preparadas en esta entrega.
Invitaciones pendientes propias revocadas/destinatario deidentificado y creador
de keys deidentificado; historiales empresariales/fiscales firmados/auditoría
retienen su evidencia. AppUser de otro realm no se borra por coincidir email.
Tokens de todas las sesiones desaparecen con AdminUser, invalidados server-side.

Google social NO activado en móvil; antes activarlo resolver Apple4.8/SignInApple
o excepción real. Cuenta Apple disponible según dueño, membresía no verificada.
Firma/acuerdos/billing/mercados/BundleID/identidad legal y submission requieren
inputs indelegables; no credenciales/upload/providerPOST por este contrato.

## Gates y recuperación

Tests preparados `tests/mobile-api-contract.test.ts`, `mobile-api-session.test.ts`,
`mobile-api-account.test.ts` y `mobile-api.integration.test.ts`: inputs strict,
fronteras calendario/DTO, firma+revocación DB/expiración/usuario inactivo, cambio
de password y últimoOWNER previo a toda mutación; HTTP/PG real por empresa/rol/
revocación/eliminación/conservación de presupuesto y fixture de documento.
La fixture de documento es sentinel de conservación, no prueba de firma válida.
Tipos/build/tests NOT_RUN pendientes de ventana Secretaría source/argv/budget/
START_BY reales. Integración sólo habilitada con MOBILE_API_TEST_URL localhost y
DB local dedicada `ledbox_mobile_qa`; jamás DATABASE_URL producción ni PG ajeno.
No schema nuevo, por lo que no hay migration de esta vertical ni prisma validate
como gate de cambio schema. Lint no declarado en repo; tipo/build sí requeridos.
QA_NOT_RUN_DEFERRED_OWNER: source de esta rama, móvil visual/browser/flujos extras,
owners PANEL cliente/PF API; recuperar cuando dueño indique o sea necesario para
defecto concreto. No exime pruebas dispositivo/capturas/flujos Apple antes envío.
Este documento no afirma app conectada, endpoints desplegados ni aprobación Apple.
