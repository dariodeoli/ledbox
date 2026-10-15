# Perfil de la empresa, apariencia y acceso al catálogo

Pedido del dueño para empresas de alquiler (caso real: La Vajilla Alquileres). Migración
`202610230001_perfil_apariencia_acceso` (aditiva e idempotente).

## Perfil (Ajustes → Empresa)

`Organization.profile` (JSON, `lib/org-profile.ts`): contacto (teléfonos, WhatsApp, Instagram, correo, web),
ubicación con **link de Google Maps** (solo `google.com/maps…` o `maps.app.goo.gl/…`; botón «Cómo llegar»),
horario de atención por día con varias franjas o cerrado, horarios por defecto de entrega/retiro/devolución,
medios de pago aceptados y condiciones comerciales (hasta 600 caracteres). Las reglas de campo viven en
`lib/field-rules.ts` (`normalizeGoogleMapsUrl`, `parseTimeRanges`). Tipo de cuenta y moneda van en
`Organization.paymentDetails` junto a lo que ya existía. Se muestra en la tienda, el seguimiento del pedido, el
portal, el presupuesto impreso (y los datos de pago en el correo del presupuesto aprobado). Lo vacío no se dibuja.

## Apariencia (Ajustes → Apariencia)

`Organization.appearance` (JSON, `lib/appearance.ts`): plantilla cerrada (clásica, minimalista, elegante, oscura;
solo tokens CSS `.cp-theme[data-cp-template]`, sin CSS libre), tipografía de una lista cerrada de Google Fonts y
fondo claro opcional. El **color de marca** sigue en `OrganizationRentalSettings.storefrontAccent` y se valida con
contraste AA (≥ 4,5:1): si no alcanza se oscurece lo mínimo y se avisa (`adjustBrandColor`). La **portada** son dos
archivos (`OrganizationCover`: escritorio 1920×600, celular 1080×1350; JPG/PNG/WebP de hasta 2 MB, validados por
magic bytes y comprimidos con sharp, `lib/server/covers.ts`; `cuotaArchivosOk` en demo y sandboxes).

- Tienda, catálogo, mayorista, acceso y seguimiento del pedido: plantilla, tipografía, color, fondo y portada.
- Portal del cliente y presupuesto impreso: color de marca, tipografía y perfil (no la plantilla).
- Correos: solo color (botón) y logo (`lib/server/mail/org-brand.ts`, `MailContent.brand`).

## Acceso al catálogo

`OrganizationRentalSettings.catalogAccessMode`: `OPEN` (como siempre), `REQUEST` (el cliente pide acceso, la empresa
aprueba o rechaza en Ajustes → Tienda web; al aprobar se resuelve o crea el cliente, se genera su link con
`CatalogAccessToken` —`priceList` RETAIL o WHOLESALE— y se manda por correo) o `PRIVATE` (solo con link). El
pedido de acceso es público con rate limit, honeypot y tope de pendientes, y responde siempre lo mismo (no revela
si el correo ya existe). Links: `/tienda/<slug>/acceso/<token>` (cliente final) y `/tienda/<slug>/mayorista/<token>`.

## Respuesta de la empresa a un pedido

Estados nuevos de `QuoteRequest`: `PROPOSED` (propuesta enviada) y `APPROVED` (aprobada por el cliente).
**Rechazar con motivo** (`reject`; el cliente lo ve en `/pedido/<token>` y por correo), **modificar** (`modify`:
cantidades, quitar, «ya no lo tengo» o reemplazar con `findSubstitutes`) y **aceptar**, que sigue siendo
`convertQuoteRequest` (ignora líneas quitadas) más `holdQuoteRequestStock`. Cada propuesta se verifica contra la
disponibilidad real del período (`availabilityForRange`, con tiempos y retenciones) y se vuelve a verificar cuando
el cliente la aprueba; la retención real sigue siendo la de la conversión, bajo el candado del motor.
