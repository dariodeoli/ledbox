# Biblioteca visual unificada de LedBox

## Objetivo

Toda la aplicación comparte las mismas reglas de interacción, espaciado,
accesibilidad y estados visuales. El contenido cambia según el módulo; la
estructura visual se reutiliza.

El punto de entrada para pantallas nuevas es:

```tsx
import {
  AdminButton,
  AdminDialog,
  AdminDialogSection,
  TextField,
  DateField,
  CityField,
} from "@/components/ui";
```

La biblioteca existente vive en `components/admin/AdminUI.tsx` y
`components/admin/AdminFields.tsx`. `components/ui/index.ts` es el contrato
estable para que los módulos no dependan de rutas internas.

## Catálogo canónico

### Acciones y botones

- `AdminButton`: `primary`, `secondary`, `ghost`, `danger`, `link`; tamaños
  `md` y `sm`.
- `AdminButtonLink`: misma apariencia para navegación.
- `AdminIconButton` / `AdminIconLink`: sólo ícono, siempre con `label` y
  `title` accesibles.
- `AdminActionsMenu`: menú de acciones de una entidad; agrupa acciones por
  intención y evita duplicados.

Regla: una pantalla tiene una acción principal visible. Las acciones
destructivas usan `danger` y confirmación explícita; nunca se usa un botón gris
como acción principal.

### Diálogos, pop-ups y confirmaciones

- `AdminDialog`: diálogo centrado, overlay, foco inicial, trampa de foco,
  Escape, retorno del foco, cierre fuera del panel y pie fijo.
- `AdminConfirmDialog`: confirmación de una acción destructiva o irreversible.
- `AdminDialogSection` y `AdminCol`: grilla de formulario consistente.
- `AdminDisclosure`: opciones avanzadas plegables.

Reglas:

1. Un pop-up nuevo debe intentar reutilizar `AdminDialog`.
2. `sm` se reserva para confirmaciones; `md` para formularios; `lg` para
   tablas o ediciones amplias; `xl` para grillas complejas; `ficha` para una
   ficha de entidad de altura completa.
3. El encabezado lleva título, descripción opcional y cierre accesible.
4. El cuerpo desplaza; el pie queda visible con Cancelar a la izquierda y la
   acción principal a la derecha.
5. Los cambios sin guardar usan `dirty` y la confirmación interna del diálogo.

### Formularios y campos

`AdminFields` contiene un componente por tipo de dato: texto, búsqueda,
correo, teléfono, RUC, ciudad, banco, dinero, porcentaje, número, fecha, hora,
fecha-hora, selección, combobox, switch, checkbox, contraseña, PIN, color,
archivo y adjunto.

Reglas:

- El label siempre está arriba; el campo no depende de placeholder para
  explicar su significado.
- El ancho se elige por semántica (`xs`, `sm`, `md`, `lg`, `full`), no con
  anchos arbitrarios por pantalla.
- Error, ayuda y éxito usan `aria-describedby` y `role="alert"` cuando
  corresponde.
- Ciudad, banco y otros catálogos usan el componente compartido, no un
  `<input>` libre distinto en cada módulo.
- Fechas usan `DateField`, `DateTimeField` o `DayField`; los atajos de fecha
  se mantienen en una sola implementación.
- Montos usan `MoneyField`; no se formatean manualmente en cada formulario.
- Las API vuelven a validar todo: la biblioteca mejora la experiencia, no
  reemplaza la validación del servidor.

### Estados, avisos y notificaciones

- `AdminDataState`: loading, vacío, error y contenido en un mismo contrato.
- `AdminNote`: avisos `info`, `success`, `warn` y `error`.
- `AdminSuccess` / `AdminError`: feedback corto de una acción.
- `AdminBadge`: estado compacto en tablas y tarjetas.

Regla: el mensaje dice qué pasó y cuál es el siguiente paso. No se muestran
toasts duplicados si el formulario ya tiene un estado visible.

### Tablas y paneles

Usar `AdminPanel`, `AdminToolbar`, `AdminTable`, `AdminRow`, `AdminCell`,
`AdminKpis` y `AdminKpi` antes de crear contenedores nuevos. Los filtros van en
la barra de herramientas; las acciones masivas aparecen sólo cuando hay
selección.

### Correo y mensajes

Los editores de correo reutilizan los mismos campos, botones, estados y
diálogos. La previsualización es un panel de contenido, no otro sistema de
modal. Las plantillas se guardan por empresa, canal y código; los envíos deben
mostrar estado, destinatario, fecha y resultado.

## Reglas de creación para otras aplicaciones

Antes de crear un componente:

1. Buscar en la biblioteca existente por intención, no sólo por nombre.
2. Reutilizar el componente y cambiar sus props o contenido.
3. Si falta una variante, agregarla a la biblioteca compartida con tipos,
   accesibilidad, estados y prueba.
4. Exportarla desde `components/ui/index.ts`.
5. Migrar al menos una pantalla real y revisar desktop, mobile, teclado y
   estados de error antes de usarla en más lugares.
6. No copiar CSS ni crear una segunda versión local con otro espaciado.

## Prompt para otros agentes

```md
Trabajá con la biblioteca visual unificada de LedBox.

Antes de crear un popup, formulario, input, botón, acción, notificación,
tabla, panel o editor de correo:

1. Buscá una pieza equivalente en `components/ui`.
2. Reutilizala y cambiá sólo contenido, datos y callbacks.
3. Para formularios usá `AdminDialog`, `AdminDialogSection`, `AdminCol` y los
   campos de `AdminFields`; no uses inputs HTML ni diálogos locales si existe
   una pieza canónica.
4. Para acciones usá `AdminButton`, `AdminButtonLink`, `AdminIconButton` y
   `AdminActionsMenu`. Una sola acción principal por vista; las destructivas
   siempre requieren confirmación.
5. Para estados usá `AdminDataState`, `AdminNote`, `AdminBadge`,
   `AdminSuccess` o `AdminError`; no inventes otro toast o alerta.
6. Para fechas, ciudades, bancos, montos, RUC, correo y teléfono usá los
   campos compartidos. Conservá sus anchos, labels, hints, errores,
   accesibilidad y atajos.
7. Si realmente falta una variante, agregala primero a la biblioteca,
   exportala desde `components/ui/index.ts`, documentá su contrato y migrá un
   caso real. No dupliques CSS.
8. Validá desktop, mobile, teclado, foco, Escape, estados loading/empty/error,
   permisos y respuesta de API. Ejecutá typecheck y las pruebas relevantes.
9. Informá: qué componente reutilizaste o agregaste, archivos, pruebas,
   riesgos y qué queda pendiente. No declares terminada toda la app por una
   sola pantalla.
```

## Plan de migración recomendado

1. Cambiar imports nuevos a `@/components/ui`.
2. Migrar primero diálogos y formularios de clientes, eventos, inventario y
   presupuestos.
3. Reemplazar botones e inputs locales que dupliquen comportamiento.
4. Añadir una revisión automática que rechace imports de primitives locales en
   módulos migrados.
5. Revisar visualmente desktop/mobile y eliminar estilos duplicados sólo
   después de confirmar que ninguna pantalla los usa.
