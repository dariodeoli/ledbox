# Base de costeo del catálogo de venta

Estado: **contrato y cálculo de vista previa**, sin persistencia ni conexión a
la pantalla de catálogo. El módulo actual `CatalogoVentaModule` sigue leyendo
productos marcados en `InventoryItem`; no se agregan ahí campos de adquisición
porque ese modelo también participa en alquiler y stock físico.

El contrato disponible en `lib/sales-catalog-costing.ts` recibe componentes
estructurados por unidad: compra en origen, traslado al puerto de China, costos
adicionales, dimensiones o CBM, tarifa de flete por CBM, cambio explícito a PYG
y porcentaje/base explícitos de importación. Todos los montos desconocidos son
`null`; cero sólo representa un valor confirmado. No se aplica cambio, tarifa,
porcentaje, base aduanera ni cargo implícito.

El cálculo de importación aplica el porcentaje recibido a la base PYG recibida.
La selección y configuración de esa base queda en manos del negocio: no se
asume una fórmula CIF ni se afirma que el resultado represente una obligación
tributaria. El flete es `CBM × tarifa USD/CBM × PYG/USD`. Si falta algún
componente requerido, la vista previa entrega los campos pendientes y no llama
subtotal parcial «costo puesto».

Con costo completo, los precios sugeridos usan margen bruto sobre precio de
venta (`precio = costo / (1 - margen)`) para 20 %, 30 %, 40 %, 50 % y un margen
personalizado. Se redondea hacia arriba a un guaraní entero para no reducir el
margen sugerido. La sugerencia no modifica el precio elegido ni un presupuesto.

Esta base no crea ni actualiza productos, familias, stock, precios, políticas
de importación o presupuestos. La integración requiere definir un modelo de
venta separado, almacenamiento de parámetros por empresa, control de acceso y
un flujo de vista previa antes de persistir datos.
