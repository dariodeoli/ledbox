# Privacidad y datos personales — registro de tratamiento (Ley N° 7593/2025)

> **Issue:** dariodeoli/ledbox#94 · **Vigente al:** 30-09-2026 · **Ámbito:** app EventOS/LedBox.
> **Regla canónica del ecosistema:** `dariodeoli/owncoding-ui#8` (protección de datos personales).
>
> Este documento es el **registro interno de tratamientos** (RAT), las medidas técnicas y
> organizativas vigentes, el proceso de derechos del titular y el checklist de adopción para las
> apps del grupo. Es material operativo: la redacción jurídica final y la política pública las
> aprueba el dueño (no reemplaza asesoría legal).

## 1. Alcance y roles

- **Qué registra:** cada tratamiento con datos personales que hoy hace la app: qué dato, para qué,
  con qué base, dónde vive, quién accede, cuánto se conserva y cómo se borra o anonimiza.
- **Roles del sistema:** cada empresa (`Organization`) es la **responsable** de los datos de su
  operación; EventOS/LedBox aporta la plataforma y la operación técnica. Los datos de una empresa
  no se usan para fines de otra: el aislamiento es por `organizationId` en todos los módulos
  (ver §3.2).
- **Interesados alcanzados:** personas que dejan un lead, clientes y sus contactos, usuarios del
  panel, firmantes del portal, proveedores, promotoras y personas que aparecen en transferencias
  bancarias conciliadas.
- **Categorías sensibles:** no hay tratamientos declarados de datos sensibles. Los datos
  financieros y la evidencia de firma se tratan con acceso restringido (§3).
- **Estado de cada punto:** `Vigente` (ya funciona), `Job pendiente` (plazo definido acá, purga
  automática todavía no implementada) y `Brecha` (falta cerrarla; ver §3.5).

## 2. Registro de tratamientos

### 2.1 Resumen

| # | Tratamiento | Interesados | Dónde vive |
| --- | --- | --- | --- |
| T1 | Leads y cotizaciones del sitio público | Visitantes que consultan | `Lead`, `QuoteRequest`, `QuoteItem` |
| T2 | Clientes, eventos y operación comercial | Clientes y sus contactos | `Client`, `ClientLogo`, `Event`, `Budget`, `BudgetItem`, `BudgetChangeRequest`, `Invoice` |
| T3 | Portal del cliente (aprobación, pedidos y comprobantes) | Cliente final (link) | `Budget.publicToken` y campos de aprobación, `BudgetPaymentProof` |
| T4 | Firmas y evidencia electrónica | Firmantes y emisores | `SignatureRequest`, `SignatureEvent`, `SignatureEvidence` |
| T5 | Usuarios del panel y equipo | Usuarios y personas invitadas | `AdminUser`, `AdminMembership`, `AdminSession`, `PasswordResetToken`, `AdminUserAvatar`, `TeamInvitation`, `ApiToken` |
| T6 | Proveedores y promotoras | Contactos de producción | `Supplier`, `SupplierJob`, `Promoter`, `EventTask` |
| T7 | Finanzas, tesorería y conciliación bancaria | Clientes, proveedores y pagadores de extractos | `ClientPayment`, `TreasuryMovement`, `Expense`, `Invoice`, `PurchaseInvoice`, `BankStatement`, `BankStatementRow` |
| T8 | Seguridad, trazabilidad y correo | Actores del sistema y destinatarios de correo | `AuditLog`, `MailLog`, `RateLimitBucket`, `IdempotencyKey`, `PaymentReminderLog` |
| T9 | Respaldos de la base | (copia de todo lo anterior) | Volumen `/data/backups` del servidor |
| T10 | Carga con IA (asistente del panel, opcional) | Textos pegados por el equipo (pueden traer datos de clientes, contactos, eventos y productos) | Nada propio: el texto no se persiste; los registros confirmados van a T1/T2/T6 |

Todas las tablas viven en el **PostgreSQL de producción** (Owncoding Hub / Coolify); los binarios
(avatares, logos, adjuntos, comprobantes y firma) viven en la **misma base**, servidos solo con
sesión o con el link/token correspondiente. Los respaldos son archivos gzip en el volumen indicado
(§ `docs/OPERACION.md`).

### T1 · Leads y cotizaciones del sitio público

| Campo | Detalle |
| --- | --- |
| Datos | Nombre, empresa, teléfono, correo, RUC, motivo/fecha/lugar del evento, mensaje, productos de interés, `source`, `consentAt` y notas internas del equipo |
| Finalidad | Responder la consulta y preparar la cotización pedida; contacto comercial sobre ese pedido |
| Base legal | Consentimiento del titular (hoy implícito al enviar el formulario — brecha B2) |
| Dónde vive | `Lead` + `QuoteRequest`/`QuoteItem`; se ve en `/leads` del panel |
| Quién accede | Miembros de la empresa activa (VIEWER solo lectura; `clients.write` muta). El sitio público solo escribe |
| Retención | 24 meses sin actividad; al convertirse en cliente pasa a T2 |
| Borrado/anonimización | Anonimizar nombre/teléfono/correo/RUC conservando métricas agregadas (job pendiente — B4) |

### T2 · Clientes, eventos y operación comercial

| Campo | Detalle |
| --- | --- |
| Datos | Nombre/empresa, RUC, contactos (`contactName`, `contactRole`, `contactPhone`, `contactEmail`), notas, logo; eventos, presupuestos e ítems, pedidos de cambio, planes de pago, cobros, facturas y adjuntos |
| Finalidad | Ejecutar el contrato, coordinar los eventos, cobrar y facturar; obligaciones fiscales y contables |
| Base legal | Ejecución de contrato y medidas precontractuales; obligación legal (facturación/contabilidad) en lo fiscal |
| Dónde vive | `Client`, `ClientLogo`, `Event`, `Budget`, `BudgetItem`, `BudgetChangeRequest`, `Invoice`, `BudgetAttachment` |
| Quién accede | Miembros de la empresa activa; las mutaciones exigen la capacidad correspondiente y VIEWER nunca escribe. El cliente final solo ve su presupuesto por el link del portal (T3) y **nunca** los costos internos (`costEstimate`, `materialCost`, `laborCost`) |
| Retención | Relación + 24 meses los datos de contacto; documentos con efecto contractual/fiscal, el plazo legal aplicable (criterio operativo: 10 años — confirmar con el contador) |
| Borrado/anonimización | Baja lógica (`active = false`) y anonimización de contactos cuando no haya obligación de conservar. El historial financiero no se borra (regla del ecosistema §3) |

### T3 · Portal del cliente (aprobación, pedidos y comprobantes)

| Campo | Detalle |
| --- | --- |
| Datos | Token público del presupuesto, primera vista (`viewedAt`), aprobación (`approvedByName`, método, nota), **IP y User-Agent de la aprobación en claro** (`approvalIp`, `approvalUserAgent` — brecha B3), pedidos de cambio y comprobantes de pago (binario) |
| Finalidad | Dar al cliente acceso a su presupuesto, aprobación digital, pedidos y comprobantes |
| Base legal | Consentimiento y ejecución de contrato |
| Dónde vive | `Budget` (token y aprobación), `BudgetChangeRequest`, `BudgetPaymentProof` |
| Quién accede | Quien tenga el link/token (aleatorio, no enumerable; se regenera o revoca desde el panel) y el panel de la empresa |
| Retención | Igual que T2: el documento contractual manda |
| Borrado/anonimización | Al revocar/regenerar el token el link muere; el contenido se anonimiza junto al cliente. Los comprobantes son binarios inmutables mientras viva el documento |

### T4 · Firmas y evidencia electrónica

| Campo | Detalle |
| --- | --- |
| Datos | Destinatario (nombre, correo, teléfono), emisor, título, hashes del documento, eventos de la solicitud con **IP y User-Agent como HMAC con pepper** (nunca en claro), OTP (hash) y firma capturada (binario). La foto/evidencia adicional es Fase 2 |
| Finalidad | Firma electrónica del documento y trazabilidad probatoria |
| Base legal | Consentimiento del firmante + ejecución de contrato |
| Dónde vive | `SignatureRequest`, `SignatureEvent` (append-only con cadena de hash), `SignatureEvidence` |
| Quién accede | Panel de la empresa y el destinatario por su link (`publicCode` de 100 bits); en el portal los datos van enmascarados |
| Retención | Valor probatorio junto al documento (criterio operativo: 10 años, igual que T2) |
| Borrado/anonimización | No se borra mientras el documento tenga efecto; la cadena es inmutable por diseño (`eventHash` + `previousEventHash`). Sin purga automática (B4) |

### T5 · Usuarios del panel y equipo

| Campo | Detalle |
| --- | --- |
| Datos | Nombre, correo, rol, contraseña (bcrypt), PIN (bcrypt), avatar, membresías, sesiones (`jtiHash`), tokens de reset (hash), invitaciones (correo y hash del token) y API keys (`prefix`, `tokenHash`, `lastUsedAt`) |
| Finalidad | Acceso, autenticación, permisos y seguridad del panel |
| Base legal | Ejecución de la relación laboral/comercial e interés legítimo de seguridad |
| Dónde vive | `AdminUser`, `AdminMembership`, `AdminSession`, `PasswordResetToken`, `AdminUserAvatar`, `TeamInvitation`, `ApiToken` |
| Quién accede | Cada persona ve su perfil; `users.manage` (OWNER/ADMIN) administra el equipo; las API keys solo las crea/revoca un OWNER. Los tokens planos nunca se persisten |
| Retención | Cuenta activa + 24 meses; sesiones 30 días tras vencer o revocarse; invitaciones vencidas/revocadas 90 días; reset 30 minutos de vigencia |
| Borrado/anonimización | Desactivar (no borrar) para conservar la traza de auditoría; anonimizar al vencer si no hay obligación (B4) |

### T6 · Proveedores y promotoras

| Campo | Detalle |
| --- | --- |
| Datos | Nombre/empresa, teléfono, correo, especialidad, condiciones de pago, notas; en promotoras además foto y disponibilidad |
| Finalidad | Coordinar producción, tareas y pagos con proveedores |
| Base legal | Ejecución de contrato |
| Dónde vive | `Supplier`, `SupplierJob`, `Promoter`, `EventTask` |
| Quién accede | `suppliers.write` y `promoters.write` (OWNER/ADMIN y, según el caso, OPERATIONS o FINANCE); el resto solo lectura |
| Retención | Relación + 24 meses; lo que impacta en finanzas sigue el plazo fiscal (T7) |
| Borrado/anonimización | Baja lógica (`active = false`) y anonimización tras el plazo (B4) |

### T7 · Finanzas, tesorería y conciliación bancaria

| Campo | Detalle |
| --- | --- |
| Datos | Cobros y pagos, cuentas, referencias, comprobantes, datos fiscales de terceros (RUC, razón social) y extractos bancarios (`description`/`raw`, que pueden contener nombres de personas) |
| Finalidad | Cobranza, pago a proveedores, facturación, contabilidad y conciliación |
| Base legal | Obligación legal fiscal/contable + ejecución de contrato |
| Dónde vive | `ClientPayment`, `TreasuryMovement`, `Expense`, `Invoice`, `PurchaseInvoice`, `BankStatement`, `BankStatementRow` |
| Quién accede | `finance.write` muta (OWNER/ADMIN/FINANCE); `org.manage` para lo fiscal configurable; `/sistema` solo OWNER/ADMIN |
| Retención | Plazos fiscales/contables (criterio operativo: 10 años para libros y comprobantes — confirmar con el contador). El historial financiero no se purga |
| Borrado/anonimización | Bloqueo o anonimización solo de la parte no fiscal; los libros y comprobantes nunca se borran |

### T8 · Seguridad, trazabilidad y correo

| Campo | Detalle |
| --- | --- |
| Datos | `AuditLog` (actor con nombre/correo, acción, entidad, antes/después), `MailLog` (destinatario, asunto, estado y error del proveedor), `RateLimitBucket` (IP y ventana), `IdempotencyKey` (hash del cuerpo), `PaymentReminderLog` (recordatorio enviado) |
| Finalidad | Auditar cambios, verificar envíos, prevenir abuso y garantizar idempotencia financiera |
| Base legal | Interés legítimo de seguridad y obligación de trazabilidad financiera |
| Dónde vive | PostgreSQL, tablas indicadas |
| Quién accede | Auditoría y correo: OWNER/ADMIN (`/auditoria`, `org.manage`); el resto es técnico, sin UI |
| Retención | Auditoría 24 meses (los eventos financieros acompañan el plazo fiscal); `MailLog` 12 meses; `RateLimitBucket` 24 h; `IdempotencyKey` 7 días |
| Borrado/anonimización | `IdempotencyKey` se purga sola al operar (`purgeExpiredIdempotencyKeys`); el resto necesita job (B4). `MailLog` se conserva para verificar entregas; no contiene el cuerpo del correo |

### T9 · Respaldos de la base

| Campo | Detalle |
| --- | --- |
| Datos | Copia completa de la base (todo lo anterior) más el estado y el log del respaldo |
| Finalidad | Continuidad del servicio y recuperación ante incidentes |
| Base legal | Interés legítimo de seguridad |
| Dónde vive | Volumen persistente `/data/backups` (gzip); detalle y restauración en `docs/OPERACION.md` |
| Quién accede | Proceso automático de respaldo y administración del servidor |
| Retención | 30 días (`BACKUP_RETENTION_DAYS`) con un mínimo de 7 archivos (`BACKUP_MIN_KEEP`) |
| Borrado/anonimización | Ciclo automático del script; restauración probada (22-09-2026, `docs/OPERACION.md` §2). Un respaldo hereda la retención de los datos que contiene |

### T10 · Carga con IA (asistente del panel, opcional)

| Campo | Detalle |
| --- | --- |
| Datos | El **texto pegado** por un miembro con permiso de escritura (puede contener nombres, teléfonos, correos, RUC, fechas y precios de clientes o contactos) y los registros que la IA propone, que la persona revisa y edita antes de crear |
| Finalidad | Ordenar texto libre en registros del panel (clientes, eventos, productos) y proponer acciones (vincular a lo existente, registrar un cobro) que la persona revisa y confirma |
| Base legal | Ejecución del contrato / interés legítimo de operación; el dato ya es de la empresa y no se usa para otra finalidad |
| Dónde vive | **El texto no se guarda en EventOS**: viaja al proveedor de IA configurado por entorno (`IA_API_KEY`/`IA_MODELO`/`IA_BASE_URL`, API compatible con `chat/completions`) y vuelve solo con la estructura propuesta. Los registros **confirmados** se guardan en T1/T2/T6 como cualquier alta del panel y las acciones (cobros) en T7; el matching contra lo existente corre en el servidor, con los datos de la empresa activa. La llamada queda auditada en `AuditLog` (`IaCarga`, solo conteos y modelo; nunca el texto) |
| Quién accede | Miembros con `clients.write`/`events.write`/`inventory.write` (OWNER/ADMIN/OPERATIONS); VIEWER y FINANCE no usan el asistente. El proveedor actúa como **encargado** y recibe solo lo pegado |
| Retención | El texto no se persiste en EventOS; el proveedor puede retener las peticiones según su propia política (evaluar sus garantías — B8) |
| Borrado/anonimización | No hay nada que borrar del lado de EventOS; apagar la función es quitar `IA_API_KEY` (el panel avisa y no envía nada) |

### 2.2 Retención y purga — una sola tabla

Plazos que Operación propone como política (los aprueba el dueño). Mientras no exista el job de
purga (§3.5, B4), la conservación real es indefinida y no se borra nada automáticamente.

| Dato | Plazo definido | Al vencer | Estado |
| --- | --- | --- | --- |
| Leads no convertidos | 24 meses sin actividad | Anonimizar | Job pendiente (B4) |
| Contactos de clientes/proveedores/promotoras | Relación + 24 meses | Anonimizar | Job pendiente (B4) |
| Documentos contractuales/fiscales (presupuestos aprobados, cobros, facturas, firmas, libros) | Plazo legal aplicable (criterio operativo: 10 años) | Bloqueo/anonimización parcial | Conservación vigente; no se purga |
| Auditoría | 24 meses (financiera: plazo fiscal) | Purga/anonimización | Job pendiente (B4) |
| `MailLog` | 12 meses | Purga | Job pendiente (B4) |
| Sesiones del panel | 30 días tras vencer/revocarse | Purga | Job pendiente (B4) |
| Invitaciones | 90 días tras vencer/revocarse | Purga | Job pendiente (B4) |
| Tokens de reset | 30 minutos de vigencia | Purga del registro usado/vencido | Job pendiente (B4) |
| Recordatorios de cobro | 12 meses | Purga | Job pendiente (B4) |
| `IdempotencyKey` | 7 días | Purga automática | **Implementado** (`lib/server/idempotency.ts`) |
| `RateLimitBucket` | 24 h | Purga | Job pendiente (B4) |
| Respaldos | 30 días (mínimo 7) | Borrado por retención | **Implementado** (`scripts/backup.mjs`) |
| Texto pegado en «Carga con IA» | No se retiene en EventOS | — | **Implementado** (no se persiste; T10) |

## 3. Medidas técnicas y organizativas vigentes

### 3.1 Identidad, sesión y equipo

- Login con correo + contraseña (bcrypt, costo 12) y Google SSO opcional; recuperación por correo.
- Sesión JWT HS256 en cookie `ledbox_session` (`HttpOnly`, `Secure` en producción, `SameSite=Lax`,
  7 días) con el `jti` guardado **solo como hash** en `AdminSession`: la sesión se puede revocar y
  `expiresAt`/`revokedAt` cortan el acceso.
- Cambiar la contraseña o el correo **revoca las sesiones abiertas**, y el reset de contraseña
  también. Desactivar a alguien le corta el acceso: al no tener membresía activa, su sesión no
  resuelve empresa.
- PIN de desbloqueo (bcrypt, 4–6 dígitos, tope de intentos) y auto-bloqueo por inactividad; login,
  PIN, recuperación, invitaciones y desbloqueo tienen rate-limit.
- Invitaciones con token aleatorio no enumerable, vencimiento a 7 días, reenvío que invalida el
  anterior y rol acotado (nunca OWNER).

### 3.2 Autorización y aislamiento por empresa

- Matriz única server-side: `lib/server/permissions.ts` + `requireAdminContext`; cada endpoint
  mutante declara su capacidad y responde 403 si el rol no la tiene. VIEWER no muta nada.
- Todos los módulos operativos filtran por `organizationId` de la sesión: un id de otra empresa
  responde 404. La empresa activa vive en la sesión, nunca en un dato que mande el navegador.
- Auditoría de cambios (`AuditLog`) con actor real denormalizado; `/auditoria` solo OWNER/ADMIN.

### 3.3 API de servicio y endpoints públicos

- API keys (issue #69): token plano mostrado una sola vez, hash SHA-256 en la base, prefijo para
  listar, rol acotado (nunca OWNER), pertenecen a **una** empresa, rate-limit propio (300 por
  ventana), revocación inmediata y `lastUsedAt` para auditoría.
- Endpoints públicos (`/api/leads`, `/api/quotes`, portal y firma) con rate-limit, honeypot donde
  aplica, tokens aleatorios no enumerables, expiración/revocación y validación server-side.
- El portal no expone costos internos ni datos de otros clientes; la firma muestra los datos
  enmascarados y guarda IP/User-Agent hasheados.

### 3.4 Secretos, infraestructura y continuidad

- Secretos solo en variables de entorno del backend (Coolify); nunca en el repo, el frontend ni los
  logs. El deploy no guarda `.env` reales.
- HTTPS/dominios por Cloudflare + Coolify; cada superficie (panel, portal, landing) con su host.
- Respaldos diarios, verificación del dump, retención y **restauración probada** (`docs/OPERACION.md`);
  alerta por correo a OWNER/ADMIN si el respaldo falta, está vencido o falló.
- La demo usa datos ficticios, sesión VIEWER, no manda correos ni cobra, y se reinicia (no mezcla
  datos reales).
- Correo transaccional con proveedor único (Resend; relay del ecosistema); cada intento queda en
  `MailLog` sin el cuerpo del mensaje.
- **Carga con IA (opcional, T10):** el asistente del panel manda **solo el texto pegado por un
  miembro** a un proveedor externo de IA configurable por entorno (`IA_API_KEY`/`IA_MODELO`/
  `IA_BASE_URL`); el servidor no persiste ese texto ni envía datos de la base, y cada llamada queda
  auditada sin el contenido. Sin clave configurada la función queda apagada con un aviso claro.

### 3.5 Brechas abiertas

| Id | Brecha | Riesgo | Cierre propuesto |
| --- | --- | --- | --- |
| B1 | No existe política de privacidad pública ni enlaces en los puntos de recolección/footer | Transparencia incumplida | Página pública versionada + aviso corto y enlaces en formularios, login, portal y footer |
| B2 | El consentimiento de leads no es verificable: `consentAt` se sella al enviar y no hay casilla ni versión del aviso | Consentimiento no comprobable | Casilla no premarcada (con enlace al aviso), guardar versión/fecha/origen en el lead y permitir oposición. **Excepción documentada (13-10-2026):** el alta manual del panel (`POST /api/admin/leads`) ya no sella el consentimiento por defecto: exige la casilla «El contacto pidió que lo llamemos o le cotizemos» (cliente y servidor) y recién ahí guarda `consentAt` y `consentChannel = panel-manual`. Como `Lead.consentAt` no admite null, es una declaración del equipo, no una constancia del titular; sigue faltando versión del aviso y revocación |
| B3 | `Budget.approvalIp`/`approvalUserAgent` se guardan en claro, a diferencia de la firma (HMAC con pepper) | Dato técnico de más | Unificar al esquema de hash con pepper o dejar de capturarlo |
| B4 | Sin job de retención/anonimización (leads, contactos, sesiones, buckets, tokens, invitaciones, `MailLog`, auditoría) | Conservación ilimitada | Job programado con los plazos de §2.2, respetando la conservación fiscal |
| B5 | Sin autoservicio «Mis datos» ni cola de solicitudes con SLA en el panel | Derechos difíciles de ejercer | Vista/API de solicitudes (base del ecosistema `owncoding-ui#8`) con vencimiento visible |
| B6 | Canal de privacidad sin habilitar y proceso sin publicar | Titular sin por dónde pedir | Habilitar el buzón de §4.1 y publicarlo con el aviso (B1) |
| B7 | El panel no enmascara contactos según rol (el portal de firma sí) | Exposición innecesaria | Enmascarado compartido por rol en listados y fichas |
| B8 | Transferencias internacionales no declaradas (infraestructura, correo, SSO, DNS/proxy) | Transparencia y garantías | Declararlas en el aviso público y evaluar las garantías del proveedor |

> **Actualización 01-10-2026 (issue #120):** la transferencia al **proveedor de IA** del asistente
> «Carga con IA» quedó declarada en la política pública (§5 Destinatarios) y registrada como
> encargado en T10; B8 sigue abierta por la formalización de garantías del proveedor (contrato/DPA)
> y por el resto de la cadena.

> Las brechas se numeran acá y se citan en el checklist (§6). Al cerrar una, se actualiza este
> documento en el mismo cambio.

## 4. Proceso de derechos del titular

### 4.1 Canal y recepción

- **Canal principal:** `privacidad@ledbox.online` (a habilitar en el proveedor de correo; hasta
  entonces rige el canal de contacto publicado de la empresa). Queda visible en la política de
  privacidad y en el pie de las superficies (B1/B6).
- Cualquier persona del equipo que reciba un pedido por otro canal (WhatsApp, teléfono, mostrador)
  lo reenvía al buzón para que entre al registro único.
- Recepción: se asigna número de caso y se responde acuse dentro de los 5 días corridos.

### 4.2 Verificación de identidad

- Se verifica **antes de dar curso**, con el mínimo de datos necesarios:
  - Usuarios del panel: la sesión autenticada alcanza para sus propios datos.
  - Cliente del portal: el acceso al link del presupuesto/firma alcanza para ese documento; para el
    resto, se contrastan dos datos que la empresa ya tenga (correo y teléfono, por ejemplo).
  - En todos los casos se puede pedir un correo de confirmación desde la dirección registrada.
- Si no se puede verificar, se responde por qué y qué hace falta; el plazo de 30 días corre desde
  la verificación.
- Nunca se piden más datos que los necesarios para verificar, ni documentos que no correspondan.

### 4.3 Plazo y gratuidad

- **Respuesta ≤ 30 días corridos** desde la recepción (o desde la verificación de identidad).
- El trámite es **gratuito**. Si el pedido es manifiestamente repetitivo o abusivo, se responde una
  vez y se deja registro, sin reiterar la búsqueda.
- Prórroga: solo si la ley la permite y el caso lo justifica; se avisa antes del vencimiento con el
  motivo y la nueva fecha.

### 4.4 Cómo se resuelve cada derecho

| Derecho | Qué se hace | Cómo se entrega |
| --- | --- | --- |
| Acceso | Se reúnen los datos del titular por empresa | Copia legible (pantalla o PDF); no incluye datos de terceros ni secretos comerciales |
| Rectificación | Se corrige en el panel con auditoría; si el dato vino de un lead, se propaga al cliente vinculado | Confirmación con el detalle corregido |
| Supresión | Se borra lo que no tenga obligación de conservarse; lo fiscal/contractual se **bloquea o anonimiza** (nunca se borra el historial financiero) | Confirmación de qué se borró, qué se anonimizó y por qué se conserva lo demás |
| Oposición | Se marca el contacto como «no contactar» y se excluye de comunicaciones no esenciales | Confirmación de la marca y de su alcance |
| Portabilidad | Export de los datos del titular en formato estructurado (CSV/JSON) | Archivo descargable (los exports actuales de finanzas/inventario son la base; falta el export por titular — B5) |
| Revocación del consentimiento | Se registra fecha y efecto, y se detiene el tratamiento que dependía de ese consentimiento | Confirmación con la fecha; los tratamientos con otra base legal siguen |

### 4.5 Plantillas de respuesta

**Acuse de recibo**

> Recibimos tu solicitud de [derecho] el [fecha] (caso N° [nº]). Vamos a verificar tu identidad y
> responderte dentro de los 30 días corridos. Si necesitamos un dato más, te escribimos a este
> mismo canal.

**Verificación de identidad**

> Para proteger tus datos, antes de continuar necesitamos confirmar que sos vos: [consigna
> concreta]. Respondé desde [correo/teléfono registrado] o confirmá el correo que te enviamos. El
> plazo de 30 días corre desde que verificamos la identidad.

**Respuesta favorable (acceso/portabilidad)**

> Adjuntamos los datos que tratamos sobre vos: [detalle]. Si algo no está o querés pedir una
> corrección, respondé a este correo. Pedido resuelto el [fecha] (caso N° [nº]).

**Rectificación aplicada**

> Corregimos [dato] según tu pedido. Quedó así: [valor corregido]. Si hace falta, avisanos.

**Supresión/anonimización con conservación legal**

> Eliminamos [datos] y anonimizamos [datos]. Conservamos [documentos/importes] por obligación
> fiscal/contable hasta [plazo]; no se usan para otra finalidad. Pedido resuelto el [fecha]
> (caso N° [nº]).

**Oposición/revocación registrada**

> Registramos tu [oposición/revocación] el [fecha]. No vamos a volver a usar tus datos para esa
> finalidad. Los tratamientos que dependen de otra base legal (por ejemplo, facturación) siguen
> vigentes.

**Rechazo fundado**

> No pudimos dar curso al pedido porque [identidad no verificada / no corresponde / ...]. Podés
> responder a este correo con [lo que falta] y lo retomamos. (Caso N° [nº], respondido el [fecha].)

### 4.6 Registro de solicitudes

Una sola planilla/carpeta interna de Operación (fuera de este repo: puede contener datos
personales) con estas columnas:

| Nº | Recepción (fecha/hora) | Canal | Titular y contacto | Derecho | Verificación (método/fecha) | Responsable | Vence (recepción + 30 días) | Respuesta (fecha/medio) | Estado | Evidencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Estados: `recibida` → `identidad verificada` → `resuelta` / `rechazada` (con motivo). Cada caso se
conserva 5 años como respaldo de cumplimiento.

## 5. Gestión de brechas de seguridad

Runbook interno (si aparece un incidente con datos personales):

1. **Detectar y contener** (primeras horas): cortar el acceso o el vector, preservar evidencia
   (logs, auditoría, respaldos) y avisar al responsable de la empresa afectada.
2. **Evaluar** (≤ 24 h): qué datos, cuántos titulares, si hay riesgo para sus derechos y qué
   empresas están alcanzadas (`organizationId`).
3. **Notificar** cuando corresponda, dentro de los plazos de la ley: a la autoridad de control
   (ANPDP — MITIC) y a los titulares afectados, con hechos, consecuencias y medidas.
4. **Registrar** el incidente: fecha, causa, alcance, medidas, notificaciones y cierre (planilla de
   Operación, misma carpeta que §4.6).
5. **Corregir y verificar**: fix, prueba y actualización de este documento (brechas §3.5).

## 6. Checklist de adopción para apps del grupo

Apoyado en `dariodeoli/owncoding-ui#8` (reglas de datos personales del ecosistema). Cada app del
grupo lo recorre antes de declararse al día; la columna **EventOS hoy** dice dónde está esta app.

| # | Requisito | Cómo se verifica | EventOS hoy |
| --- | --- | --- | --- |
| 1.1 | Política de privacidad pública, en lenguaje claro y **versionada** | Página en el sitio + versión visible | Pendiente (B1) |
| 1.2 | Enlaces al aviso en **todo punto de recolección** y en el footer | Formularios, login, portal y pie | Pendiente (B1) |
| 2.1 | Consentimiento explícito, sin casilla premarcada, con finalidad declarada | Checkbox + enlace al aviso | Parcial: portal y firma sí; leads no (B2) |
| 2.2 | Consentimiento **registrable** (versión, fecha, origen) y **revocable** | Registro consultable + canal de revocación | Parcial: `consentAt`; falta versión y revocación (B2) |
| 3.1 | Finalidad determinada por dato, sin reutilización para fines incompatibles | Registro de tratamientos (§2) | **Hecho en este documento** |
| 3.2 | Minimización: campos sin uso se quitan u ocultan; contacto enmascarado por rol | Revisión por módulo | Parcial (B3, B7) |
| 4.1 | Canal visible y gratuito para derechos del titular | Buzón + aviso | Pendiente (B6) |
| 4.2 | Respuesta **≤ 30 días corridos** con identidad verificada | Registro de solicitudes (§4.6) | Proceso definido; falta herramienta (B5) |
| 4.3 | Acceso, rectificación, supresión, oposición, portabilidad y revocación operables | Casos de prueba por derecho | Parcial: rectificación y bajas sí; export por titular y oposición no (B5) |
| 5.1 | Auth y permisos validados en servidor; aislamiento por empresa | Matriz de permisos + pruebas con rol sin privilegios | **Hecho** (§3.1–3.2) |
| 5.2 | Auditoría de accesos y cambios sensibles | `AuditLog` + página `/auditoria` | **Hecho** (§3.2) |
| 5.3 | Rate-limit en login, recuperación, PIN, archivos y enlaces públicos | Revisión de endpoints | **Hecho** (§3.3) |
| 5.4 | Secretos fuera del repo (solo entorno del backend) | Revisión de repo y despliegue | **Hecho** (§3.4) |
| 5.5 | Respaldo **con restauración probada**, no solo «respaldos» | Prueba de restore documentada | **Hecho** (`docs/OPERACION.md`) |
| 5.6 | Gestión de brechas con responsables y plazos | Runbook (§5) + registro | Proceso definido; falta habilitar buzón (B6) |
| 6.1 | Retención declarada por dato y purga/anonimización al vencer | Tabla §2.2 + job | Declarada; job pendiente (B4) |
| 6.2 | Nunca se borra historial financiero auditable (se bloquea/anonimiza) | Revisión de bajas | **Hecho** (§2 T7) |
| 7.1 | Autoridad de control identificada (ANPDP — MITIC) y notificación según ley | Aviso + runbook | **Hecho** (§5) |

## 7. Referencias

- `docs/OPERACION.md` — respaldos, restauración y estado del sistema (sostiene §3.4 y T9 de este documento).
- `docs/REGLAS-GENERALES.md` — reglas obligatorias de la app (§10: secretos, endpoints públicos).
- `docs/CONTEXTO-LEDBOX.md` — arquitectura y módulos.
- `docs/client-signature-portal.md` — consentimiento y evidencia en el portal de firma.
- `docs/SSO.md` — acceso con Google y sesiones.
- `dariodeoli/owncoding-ui#8` — reglas de protección de datos del ecosistema.
- `dariodeoli/ledbox#94` — issue de origen de este documento.
