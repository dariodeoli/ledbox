# EventOS · cliente nativo iPhone

Vertical React Native/Expo SDK55. No WebView, datos demo, credenciales de servicio
ni dependencia de componentes DOM. Código independiente en mobile/**, package
propio; no modifica lock/dependencias/scripts raíz.

## Implementado en fuente

- Login correo/contraseña y sesión personal Bearer en Keychain/SecureStore.
- Restauración de sesión vía me, empresas/membresías y selección activa validada.
- Calendario mensual con botones anterior/siguiente y selección de día; eventos,
  montaje y desmontaje reales del contrato, paginación completa y estado truncado
  explícito cuando llega al límite defensivo. Fechas Asunción/24h.
- Detalle operativo de evento desde la lista paginada: inicio/fin/montaje/
  desmontaje/lugar/estado. No inventa endpoint individual ni campos privados.
- Perfil desde me, privacidad antes/después del login, logout con revocación
  confirmada por servidor y eliminación real reautenticada desde la app.
- 401 borra sesión excepto contraseña incorrecta de reautenticación;403 conserva
  sesión; cambio de empresa aborta e invalida lecturas anteriores y limpia UI.
- Controles nativos accesibles, teclado adecuado, errores/reintento/empty/loading,
  tokens oscuro/claro proyectados de DISENO-PANEL/globals --a-*.

## Contrato y estado de integración

Fuente PF: docs/CONTRATO-MOVIL-LEDBOX.md en carril-plataforma, v1. Binding
local src/api/contract.ts marca BOUND_PF: es vínculo a contrato fuente, NO prueba
de endpoint desplegado o conexión real. PF conserva API/backend/gates.

POST login → envelope version1/session.accessToken → GET me. Selección POST
active-organization {organizationId} → GET me. Calendar pagina EVENTOS y une
items porID; nunca manda organizationId como filtro. Detalle busca evento porID
en GET events paginado. DELETE account {password,confirmation:DELETE_ACCOUNT};
409 último OWNER conserva sesión/cuenta,401 reauthentication_required conserva
token y permite corregir contraseña. Logout exige loggedOut:true antes de limpiar.

Contrato v1 no expone endpoint dedicado de detalle, clientes/contactos/notas/
documentos ni URL privacidad: el resumen usa únicamente allowlist PF y privacidad
requiere URL HTTPS pública configurada. Ninguno se presenta como endpoint nuevo.
App conectada/READY: **NO ACREDITADO**, pending backend integrado+gates+prueba real.

## Configuración sin secretos de firma

EXPO_PUBLIC_LEDBOX_API_URL: origen HTTPS del backend configurado por integrador.
EXPO_PUBLIC_LEDBOX_PRIVACY_URL: URL HTTPS pública de privacidad verificada.
Variables EXPO_PUBLIC son públicas; nunca tokens, contraseña, TeamID o claves.
LEDBOX_IOS_BUNDLE_ID / LEDBOX_APPLE_TEAM_ID: inputs privados del dueño para app.config.
Si faltan se omiten, no se inventan IDs/perfiles aceptados. No EASproject/signing
ni membresía Apple acreditados. No cámara/ubicación/micrófono/ATT solicitados.
Política de esta vertical: iPhone; supportsTablet:false, iPad no acreditado.

## Gates preparados, no ejecutados

Instalación aislada dentro mobile (no npm raíz): npm install --package-lock-only
y npm ci, sólo con ventana explícita propia de Secretaría. Después:
`npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`.
build = Expo export iOS/bundle JS, **no archive nativo firmado ni IPA**.
Pruebas escritas: login/auth envelope,401/403, companyswitch/staleresponse,
calendarpagination/cursores, logout/network, delete/últimoOWNER/reautenticación,
fechas Asunción/exclusiveend/leapdays. Mocks únicamente dentro tests, no runtime.
Todos estos gates actualmente NOT_RUN, sin instalación/lock fabricado.

Importante integración: tsconfig raíz incluye **/*.ts/tsx y sólo excluye
node_modules. Integrador debe aislar mobile en exclude del proyecto Next antes
admisión; PANEL no edita ese archivo reservado ni mezcla dependencias raíz.
OwnCoding UI compartida hoy es DOM; adopción nativa usa tokens/contratos,
no declara importar sus componentes web como nativos.

QA_NOT_RUN_DEFERRED_OWNER: revisión visual/web no necesaria; owner PANEL,
recuperar por orden dueño/necesidad concreta. **APPLE_DEVICE_QA_NOT_RUN** distinto:
dispositivos reales iPhone, capturas, flujos y toolchain Xcode26/SDK26, manifests
SDK y ficha/identidad/acuerdos son pendientes antes de envío. Cuenta disponible
según dueño, acceso/membresía no verificados. No upload/firmas/billing/agreement.

Consumo: commits sólo mobile/** desde6948 en rama feat/mobile-client-native.
Integrador cherry-pick selectivo; no importar SIGPDF/history/cuts, no push/main/HD.
