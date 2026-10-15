# Guía reutilizable para preparar e importar empresas en LedBox

Basada en la carga real de La Vajilla Alquileres, EventOS v2.1.121, 15/10/2026. Distingue requisitos de preparación, comportamiento observado y funciones aún no probadas.

> Nota del equipo: las secciones marcadas «Comportamiento v2.1.121» describen lo observado en esa versión. Los arreglos posteriores (stock sin contar, juego incompleto, precio a consultar) se documentan en «Cambios desde v2.1.121» al final.

## 1. Resultado comprobado

- Un JSON y un ZIP se pudieron cargar juntos desde Inventario → Importar → Con ChatGPT.
- La vista previa aceptó 392 productos y 390 fotos: 392 creados, 0 actualizados y 0 omitidos al aplicar. Lote 01ca586d.
- Se importaron 19 combos con componentes completos. Otros 41 juegos con componentes vacíos se convirtieron en unidades.
- Hubo 99 avisos no bloqueantes: 41 juegos sin componentes y 58 precios sin dato. Además, se mostraron 180 fichas con dudas procedentes del archivo. No son 180 errores de importación.
- No hubo errores bloqueantes en esta importación. No se ensayaron archivos inválidos deliberadamente.
- Los precios null se aceptaron; la vista previa avisó que se guardan como 0 y se presentan como «Consultar» en tienda. La tienda permaneció apagada, por lo que esa presentación pública no se verificó en vivo.
- Se observó 1 unidad creada por defecto para productos con cantidad null. Es una decisión del importador, no una cantidad del catálogo.
- Se aceptaron códigos con SC-, PK-, y sufijos -b/-c. Mantener siempre el código y archivo exactos.
- La foto de prueba del sofá 743 se vio centrada y con margen en la cuadrícula del inventario. No se verificó visualmente cada foto después de cargarla ni la tienda pública en móvil.
- Portadas de escritorio y celular se pudieron cargar por separado, ver sus medidas y guardar.

## 2. Archivos a entregar

```text
entrega/
  catalogo.json
  fotos.zip
  perfil_empresa.md
  dudas.md
  juegos_y_paquetes.md
  logo_claro.png
  logo_oscuro.png
  portada_escritorio.jpg
  portada_celular.jpg
```

Solo catalogo.json y fotos.zip van al importador de productos. Los demás son documentación o recursos para cargar en Ajustes. perfil_empresa.md no es un formato de importación automática.

Límites: JSON hasta 2 MB; ZIP hasta 60 MB y 400 fotos; hasta 1000 productos por archivo. Planillas .xlsx/.csv hasta 5 MB (no probadas en esta carga). Si se exceden límites, dividir en lotes conservando códigos y dependencias, y revisar la vista previa de cada lote.

## 3. Formato JSON

JSON válido en UTF-8, sin comentarios, sin bloques Markdown y sin comas finales. Ejemplo ficticio:

```json
{
  "empresa": "Empresa de ejemplo",
  "moneda": "PYG",
  "productos": [
    {
      "codigo": "S-1",
      "nombre": "Silla modelo A",
      "categoria": "Sillas",
      "tipo": "unidad",
      "precio": 17000,
      "cobro": "dia",
      "cantidad": 40,
      "medidas": null,
      "capacidad": null,
      "descripcion": null,
      "componentes": [],
      "foto": "S-1.jpg",
      "pagina": 2,
      "dudas": null
    },
    {
      "codigo": "PK-1",
      "nombre": "Paquete de 8 sillas modelo A",
      "categoria": "Juegos de mesa",
      "tipo": "juego",
      "precio": null,
      "cobro": "dia",
      "cantidad": null,
      "medidas": null,
      "capacidad": "8 personas",
      "descripcion": "Incluye 8 sillas modelo A.",
      "componentes": [{ "codigo": "S-1", "cantidad": 8 }],
      "foto": null,
      "pagina": null,
      "dudas": "Paquete nuevo. Precio comercial pendiente. Suma de piezas: 136000 PYG."
    }
  ]
}
```

Sección opcional `categorias` (al mismo nivel que `productos`), para darle foto propia y orden a cada categoría:

```json
"categorias": [
  { "nombre": "Platos", "foto": "cat-platos.jpg", "orden": 3 },
  { "nombre": "Vajilla / Copas", "foto": "cat-copas.jpg", "orden": 4 }
]
```

- `nombre`: el de la categoría (o «Categoría / Subcategoría»). Se compara normalizado (sin importar mayúsculas, acentos ni espacios), igual que la categoría de un producto. Si no existe, se crea.
- `foto`: nombre exacto del archivo dentro del mismo ZIP de las fotos de productos. `null` o ausente = sin foto.
- `orden`: entero 0 a 9999, llena el orden de la categoría (las más chicas van primero). Ausente = no se toca.
- Es opcional y nunca bloquea: una entrada sin nombre, repetida o con un orden inválido se descarta con un aviso. Máximo 200 categorías.
- Reimportar actualiza la foto de la categoría por nombre (la reemplaza); no crea duplicados.
- La vista previa muestra «N fotos de categoría» (las que se encontraron en el ZIP) y avisa las que no están.

### Tienda, parte 2: varias fotos, colecciones y estilos (migración `202610310001_tienda_parte2`)

Tres campos opcionales por producto y una sección opcional del archivo. Ninguno bloquea: lo inservible se descarta con un aviso. Los campos ausentes **no tocan** lo que el producto ya tiene.

```json
{
  "codigo": "527",
  "nombre": "Lounge Oslo",
  "foto": "527.jpg",
  "fotos": ["527.jpg", "527-2.jpg", "527-3.jpg"],
  "colecciones": ["Verde Bosque", "Colección Rayas"],
  "estilo": ["Natural", "Rattan"]
}
```

```json
"colecciones": [
  { "nombre": "Verde Bosque", "descripcion": "Tonos de selva.", "foto": "col-verde-bosque.jpg", "orden": 10 }
]
```

- `fotos`: lista ordenada de archivos del mismo ZIP, además de `foto`. La principal es `foto` (o, si no hay, la primera de `fotos`) y no se repite entre las extra. Hasta 8 extra por producto (9 con la principal); las que sobran se descartan con aviso. Una lista, aunque sea corta, **reemplaza** las fotos extra que ya tenía; reimportar las mismas fotos no escribe nada. Nombres simples (sin carpetas ni `../`). Si el archivo no está en el ZIP, avisa y se importa el resto.
- `colecciones` (por producto): nombres de colecciones. Se comparan sin tildes ni mayúsculas; la que no existe se **crea** y el producto se **suma** (nunca se saca de otras). También sirve un texto con comas o `;` (planilla).
- Sección `colecciones` (al mismo nivel que `productos`): `nombre`, `descripcion` (hasta 400), `foto` (en el mismo ZIP) y `orden` (0 a 9999, menor = primero). Opcional: solo hace falta para darle descripción, foto u orden. Máximo 40 colecciones por empresa; repetidas o sin nombre se descartan con aviso.
- `estilo`: lista de estilos o colores para el filtro de la tienda (hasta 8 por producto, 24 caracteres cada uno; «Rattan» y «rattán» son el mismo). Ausente = no se toca; `[]` = los limpia.
- La vista previa muestra «Fotos extra de producto», «Colecciones» y «Productos con estilo». Todo queda en la empresa activa; las colecciones nuevas nacen visibles.
- No cargado por importación (se hace en el panel): «Destacado» del producto (Inventario → ficha → Tienda web), el orden de las secciones del inicio, el bloque editorial y las fotos de inspiración (Ajustes → Apariencia).

Campos adicionales soportados pero no ejercitados en este lote: subcategoria, deposito, ubicacion y precios_dias. No agregarlos por inventar información. precios_dias usa `[{"desde_dias":5,"modo":"total","precio":300000}]`, con modo dia o total, únicamente cuando hay una tarifa documentada. No deducir descuentos.

### Estados de unidades (opcional, solo `tipo: unidad`)

Tres campos enteros ≥ 0 por producto: `en_mantenimiento`, `danadas` y `perdidas` (en la planilla, columnas «En mantenimiento», «Dañadas» y «Perdidas»; una planilla anterior sin esas columnas sigue valiendo). Van a los estados MAINTENANCE, DAMAGED y LOST de la unidad.

```json
{ "codigo": "S-1", "nombre": "Silla modelo A", "tipo": "unidad", "cantidad": 40, "en_mantenimiento": 2, "danadas": 1, "perdidas": 0 }
```

- La suma de los tres no puede superar la cantidad (o las unidades totales después de completar): si la supera es un **error bloqueante** de esa fila («suman X y el producto tiene Y»).
- **Alta:** de las unidades creadas, N quedan en cada estado y el resto AVAILABLE.
- **Reimportación:** el estado del archivo es el objetivo. Solo se mueven unidades AVAILABLE que no hacen falta para asignaciones vigentes o futuras (la reserva es por cantidad: se descuenta la cantidad comprometida), o unidades en esos estados que vuelven a AVAILABLE si el archivo trae menos. Nunca se tocan las RETIRED. Si no se llega al objetivo, aviso «solo se pudieron ajustar N».
- **Campo ausente = no tocar** el estado. **Campo en 0 = devolver a disponible** las que estén en ese estado (con las mismas restricciones).
- Cada cambio deja el mismo rastro que uno manual (auditoría de la unidad y cantidad del producto sincronizada) y además un incidente abierto con la nota «Importación» (mantenimiento = reparación, dañada = daño, perdida = faltante). Al volver a disponible se resuelven los incidentes abiertos de esa unidad.
- En un juego estos campos se ignoran con un aviso. La vista previa muestra «Estados de unidades: X a mantenimiento, Y dañadas, Z perdidas, W vuelven a disponible».
- Sin migración: usa el enum `InventoryUnitStatus` actual.

## 4. Códigos, nombres, categorías y descripciones

- codigo es texto único por empresa. Conservar el original, incluidos ceros iniciales. No usar el nombre como identificador.
- Un mismo producto repetido en varias páginas se incluye una sola vez. Si un código identifica productos distintos, documentar el conflicto y asignar sufijo estable -b, -c. Sin código: SC-1, SC-2. Paquete nuevo fuera de catálogo: PK-1, PK-2. No reutilizar identificadores.
- nombre: nombre comercial legible, con mayúscula inicial y variante comprobada. Sin precios, stock, emojis ni características supuestas.
- categoria: misma grafía en toda la empresa. Las categorías de una empresa no son una lista universal.
- medidas y capacidad son texto; null si faltan. No deducir cantidades físicas de capacidad o fotos.
- descripcion: castellano claro con información documentada, piezas incluidas y exclusiones. Sin condiciones bancarias o generales. Sin información útil: null.
- pagina: página del documento fuente; null en paquetes nuevos o fuentes sin páginas.
- dudas: observación concreta sobre faltantes o contradicciones. Conservar el detalle completo en documentos de auditoría.

## 5. Cantidades

| Situación | cantidad en JSON | Qué hacer |
|---|---:|---|
| Stock confirmado de 20 unidades | 20 | Entero, sin separadores. Registrar fuente/fecha. |
| Stock confirmado agotado | 0 | Cero = se confirmó que no hay existencias. |
| La fuente no informa stock | null | Anotar «stock no informado; pendiente de conteo» en dudas. |
| Total de varias variantes sin desglose | null por variante | Documentar el total compartido. No repetirlo en cada variante. |
| Combo con composición completa | null | La disponibilidad depende de sus componentes. |
| Juego con composición incompleta | null | componentes: []; anotar piezas faltantes. |

Cambio posterior: **cantidad null sigue creando 1 unidad por defecto**; es una decisión del dueño y no cambió.

No confundir «capacidad 8 personas», «incluye 8 sillas» y «stock de 8 juegos». No poner 1, 0 ni un número grande para rellenar stock desconocido.

Comportamiento v2.1.121: cantidad null creaba 1 unidad por defecto (en La Vajilla, 304 productos; el panel mostró 1833 unidades que no acreditan existencias reales). El dueño decidió conservarlas hasta el conteo, y ese comportamiento se mantiene.

## 6. Precios y moneda

- PYG = guaraníes. En otras empresas confirmar la moneda. No convertir divisas por suposición.
- precio es entero sin puntos ni símbolo: Gs. 660.000 → 660000.
- Sin precio: null, y en dudas «precio no informado; consultar». No usar 0 como sinónimo de gratis: **precio null o 0 significa «a consultar»** (ver «Cambios desde v2.1.121»).
- Dos precios contradictorios: usar el inequívocamente asociado al producto; si no se puede decidir, null y preguntar.
- precio del combo = importe comercial del paquete completo, nunca la suma de piezas. Si falta, null y suma de referencia en dudas.
- cobro: dia o evento. Si la fuente no lo aclara, preguntar.

## 7. Combos, juegos y paquetes

- Todos usan tipo: juego. componentes contiene objetos codigo/cantidad con enteros positivos.
- Cada pieza debe existir como unidad en el mismo archivo o estar ya cargada. Lo comprobado: todo en el mismo JSON.
- No anidar juegos dentro de juegos.
- Usar la composición completa. Una lista parcial calcularía disponibilidad sin las piezas faltantes.
- No inventar códigos de piezas ni cantidades. Si se conoce el código de una pieza faltante, crear su unidad con datos comprobados; si no, preguntar.
- Foto del juego: conjunto exacto si hay foto real; si no, null. Sin collages ni imágenes generadas.
- Tabla de auditoría: código, nombre, componentes, precio comercial, suma de piezas, faltantes.

Disponibilidad de un combo = mínimo, por pieza, de unidades libres ÷ unidades requeridas, redondeando hacia abajo. En la carga de La Vajilla no se hizo una reserva real.

Comportamiento v2.1.121: componentes [] se importaba como unidad (41 juegos en La Vajilla). Ya no: ahora se importa como juego incompleto (ver «Cambios desde v2.1.121»).

## 8. Fotografías y ZIP

- JPG RGB, 1200 × 1200 px, calidad 85 (estándar de entrega, no mínimo del importador).
- Centrar sin estirar ni cortar. Al menos 72 px de blanco por borde (contenido máximo 1056 × 1056).
- Quitar textos de precios y logos del catálogo del recorte. Sin marcos decorativos.
- Nombre exacto `<codigo>.jpg`; foto en el JSON debe coincidir carácter por carácter (527.jpg, 625-b.jpg, SC-1.jpg, PK-1.jpg).
- ZIP sin carpetas ni archivos auxiliares (sin PDF, logos, portadas, .DS_Store, __MACOSX).
- Foto de categoría: `cat-<slug>.jpg` (por ejemplo `cat-platos.jpg`, `cat-copas.jpg`) de 1200 × 1200 px, cuadrada, con una foto representativa del rubro (no de un producto suelto ni un collage), centrada y con el mismo margen blanco. Va en el mismo ZIP, en la raíz, y el nombre tiene que coincidir con el `foto` de la sección `categorias`. Hasta 1 MB al subirla a mano desde el panel; una foto que no es cuadrada no se guarda (aviso, el resto se importa).
- Sin foto propia: foto null y ningún archivo. Si varios productos comparten imagen, duplicarla bajo cada código y explicarlo en dudas.
- Formatos admitidos: .jpg, .png, .webp. Máximo 400 archivos y 60 MB.

## 9. Perfil, logos y portadas

Preparar nombre comercial, razón social, RUC, dirección, ciudad, barrio, Maps, teléfonos, WhatsApp, correo, Instagram, horarios, medios de pago, condiciones y cuenta bancaria solo con fuente o confirmación. Se cargan a mano:

- Ajustes → Empresa: nombre, logos por tema, contacto, ubicación, horarios, medios de pago y condiciones.
- Presupuestos → Datos de pago de la empresa: banco, titular, RUC, cuenta, tipo, moneda y alias.
- Logos: JPG/PNG/WebP hasta 1 MB. Variante clara (para fondo oscuro) y oscura (para fondo claro). PNG transparente ideal.
- Ajustes → Apariencia: portada escritorio 1920 × 600; celular 1080 × 1350. JPG/PNG/WebP, 2 MB cada una.
- Ajustes → Alquileres: seña, garantía, demoras, cancelaciones y fletes. No inventar tarifas.
- Ajustes → Tienda web: importar productos o guardar Apariencia no enciende la tienda.
- URL pública: `https://ledbox.online/tienda/<slug>` (no app.ledbox.online). Un «no encontrado» puede ser tienda apagada o dominio equivocado.

## 10. Flujo de carga y comprobación

1. Comprobar la empresa activa antes de escribir. El campo empresa del JSON no la selecciona.
2. Auditar códigos únicos, precios, stock, referencias de componentes, nombres de archivos y límites.
3. Inventario → Importar → Con ChatGPT → seleccionar catalogo.json y fotos.zip.
4. Revisar la vista previa: creaciones, actualizaciones, combos, fotos, omitidos, avisos y dudas. Resolver errores bloqueantes antes de aplicar.
5. Aplicar una sola vez y esperar el resultado final.
6. Registrar lote y cantidades. Verificar fichas representativas: unidad, foto alta/ancha, combo, precio null, cantidad null y código con sufijo.
7. Antes de reimportar, revisar cuántos se actualizan (actualiza por código, no duplica).
8. Completar precios, cantidades y composiciones antes de confiar en la disponibilidad o publicar.

## 11. Errores y límites

No atribuir una causa a un error solo por su color o mensaje genérico: conservar mensaje literal, empresa activa, archivos, tamaño, paso y captura, sin exponer credenciales.

## Orden breve para futuras IAs

Prepará catalogo.json y fotos.zip conforme a esta guía. Conservá códigos únicos y estables, nombres comerciales y datos comprobados. Precios y existencias desconocidos van null, con dudas claras; stock confirmado agotado va 0. Combos solo con componentes completos y unidades reales; composición incompleta va [] y se advierte. Precio de combo es comercial, nunca la suma automática. Fotos cuadradas 1200 × 1200 centradas con margen blanco, código.jpg en la raíz del ZIP. Si querés foto por categoría, agregá la sección opcional `categorias` (`nombre`, `foto`, `orden`) y las fotos `cat-<slug>.jpg` de 1200 × 1200, cuadradas, con una imagen representativa del rubro, centradas y con margen, en el mismo ZIP. Estados de unidades (solo `tipo: unidad`): `en_mantenimiento`, `danadas` y `perdidas` son opcionales, enteros ≥ 0 y su suma no puede superar `cantidad`; ausente = no tocar, 0 = devolver a disponible, y nunca se mueven unidades asignadas a eventos ni retiradas. No los inventes: solo si el cliente informa piezas en reparación, rotas o perdidas. Varias fotos por producto: `fotos` (lista ordenada, hasta 8 extra, mismas reglas de nombre y de ZIP que `foto`); no repitas fotos entre productos sin explicarlo en dudas. Colecciones con nombre: `colecciones` por producto y, si hay descripción, foto u orden, la sección `colecciones` (`nombre`, `descripcion`, `foto`, `orden`); solo agrupá productos que combinan de verdad. Estilo o color para filtrar: `estilo` por producto (hasta 8 palabras cortas, p. ej. Natural, Rattan, Verde); ausente = no se toca. No inventes colecciones ni estilos: solo los que el cliente nombra. Separá logo, portadas y perfil. Entregá resumen de productos, categorías, colecciones, fotos extra, precios faltantes, cantidades faltantes, combos completos/incompletos y dudas. No inventes datos ni publiques la tienda sin instrucción. Marcá lo no probado como no probado.

## Cambios desde v2.1.121

Tres cambios, todos aditivos (migración `202610290001_import_pendientes`, idempotente): los datos que ya están en producción no cambian de significado.

### Stock

Sin cambios: `cantidad: null` sigue creando 1 unidad por defecto (decisión del dueño). No hay estado «sin contar».

### Juego incompleto (`tipo: juego` con `componentes: []`)

- Se importa como **juego (combo) incompleto**, ya no como unidad. No tiene stock propio ni unidades (aunque el archivo traiga `cantidad`) y **no se puede reservar ni aprobar**: reservarlo a mano o aprobar un presupuesto con ese juego responde «es un juego incompleto (sin piezas cargadas)». «Aprobar igual» no lo salta.
- Inventario lo muestra con el chip «Incompleto».
- Deja de estar incompleto al agregarle piezas, en el editor del juego o reimportando el mismo código con `componentes`.
- Reimportar un código que ya es juego completo con `componentes: []` conserva sus piezas (no pasa a incompleto).
- Si el código existe como **unidad** y el archivo trae `tipo: juego` **sin** componentes, se conserva como unidad (aviso).
- La vista previa lo anuncia: «se importa como juego incompleto: sin stock propio y no se puede reservar hasta que le cargues las piezas», y suma una tarjeta «Juegos incompletos».

### Unidad que pasa a juego (reimportación)

- Si el producto existente es una unidad y el archivo trae `tipo: juego` con componentes, se **convierte en juego** y se retiran sus unidades.
- Solo si no tiene reservas (ninguna asignación a eventos) **ni** unidades con historial (en mantenimiento, dañadas, perdidas, retiradas o con incidentes). Si las tiene, es un **error bloqueante** en la vista previa («no se puede convertir en juego»): esa fila se omite y no cambia nada. Dejalo como unidad o armá un juego nuevo con otro código.
- Las unidades «limpias» se eliminan dentro de la misma transacción que arma el juego; si el juego no se puede armar, no se toca nada.

### Precio a consultar

- **Precio null o 0 = «a consultar»**, automático y sin marca nueva: se guarda 0, como antes. El 0 explícito y el null significan lo mismo; un dato que ya estaba en producción no cambia.
- La tienda lo muestra como «Consultar».
- En un presupuesto, una línea con precio unitario 0 queda marcada **«falta precio»** y **bloquea enviar, aprobar (panel, portal, comparación y firma) y cobrar** hasta cargarle el precio. Nunca suma 0 en silencio.
- Si el ítem es gratis a propósito, en la línea se activa **«Gratis a propósito (precio 0 confirmado)»**; recién ahí el 0 es válido y se muestra «Gratis».
- Pedidos de la tienda convertidos a presupuesto (`catalogLineAmounts`): la función conserva sus campos y suma `missingPrice` (true cuando no hay ningún precio); la línea queda en 0 y el presupuesto la bloquea.
- La vista previa lo anuncia con el texto «queda como “a consultar” (precio 0) … en un presupuesto la línea queda “falta precio”».

### Foto propia por categoría

- Sección opcional `categorias` del JSON y fotos `cat-<slug>.jpg` en el mismo ZIP (ver §3 y §8). La vista previa muestra «Fotos de categoría: N».
- También se puede subir, cambiar o quitar desde Ajustes → Inventario → Categorías (JPG/PNG/WebP cuadrada, hasta 1 MB; solo OWNER y ADMIN).
- La tienda pública lee `imageUrl` de cada categoría (`loadPublicCategories`); sin foto propia usa la del primer producto.

No probado en vivo: la vista de la tienda con estas fotos y los textos «Consultar» en producción (la tienda estaba apagada).

## Eventos y reservas

Carga de **eventos con sus productos** para que las reservas queden cargadas. Va en Eventos → Importar (planilla .xlsx/.csv, «Con ChatGPT» con `eventos.json` o «IA de LedBox»), con el mismo patrón que el catálogo: vista previa → aplicar. Solo OWNER y ADMIN. Se importa **después** del catálogo: los productos se resuelven por el SKU de la empresa activa.

### Formato JSON (`eventos.json`)

```json
{"eventos":[{"codigo":"EV-2026-001","nombre":"Boda Pérez","cliente":{"nombre":"Ana Pérez","telefono":"+595981000111","correo":"ana@ejemplo.com"},"desde":"2026-11-14","hasta":"2026-11-15","lugar":"Salón X","estado":"confirmado","productos":[{"codigo":"527","cantidad":1},{"codigo":"1482","cantidad":10}],"notas":null}]}
```

Planilla: una fila por evento, columnas `codigo, nombre, cliente, telefono, correo, desde, hasta, lugar, estado, productos, notas`; `productos` va como «527x1; 1482x10». Límites: 500 eventos por archivo y 200 líneas por evento; JSON hasta 2 MB, planilla hasta 5 MB.

### Reglas

- **Clave:** `codigo` del evento. Reimportar el mismo código **actualiza** (nombre, lugar, fechas, estado, notas, cliente y líneas); nunca duplica. Un código repetido dentro del archivo se omite (error). El vínculo código → evento se guarda en `IdempotencyKey` (scope `import:evento`, por empresa), así que **no hay migración**; un evento enviado a la papelera deja de estar vinculado y el mismo código crea uno nuevo.
- **Cliente:** se busca por teléfono o correo normalizados (`field-rules`; «0981 123 456» equivale a «+595 981 123 456»); sin ninguno de los dos, por nombre exacto. Si no existe se crea (una sola vez aunque aparezca en varios eventos). Un teléfono o correo inválido se descarta con aviso, nunca se inventa.
- **Fechas:** `AAAA-MM-DD` o `dd/mm/aaaa` (también el número de serie de una celda de fecha de Excel). `desde` es obligatoria y `hasta` también (si dura un día, la misma). Se interpretan en la zona horaria de la empresa (America/Asuncion): el evento empieza a las 00:00 de `desde` y termina a las 23:59 de `hasta`. Una fecha ambigua o inválida es error de esa fila; nunca se adivina.
- **Productos:** por SKU de la empresa activa. Un código inexistente o un juego incompleto (`comboIncomplete`) es **error de ese evento**: el evento entero se omite y no se escribe nada (se evita un evento a medias por un error de tipeo). Los demás eventos del archivo siguen.
- **Estados:**
  - `confirmado`: evento CONFIRMADO; reserva en firme con el motor existente (`commitInventoryAssignment`: lock del ítem + disponibilidad por período con colchones de preparación, transporte y limpieza, dentro de la transacción; es la misma función de la asignación manual).
  - `tentativo`: evento BORRADOR con **retención** (bloqueo tentativo con el vencimiento de retención de la empresa); se confirma después desde el evento.
  - `borrador` (o sin estado): evento BORRADOR **sin reservar**; los productos pedidos quedan anotados en las notas del evento.
  - `cancelado`: evento CANCELADO; libera las reservas (las que ya salieron del depósito siguen contando hasta su devolución, con aviso).
- **Juegos (combos):** reservan sus componentes, como hoy. Una línea suelta del mismo producto se suma a lo que aporta el juego.
- **Sin stock:** nunca se sobrevende. Es un **aviso por línea** («Lounge Oslo: piden 2, hay 1 libre en esas fechas»): esa línea **no se reserva** (todo o nada por línea, como la asignación manual; no se reserva "lo que entra"), el evento se crea o actualiza igual con las líneas que sí entran, y la línea faltante queda en las notas del evento («Sin stock al importar: …») y en el resultado. Se eligió esto y no bloquear la fila porque el evento existe en la realidad aunque falte stock; lo seguro es no reservar de más y dejar la falta a la vista para resolverla (comprar, tercerizar, cambiar fechas) y reimportar o asignar a mano. Un producto en mantenimiento o retirado se trata igual.
- **Reimportar** solo agrega o actualiza líneas: **no quita** productos que el archivo ya no trae (pueden haberse cargado a mano); la vista previa avisa cuáles quedan sin tocar. Un evento que ya está **en curso o finalizado** en LedBox no se modifica (error de esa fila). Un evento cancelado se reactiva si el archivo lo trae con otro estado.
- Rate limit, lote idempotente (mismo lote no se aplica dos veces), cuota y bloqueo de la demo como en las otras importaciones; todo acotado a la empresa activa (un código de producto o cliente de otra empresa no existe para esta).

### Vista previa

Tarjetas: eventos a crear, eventos a actualizar, clientes nuevos, líneas reservadas, líneas sin stock y errores; más las filas (acción, fechas, estado, cliente, líneas) y los avisos por línea. **La disponibilidad de la vista previa es una estimación**: descuenta lo que ya está comprometido y lo que el propio archivo reserva antes (los eventos compiten en el orden del archivo), pero al aplicar cada línea se vuelve a comprobar bajo lock y es la que manda. Los componentes compartidos entre un juego y una unidad suelta de otro evento del mismo archivo pueden hacer que la estimación difiera apenas.

### Resumen para IAs (eventos)

Preparé `eventos.json` con `{"eventos":[…]}`. Por evento: `codigo` único y estable (clave; reimportar lo actualiza), `nombre`, `cliente {nombre, telefono, correo}` (los datos de contacto evitan clientes duplicados; no los inventes), `desde` y `hasta` en AAAA-MM-DD (misma fecha si dura un día), `lugar`, `estado` (`confirmado` reserva, `tentativo` retiene, `borrador` no reserva, `cancelado` libera; sin dato, `borrador`), `productos` `[{codigo, cantidad}]` con el **SKU del inventario** (no el nombre) y cantidades enteras, y `notas`. Los productos tienen que estar importados antes; un SKU que no existe bloquea ese evento. Si falta stock el evento se carga igual y la línea queda avisada: nunca se sobrevende. No inventes fechas, códigos ni clientes; lo dudoso va fuera del archivo y se anota aparte.

No probado en vivo: la importación de eventos contra datos reales de una empresa y el diálogo en el navegador (probada con Postgres descartable: reservas, reimportación, sin stock, cancelado, concurrencia y aislamiento entre empresas).
