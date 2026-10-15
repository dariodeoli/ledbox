# Correos de EventOS — plantilla única y remitente

Todo correo se arma con **una sola plantilla**: `renderMail` / `renderMailText` en
`lib/server/mail/template.ts` (HTML de tablas, estilos en línea, 600 px, tolerante a modo oscuro
y a Outlook; sin fuentes externas). Ningún otro archivo puede escribir HTML de correo
(`tests/mail-brand.test.ts` lo verifica). Los correos concretos son constructores en
`lib/server/mail/*` (`invitation`, `budget`, `signature`, `catalog`) o contenido armado en
`reminders.ts`, `resend.ts` (reset) y `system-status.ts` (alerta de respaldo).

## Marca
- **Correo de empresa**: encabezado con el isotipo de EventOS (`/assets/eventos-mark.png`), el logo
  de la empresa (variante clara de `OrganizationLogo`; si solo hay la oscura va sobre una chapa
  blanca) y su nombre. Sin logo, solo el nombre. Pie con el contacto del perfil (teléfono,
  WhatsApp, Instagram, correo, web, dirección con link de Maps; lo que no cargó no aparece) y
  «Enviado con EventOS». El color de Apariencia (`storefrontAccent`, ya ajustado a AA) va solo
  en el botón y los acentos; sin color rige el acento de EventOS.
- **Correo de plataforma** (alta de empresa desde el superadmin, reset de contraseña, alerta de
  respaldo): marca y remitente «EventOS» (`PLATFORM_BRAND`, `platform: true`).
- LedBox como empresa usa su propio logo y nombre como cualquier otra.
- El logo se sirve por `/api/mail/logo/<slug>/<light|dark>` (público, de empresas activas, no
  depende de que la tienda esté encendida).

## Remitente
`lib/server/mail/org-brand.ts` (`mailIdentityFor`) resuelve marca + `From` + `reply-to` en un solo
lugar y `sendMail` lo aplica:
- `From`: **«<Empresa> vía EventOS» <dirección configurada>** (`EMAIL_FROM` o `authConfig.resetSender`;
  el dominio de envío no cambia). Plataforma: **«EventOS» <dirección>**.
- `reply-to`: correo de contacto del perfil (o `storefrontEmail`) si es válido; si no, no se manda.
- La salida (`salidaPermitida`, demo/sandbox, historial `MailLog`) no cambia.

Un correo nuevo: arma su contenido con `renderMail`, trae `brand` con `mailIdentityFor(orgId)` y
llama a `sendMail({ ..., organizationId, identity })` (o `platform: true` si es de la plataforma).
