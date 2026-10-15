# Boutique — diseño vigente desde 2.1.130

Referencia: La Vajilla Alquileres. El dueño reemplazó la dirección editorial original por un diseño minimalista tipo Apple: blanco, negro, letra moderna y pocos elementos.

- Una sola fuente de tokens: `lib/storefront-themes/boutique.ts`. Fondo blanco, texto casi negro, tipografía del sistema, bordes discretos y sin sombras decorativas.
- El encabezado muestra la identidad de la empresa, catálogo, contacto, búsqueda y pedido. EventOS queda en el pie.
- Portada íntegra, sin título ni controles superpuestos. Computadora: archivo horizontal 1920 × 600; celular: archivo vertical 1080 × 1350. Si falta una, se centra la otra.
- Título, acciones y fechas debajo de la imagen. Una sola instancia del selector de evento en el inicio.
- Campos con línea inferior. En escritorio: fecha 160 px, días 100 px e invitados 80 px. En celular se reducen y acomodan sin desbordar. Invitados es opcional y solo de referencia.
- Catálogo con cuatro columnas en escritorio y dos en celular. Producto completo sobre fondo blanco; las tarjetas no reservan huecos para datos ausentes.
- Todas las tarjetas permiten agregar al pedido. Sin precio: «Consultar precio y disponibilidad».
- Cada categoría tiene página propia; al navegar se conservan fechas y carrito.
- Popup con ficha pública completa y fechas; no obliga a abrir otra ficha. Sin datos internos.
- Pedido persistente con productos, unidades e importe desde el primer agregado, confirmación animada y respeto de movimiento reducido. Guardar carrito es voluntario.
- Pie compacto de tres columnas, claro en Boutique.
- El negro intencional está autorizado como botón principal; los grises medios siguen rechazados y todo color efectivo conserva contraste AA.
- Las otras seis plantillas por rubro permanecen disponibles. Los colores y tipografías configurados explícitamente por cada empresa siguen respetándose.

El cambio es visual y de navegación: no altera precios, reservas, permisos, condiciones ni datos de la empresa.
