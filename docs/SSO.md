# SSO con Google — panel e invitaciones al equipo

Cómo funciona hoy el acceso con Google de LedBox, qué hay que configurar en
Google Cloud, cómo se comportan los errores y qué haría falta para el login de
clientes en el portal (propuesta, **sin implementar**).

- **Google no se usa como proveedor genérico** (no hay NextAuth): el flujo es
  OAuth 2.0 *Authorization Code* propio, en dos endpoints.
- El **panel vive en `app.ledbox.online`** (EventOS) y sus rutas no llevan
  `/admin` (regla del 21-09-2026): el callback es `/api/auth/callback/google`.
  `admin.ledbox.online` redirige al host nuevo (issue #39).
- La **aceptación de invitaciones** (issue #31) usa el mismo callback, con el
  token de la invitación en su propia cookie.

## 1. Piezas del flujo

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Arranque | `app/api/auth/login/google/route.ts` | Redirige a Google con `state` y, si viene `?invitation=<token>`, guarda el token en su cookie. |
| Callback | `app/api/auth/callback/google/route.ts` | Valida `state`, canjea el código, verifica identidad y acepta invitación o abre sesión. |
| Sesión | `lib/server/auth.ts` | JWT HS256 (`AUTH_SECRET`) en la cookie `ledbox_session` (7 días, `HttpOnly`, `Secure`, `SameSite=Lax`). |
| Invitaciones | `lib/server/invitations.ts` | `acceptInvitationWithGoogle`: correo verificado == correo invitado, alta/membresía y auditoría. |
| Mensajes | `lib/google-auth.ts` | Códigos → texto seguro para las personas (una sola fuente, panel e invitaciones). |
| Página | `app/(admin)/invitacion/[token]/page.tsx` | Aceptación pública (sin sesión) dentro del host del panel. |

Botones que arrancan el flujo:

- Login del panel: `/login` → «Continuar con Google» → `/api/auth/login/google`.
- Invitación: `/invitacion/<token>` → `/api/auth/login/google?invitation=<token>`.

## 2. Configuración en Google Cloud

### 2.1 Proyecto y pantalla de consentimiento

1. Crear (o reutilizar) un proyecto en [Google Cloud Console](https://console.cloud.google.com/).
2. **APIs y servicios → Pantalla de consentimiento de OAuth**:
   - Tipo de usuario: **Externo**.
   - Nombre de la app: `LedBox`; correo de asistencia: el del equipo.
   - Dominios autorizados: `ledbox.online` (y los hosts del panel,
     `admin.ledbox.online` / `app.ledbox.online`, como orígenes si la consola
     lo pide).
   - Permisos (*scopes*): `openid`, `email`, `profile`. No se piden permisos de
     Gmail, Drive ni Calendar; el flujo solo necesita identidad.
   - Mientras la app esté en **Testing**, agregar como *test users* a las
     cuentas que van a probar; las cuentas fuera de la lista reciben
     `access_denied`.
   - Al publicar (**In production**) la pantalla queda disponible para cualquier
     cuenta; el control de acceso real lo hace LedBox (usuario activo + rol en la
     organización activa), no Google.

### 2.2 Credenciales OAuth (cliente web)

**APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth**
(tipo *Aplicación web*).

Orígenes autorizados de JavaScript (no los usa el flujo actual, pero evitan
ruido al configurar):

```
https://app.ledbox.online
https://admin.ledbox.online
http://localhost:3000
```

URIs de redireccionamiento autorizados — **exactos**, sin barra final, con el
path completo. Estado al 21-09-2026: registrados en Google Cloud el de la app y
el viejo del panel (transición) y el de desarrollo:

```
https://app.ledbox.online/api/auth/callback/google
https://admin.ledbox.online/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

> Cliente OAuth real: **`LexBox`**, proyecto **`weem-db`**
> (ID público `500595134387-k1g1s92q5pr26efbt6fehs8ksn4qeloq`). Verificado en
> producción: `/api/auth/login/google` redirige a Google con ese `client_id` y
> con `redirect_uri=https://app.ledbox.online/api/auth/callback/google`, tanto
> en el login como en la aceptación de invitaciones.
>
> El panel vive en `app.ledbox.online` desde el issue #39 (`admin.ledbox.online`
> redirige 308); el `NEXT_PUBLIC_ADMIN_URL` define cuál se usa.
> El callback arma el `redirect_uri` con el origen real de la request
> (`getPublicOrigin`), así que el mismo deploy funciona en los dos hosts
> mientras ambos estén registrados en Google. Al comprar el dominio propio de
> EventOS hay que registrar también su callback.
>
> El panel **no** puede configurar `https://admin.ledbox.online/admin/api/...`:
> las rutas del panel van sin `/admin`.
>
> En desarrollo `next dev` sirve HTTP en `localhost`: `getPublicOrigin` usa
> `http` para hosts locales, así que alcanza con registrar
> `http://localhost:3000/api/auth/callback/google`. Si se usa otro puerto
> (`npm run dev -- -p 3241`), registrar el mismo puerto.

### 2.3 Variables de entorno

Se cargan en el entorno del servidor (Owncoding Hub / Coolify); **nunca** en el
repo, en `NEXT_PUBLIC_*` ni en el navegador:

| Variable | Uso |
| --- | --- |
| `GOOGLE_CLIENT_ID` | ID de cliente OAuth (público, pero solo lo lee el servidor). |
| `GOOGLE_CLIENT_SECRET` | Secreto del cliente; solo lo usa el callback al canjear el código. |
| `AUTH_SECRET` | Firma los JWT de sesión (`ledbox_session`). |
| `NEXT_PUBLIC_ADMIN_URL` | Host del panel usado por los enlaces de invitación (`invitationAcceptUrl`). |

Sin `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` el panel no ofrece el acceso con
Google: `/api/auth/login/google` responde `503` y el callback redirige con
`?error=google_unconfigured` (mensaje genérico, ver §4). El login con correo y
contraseña sigue funcionando.

## 3. Flujo paso a paso

### 3.1 Panel (`/login`)

1. La persona entra a `/login` y toca **Continuar con Google**.
2. `GET /api/auth/login/google` genera un `state` aleatorio (24 bytes,
   base64url) y responde `302` a:

   ```
   https://accounts.google.com/o/oauth2/v2/auth
     ?client_id=<GOOGLE_CLIENT_ID>
     &redirect_uri=<origen>/api/auth/callback/google
     &response_type=code
     &scope=openid email profile
     &state=<state>
     &prompt=select_account
   ```

   y guarda `ledbox_google_state` (`HttpOnly; Secure; SameSite=Lax; Max-Age=600`).
3. Google pide la cuenta y vuelve a
   `GET /api/auth/callback/google?code=…&state=…`.
4. El callback:
   - compara `state` con la cookie (si no coincide → `google_state`);
   - canja el `code` en `https://oauth2.googleapis.com/token` con el **mismo**
     `redirect_uri`;
   - valida el `id_token` contra `https://oauth2.googleapis.com/tokeninfo` y
     exige `email_verified === "true"` (si no → `google_not_allowed`);
   - busca el `AdminUser` por correo normalizado: si no existe, está inactivo o
     no tiene organización activa → `google_not_allowed`;
   - abre sesión (`createSession`) y redirige a `/dashboard` (ruta limpia del
     panel). Borra la cookie de `state`.

> El estado real lo decide LedBox: Google solo prueba identidad y correo. Un
> correo verificado sin usuario/membresía **no** entra.

### 3.2 Invitaciones (`/invitacion/<token>`)

1. El correo de invitación apunta a
   `https://admin.ledbox.online/invitacion/<token>` (`invitationAcceptUrl`).
2. La página resuelve la invitación por token; si es aceptable, muestra el botón
   **Continuar con Google** → `/api/auth/login/google?invitation=<token>`.
3. El arranque guarda además el token en la cookie
   `ledbox_google_invitation` (`HttpOnly; Secure; SameSite=Lax; Max-Age=600`).
4. En el callback, con token de invitación presente se llama a
   `acceptInvitationWithGoogle`:
   - el correo verificado por Google tiene que ser **exactamente** el invitado;
   - si la cuenta no existe, se crea con el nombre de Google; si existe, se
     reutiliza sin tocar su contraseña;
   - se crea la membresía con el rol invitado, se marca la invitación como
     `accepted` y se audita «Aceptó la invitación…» con el actor real;
   - si ya es miembro, la invitación venció/fue revocada o la persona está
     desactivada, la invitación no se aplica (misma regla que con contraseña).
5. Con la membresía lista se abre la sesión y se va a `/dashboard`. Ante un
   error, la vuelta es `/invitacion/<token>?error=<código>` (§4); la página ya
   muestra además el estado de la invitación (vencida, revocada, ya miembro…).

Las cookies del flujo se borran siempre al terminar, con éxito o sin él.

## 4. Errores: códigos y mensajes

El callback **nunca** pone en la URL el mensaje de Google, el `code`, el
`id_token` ni detalles del proveedor: redirige un código estable y la página lo
traduce con `authErrorMessage` (`lib/google-auth.ts`). Un código desconocido cae
en un mensaje genérico; el texto libre en `?error=` no se refleja.

| Código | Mensaje que ve la persona | Causa típica |
| --- | --- | --- |
| `google_state` | La sesión de Google venció o se interrumpió. Probá de nuevo. | `state` ausente/distinto (cookie vencida a los 10 min, pestaña vieja, CSRF). |
| `google_unconfigured` | El acceso con Google no está disponible en este momento. Entrá con tu correo y contraseña. | Faltan `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` en el servidor. |
| `google_exchange` | No pudimos validar tu cuenta de Google. Probá de nuevo en unos minutos. | El canje del `code` falló: `redirect_uri` no coincide, cliente inválido o código vencido/reusado. |
| `google_identity` | No pudimos confirmar tu identidad con Google. Probá de nuevo. | `id_token` ausente o `tokeninfo` rechazó el token. |
| `google_not_allowed` | Tu cuenta de Google no tiene acceso a este panel. Pedile a un administrador que te invite. | Correo no verificado, usuario inexistente/inactivo o sin organización activa. |
| `invitation_missing` | No encontramos esta invitación. Revisá el link del correo. | Token mal copiado o borrado. |
| `invitation_blocked` | Esta invitación ya no está disponible. Pedile al equipo que te envíen una nueva. | Vencida, revocada o ya aceptada. |
| `invitation_email_mismatch` | La cuenta de Google no coincide con el correo invitado. Probá con la cuenta correcta. | Se eligió otra cuenta de Google. |
| `invitation_already_member` | Ya sos miembro de este equipo. Entrá al panel con tu cuenta. | La cuenta ya pertenece a la empresa. |
| `invitation_user_inactive` | Tu cuenta está desactivada. Pedile al equipo que la reactive. | `AdminUser.active = false`. |
| `invitation_name_invalid` | Ingresá un nombre de 2 a 120 caracteres. | El nombre de Google vino vacío o inválido en un alta nueva. |
| `invitation_conflict` | La invitación cambió mientras la aceptabas. Probá de nuevo. | Carrera: otro proceso la aceptó/revocó antes. |
| `invitation_failed` | No pudimos aceptar la invitación. Probá de nuevo. | Fallback sin código (no debería ocurrir). |

En el login, el mensaje aparece dentro del formulario (`AdminError`); en la
invitación, arriba del formulario. Los códigos se ven en la URL, nunca el
detalle técnico.

## 5. Puesta en marcha y verificación

1. Completar en Owncoding Hub: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `AUTH_SECRET`, `NEXT_PUBLIC_ADMIN_URL` con el host real del panel
   (`https://admin.ledbox.online` hoy, `https://app.ledbox.online` con el
   cambio de hosts del issue #39).
2. En Google Cloud, registrar los *redirect URIs* exactos de §2.2 (el host actual
   del panel y el nuevo, más el de desarrollo).
3. Desplegar (Coolify reconstruye al integrar a la rama viva).
4. Probar:
   - `/login` → Google → entra a `/dashboard`;
   - una cuenta de Google **sin** membresía → mensaje de acceso denegado;
   - `/invitacion/<token>` con la cuenta invitada → entra con el rol invitado;
   - con otra cuenta → «La cuenta de Google no coincide…»;
   - sin las variables → el login con Google no está disponible y el correo
     sigue funcionando.

## 6. Problemas frecuentes

| Síntoma | Qué revisar |
| --- | --- |
| `Error 400: redirect_uri_mismatch` | El `redirect_uri` enviado debe coincidir **carácter por carácter** con uno registrado: `https://admin.ledbox.online/api/auth/callback/google` (y `https://app.ledbox.online/...` tras el cambio de host), sin `/admin`, sin barra final. |
| `invalid_client` | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` mal cargados o de otro proyecto. |
| `access_denied` | La app está en Testing y la cuenta no es *test user*; o la persona canceló. |
| `403 org_internal` | La pantalla de consentimiento está restringida al dominio de la organización y la cuenta es externa. |
| Entra siempre la misma cuenta / no deja elegir | El flujo pide `prompt=select_account`; si el navegador la ignora, cerrar sesión de Google o usar ventana privada. |
| «Tu cuenta de Google no tiene acceso» con la cuenta correcta | Verificar `AdminUser.active`, la membresía en la organización activa y que el correo sea el mismo (normalizado en minúsculas). |
| Vuelve a `/login?error=google_state` | La cookie `ledbox_google_state` se perdió: el flujo tiene que empezar y terminar en el mismo host y en menos de 10 minutos; en producción `Secure` exige HTTPS. |
| En local el callback apunta a `https://localhost:3000` | `getPublicOrigin` ya usa `http` para `localhost`/`127.0.0.1`; si pasa, revisar que no haya un `x-forwarded-proto` mal seteado. |

## 7. Seguridad

- **Secretos solo en el servidor**: `GOOGLE_CLIENT_SECRET` y `AUTH_SECRET` jamás
  se exponen al cliente; el client ID viaja en la URL de Google, como
  corresponde.
- **CSRF**: `state` aleatorio, comparado contra cookie `HttpOnly` + `SameSite=Lax`.
- **Identidad**: `email_verified` obligatorio; el correo lo prueba Google.
- **Autorización propia**: usuario activo + membresía en la organización activa
  (panel) o invitación vigente con el correo exacto (equipo). Google no decide
  accesos.
- **Sesión**: JWT HS256 corto (7 días), cookie `HttpOnly`, `Secure`,
  `SameSite=Lax`; el callback no acepta `next`/URLs arbitrarias (no hay
  *open redirect*).
- **Sin filtración de detalles**: la URL solo lleva códigos; los mensajes salen
  de `lib/google-auth.ts`.
- **Auditoría**: cada aceptación de invitación queda en `recordAudit` con la
  persona real y el método (`via: "google"`).
- **Pendiente conocido**: `/api/auth/login/google` no tiene rate limit (el login
  con contraseña sí: 10 intentos por IP). Al ser un redirect corto y sin estado
  propio, el riesgo es bajo, pero se puede sumar el mismo limitador.

## 8. Propuesta: login de clientes en el portal (sin implementar)

**Estado**: idea evaluada, **no implementada**. Hoy el portal
(`clientes.ledbox.online`) valida presupuestos con el código público del link
(`/p/<código>`, 20 caracteres no enumerables) y no tiene cuentas de cliente.

**Objetivo**: que un cliente vea todos sus presupuestos y aprobaciones desde un
host estable, sin password y sin códigos por link.

**Propuesta**:

- Host del portal de clientes (`clientes.ledbox.online`, el que ya existe para
  validar presupuestos) o un host nuevo si producto decide separarlo; sesión de
  cliente separada de la del panel (otra cookie, otro alcance, otro nombre).
- Mismo flujo OAuth 2.0 Authorization Code, con su propio par de rutas
  `/api/auth/login/google` y `/api/auth/callback/google` en ese host.
- **Redirect URI que haría falta registrar en Google Cloud**:
  `https://clientes.ledbox.online/api/auth/callback/google` (y, para desarrollo,
  `http://localhost:3000/api/auth/callback/google` si se prueba en el mismo
  host). Se puede usar el mismo cliente OAuth agregando el URI, o crear uno
  separado (`GOOGLE_CLIENT_ID_CLIENTES`/`GOOGLE_CLIENT_SECRET_CLIENTES`) para
  que revocar el del portal no toque el del panel.
- *Scopes*: `openid email profile`, igual que el panel.
- **Vinculación**: por correo verificado contra `Client.email` (el modelo que ya
  usa presupuestos y eventos). Si no hay cliente con ese correo, no se muestra
  nada: se ofrece dejar la consulta al equipo (misma regla de allowlist del
  panel). Nunca se crea un cliente desde Google.
- **Autorización**: la sesión de cliente solo puede leer presupuestos/eventos de
  su propio `clientId` (el portal actual ya resuelve por token; habría que
  agregar la resolución por sesión y el mismo scoping por organización).
- **Acciones sensibles** (aprobar/rechazar un presupuesto) siguen igual: la
  sesión agrega identidad, no relaja ninguna validación.
- **Qué falta definir antes de implementar**: producto (¿migrar links por token
  o convivir con ambos?), expiración/rotación de la sesión de cliente, alta
  manual de clientes sin correo, rate limit propio, y el nombre/dominio final.
