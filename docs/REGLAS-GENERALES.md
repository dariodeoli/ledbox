# Reglas generales de la app — plantilla portable

> Norma vigente para todo el trabajo en LedBox (front y API). **Obligatoria** para agentes y humanos.
> Principio madre: **buscar antes de crear**. Si el objeto existe, se reutiliza; si falta, se crea una vez en el módulo compartido y se adopta en todos lados. Nunca variantes locales.

## 1. Campos de formulario — un componente por tipo de dato

Nunca un `<input>` suelto. Un objeto canónico por tipo:

| Tipo | Objeto | Regla |
| --- | --- | --- |
| Texto libre | Input + Label | label arriba (`htmlFor`), required real, maxLength (120/200) |
| Texto largo | Textarea | notas 2000 · descripciones 400 · rows fijo |
| Moneda (Gs/USD) | MoneyInput + CurrencySelect | PYG sin decimales, USD/BRL/EUR con 2; el símbolo lo dibuja el campo; entrega el número limpio; `type="number"` prohibido |
| Moneda lectura | Money | no convertir a mano; no finito → — |
| Porcentaje | PercentField | coma decimal, 0–100, hasta 2 decimales |
| Teléfono | PhoneField | código de país editable (default +595) |
| Correo | EmailField | `type=email`, no rompe pegado/autofill |
| Serial/IMEI | SerialField | mayúsculas, sin espacios ni prefijos |
| Fechas/horas | date / datetime-local + RangoFechas | 24 h; rangos con atajos (24 h, 7 d, 30 d) |
| PIN | PinInput | 4 dígitos, teclado numérico, autoenvía al completar, nunca visible |
| Contraseña | PasswordInput | mostrar/ocultar obligatorio |
| Archivo/imagen | AttachmentInput | JPG/PNG/WebP/PDF ≤5 MiB, validación por MIME + magic bytes |
| Búsqueda | SearchField | lupa + limpiar; el debounce vive en la pantalla |
| Catálogo (banco, producto, ciudad, RUC) | Combobox/autocomplete | texto libre permitido; sugiere y completa campos derivados; extractores aplican solo al confirmar |
| Catálogo cerrado | Select | estados, roles, moneda; nunca texto libre |
| Booleano | Switch | interruptor estilo iPhone; `onChange(event.target.checked)` |
| Selección múltiple | checkbox (accent) | listas con varias filas |
| 2–5 opciones excluyentes | SegmentedField | barra con `aria-pressed` |
| Subnavegación | Subtabs | misma fuente para todas las subpáginas |
| Tema | ThemeToggle | claro/oscuro por tokens |

**Reglas transversales de campos**

- Label arriba; error o hint, nunca ambos; `aria-invalid` + `aria-describedby`; error con `role="alert"`.
- Teclado móvil correcto (`inputMode`/`autoComplete`); sin máscaras que rompan pegado, autofill o tests.
- Solo dígitos: `inputMode="numeric"` + limpieza `\D`.
- El backend revalida **siempre**; el front solo ayuda. `required` real y validación al enviar.
- Tamaños de monto: general hasta 10.000.000.000; ventas hasta 99.000.000.000 — nunca truncar dígitos; al superar, marcar inválido.
- Cada regla se fija con test de aserción de fuente: si un campo se reimplementa suelto, el test falla.

## 2. Formatos de datos

- **Moneda**: se guarda normalizado (PYG entero; con centavos como decimal limpio) y el campo dibuja símbolo/separadores. Pegar un monto con símbolo funciona (se limpia lo que no sea dígito/coma/punto).
- **Porcentaje**: se guarda con `parsePercent` y se muestra con `formatPercent`; el % va en la etiqueta, nunca dentro del valor.
- **Fechas/horas**: 24 h, una sola zona horaria (`America/Asuncion`); montos/fechas/códigos con `nowrap` + `tabular-nums`.
- **Teléfonos**: se guardan normalizados (`+<código> <dígitos>`), se muestran con espacios.
- **Nombres de personas**: 1º nombre → 2º → 3º → 1º apellido → 2º apellido (nunca “Apellido, Nombre”).

## 3. Fotos, avatares y archivos

- Identidad por ID, nunca por nombre/correo.
- Un único Avatar: foto subida → foto de Google → iniciales; nunca `<img>` a mano y nunca imagen rota.
- La foto externa se pasa solo para quien corresponde y se sirve con sesión y `referrerPolicy="no-referrer"`.
- Subida: PNG/JPG/WebP hasta 1 MiB (fotos de persona); validar MIME + magic bytes en cliente y servidor; recortar y comprimir antes de subir; borrado explícito (no se restaura solo).
- Adjuntos: validación de contenido real, acceso autenticado y almacenamiento fuera del HTML público.
- Logos/marcas externas: registro nombre → asset del repo (sin hotlinks) → vector compartido → monograma con iniciales y color.
- Logo por tema: fondo oscuro → logo claro; fondo claro → logo oscuro. La empresa sube ambas variantes; en papel siempre la variante clara. La regla vive en un solo lugar (no se duplica por pantalla).

## 4. Tablas y listados

- Filas compactas, columnas alineadas y de ancho fijo, encabezados arriba; un texto largo no mueve la siguiente columna.
- Sin scroll horizontal en desktop: se compacta/abrevia la información secundaria antes de desbordar.
- Listado = información rápida; el detalle tiene lo completo (al clic).
- Estados visuales consistentes (pagado/parcial/no pagado; finalizado atenuado).
- Acciones importantes a la vista, no escondidas detrás de scroll o modales.

## 5. Botones y acciones

- Una acción primaria por pantalla; secundarias en outline/ghost; destructivas con confirmación propia.
- Acciones de fila compactas (íconos con `aria-label`), nunca botones gigantes.
- Envío single-flight: deshabilitar mientras guarda, evitar dobles clics.
- Nada de `alert()`/`confirm()` nativos: diálogos propios.

## 6. Estados y avisos

- Un objeto por concepto: toast de éxito, toast de error, estado vacío, alerta inline. No inventar variantes.
- Estados vacíos coherentes en todas las pantallas (mismo tono y acción sugerida).
- Estados honestos: pendiente / aceptado / incierto / fallido — nunca mostrar “listo” sin confirmación real.

## 7. Identidad, sesión y bloqueo

- Autenticación principal (correo/Google) antes de habilitar PIN.
- PIN: 4–6 dígitos, nunca visible, valida solo al completarlo, con tope de intentos.
- Auto-bloqueo por inactividad configurable (default 10 min) con pantalla de bloqueo clara.

## 8. Dinero y datos críticos

- Operaciones financieras idempotentes; el navegador nunca confirma un pago solo.
- Comprobantes y registros desde snapshots inmutables (si el original cambia, la historia no).
- Transiciones de estado monotónicas (webhooks repetidos/fuera de orden no retroceden).
- Si un dato no está (cotización vencida, proveedor sin credenciales): “no disponible” — jamás inventarlo ni mostrarlo como activo.
- No simular capacidades: si el dispositivo/proveedor no la soporta, se muestra como no disponible.
- Todo cargo externo (p. ej. consultas pagas) requiere confirmación explícita, queda auditado y muestra fuente, fecha y costo.

## 9. Lógica compartida (frontend)

- Cliente API único: timeout por request, caché corta solo-GET, limpieza en mutaciones, 401/403 invalidan sesión.
- Reglas de campos puras y testeables en un solo módulo.
- Moneda y zona horaria únicas; navegación filtrada por rol desde una matriz central.
- Helpers canónicos de formato (dinero, fechas, etiquetas de estado).

## 10. Backend — predeterminados

- Revalidar todo; textos normalizados (trim, límites).
- Migraciones aditivas, idempotentes y re-ejecutables; verificación base↔modelo (`db:check`) hasta cero diferencias.
- Secretos solo en variables de entorno del backend; nunca en frontend, repo ni logs.
- Endpoints públicos: tokens aleatorios no enumerables (nunca IDs secuenciales), expiración/revocación, rate limit, CORS explícito y auditoría con actor real.

## 11. Publicación y modo

- Fuente única de versión; `prepare` (valida, no publica) separado de `publish`.
- Antes de declarar publicado: builds con artefacto real, flujos críticos probados, permisos verificados con cuenta sin privilegios, salud/HTTPS/dominio/versión comprobados.
- Al informar: versión desplegada explícita y estado de cada frente — nunca presentar local como publicado.
- Si la app tiene modos (test/producción/demo), el modo siempre visible; el demo con datos ficticios y aviso claro.

## 12. Proceso de creación

1. Buscar antes de crear (campo, estado, botón, aviso).
2. Un objeto por concepto, en el módulo compartido.
3. Al adoptar: migrar todos los usos y borrar la variante vieja.
4. Toda regla nueva se fija con test de aserción de fuente.
5. Documentar en la biblioteca de objetos de la app (este documento).

## Checklist de adopción por app

- [x] Campos: un componente por tipo; sin inputs sueltos; tests de fuente.
  Kit en `components/admin/AdminFields.tsx`, reglas puras en `lib/field-rules.ts` y aserción de fuente en `npm run check:fields` (falla con `<input>`/`<select>`/`<textarea>` sueltos o `type="number"`).
- [x] Formatos: moneda/porcentaje/fechas/teléfonos normalizados.
  `MoneyField`/`NumberField`/`PercentField` y las reglas puras; teléfonos `+<código> <dígitos>` (default +595), correos en minúsculas y seriales en mayúsculas sin separadores.
- [ ] Fotos: Avatar único con fallback; validación MIME+magic bytes. LedBox no usa avatares hoy (promotoras guarda `photoUrl` sin subida).
- [ ] Tablas: alineadas, sin scroll horizontal, acciones a la vista. El panel denso ya usa plantillas de columnas por vista; queda la auditoría fina por módulo.
- [x] Estados y avisos: un objeto por concepto; estados honestos.
  `AdminNote` (variantes `note`/`alert`), `AdminEmpty` y `AdminDataState` son los únicos objetos de aviso/estado inline del panel.
- [ ] Dinero: idempotencia, snapshots, monotonicidad, “no disponible” (pendiente declarado).
- [x] Publicación: versión única, `prepare` ≠ `publish`, secreto fuera del código.
  `package.json` → `lib/version.ts` → pie del panel; `npm run release:prepare` valida (typecheck + tests + build) y el publish sigue en Owncoding (README).
- [x] Biblioteca de objetos actualizada con cada regla nueva.

Referencias de implementación (MobOS): `docs/PLANTILLA-OBJETOS.md`, `docs/PLANTILLA-CAMPOS.md`, `docs/AVATAR.md`, `docs/TABLAS.md`, `docs/TOKENS.md`.
