# Actualizar sólo precios por JSON

En Inventario → Importar → Productos existentes → **Actualizar sólo precios (JSON explícito)**.

Esta entrega actualiza únicamente códigos existentes de la empresa. No crea fichas ni cambia nombres, fotos, cantidades, estados, depósitos, dueños, categorías, cobro, componentes o documentos ya emitidos. Para variantes, un precio efectivamente modificado pasa a ser propio y no cambia sus hermanas.

```json
{
  "moneda": "PYG",
  "productos": [
    {
      "codigo": "CODIGO-EXISTENTE",
      "cambios": {
        "listPrice": { "op": "REPLACE", "value": 25000 },
        "wholesalePrice": { "op": "KEEP" },
        "minimumPrice": { "op": "CLEAR" },
        "tarifasFinal": {
          "op": "REPLACE",
          "value": [{ "fromDays": 3, "mode": "TOTAL", "price": 60000 }]
        }
      }
    }
  ]
}
```

Los importes son ejemplos, no recomendaciones comerciales. Los campos disponibles son:

- `listPrice`: precio de cliente final.
- `wholesalePrice`: precio mayorista.
- `minimumPrice`: mínimo existente.
- `tarifasFinal` y `tarifasMayorista`: tabla por días de cada segmento. Cada escalón usa `fromDays`, `mode` (`TOTAL` o `PER_DAY`) y `price`.

Campo ausente o `KEEP` conserva. `CLEAR` quita el precio (0 almacenado, Consultar) o vacía la tabla de ese segmento. `REPLACE` exige un número entero para un precio o una lista explícita para una tabla. Null/cadena vacía no ordenan borrar. `REPLACE` con precio 0 es explícito y equivale a dejarlo sin precio comercial; una tabla `[]` queda vacía. No se suman componentes para calcular precios de combos.

Sólo JSON, hasta 2 MiB y 1.000 filas. Este modo no utiliza planilla, IA ni ZIP. Rechaza otros campos e identifica todas las filas de un código repetido, sin elegir la primera. La plantilla del importador de catálogo anterior no es esta plantilla.

La vista previa muestra antes/después por código. Su confirmación vence a los 15 min; cambiar el archivo requiere revisión nueva. Al aplicar se releen los campos elegidos bajo lock. Si cambiaron, la fila queda en conflicto sin sobrescribirlos; una edición de notas o precio no elegido se conserva y no impide el cambio seleccionado.

Cada fila guarda sus precios, su auditoría y el recibo de reintento en una misma transacción. Si se corta la conexión, usá **Recuperar reporte** con el identificador de lote, o repetí ese mismo intento: una fila ya comprometida devuelve su resultado original sin reaplicarse. El reporte y esa protección duran 7 días. El reporte es histórico; no asegura que nadie haya editado los precios después.

**Descargar revisión CSV** y **Descargar reporte CSV** incluyen filas/errores y neutralizan fórmulas de planilla. **Cargar otro lote** conserva los reportes y los originales en esa sesión del diálogo. **Preparar sólo pendientes** crea un archivo para una vista previa nueva de conflictos/interrupciones, excluyendo éxitos; los errores de formato requieren corregir el original. Recuperar un reporte después de cerrar no recupera automáticamente el archivo local: conservá el JSON original.

CREATE_ONLY y UPSERT conservan su contrato. Sigue pendiente en #247 seleccionar fotos/estados/metadatos y revisar conversiones estructurales con el mismo flujo; esta entrega no cierra todo ese alcance. El CSV de reporte no es una copia de seguridad restaurable.
