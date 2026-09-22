# Adopción de `owncoding-ui` en LedBox/EventOS

Estado y plan del uso de la librería compartida de OwnCoding
(`github.com/dariodeoli/owncoding-ui`) en esta app. Se apoya en el piloto
(`feat/piloto-owncoding-ui`, `docs/PILOTO-OWNCODING-UI.md`) y en las reglas de
la propia librería (`REGLAS.md`, `ALIMENTAR.md`, `MODOS-DE-TRABAJO.md`).

Regla madre: **buscar antes de crear**. Si el objeto existe en la librería, se
usa; si falta y es genérico, se crea **en la librería** y se adopta acá.

## 1. Cómo se consume (una sola vez)

```bash
npm install github:dariodeoli/owncoding-ui#vX.Y.Z qrcode
# tailwind.config.js: presets: [preset] + corePlugins: { preflight: false }
# globals.css: @import 'owncoding-ui/styles.css';
```

- **Preflight apagado**: el reset de Tailwind rompería el panel entero.
- **Tema**: la librería usa `html.dark`; el panel usa `[data-theme]` en
  `#admin-root` → el shim de tema vive en un solo lugar (§4).
- **Repo privado**: en CI/Coolify hace falta un token de lectura de GitHub para
  instalar la dependencia (`git+https://x-access-token:$TOKEN@github.com/...`).

## 2. Mapa de adopción (objeto → dónde → prioridad)

| Objeto de la librería | Reemplaza a | Dónde | Prioridad |
| --- | --- | --- | --- |
| `formatGs`, `montoTexto`, `parseGsInput`, `excedeMonto`, `MoneyInput` | `lib/admin-format.ts` (montos), `MoneyField` | Todo el panel | **1** |
| `BANCOS_PARAGUAY`, `normalizarBanco`, `logoDeBanco`, `sugerenciasDeBanco`, `BancoCombobox`, `BancoLogo` | datos y combos de bancos | Tesorería, Conciliación, Datos de pago | **1** |
| `parseTelefono`, `componerTelefono`, `telefonoVisible`, `MENSAJE_TELEFONO`, `PhoneField` | normalización de `lib/field-rules.ts` | Clientes, Promotoras, Invitaciones | **1** |
| `CIUDADES_PARAGUAY`, `buscarCiudad`, `departamentoDe`, `CityAutocomplete` | ciudad libre | Clientes, Eventos, Leads | **1** |
| `fechaCorta`, `fechaDia`, `fechaHora`, `fechaHoraCorta` | helpers de fecha en módulos | Listas y fichas | **2** |
| `ChipEstado` + `ESTADOS_CHIP`/`TONOS` | `AdminBadge` + mapas de tono | Todas las listas | **2** |
| `Stat`, `EmptyState`, `ErrorState`, `Skeleton` | `AdminKpi`, `AdminEmpty`, carga | Todos los módulos | **2** |
| `Button`, `IconAction`, `Icon`, `ToastProvider`/`useToast` | botones y avisos flotantes | Todo el panel | **2** |
| `DataTable` + `CELDA_*`/`ROTULO_*` | contrato de listas propio | Listas del panel | **3** |
| `Modal`, `ConfirmDialog`, `Drawer` | `AdminDialog` | Todo el panel | **3** |
| `FormField`, `Input`, `Select`, `Textarea`, `SearchField`, `PercentField`, `SerialField`, `Subtabs`, `Switch` | kit de campos propio | Formularios | **3** |
| `PageHeader`, `Eyebrow`, `FilaDato`, `CeldaMoneda`, `Money`, `Dot`, `BarraProgreso`, `Nota`, `Aviso` | cabeceras y celdas | Todos los módulos | **3** |
| `qrDataUrl`, `QR_OPCIONES`, `CodigoQr` | `lib/qr.ts` | Portal, presupuestos, demo | **2** |
| `nombrePartes`, `normalizarNombre`, `primerNombre`, `inicialesDeBanco` | avatares/nombres | Clientes, Usuarios | **3** |
| `esToken`, `extractTokenFromUrl` | validación de códigos | Portal, plantillas | **3** |

**No aplica** (otras apps): checklist de dispositivos, locks, batería, iPhones,
ESC/POS e impresoras LAN.

## 3. Objetos que LedBox necesita y hay que implementar en la librería

Genéricos (props adentro, nada de negocio ni `fetch`), con lo que ya funciona
acá como referencia:

| Objeto propuesto | Referencia en LedBox | Para qué sirve en las otras apps |
| --- | --- | --- |
| `TableroKanban` | `AdminBoard` (columnas por estado, arrastre HTML5 + «Mover a…», optimismo con revert) | cualquier pipeline por estados (MobOS, ScaleOS, PagaYa) |
| `Cronologia` | `AdminTimeline` (hitos con ícono/tono por tipo, fecha y actor) | historia de un pedido/equipo/cliente |
| `PlanPagos` | plan de cuotas del portal y de Finanzas | ventas a plazo (todas las apps venden a crédito) |
| `DocumentoImpresion` | hojas `lbprint` (presupuesto, factura, orden de trabajo) | documentos A4 con emisor/receptor/detalle/totales e imprimible |
| `SubidaImagen` | `AdminImageUpload` + recorte/compresión del navegador | logos, fotos de perfil, comprobantes |
| `ProgresoChecklist` | `checklistProgress` (barra + «x de y» + tono) | avance de un trabajo en cualquier app |

El primer lote se implementa en la rama `feat/objetos-ledbox` de la librería
(con sus tests y `CHANGELOG.md`); la versión y el tag los decide el dueño.

## 4. Shim de tema (un solo lugar)

Nuestros tokens `--a-*` y los de la librería (`ink-*`, `fono`, `text-mute`…)
conviven mapeando **una vez** en `app/globals.css`:

```css
/* Solo mientras el panel siga con tokens propios. */
.admin-root { --c-fono: var(--a-accent); /* …el resto del mapeo */ }
```

El modo oscuro de la librería (`html.dark`) se activa desde el mismo lugar
donde hoy se aplica `data-theme`.

## 5. Orden de ejecución

1. **Piloto** (en curso): veredicto y capturas comparativas.
2. **Prioridad 1** (sin Tailwind, ya usable): montos, bancos, teléfono y
   ciudades — menos código duplicado y formatos idénticos en todas las apps.
3. **Prioridad 2 y 3** dentro del **rediseño completo del panel**
   (`docs/DISENO-PANEL.md`), para migrar cada objeto una sola vez.
4. **Objetos nuevos** (§3): implementar en la librería y adoptar acá en la
   misma pasada.
