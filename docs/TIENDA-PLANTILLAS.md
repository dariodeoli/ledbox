# Sistema de plantillas de la tienda (especificación del dueño, 2026-10-15)

Tiendas en /tienda/{slug}, de venta y de alquiler: precio «por día», fechas y «pedido = cotización, no reserva». Nivel premium, a la altura de Shopify Prestige, Aesop o Apple.

## Decisiones del dueño que prevalecen sobre el texto original
- **Header:** sello EventOS ARRIBA (pequeño, «EventOS | logo + nombre de la empresa») Y en el pie («Desarrollado por OwnCoding · EventOS vX»).
- **Plantillas:** las 4 de abajo (Lienzo, Boutique, Noir, Studio) reemplazan a las 5 de v2.1.126. Migración de las empresas que ya eligieron una: minimal→lienzo, boutique→boutique, noche→noir, tecnologica→noir, fresca→studio. La editorial y la clásica se mapean a la más parecida: editorial→boutique, clásica→lienzo. Hacelo en una migración de datos aditiva o con un alias en lectura.
- **Tarjeta:** toda la tarjeta abre la vista rápida, más UN botón «Agregar» (icono + texto). Se quita «Ver más». El código va chico y discreto, y el precio va sin caja gris.
- **No tocar** la landing principal app/(public) ni app/(product).

## Actualización vigente: v2.1.129

- Hay **8 plantillas**, agrupadas por rubro en Apariencia: Boutique (eventos, vajilla y decoración), Escenario (producción, sonido e iluminación), LedBox (identidad visual LedBox con catálogo y carrito), Corporativo (empresas), Fiesta (eventos sociales), Gourmet (catering), Kids (infantil) e Industrial (carpas, estructuras y generadores). Lienzo, Noir, Studio, Jardín, Mármol, Terracota, Nórdico, Gala y Brisa se retiraron del selector por pedido del dueño; sus identificadores se resuelven a una alternativa compatible en lectura.
- Fotos de producto y categoría siempre completas: caja cuadrada, fondo claro y `contain`. Los temas con pie oscuro conservan el nombre debajo de la foto. Solo ambientaciones usan `cover`.
- Portadas independientes: escritorio desde 768 px, 1920 × 600 (16:5); celular, 1080 × 1350 (4:5). Si falta una se centra la otra. La vista previa de Apariencia muestra las dos versiones juntas con los archivos de la empresa.
- Boutique conserva la guía cálida editorial (crema, oliva, Cormorant/Jost y script decorativo); los datos y precios del ejemplo del dueño no se cargan en negocios reales.
- Controles y carrito compactos, conservando áreas táctiles de 44 px. El aviso de guardar carrito es pequeño y no compite con la confirmación de agregado.

Estas reglas reemplazan las indicaciones históricas de cuatro temas y de texto encima de fotos de producto de las secciones siguientes.

## Arquitectura (obligatorio)
1. Datos separados de la presentación: los componentes reciben props y el tema decide el look.
2. Tema = archivo de tokens (CSS variables) + variantes de layout. Nada de colores ni tamaños hardcodeados en los componentes.
3. Tokens mínimos: `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-border`, `--color-primary`, `--color-on-primary`, `--color-accent`, `--font-display`, `--font-body`, `--radius-sm/md/lg`, `--shadow-card`, `--space-section`, `--container-max` (1280px) y `--image-ratio-card`.
4. Campo `theme` de la tienda (ya existe el de plantilla en Apariencia) + selector en el panel con vista previa en vivo.
5. El dueño puede sobreescribir el color primario, el logo, la imagen del hero y la tipografía (de una lista curada).

## Las 4 plantillas
1. **Lienzo** (minimal editorial): blanco cálido, sans geométrica, mucho aire, bordes de 1px, sin sombras y fotos sobre fondo neutro.
2. **Boutique** (lujo cálido): crema, serif (Fraunces o Cormorant), dorado o verde salvia y radios suaves. Para eventos, vajilla y decoración.
3. **Noir** (oscuro premium): casi negro, texto blanco, acento único (cian o ámbar) e imágenes con brillo. Para tecnología, LED y electrónica.
4. **Studio** (moderno comercial): grilla densa, tipografía bold, chips de filtro y badges de oferta o stock. Para catálogos grandes.

Prohibido el rosa en las paletas por defecto.

## Reglas globales
- Máximo 2 familias tipográficas, con escala 12/14/16/20/24/32/48/64.
- Botón primario sólido, con contraste AA, NUNCA gris.
- Un solo CTA primario por vista; el resto secundarios (outline) o links.
- Contraste ≥ 4.5:1 y áreas táctiles ≥ 44px.
- Mobile-first: a 390 px nada se corta ni hay scroll horizontal.
- Estados diseñados en cada componente: hover, focus visible, loading (skeletons), vacío y error.
- Imágenes con ratio fijo por tema y `object-fit: contain` sobre `--color-surface`; los productos con fondo blanco no flotan en cajas enormes. Lazy loading y blur placeholder.
- Microanimaciones de 150 a 250 ms: zoom 1.03 en la imagen de la card, drawer y toasts.
- Nada de texto duplicado.

## Home
- Hero único: imagen + título + subtítulo + CTA «Ver catálogo» + uno secundario. NO repetir el nombre de la tienda en un bloque aparte.
- Después, en este orden: categorías destacadas → productos destacados → «Cómo funciona» (3 pasos con íconos) → confianza (reseñas reales, logos, zonas de entrega) → contacto/WhatsApp → footer completo.

## Categorías
- Grilla de 2 columnas (móvil) y 3 a 4 (desktop), todas de la misma altura.
- Imagen con ratio fijo, nombre y «38 productos» en texto pequeño (no pill). Toda la card es clickeable.
- Boutique y Noir: imagen full-bleed con overlay y texto encima.

## Catálogo
- Barra de filtros sticky: chips con scroll horizontal y fade en los bordes, orden (precio, nombre, nuevos) y buscador.
- Encabezado de sección con nombre y contador.
- Paginación o «cargar más», con skeletons.

## Card de producto (crítico)
- Estructura: imagen → categoría (texto pequeño) → nombre (2 líneas, clamp) → dato clave (medidas, 1 línea) → precio → acción.
- Sin espacios vacíos y sin reservar espacio para la descripción.
- Código chico y discreto.
- Precio grande y limpio («Gs. 250.000» + «/día» en muted), sin caja.
- Un solo botón «Agregar», y la card entera abre la vista rápida. Quick-add en hover en desktop.
- Badges opcionales: Nuevo, Popular, Pocas unidades.

## Ficha de producto
- Desktop: galería (60%) + panel sticky (40%). Móvil: carrusel arriba.
- Galería: miniaturas, zoom, varias fotos y video opcional (si hay una sola foto, sin miniaturas).
- Panel: breadcrumb → nombre → precio UNA vez → fechas con disponibilidad en vivo → cantidad → CTA ancho → «Consultar por WhatsApp» → nota legal.
- Debajo: tabs o acordeón (Descripción, Medidas, Qué incluye, Condiciones de alquiler), «Incluido en el alquiler» y «También te puede interesar».

## Carrito
- Drawer en desktop y bottom sheet en móvil.
- Sin fechas: selector de fechas DENTRO del drawer, arriba, con un mensaje neutro (no rojo).
- Ítems: miniatura, nombre, código, stepper compacto y subtotal.
- Nunca «A cotizar» y un total a la vez: «Estimado: Gs. X · confirmamos al cotizar».
- Botones «Enviar pedido» (primario) y «Seguir eligiendo».

## Barra flotante
- No tapa contenido: padding-bottom reservado.
- Desktop: badge en el carrito + toast al agregar. Móvil: barra inferior compacta.
- No se superpone con WhatsApp: se apilan con separación.

## Header y footer
- Header sticky que se compacta al hacer scroll.
- Footer: contacto, horarios, redes, zonas, términos y medios de pago.

## Entrega
Tokens + 4 temas. Componentes refactorizados:
- Header y Hero;
- CategoryCard y ProductCard;
- FilterBar;
- ProductGallery y BuyPanel;
- CartDrawer y OrderBar;
- Footer.

Selector con vista previa. Antes de terminar, revisar cada tema a 390, 768 y 1440 px contra TODAS las reglas, con un checklist en el reporte y capturas.
