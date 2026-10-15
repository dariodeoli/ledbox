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

Campos adicionales soportados pero no ejercitados en este lote: subcategoria, deposito, ubicacion y precios_dias. No agregarlos por inventar información. precios_dias usa `[{"desde_dias":5,"modo":"total","precio":300000}]`, con modo dia o total, únicamente cuando hay una tarifa documentada. No deducir descuentos.

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

Prepará catalogo.json y fotos.zip conforme a esta guía. Conservá códigos únicos y estables, nombres comerciales y datos comprobados. Precios y existencias desconocidos van null, con dudas claras; stock confirmado agotado va 0. Combos solo con componentes completos y unidades reales; composición incompleta va [] y se advierte. Precio de combo es comercial, nunca la suma automática. Fotos cuadradas 1200 × 1200 centradas con margen blanco, código.jpg en la raíz del ZIP. Si querés foto por categoría, agregá la sección opcional `categorias` (`nombre`, `foto`, `orden`) y las fotos `cat-<slug>.jpg` de 1200 × 1200, cuadradas, con una imagen representativa del rubro, centradas y con margen, en el mismo ZIP. Separá logo, portadas y perfil. Entregá resumen de productos, categorías, precios faltantes, cantidades faltantes, combos completos/incompletos y dudas. No inventes datos ni publiques la tienda sin instrucción. Marcá lo no probado como no probado.

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
