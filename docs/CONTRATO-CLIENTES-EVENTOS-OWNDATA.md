# Contrato fase 2 — clientes, eventos y OwnData (Refs #173)

## Identidad y compatibilidad

`Client.name` era el nombre obligatorio; `company` la empresa opcional. Los APIs,
presupuestos y contactos históricos usan ambos y no distinguen identidad fiscal.
No se convierten ni renombran filas existentes. La migración deja nuevas columnas
nulas, `contacts=[]`, y mantiene intactos `name`, `company` y `Event.location`.

- `tradeName`: fantasía/comercial principal, texto libre empresarial hasta 200.
  Mostrar con `clientDisplayName` de `lib/client-identity.ts` (integrador #173):
  `tradeName.trim() || name`. `clientLegalName` usa sólo `legalName`, nunca company.
- `legalName`: razón social manual (hasta 300) u oficial confirmada; nunca se
  deduce de `name`, `company`, fantasía ni contactos.
- POST admite sólo `tradeName`: inicializa `name` para compatibilidad de la nueva
  fila. PATCH de `tradeName` **no** modifica `name/company`. Los clientes históricos
  siguen pudiendo usar `name` sin cargar fantasía.
- Si se envía `name` explícito, es texto comercial no vacío de hasta 200, no un
  nombre humano de 120. No se trunca. Sólo PATCH que lo envía explícitamente lo
  modifica. La UI puede proyectar fantasía a ambos campos en altas nuevas.
- `billingEmail` (correo normalizado), `city`, `department` (120), `address` (300),
  `addressReference` (400), `locationUrl` (HTTP/HTTPS hasta 2000, sin credenciales).
- `contacts`: hasta 20 `{name, role, phone, email}`; `name` obligatorio, el resto
  nullable. `role` es función libre (120), no rol de seguridad. Teléfono y correo
  normalizados. Convive con el contacto principal `contactName/Role/Phone/Email`
  existente, sin inferencias ni sincronización automática.

Campos nuevos opcionales en escrituras: ausente conserva, vacío/null limpia; para
vaciar contactos usar `[]`. `tradeName` vacío vuelve a la identidad histórica.
Los tipos nuevos son opcionales en refs mínimos por compatibilidad con APIs fuera
del carril; lista/ficha completas sí devuelven las columnas y selectores de clientes
y eventos exponen `tradeName/legalName` explícitamente. Finanzas debe pedir/exponer
los campos necesarios en sus propios selects/documentos, sin convertir historia.

## Eventos

`location` sigue siendo lugar/recinto, separado de `city` y nuevo `department`.
Opcionales: `address`, `addressReference`, `locationUrl`, `venueContactName/Phone/Email`,
`responsibleName/Phone/Email`, `modality` (texto hasta 120) y `attendees` (entero
0..2147483647). No existe catálogo nuevo de recintos ni contactos inferidos.
`POST /api/admin/events` mantiene cliente+nombre y estado inicial DRAFT. Permite
fechas vacías; `PATCH /api/admin/events` con `{id,...campos}` extiende el cambio
de estado previo a edición parcial. Validación de fechas combinadas (montaje ≤
inicio ≤ fin ≤ desmontaje cuando ambas fechas existen). `events.write` obligatorio,
ID acotado a la organización activa, cliente de otra empresa devuelve 404.
`clientId` no es editable por este PATCH. El cambio de evento desde presupuestos
es responsabilidad del API budgets y debe verificar `events.write` en servidor.

La UI de ciudad debe enviar ciudad+departamento resueltos juntos; al escribir
ciudad no resuelta, enviar `department:null`. Si PATCH cambia ciudad y omite
departamento, el servidor limpia el departamento previo. El backend permite localidad manual
y no infiere departamento por nombre de ciudad.

## OwnData real

Revisado en `owndata/src/lib/server/commercial-api.ts`, `dnit-ruc.ts` y
`owncoding-ui/src/utils/ownDataRuc.js`. Transporte comercial:
`GET <OWNDATA_API_URL>/api/v1/ruc/{ruc}` con `X-API-Key: OWNDATA_API_KEY`.
Ambiente esperado `OWNDATA_ENVIRONMENT=test|live`, clave con `ruc:read` y acceso
habilitado por proveedor. No usar endpoint de cuenta (otro envelope), no SUN,
no demo/fallback, no claves públicas. URL raíz HTTPS sin query/userinfo/hash.
Sin credencial/configuración/helper publicado: 503 honesto, manual disponible.
No se realizaron consultas reales ni se certifica habilitación comercial.

### Consulta y confirmación

`POST /api/admin/clients/ruc` exige sesión y `clients.write` (VIEWER=403):

```json
{"numero":"80012345-6","confirmLookup":true}
```

La confirmación de consulta advierte consumo posible de cuota; no hay retry ni
redirect. RUC de base 1..9 dígitos sin cero inicial y DV opcional explícito,
sin calcular/corregir DV. Timeout 6s, cuerpo máximo 64KiB, 10 consultas/15 minutos
por empresa+actor. El secreto OwnData nunca se usa en el endpoint público `/api/ruc`,
que conserva su proveedor legacy y contrato. Los helpers canónicos
`createOwnDataRucProvider/mapOwnDataRucResponse` validan identidad/envelope y
conservan estado/equivalencias/partición y fuente; no hay mapper paralelo.

Respuesta: `{name,fullRuc,reviewRequired:true,ownData,lookedUpAt,confirmationToken}`.
`name` acá es **razón social oficial**, nunca fantasía. `ownData` conserva cuota y
procedencia. Consulta sólo propone datos, no persiste cliente. Token HS256 firmado
por servidor válido 10 minutos y ligado a empresa+actor; no se registra en auditoría.
Al confirmar, POST/PATCH del cliente reciben:

```json
{"confirmRuc":true,"rucConfirmationToken":"<resultado de consulta>"}
```

Se aplican únicamente `ruc`, `legalName` y `rucSnapshot`; no fantasía ni contactos.
Si se incluyen `ruc/legalName`, deben coincidir exactamente con lo confirmado.
No aceptar `rucSnapshot` del navegador. Guardado manual sin token siempre posible;
cambiar RUC/razón social manualmente invalida snapshot. Confirmación vencida o
actor/empresa distinta: 400, volver a consultar o guardar manualmente.

`rucSnapshot` nullable:
`{fullRuc,nameOfficial,environment,equivalenceRaw,stateRaw,sourcePartition?,
provenance:{source,sourcePage,publicationDate,publishedText,importedAt,snapshotHash},
lookedUpAt,confirmedAt}`. `source=dnit_official_snapshot`; fecha oficial se conserva
como texto recibido, no como fecha actual. Consulta/resultado y cambios auditados
en empresa activa. Costos monetarios no provistos por contrato: no se inventan,
`costKnown:false`; mostrar cuota/procedencia reales para revisar antes de aplicar.

Errores seguros `{error,code,manualEntryAllowed:true,retryAfter?}`: no encontrado
404, cuota 429 (`Retry-After` si disponible), indisponible/config/auth upstream 503,
envelope/transporte 502, formato 400. No exponer cuerpo/mensaje/credenciales upstream.
Respuestas de consulta `private,no-store`. Sin consulta silenciosa desde selectores.

## Verificación y ownership

Migración aditiva únicamente Client/Event, probada en PG local aislado y reejecutada.
Pruebas servidor cubren normalización, scope y permisos, fantasía preservada al
confirmar, token falsificado/vencido y errores/procedencia OwnData con fixtures
de prueba etiquetados. Node/dependencias/UI/globals/presupuestos pertenecen a otros
carriles. El integrador incorpora helper display y pin nuevo; pilot QA por SHA.
