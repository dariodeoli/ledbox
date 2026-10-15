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

## Tienda: sistema de temas (v2.1.127)

Especificación del dueño: `docs/TIENDA-PLANTILLAS.md` y `docs/TIENDA-BOUTIQUE.md`. Cuatro plantillas (Lienzo, Boutique, Noir y Studio); las anteriores se leen con un alias (`LEGACY_TEMPLATE_MAP`) y las migra `202610300001_tienda_temas`.

- **Una sola fuente de verdad.** Cada plantilla es un archivo de tokens en `lib/storefront-themes/<id>.ts` (colores, tipografías, radios, sombras, espacios, proporciones de imagen y variantes de layout) y se anota en `lib/storefront-themes/index.ts`. `StoreChrome` pone los tokens inline (`--color-*`, `--font-*`, `--radius-*`, `--shadow-*`, `--space-section`, `--container-max`, `--image-ratio-*`) y las variantes como `data-*`. El CSS (`app/tienda.css`) y los componentes (`components/catalog-public`) no llevan colores ni tamaños de letra propios: lo verifica `tests/tienda-plantillas.test.ts`.
- **Agregar una plantilla** = un archivo de tokens + una línea en el registro (+ una regla `[data-…]` en `app/tienda.css` solo si trae una variante de layout nueva). Los tests de contraste AA, de rosa prohibido, de tokens mínimos y de hardcodes recorren TODO el registro; el selector de Apariencia las agrupa por `rubro` con una miniatura real.
- **Personalizable por empresa** (`Organization.appearance` + `OrganizationRentalSettings`): color primario (solo si da AA con el tema), frase de la tienda (título de la portada), tipografía de títulos (lista curada), barra de anuncio, modo de precio (`day` · `unit` «c/u» con cantidades de a 10 · `quote`) y portada. El logo se carga en Mi empresa.
- **Ganchos pendientes** (sin datos todavía): fotos de ambientación más allá de la portada, colecciones con nombre, filtros por estilo/color, reordenar secciones del inicio, badges «Nuevo» y «Popular».

## Tienda, parte 2 (migración `202610310001_tienda_parte2`)

- **Varias fotos por producto**: `InventoryImage` (orden y texto alternativo); la foto principal sigue en el producto y es la primera de la galería. Ficha del producto → «Tienda web» (`ProductStorefrontPanel`): subir, ordenar con Subir/Bajar y quitar, hasta 8 extra. Tienda: miniaturas, zoom y carrusel con puntos en móvil (ficha y vista rápida).
- **Colecciones**: `Collection`/`CollectionItem`; Ajustes → Tienda web → Colecciones. Landing `/tienda/<slug>/c/<coleccion>`, bloque en el inicio y filtro del catálogo.
- **Inicio** (`Organization.appearance.home`, `lib/store-home.ts`): orden y visibilidad de secciones (portada, categorías, destacados, editorial y colecciones, catálogo, cómo funciona, inspiración, contacto; el catálogo no se oculta), bloque editorial e inspiración con sus fotos (`OrganizationCover` con las ranuras `editorial` e `inspiracion-1..3`). Una sección sin contenido no se dibuja.
- **Destacado y estilos** por producto (`featured`, `tags`) y filtros del catálogo: capacidad, precio por día, estilo, colección y «Disponible en mis fechas» (barra lateral; cajón en el celular).
- Lo que sigue sin datos: badges «Nuevo» y «Popular».

## Actualización de Apariencia (v2.1.129)

El selector contiene siete temas (Boutique, Escenario, Corporativo, Fiesta, Gourmet, Kids e Industrial), agrupados por rubro. Los nueve retirados conservan alias de lectura hacia los temas activos. La vista previa muestra simultáneamente computadora y celular con las portadas de la empresa; el cambio de imagen se hace con `picture` desde 768 px. Escritorio usa 16:5 y celular 4:5, con fallback centrado si falta un archivo. Las fotos de productos y categorías son cuadradas, completas sobre fondo claro, incluso en temas oscuros.
