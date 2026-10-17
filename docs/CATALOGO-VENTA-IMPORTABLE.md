# Catálogo de venta importable por JSON — auditoría y contrato propuesto

Estado: **propuesta de contrato**, no implementado ni habilitado en el importador. No contiene productos, costos ni precios reales. La empresa y el usuario salen de la sesión autenticada; el JSON nunca puede seleccionar otro tenant.

## Hallazgos del esquema actual

- `InventoryItem` es el producto canónico, con `organizationId`, SKU, `replacementCost`, `dailyCost`, precios base de lista/mayorista y un precio mínimo. `replacementCost` y `dailyCost` son importes internos en PYG existentes; no distinguen compra en origen, flete, aduana, despacho ni costo puesto en Paraguay. No reutilizar `replacementCost` como total de importación.
- `InventoryPriceTier` representa escalones por **días** (`fromDays`, `mode`, `price`, frente RETAIL/WHOLESALE). No modela precios por cantidad de unidades. El importador actual acepta `precios_dias` para RETAIL; la ausencia conserva escalones existentes.
- `InventoryFamily` ya agrupa productos SKU y limita la familia a dos ejes. Cada variante es un `InventoryItem` independiente y `variantOptions` guarda la combinación como JSON; dos ejes alcanzan para opciones principales y subvariantes, por ejemplo color y talle. La API de importación no crea ni actualiza familias hoy.
- `PurchaseInvoice` es una cabecera fiscal del comprobante recibido, no una ficha de costos unitarios del producto ni un libro de importación. No sirve como destino de costos China/importación/despacho.
- `QuoteComparison` ya agrupa presupuestos alternativos del mismo cliente, conserva la opción elegida y su selección. El catálogo de venta no debe reemplazar ese flujo ni convertir sus precios congelados en precios derivados en cada lectura.
- Los DTO públicos del catálogo omiten costos, notas internas y stock exacto. Los nuevos datos de adquisición tienen que permanecer en endpoints administrativos; ninguna superficie de tienda, portal, comparación o comprobante recibe esos campos.

Referencias verificadas: `prisma/schema.prisma` (`InventoryItem`, `InventoryPriceTier`, `InventoryFamily`, `PurchaseInvoice`, `QuoteComparison`), `lib/import-catalog.ts`, `lib/server/import-catalog.ts`, `lib/server/catalog-public.ts` y `docs/VARIANTES.md`.

## Contrato JSON propuesto

Conservar los campos actuales de `productos`, `categorias` y `colecciones`. Añadir opcionalmente estas propiedades por producto:

| Campo | Forma propuesta | Semántica |
|---|---|---|
| `costos_adquisicion` | `{ componentes: [...], puesto_paraguay_pyg: entero|null, completo: boolean }` | Costo interno unitario. `completo:false` o total `null` significa que no se conoce el costo puesto; campos omitidos no equivalen a cero. |
| `precios_mayorista_cantidad` | `[{ desde_unidades, precio_pyg }]` | Precio unitario mayorista en PYG; rige el umbral mayor `desde_unidades` que no supere la cantidad solicitada. Separa umbrales por cantidad de `precios_dias`. |
| `familia` | `{ codigo, nombre, ejes, opciones }` | `codigo` agrupa SKUs; `ejes` define hasta dos dimensiones y `opciones` asigna un valor por eje al SKU actual. Cada combinación continúa siendo un producto independiente. |

Una componente de costo tendría esta forma, sin valores de ejemplo: `{ tipo, monto_origen, moneda, cambio_pyg, monto_pyg }`. `moneda` sería un código ISO 4217; `cambio_pyg` sería PYG por unidad de moneda y `monto_pyg` un entero redondeado de forma explícita. Tipos iniciales candidatos: `COMPRA_CHINA`, `FLETE_INTERNACIONAL`, `SEGURO`, `ARANCEL`, `IVA_IMPORTACION`, `DESPACHO_ADUANERO`, `DESPACHO_LOCAL` y `OTRO`. Una futura regla de validación debe impedir que un costo parcial se presente como costo puesto completo y comprobar la suma cuando `completo` sea verdadero.

La semántica de actualización propuesta es: campo ausente = conservar el valor vigente; objeto `costos_adquisicion` presente = reemplazar la ficha de costo explícitamente; `precios_mayorista_cantidad` ausente = conservar; lista vacía = borrar los umbrales mayoristas. Cambiar costos o precios debe aparecer en la vista previa antes de aplicar.

## Persistencia aditiva sugerida

1. `InventoryAcquisitionCost`: snapshot interno vigente por producto, organización, actor y fecha. Componentes separados con monto original, moneda, tipo de cambio y equivalente PYG; total puesto PYG nullable hasta completar la composición. No modificar automáticamente facturas, pagos, costo de presupuestos ya guardados ni `InventoryItem.replacementCost`.
2. `InventoryQuantityPriceTier`: producto, organización, cantidad mínima, precio unitario PYG y orden. Índice único por producto/cantidad mínima; el servicio rechaza límites inválidos y controla rangos solapados si se decide admitir `hasta_unidades`.
3. Ambas tablas llevarían `organizationId` y una FK compuesta a `(InventoryItem.id, InventoryItem.organizationId)`. La organización se obtiene de la sesión y se revalida en cada alta/importación. Los registros de variantes se enlazan a cada SKU real; no se crea stock en el objeto familia.
4. Reutilizar `InventoryFamily` y sus dos ejes para variante/subvariante. No introducir otro árbol de producto ni añadir una tercera dimensión sin aceptación de producto y actualización de la tienda completa.

## Límites y decisiones antes de activar importación

- Confirmar si el cambio de moneda se entrega por componente o por lote y qué precisión/redondeo se acepta.
- Definir qué costos forman un `puesto_paraguay_pyg` completo y cómo se reparte un costo común entre varios SKUs. El importador no debe prorratearlo por su cuenta.
- Fijar si los umbrales mayoristas aplican al número de unidades de un SKU o a la suma del carrito, y qué superficies recalculan el precio. Hasta integrarlo en el motor de venta, el campo es dato importado y no debe anunciarse como precio efectivo.
- Completar creación/actualización de familias en el importador; resolver choques de combinación con vista previa y confirmar que cada producto del JSON tenga SKU propio.
- Conservar alternativas de comparación, selección, versionado y precios congelados. La comparación consume presupuestos aprobados y snapshots comerciales; nunca muestra costos de adquisición.

La aceptación de este documento autoriza revisar el contrato, no importar productos ni costos, cambiar datos de una empresa, publicar precios, modificar una comparación existente ni desplegar.
