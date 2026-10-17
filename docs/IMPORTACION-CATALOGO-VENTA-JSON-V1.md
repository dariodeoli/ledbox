# Importación de catálogo de venta — JSON v1

Este documento define un formato de intercambio para preparar un catálogo de productos destinados a venta. **El parser disponible valida el archivo; todavía no importa ni guarda productos.** La tienda pública, el carrito y los pedidos de venta son fases aparte.

El formato permite describir variantes, especificaciones, costos de origen, CBM, precios minoristas y tramos mayoristas. Los costos y precios desconocidos se expresan con `null`; nunca como cero. Cada variante vendible es un producto con su propio `codigo`, costo y precio. `familia` agrupa las variantes y `variante` identifica su combinación de opciones.

## Ejemplo ilustrativo

Los valores de este ejemplo son ficticios y sirven solo para mostrar la estructura. No representan productos ni precios reales de LedBox.

```json
{
  "formato": "ledbox.catalogo-venta",
  "version": 1,
  "productos": [
    {
      "codigo": "PANT-01-43-NEGRO",
      "nombre": "Pantalla de ejemplo",
      "descripcion": null,
      "categoria": "Pantallas",
      "familia": "PANT-01",
      "variante": { "pulgadas": "43", "color": "Negro" },
      "especificaciones": {
        "tecnologia": "LCD",
        "resolucionNativa": null,
        "brilloNits": null,
        "tactil": null
      },
      "foto": "fotos/PANT-01-43-NEGRO.webp",
      "costos": {
        "productoEnOrigen": { "amount": null, "currency": "USD" },
        "trasladoHastaPuertoChina": null,
        "cbm": null,
        "importacionPorcentaje": null
      },
      "precios": {
        "minorista": null,
        "mayorista": []
      }
    }
  ]
}
```

## Campos y archivos

- `codigo`: clave única del producto/variante en el archivo. No reutilices códigos para variantes distintas.
- `familia`: código común para agrupar variantes. Dejalo `null` cuando sea un producto sin variantes.
- `variante`: mapa de opciones como `pulgadas`, `color` o `memoria`. La combinación debe ser única dentro de una familia.
- `especificaciones`: pares clave/valor; conserva texto, números, booleanos y `null`. No completes especificaciones que la fuente no confirme.
- `foto`: ruta relativa dentro del ZIP. Acepta JPG, PNG y WebP. No uses rutas del equipo, `..`, URL ni base64. El ZIP puede contener `fotos/` y otros subdirectorios; el nombre debe coincidir exactamente.
- `costos.productoEnOrigen`: costo de compra y moneda.
- `costos.trasladoHastaPuertoChina`: gasto separado hasta el puerto de China, si se conoce.
- `costos.cbm`: volumen de esta variante. Si se proporciona alto, ancho y largo en otro formato, un futuro importador puede convertirlos a CBM con unidades explícitas.
- `costos.importacionPorcentaje`: porcentaje específico del producto cuando esté confirmado; `null` hereda la configuración de la empresa en una futura pantalla de costos. El JSON no impone el 25% sugerido ni ninguna tasa fiscal.
- `precios.minorista`: precio de venta minorista y moneda.
- `precios.mayorista`: tramos por cantidad mínima, cada uno con su precio unitario y moneda. No repitas la cantidad mínima.

El precio del flete por CBM, el tipo de cambio y las demás reglas generales deben configurarse en la empresa, no en cada archivo, para evitar que un JSON antiguo modifique la configuración global. El costo puesto en Paraguay se calcula en la aplicación desde datos y parámetros explícitos; no se acepta como cifra autoritativa en este formato.

## Paquete para preparar

```text
catalogo-venta.json
fotos.zip
  fotos/
    PANT-01-43-NEGRO.webp
```

La forma actual del archivo no incluye cliente, presupuesto, stock, disponibilidad, unidades de alquiler, proveedor, cuentas bancarias, costo de alquiler, días ni estado de publicación. La futura importación debe obtener la empresa de la sesión autenticada, conciliar códigos existentes y mostrar una vista previa antes de guardar. Validar este JSON no debe crear productos, alterar stock, reservar unidades, publicar fichas, emitir presupuestos ni registrar pagos.

## Preparación con un agente de extracción

Pedile que devuelva `catalogo-venta.json` y `fotos.zip` respetando este contrato. Debe copiar solo información que aparezca en el catálogo fuente; usar `null` cuando el dato no esté; conservar las unidades y monedas originales; no calcular tipo de cambio, impuestos, flete ni precio puesto en Paraguay; y listar por separado cualquier duda de lectura. Antes de cargar, verificá cada SKU y foto contra los documentos originales.
