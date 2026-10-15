# Plantilla «Boutique», especificación del dueño (2026-10-15)

Tienda de referencia: La Vajilla Alquileres, «Espacios que se sienten». Todo lo visual sale de tokens: otra tienda que elija Boutique cambia logo, colores e imágenes sin tocar componentes.

**El dueño decidió algo que prevalece sobre esta spec:** el sello EventOS va ARRIBA (chico, junto al logo de la tienda) Y en el pie.

## 1. Identidad
- **Personalidad:** cálida, natural, elegante y editorial, como una revista de decoración.
- **Logo:** wordmark serif con tracking y una rama de hojas en línea fina.
- **Tagline:** «Espacios que se sienten», en script.
- **Recursos gráficos:** ramas en línea fina, títulos de colección en script, crema y verde oliva.
- **Fotografía:** producto recortado sobre blanco y fotos de ambientación para hero y editoriales.
- **Prohibido:** rosa, gradientes de color, emojis, sombras duras y esquinas filosas.

## 2. Tokens
```css
:root[data-theme="boutique"] {
  --color-bg:#F6F2EA; --color-surface:#FFFFFF; --color-sand:#EDE6D8;
  --color-text:#22241E; --color-muted:#5F5E54; --color-border:#DCD3C2; --color-border-soft:#E6DECF;
  --color-primary:#4B5637; --color-primary-700:#3A4329; --color-on-primary:#FFFFFF;
  --color-accent:#9C7B45; --color-ink:#22241E; --color-success:#3F6B45; --color-info-bg:#EEF0E6;
  --font-display:'Cormorant Garamond',Georgia,serif; --font-body:'Jost',system-ui,sans-serif; --font-script:'Pinyon Script',cursive;
  --radius-sm:12px; --radius-md:18px; --radius-lg:28px; --radius-pill:999px;
  --shadow-card:0 1px 0 rgba(34,36,30,.04); --shadow-float:0 20px 50px rgba(0,0,0,.18);
  --container-max:1280px; --gutter:32px /* 16 en móvil */; --space-section:112px /* 64 en móvil */;
  --image-ratio-card:1/1; --image-ratio-category:4/3;
}
```

Google Fonts: Cormorant Garamond 400/500/600 + italic, Jost 400/500/600 y Pinyon Script.

**Escala tipográfica**

| Uso | Tamaño | Fuente y peso |
|---|---|---|
| H1 hero | 68 / 44 px, line-height 1.02 | display 500 |
| H2 | 48 / 34 px | display |
| Nombre en la card | 26 / 22 px | display |
| Nombre en la ficha | 56 / 38 px | display |
| Script | 40 px, máximo 1 por sección | script |
| Eyebrow | 13 px, mayúsculas, tracking .24em | body 500, accent |
| Cuerpo | 16–18 px, line-height 1.6 | body |
| Precio | 18 px (card) y 32 px (ficha) | body 500 |
| Meta | 12–13 px, tracking .12em | body, muted |

El script solo decora y nunca lleva información crítica.

## 3. Componentes

**3.1 Barra de anuncio.** Fondo primary-700 y texto crema de 13 px centrado. La edita el dueño.

**3.2 Header sticky**
- 80 px de alto, fondo bg y borde inferior.
- Logo a la izquierda, navegación por categorías al centro, y búsqueda (44 px) + píldora primaria «Pedido (2)» a la derecha.
- En móvil: hamburguesa, y la píldora queda solo con ícono y contador.
- Al hacer scroll baja a 64 px con blur.

**3.3 Botones**
- Primario: primary, texto blanco, píldora de 52 px, hover primary-700.
- Primario sobre foto: fondo crema.
- Secundario: borde 1px primary.
- Fantasma sobre foto: borde blanco al 70 %.
- Icon button: círculo de 44 px con borde primary.
- Nunca gris. El deshabilitado va con opacidad .45 y cursor not-allowed.

**3.4 Selector de evento**
- Card blanca flotante, radio 20 y shadow-float.
- Campos con fondo crema: Fecha del evento · Días de alquiler · Invitados, más el botón «Ver disponibilidad».
- Aparece en el hero, arriba del catálogo y en el drawer.
- Las fechas se guardan en la sesión y se aplican a toda la tienda.

**3.5 Card de categoría**
- Fondo blanco, borde border-soft y radio md.
- Imagen 4:3 con el producto en contain al 88 %.
- Nombre en display de 26 px y un dato corto en muted («Juegos de 6 a 10 pers.», «Desde Gs. 2.500 c/u»), sin píldora grande.
- Hover: zoom 1.04 en 500 ms.

**3.6 Card de producto.** Orden fijo y sin huecos:
1. Imagen 1:1 sobre blanco, en contain con padding de 18 px, con badge crema arriba a la izquierda («8 personas» o «Nuevo»).
2. «COD #527» en 12 px muted.
3. Nombre en display de 26 px, máximo 2 líneas.
4. Composición en una línea muted («2 sofás · 4 sillones · mesa baja»).
5. Precio «Gs. 660.000» + «/ día» en muted, y a la derecha un botón circular «+».

El precio va sin caja. La card entera abre la ficha y el «+» agrega con un toast.

**3.7 Card por unidad (vajilla, copas).** El precio dice «Gs. 2.500 c/u» y en vez del «+» lleva un stepper con saltos de 10.

**3.8 Bloque editorial**
- Dos columnas sobre primary-700, radio lg.
- Foto a sangre de un lado. Del otro: eyebrow, título con una palabra en script, párrafo y CTA crema.
- En móvil se apila.

**3.9 Cómo funciona**
- Fondo sand, 4 cards crema con número display de 44 px en primary.
- Los 4 pasos:
  1. Elegí tus productos.
  2. Indicá fecha e invitados.
  3. Recibí tu cotización (un pedido no es una reserva; hasta 24 h hábiles).
  4. Confirmá y disfrutá.

**3.10 Footer**
- Fondo ink.
- Columnas: marca + tagline script, Catálogo, Contacto, y WhatsApp en píldora crema.
- Al final: «Todas las imágenes son referenciales…» y «Hecho con EventOS».

**3.11 WhatsApp flotante**
- Uno solo, de 56 px, en verde oliva.
- Se oculta con el drawer abierto y nunca pisa la barra de pedido.

## 4. Páginas

### 4.1 Inicio
1. Barra de anuncio.
2. Header.
3. Hero a sangre de 680 px con foto de ambientación y overlay a la izquierda: script, H1, subtítulo, «Ver catálogo» y «Cómo funciona», y el selector de evento flotando abajo.
4. Categorías: eyebrow + H2 + grilla de 6.
5. Destacados: 4 cards.
6. Bloque editorial de colección.
7. Colecciones: título script + H2 + 3 colecciones.
8. Cómo funciona.
9. Inspiración: 3 fotos 4:5 + Instagram.
10. Footer.

### 4.2 Catálogo
- Breadcrumb.
- Encabezado: eyebrow, H1, descripción y «Mostrando N productos».
- Barra sticky: chips con scroll y fade (el activo en primary), orden (Destacados, Precio ↑, Precio ↓, Capacidad) y buscador.
- Sidebar de filtros (drawer «Filtrar» en móvil):
  - Capacidad: 6 · 8 · 10+;
  - Precio por día: rango;
  - Estilo/Color;
  - Disponible en mis fechas.
- Grilla de 3 columnas en desktop y 2 en tablet y móvil.
- Banner intercalado cada 9 productos.
- Estados: skeleton, sin resultados (con limpiar filtros) y error.

### 4.3 Ficha
Galería al 58 % y panel sticky al 42 %. En móvil, carrusel con puntos.

**Galería:** foto 1:1 sobre blanco, miniaturas, zoom y «Imagen referencial».

**Panel de compra**, en este orden:
1. Breadcrumb.
2. Meta «SECTOR · COD».
3. H1.
4. Subtítulo «Juego para 8 personas».
5. Precio UNA vez.
6. «Incluye» con checks.
7. Fecha + días, con indicador «Disponible para tu fecha» en verde o «Consultar disponibilidad».
8. Stepper + «Agregar al pedido» ancho.
9. «Consultar por WhatsApp» secundario, con mensaje prearmado.
10. Nota de 13 px.

**Debajo:**
- Acordeón: Descripción · Medidas y piezas · Condiciones · Entrega y retiro.
- «Completá el ambiente»: cards chicas con «+».
- «Otros …»: carrusel de 4.
- Piezas sueltas: tabla «Armá tu combinación» con pieza, precio y stepper.

### 4.4 Pedido
Drawer de 480 px; bottom sheet en móvil.
1. «Tu pedido (N)» + cerrar.
2. Card de evento editable (fecha, días, invitados). Si faltan datos, aviso en info-bg, nunca rojo.
3. Ítems con miniatura de 64 px, nombre, COD, stepper, subtotal y «Quitar».
4. Resumen: subtotal por día, × días, «Entrega e instalación: se cotiza», **Total estimado** y «Confirmamos el monto final en la cotización». Nunca «A cotizar» junto a un total.
5. «Enviar pedido» (primario) + «Seguir eligiendo».
6. Desktop sin barra flotante: toast + contador animado. Móvil: barra compacta «N productos · Ver pedido» y padding-bottom reservado.

## 5. Contenido de ejemplo
Lounge Oslo, Paris, Milano y Treo; Juego Petra; Barra y Estante Sophia; Copas Elegance; Set Arabesco. Ver el catálogo de La Vajilla.

Colecciones: Set Natural, Arena & Blanco, Verde Bosque, Copas & Estilo, Colección Rayas y Exteriores.

## 6. Medios
- **Producto:** blanco puro y centrado, con 10–12 % de aire, siempre en contain.
- **Ambientación:** cover.
- WebP/AVIF, srcset 400/800/1400, lazy loading y blur del color surface.
- Alt descriptivo.

## 7. Movimiento
- Transiciones de 150–250 ms ease-out; 500 ms en la imagen de la card.
- Drawer en 280 ms con overlay rgba(34,36,30,.45).
- Toast abajo al centro durante 2,5 s.
- Respetar prefers-reduced-motion.

## 8. Responsive
- **≥1280:** contenedor de 1280 px y 3–4 columnas.
- **768–1279:** 2–3 columnas y filtros en drawer.
- **<768:** gutter de 16 px, H1 de 44 px, 2 columnas compactas, hamburguesa, bottom sheet y selector apilado.

Validar a 390, 768 y 1440 px.

## 9. Accesibilidad
- Contraste AA. El accent solo en eyebrows o decoración.
- Controles reales con foco de 2 px primary y offset 3.
- aria-label en los íconos y áreas táctiles ≥ 44 px.

## 10. Personalizable por tienda
- Logo y favicon (wordmark de texto si no hay logo).
- Tagline.
- Color primario, del que se derivan los demás tonos.
- Fuente display: Cormorant, Playfair o Fraunces.
- Hero: imagen y textos.
- Barra de anuncio: on/off + texto.
- Secciones del inicio: reordenables y ocultables.
- WhatsApp, Instagram y contacto.
- Modo de precio: por día / c/u / a cotizar.

## 11. Checklist de aceptación
- Tokens sin hardcodes.
- Sin botones grises y un solo CTA primario.
- Cards de igual altura, sin huecos y con el precio sin caja.
- Precio una sola vez en la ficha.
- Sin nombre repetido bajo el hero.
- Chips con fade.
- Pedido sin totales contradictorios ni avisos rojos.
- Barra de pedido y WhatsApp sin superponerse.
- Bien a 390, 768 y 1440.
- AA, foco visible y alt.
- Sin rosa.
