# Facturación fiscal interna y SIFEN — alcance y faltantes

> Documento del issue #41 (rama `feat/facturacion-fiscal`). Explica **qué es** el
> módulo de Facturación del panel, **qué no es** y **qué falta** para emitir
> facturas electrónicas válidas con SIFEN/DNIT.

## 1. Qué entrega el módulo (alcance real)

El módulo `/facturacion` del panel es un **registro fiscal interno** serio, no la
factura electrónica de SIFEN:

- **Datos fiscales de la empresa** (RUC, razón social, timbrado, establecimiento
  y dirección) editables por OWNER/ADMIN; son el encabezado del imprimible.
- **Facturas de venta** (`Invoice` + `InvoiceItem`) con:
  - numeración correlativa **por empresa**, atómica y sin huecos
    (`InvoiceSequence`, un `UPDATE … RETURNING` dentro de la transacción de la
    factura: si la transacción falla, el contador vuelve atrás);
  - receptor con razón social y RUC **congelados al emitir** (snapshot);
  - presupuesto y/o evento asociados (opcional), condición contado/crédito con
    vencimiento, y fecha de emisión;
  - IVA 10 % / 5 % / exenta sobre importes **brutos** (IVA incluido) en enteros
    PYG: `base = redondeo(bruto × tasa/(1+tasa))` con redondeo medio hacia
    arriba a nivel de línea, y el resto del redondeo queda en el IVA de esa
    línea. Invariante: **`base + IVA = bruto`** en cada línea (tests en
    `tests/fiscal.test.ts`);
  - estado `emitida` / `saldada` / `anulada`. Una factura **nunca se borra**: se
    anula con motivo y queda auditada; el número no se reutiliza.
- **Emisión desde un presupuesto aprobado** (ítems prellenados) o manual.
- **Imprimible propio** (`/imprimir/factura/[id]`) con el kit de impresión del
  panel y leyenda visible de que no es un comprobante electrónico.
- **Libro de IVA** del período: ventas (sin anuladas) y compras, con débito,
  crédito, saldo de IVA y resultado; **export CSV** con los mismos datos de la
  pantalla.
- **Compras** (`PurchaseInvoice`): el comprobante que emite el proveedor, con
  timbrado, número y tipo de IVA; se puede editar o borrar con el mes abierto.
- **Cierre mensual** (`FiscalPeriod`): congela el resumen del mes (snapshot),
  bloquea emisión/anulación/saldado/compras del mes (409 explicado) y se reabre
  **solo OWNER**, con motivo y auditoría.

Permisos: FINANCE/OWNER/ADMIN escriben (`finance.write`), el perfil fiscal es de
OWNER/ADMIN (`org.manage`), la reapertura es solo OWNER, VIEWER solo lee. Todo
está aislado por empresa (un comprobante de otra empresa responde 404) y la demo
pública es de solo lectura.

## 2. Qué NO es (límite explícito)

- **No es la factura electrónica de SIFEN/DNIT**. No tiene CDC, ni XML firmado,
  ni KuDE, ni transmisión a la DNIT, ni validez fiscal.
- **No reemplaza** la declaración de IVA (Formulario 120) ni el libro de compras
  y ventas que exige la Administración Tributaria.
- **No lleva contabilidad**: no hay asientos, retenciones ni estados contables.
- **No emite notas de crédito/débito** ni autofacturas, exportaciones o
  documentos especiales del régimen electrónico.
- El «timbrado» y el «establecimiento» que carga la empresa son **datos de
  encabezado** del registro interno: la app no los valida contra la DNIT.

## 3. Qué falta para SIFEN (checklist técnico)

### 3.1 Habilitación y credenciales

- RUC activo y **timbrado autorizado** con su rango de numeración vigente
  (desde/hasta), establecimiento y punto de expedición (`001-001`).
- **Certificado digital** de contribuyente emitido por una AC autorizada, con su
  clave privada, para firmar el documento y autenticar la transmisión (TLS
  mutuo). Es un secreto de backend: debe vivir en variables de entorno o un
  almacén de secretos, nunca en la base ni en el repositorio.
- Habilitación del **usuario/empresa en el sistema de la DNIT** y ambiente de
  pruebas (homologación) antes de producción.
- **Certificación del software** (proceso de homologación del emisor) según el
  procedimiento vigente de la DNIT.

### 3.2 Documento electrónico

- **XML del DE** según el esquema vigente de la DNIT (factura electrónica,
  notas de crédito/débito, autofactura, etc.), con todos los campos fiscales
  obligatorios que hoy no se capturan:
  - tipo de documento y **CDC** (código de control de 44 dígitos);
  - numeración **por timbrado + establecimiento + punto de expedición** (hoy la
    secuencia es por empresa; el diseño la admite agregando un alcance a
    `InvoiceSequence`);
  - condición del receptor frente al IVA, tipo de contribuyente, actividad
    económica, tipo de operación (venta de mercadería/servicio) y moneda;
  - desglose por ítem con unidad de medida, cantidad, precio unitario y tasa de
    IVA por línea (hoy el IVA se guarda por línea y por encabezado, pero falta
    la unidad de medida y el catálogo de productos/servicios de la DNIT).
- **Firma digital XMLDSig** del DE con el certificado del emisor.
- **KuDE** (representación gráfica del DE) con el **QR** de consulta, para
  entregar al cliente en papel o PDF. Nuestro imprimible es el antecedente
  visual, pero no el KuDE oficial.

### 3.3 Transmisión y eventos

- **Servicios web de la DNIT**: recepción del DE (síncrona y por lote), consulta
  de estado por CDC, consulta de RUC y **eventos** (cancelación, inutilización de
  rangos, conformidad del receptor).
- **Contingencia**: emisión sin conexión con envío posterior y su marca de
  estado («pendiente de transmisión»), más el plazo de regularización.
- **Reintentos y reconciliación**: cada DE debería guardar su XML, su CDC y el
  estado real de la transmisión (aprobado/rechazado/contingencia) con el
  mensaje crudo de la DNIT. Hoy el estado del comprobante es interno.
- **Almacenamiento** del XML firmado y del KuDE durante el plazo de
  conservación que exige la normativa.

### 3.4 Procesos y contabilidad

- **Notas de crédito** para anular o ajustar un DE ya aprobado (la anulación
  interna no cancela un DE: se cancela con evento y, si corresponde, con nota de
  crédito).
- **Numeración por rango autorizado**: inutilización de números al vencer el
  timbrado y control de rango agotado.
- **Declaración jurada de IVA** (Formulario 120) y libro de compras/ventas
  oficiales: hoy el libro es interno y se exporta a CSV para que el contador lo
  use como insumo, no como presentación.
- **Régimen del contribuyente** (general, pequeño contribuyente, monotributo) y
  retenciones, si aplican al negocio.
- **Multiempresa**: cada empresa necesitaría sus propias credenciales,
  certificado, timbrado y secuencia; el aislamiento por `organizationId` ya
  existe y es la base.

## 4. Cómo seguir (sugerencia de diseño)

1. Mantener este registro interno como **fuente de verdad del negocio** (es lo
   que el equipo usa a diario y lo que alimenta tesorería y cobranzas).
2. Agregar una capa de **emisión electrónica** como adaptador por empresa
   (`SifenProvider`): construir el XML desde el `Invoice` + snapshot del
   receptor, firmarlo, transmitirlo y guardar `cdc`, `xml` y `estado` en una
   tabla nueva (`InvoiceFiscalDocument`), sin tocar el circuito interno.
3. Recién entonces, imprimir el **KuDE** (con QR y CDC) en lugar del
   comprobante interno, y mapear la anulación interna a los eventos/notas de
   crédito del DE.
4. Probar todo contra el **ambiente de pruebas** de la DNIT antes de declarar
   cualquier capacidad como publicada.

> Mientras tanto, la app **dice la verdad**: el imprimible, el módulo y este
> documento aclaran que el registro no es un comprobante electrónico y que la
> factura válida se emite con el sistema habilitado de la empresa.
