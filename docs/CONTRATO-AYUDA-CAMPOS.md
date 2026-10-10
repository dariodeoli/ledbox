# Kit compartido · ayuda y moneda compacta · #161 / #123

Unidad admitida posterior a #156/#159, sobre base local `bc0619eca31177cd2c1f291d72c38b49fd82a417`. No incorpora ni modifica sus candidatos sellados. Antecedente #109 cerrado; adopción nueva de inventario #161, revisión UX #123. Sin alcance de cálculo FIN ni AUTO173.

## API canónica

Desde `components/admin/AdminFields.tsx`:

```tsx
<TextField label="Artículo" help="Nombre visible para identificar el producto." value={name} onChange={setName} />
<NumberField label="Cantidad" help="Unidades físicas de este producto." value={quantity} onChange={setQuantity} />
<MoneyField label="Costo diario" help="Costo interno por día; no es la tarifa al cliente." value={dailyCost} onChange={setDailyCost} />
<AdminFieldHelp label="Tarifas" text="Explicación de este control compuesto." />
```

- **`help?: string`**: ayuda junto al label. Hover, foco de teclado y toque; Escape cierra. Reutiliza el **Tooltip publicado de owncoding-ui**. Un solo wrapper canónico `AdminFieldHelp({ label: string, text: string })`, sin otro helper de módulo.
- Disponible en TextField, TextAreaField, MoneyField, PercentField, NumberField, PhoneField, CityField, BancoField, EmailField, RucField, SerialField, DateField/TimeField/DateTimeField, DayField, SelectField, Combobox, SwitchField, PasswordField, PinField, SegmentedField y AttachmentInput. Para controles compuestos/búsqueda, usar AdminFieldHelp explícito. Honeypot no muestra ayuda.
- Sin label visible, mantener `ariaLabel`; el botón recibe el nombre del campo. La ayuda no sustituye el hint persistente ni el error (`role=alert`) y no cambia `aria-describedby` del control. PasswordField conserva `labelAction` además de la ayuda.
- Trigger de ayuda 44×44, icono16, foco visible. Popup de la librería acotado al viewport y asociado al botón por `aria-describedby`.
- **`MoneyField.compact?: boolean`**, default `true`: ancho visual máximo14rem en escritorio; fluido en móvil ≤760px. `compact={false}` conserva ancho de su contenedor. No cambia límites, normalización, valores raw, BigInt, prefijo PYG o validación Int.
- Grupos existentes de inventario `--costs`, `--prices`, `--min` usan moneda compacta en escritorio y una columna en ≤640px. Otros formularios y acciones no reciben una reestructuración general.

## Plantilla de inventario

La propuesta OPS `evidencia/ronda-al/ops/inventario-columns-proposal.css` coincide con el fragmento aplicado. Fuente cotejada: InventarioModule OPS `31e977b7c81efff3edddd29de71e228c5db85a59`, nueve celdas; selección dentro de identidad, sin columna nueva.

Una sola `--inventario-cols`, referenciada por `--admin-cols` para encabezado y filas. Orden: Artículo, Categoría, Tipo, Cantidad, Libres, Costo diario, Precios, Estado, Acciones. Se elimina la sexta posición anterior, Reposición; dato/edición secundaria siguen responsabilidad OPS. Mínimo58.5rem. Encabezado usa borde lateral transparente1px, igualando ancho útil con el borde de fila; no existe una segunda plantilla.

El fragmento debe consumirse **junto al módulo OPS de nueve celdas**. La base de esta rama aún tiene el módulo histórico de diez: no es una entrega autónoma de la página de inventario. La QA del objeto Table de nueve celdas distingue alineación de la cobertura de la pantalla integrada. En 360/390 la tabla de contrato conserva su desplazamiento interno existente; no se oculta overflow ni se bloquea swipe, y no se declara resuelta la reorganización completa de esa lista.

## Reservas y aceptación

- PANEL: AdminFields y primitivas CSS de ayuda/moneda/plantilla de inventario. OPS: InventarioModule, bulk/inline, unidades y AdminDisclosure ARCHIVADOS final cerrado por defecto; schema archivo depende de PLATAFORMA.
- Sin cambios a OPS store/cart/LandingPage, FIN contratos/cálculos/vistas, AdminAvatar, root candidato integrado0aac, #156/#159, firma, release o watcher.
- Regresión opt-in: `LEDBOX_FIELD_HELP_BROWSER=1 node --import tsx --test tests/admin-field-help.integration.test.ts`. Componentes reales en fixture local HTTP, CSS real procesado con el preset existente; ningún API/DB. Seis combinaciones viewport/tema, tres modos de ayuda cada una, Escape, ancho y valor Int máximo, exceso retenido/error, cero válido, tabla nueve celdas con template único.
- OPS consume commits locales y ejecuta nueva QA visual/funcional de **su SHA combinado** antes de FINAL_READY. La QA funcional anterior31e977 no cubre automáticamente la dependencia nueva.
