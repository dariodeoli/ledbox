# Venta digital separada de alquiler — auditoría y contrato inicial

Estado: propuesta técnica de alcance inicial; no activa una tienda de venta ni cambia reglas comerciales.
Base auditada: `d2aacd2297b22a3585aae9b1af52f2edd8f3089c`.

## Auditoría del estado actual

- `/tienda/[orgSlug]` se presenta como tienda de alquiler. Sus páginas y carrito trabajan con fechas, días, zonas y disponibilidad; el pedido es una cotización, no una venta confirmada.
- `InventoryItem` ya contiene `listPrice`, precios mayoristas, mínimo, `visibleOnWeb` y `catalogAudience`, pero también campos de alquiler/stock y costos internos. `replacementCost` y `dailyCost` no son información pública.
- La documentación y el modelo de familias tratan cada variante como un `InventoryItem` completo. Las líneas existentes de presupuesto/pedido/carrito apuntan al inventario. Eso sirve para identificar variantes, pero no define por sí solo un ciclo de venta independiente.
- `StoreCart` conserva referencias a inventario y condiciones de fechas/zona; no es una base segura para asumir un carrito de venta sin fechas. El precio se vuelve a calcular al reabrirlo.
- Existe una comparación pública de presupuestos de alquiler. El servidor limita el grupo a 2–4 alternativas; la UI muestra etiquetas administrables (no fuerza A/B/C/D). El layout usa una grilla adaptable y el formulario permite elegir y aprobar una alternativa.
- La comparación devuelve una allowlist de datos del portal y excluye costos internos. Los presupuestos guardan snapshots de precio por línea, pero la comparación no guarda una versión comercial completa propia: consulta las alternativas vigentes. El grupo conserva selección, vencimiento y revocación; no equivale a congelar cada alternativa/version de punta a punta.

## Contrato v1 propuesto: catálogo y carrito de venta

El catálogo de venta debe ser una superficie y un flujo separados del catálogo de alquiler. Reutilizar la identidad de una variante (`InventoryItem.id`) no implica reutilizar su reserva, rango de fechas, zona, tarifa diaria ni aprobación de disponibilidad.

### Lectura pública

- Resolver empresa y publicación en el servidor; solo incluir productos explícitamente publicados y aptos para venta según el alcance configurado. No inferir publicación desde la existencia de un precio.
- Proyectar una allowlist pública: identidad/variante, descripción pública, imagen, precio de venta confirmado o estado «Consultar». Nunca incluir cantidad exacta, notas internas, costos, mínimos internos, márgenes o datos de proveedores.
- Una familia agrupa sus variantes existentes. Las opciones/subopciones salen de los ejes y valores configurados; no crear opciones sintéticas ni productos ficticios.
- Si falta precio o información de variante, presentarlo como no cargado/consultar y permitir que el negocio complete el dato. No asumir cero, disponibilidad ni equivalencia de variantes.

### Carrito de venta

- La línea identifica el `InventoryItem` variante concreta y cantidad entera positiva. No representa familia sin variante elegida.
- No requiere fechas de alquiler, duración, zona ni comprobación/reserva de disponibilidad del flujo de alquiler.
- El total debe ser calculado por servidor con el precio de venta autorizado para esa audiencia; el cliente no puede fijar precio/descuento ni enviar costos internos.
- Crear/confirmar un pedido de venta es una operación separada. Esta unidad no define pago, despacho, impuestos ni reserva de stock porque la auditoría no encontró un contrato vigente que permita fijarlos.

## Requisito asociado: comparación de presupuestos A/B/C/D/E

Esto se refiere al portal de comparación de presupuestos, separado del carrito de venta. El estado actual admite de 2 a 4 alternativas, así que la quinta opción requiere cambio de contrato tanto en la validación del servidor como en el portal.

- El portal debe ofrecer selección explícita A, B, C, D o E, con las opciones realmente configuradas (mínimo 2, máximo 5); no inventar una quinta alternativa si no existe.
- En móvil, presentar alternativas en una columna y conservar visible/alcanzable el selector y la confirmación. En web, comparar en columnas o permitir cambiar de alternativa sin scroll horizontal. Debe seguir siendo usable con teclado y lector de pantalla.
- Cada alternativa necesita una versión comercial congelada e identificable. La vista, selección y posterior aprobación deben usar la misma versión; una edición comercial posterior crea otra versión o exige renovar/publicar explícitamente la comparación. La selección de una opción no debe reescribir las demás.
- Construir la respuesta del portal desde una allowlist versionada. Excluir costos internos, margen, costos de artículos/materiales/mano de obra, datos de proveedores, notas privadas y cualquier campo de administración. La vista solo puede mostrar los valores comerciales aprobados para el cliente.
- Mantener vencimiento, revocación y elección única. La revisión de concurrencia debe comprobar que la versión elegida sigue siendo la publicada antes de registrar la aprobación.

## Fuera de alcance de esta unidad

No crea modelos/migraciones, no publica catálogo, no cambia el carrito actual, no inventa productos/precios ni convierte presupuestos de alquiler en órdenes de venta. Los siguientes pasos requieren definir pedido/pago/stock de venta y diseñar versionado de comparación; esta propuesta delimita esos contratos sin afirmar que ya están implementados.
