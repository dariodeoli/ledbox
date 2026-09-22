# Adopción de `owncoding-ui` en LedBox/EventOS

Estado y plan del uso de la librería compartida de OwnCoding
(`github.com/dariodeoli/owncoding-ui`) en esta app. Se apoya en el piloto
(`feat/piloto-owncoding-ui`, `docs/PILOTO-OWNCODING-UI.md`) y en las reglas de
la propia librería (`REGLAS.md`, `ALIMENTAR.md`, `MODOS-DE-TRABAJO.md`).

Regla madre: **buscar antes de crear**. Si el objeto existe en la librería, se
usa; si falta y es genérico, se crea **en la librería** y se adopta acá.

## 1. Cómo se consume (una sola vez)

```bash
npm install github:dariodeoli/owncoding-ui#v0.13.1 qrcode
# tailwind.config.js: presets: [preset] + corePlugins: { preflight: false }
# globals.css: @import 'owncoding-ui/styles.css';
```

- **Preflight apagado**: el reset de Tailwind rompería el panel entero.
- **Tema**: la librería usa `html.dark`; el panel usa `[data-theme]` en
  `#admin-root` → el shim de tema vive en un solo lugar (§4).
- **Repo privado**: en CI/Coolify hace falta un token de lectura de GitHub para
  instalar la dependencia (`git+https://x-access-token:$TOKEN@github.com/...`).
- **Prefijo de contenido del preset**: Tailwind 3.4 ignora el `content` que trae
  el preset; hay que repetir los `src/**/*.jsx` de la librería en el `content`
  de la app (si no, los íconos salen gigantes). Está reportado upstream (#3).
- **`styles.css` trae base global**: se aísla en el contenedor de la pantalla que
  adopta la librería; reportado upstream para partir tokens y base.

## 1 bis. Lo que dejó el piloto (22-09-2026)

- Instalar la librería + Tailwind **no cambia el panel**: capturas byte a byte
  idénticas en `/finanzas` y `/clientes`, misma huella de DOM/estilos.
- **Formato de dinero decidido**: `Gs 1.234.567` (sin punto). La librería quedó
  alineada en `v0.13.1` (`Money`, `CeldaMoneda` y los formateadores puros).
- **Tema decidido**: el panel mantiene `data-theme` por usuario; al adoptar se
  agrega un puente de una línea para reflejarlo en `html.dark` (contrato de la
  librería).
- **No adoptar `DataTable`**: no soporta la plantilla `--<vista>-cols` ni el
  scroll silencioso. Se mantiene `AdminTable` y se adopta `CeldaMoneda` adentro.
- Veredicto completo y capturas: `docs/PILOTO-OWNCODING-UI.md`.

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

## 6. Plan mecánico de la prioridad 1 (sin Tailwind)

Se adopta `v0.13.1` (solo utils puros): `npm install github:dariodeoli/owncoding-ui#v0.13.1`.
Nada de Tailwind, nada de estilos: son funciones y catálogos.

| Paso | Archivo(s) | Cambio |
| --- | --- | --- |
| 1 | `package.json`, `.npmrc`/env | fijar `owncoding-ui#v0.13.1` y documentar el token de build |
| 2 | `lib/admin-format.ts` | `formatMoney`/`formatMoneyInput` delegan en `formatGs`/`formatGsInput`/`parseGsInput`; se borra el `Intl` duplicado |
| 3 | `lib/field-rules.ts` | el teléfono usa `parseTelefono`/`componerTelefono`/`telefonoValidado` (mismo contrato de `FIELD_*`: los mensajes no cambian) |
| 4 | Tesorería/Conciliación/Datos de pago | el catálogo de bancos y sus logos salen de `BANCOS_PARAGUAY` + `logoDeBanco`, sin listas locales |
| 5 | Clientes/Eventos/Leads | el campo ciudad usa `CIUDADES_PARAGUAY` + `buscarCiudad`/`departamentoDe` |
| 6 | Pruebas | `npm run test:rules` cubre los formatos nuevos (mismos resultados que hoy) |

Verificación: los valores de pantalla **no cambian** (mismo `Gs 1.234.567`, mismo
`+595 982 029 217`, mismas ciudades) y los imprimibles siguen idénticos.

## 7. Requisito de deploy (Coolify)

Al adoptar la librería, el build necesita un token de lectura del repo privado:

- Crear un *fine-grained token* de GitHub con acceso de lectura a
  `dariodeoli/owncoding-ui` y cargarlo en Coolify como `GITHUB_TOKEN` del build.
- En `package.json` la dependencia queda como
  `git+https://x-access-token:${GITHUB_TOKEN}@github.com/dariodeoli/owncoding-ui.git#v0.13.1`
  (o `.npmrc` con `//github.com/:_authToken=${GITHUB_TOKEN}`).
- Probar el build en una rama antes de mergear a la rama viva.
