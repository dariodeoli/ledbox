# Campos y ventanas compartidos · matriz de adopción

Seguimiento [#264](https://github.com/dariodeoli/ledbox/issues/264). Base publicada2.1.135, delta2.1.136. Esta matriz describe adopción de código y pruebas por familia; no afirma revisión visual de cada pantalla ni cero errores.

## Campos

| Familia | Base canónica | Consumidores y contrato |
|---|---|---|
| Texto, nombre, empresa | TextField/FieldChrome → owncoding-ui Input | Panel; acceso, lead, alta de empresa y portal usan misma primitiva. Labels/required/autocomplete y límites propios se conservan |
| Teléfono/país | PhoneField y PhonePartsField → primitivas compartidas | Adapter por partes preserva teléfonos fijos y país en formularios públicos; no obliga a móvil |
| Correo | EmailField → owncoding-ui EmailField | Callback de cadena y autocomplete; no sobrescribe contactos fiscales |
| Montos/porcentajes | MoneyField/PercentField | PriceRequestForm y rebaja portal migrados135. Pegado Gs.1.200.000 probado; enteros grandes inválidos no se redondean. Backend revalida |
| Cantidades/días | NumberField + Stepper + quantity-control | Tienda usa salida con paso/lotes, portal y carrito landing editables. Vacío transitorio; límites por contexto; disabled/readOnly; flechas. Invitados usa NumberField sin inventar cantidad |
| Fecha/hora/rango | DateField/DayField/DateTimeField/TimeField + date-shortcuts | Kit compartido135, atajos contextuales Hoy/Mañana/Pasado; díaPY, min/max y hora conservada; #263 publicado |
| Selects | SelectField/AdminSelect → owncoding-ui Select | Panel/plataforma/alta/reporte imprimible/tienda; menú nativo conserva teclado y validación |
| Búsqueda | SearchField/TextField search → Input | Misma primitiva; debounce/limpiar/filtros siguen en consumidor cuando son reglas de pantalla |
| Ciudad/departamento | CityField y catálogo cerrado común | #242 publicado134. Históricos conservados; no transformar al editar otro campo. Dirección/barrio son texto libre |
| Banco/cuenta | BancoField y PaymentDetailsDialog común | #262 publicado135. Catálogo banco distinto de cuenta real de empresa |
| RUC/CI | RucField/ClientFiscalFields | ExtraerOwnData aplica sólo al confirmar; #266 real pendiente de verificación, no declarar conexión por diseño |
| Enlaces/Maps/Instagram | TextField + normalizadores por dominio | Una primitiva; no aplicar reglas de enlace genérico a Maps sin validación |
| Identificador/SKU/serial | TextField/SerialField | Reglas distintas intencionales; alias permanente de slug publicado135 |
| Notas/mensajes | TextAreaField/SharedTextarea | Propuesta, precio, lead y portal migrados; insertion de variables conserva cursor/ref y límites |
| Casilla/switch/radio | CheckboxField/SharedCheckbox, SwitchField, SegmentedField, RadioControl | Consentimientos portal/comparación/solicitud de precio migrados136. Radios ricos mantienen labels/fieldset/name/required y exclusión; no preseleccionar consentimiento |
| Archivos/imágenes | FileField, AttachmentInput, AdminImageUpload | FileField para selección/transporte; AttachmentInput para validación de contenido; imagen para crop/compresión. PortalProof y SignaturePortal usan FileField136; required/FileList/FormData/ref/quitar/cancelar conservados. maxBytes=null sólo delega explícitamente al preparador que comprime/valida salida2MB |
| Contraseña/PIN/código | PasswordField/PinField/TextField | Diferentes reglas intencionales: no hacer PIN del código alfanumérico ni mostrar secreto. Mecanismos nativos internos viven en base |
| Cliente/producto/recinto | Combobox/ClientIdentityView/InventoryLinkPicker | Catálogo y presentación comunes; permisos/búsqueda por tenant; libreta independiente #265 publicada135 |

## Ventanas y navegación flotante

Ciclo único `lib/overlay-lifecycle.ts`, hook `components/overlays/useModalBehavior.ts`: stack porDocument, foco/Tab/Escape del superior, inert/scroll con snapshots, limpieza noLIFO, ramas portaled y retorno seguro.

| Consumidor | Adopción |
|---|---|
| AdminDialog/AdminConfirmDialog | Hook único; conserva dirty, pie, error, viewport y confirmación |
| QuickView/CartDrawer/ContactPanel/ProductGallery/FiltersDrawer | ThemePortal reexporta hook único. FiltersDrawer monta Content después de resolver portal; comprobado causal y navegador |
| Carrito landing | Adaptador mountCartDialogFocus al mismo core; drawer persistente aria-hidden/inert, sin motor paralelo |
| LeadCaptureDialog | Hook común, foco/retorno/scroll además de Escape |
| Sidebar mobile | Core común; conserva backdrop y retorno a marca si cambia breakpoint |
| PublicNav nativo | showModal/cancel/close nativos; mismo registro/scroll/cleanup; no duplicar Escape/Tab del navegador |
| AdminMenu dentro de modal | Rama propiedad del modal para portal albody; conserva flechas/Tab/Escape propios de menú |
| Popovers/combobox/listbox/tooltips | No son modales: conservan semántica y navegación propia. No trap ni aria-modal artificial |
| AdminLockScreen | Excepción: reemplaza shell y no tiene Escape para evitar desbloqueo; no es diálogo descartable |

## Guardas y evidencia

`npm run check:shared-fields` analiza AST de todos los TSX de app/components, no comentarios ni ejemplos de strings. Falla ante input/select/textarea visible fuera de AdminFields. Excepciones exactas: uploaders compartidos de AdminUI, hidden sin spread y honeypots con nombrewebsite/tabIndex−1/autocompleteoff/clase reconocida. No hay excepciones de archivo completo para portal/tienda/impresión.

Se ejecuta dentro de test:rules. El guard histórico check:fields conserva reglas de máscaras/tipos del panel. Los controles de biblioteca implementan internamente HTML nativo; eso es la base y no una variante local.

Pruebas causales cubren borradores/límites/teclado; transporte de archivos y compresión/MIME; consentimientos/radios; stack/nested/noLIFO/StrictMode, autofocus diferido y retorno después de desmontar carrito. Revisión cruzada independiente detectó el montaje diferido de filtros y QA real encontró BODY como destino de retorno y un texto de saldo sin wrap; se corrigieron antes de publicar.

QA local utiliza datos ficticios, sin correos/cobros/aprobaciones/reservas reales. Capturas y comandos quedan en informes del integrador y comentarios de #264. Publicación se informa separada después de CI/deploy y SHA servido. Los otros pendientes de producto e importaciones siguen sus issues.
