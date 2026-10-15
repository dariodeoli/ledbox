# Variantes de producto (familias): plan por etapas

Arquitecto, 15-10-2026, sobre `origin/codex/ledbox-gestion-multiempresa` @ d0e6ee7 (v2.1.128). Migración `202611010001_inventory_families`: aditiva, idempotente, la aplica el deploy.

## 1. Qué existe y la decisión de fondo
- **Todo el motor gira sobre `inventoryId`.** Usan esa clave:
  - unidades (`InventoryUnit`), `quantity` e `incidentHold`;
  - las reservas (`EventInventory`, que es única por `(eventId, inventoryId)`);
  - el lock (`lockInventoryItems`: `FOR UPDATE` ordenado por id);
  - los combos (`InventoryComponent.componentId` y `comboSubstitutions`);
  - los precios (`listPrice`…, `InventoryPriceTier`, `pricingSnapshot` en `BudgetItem`);
  - las líneas de presupuesto (`BudgetItem.inventoryId`), de pedido (`QuoteItem.inventoryId`) y de carrito (`StoreCart.items[{inventoryId}]`);
  - la aprobación (`approval-stock.ts` → `reserveBudgetInventory`).
- **Decisión: cada variante es un `InventoryItem` completo**, con su código, unidades, foto y precio. La familia es solo una capa que agrupa y presenta. Así disponibilidad, lock, aprobación, presupuestos, remitos, conteos y papelera siguen iguales.
- No existe nada parecido: no hay issue abierto de variantes ni campos `family`/`variant` en el schema. Issues que se cruzan: #161 (filtros de inventario) y #157 (fichas de la tienda pública).
- **Se reutiliza:**
  - `resolveInventoryCategory` (escritor único de la categoría);
  - `comboSubstitutions` + `effectiveComponents` + `substitutionPrice` para «cualquier variante»;
  - `replacePriceTiers`;
  - `findSubstitutes`;
  - `/p/[code]` (ya resuelve por id o SKU);
  - la sección opcional `categorias` del importador como modelo para `familias`.

## 2. Modelo de datos (recomendación: tabla nueva liviana + columnas en InventoryItem)
**Opción recomendada, una mezcla de las dos.** Tabla `InventoryFamily` para el «padre», y las opciones de cada variante en JSON sobre el ítem.
- **Por qué no solo `familyId` + JSON en el ítem:** el padre necesita nombre, código de tienda, descripción, categoría, ejes y orden propios. Guardarlos en una variante «líder» es ambiguo. Un padre que fuera `InventoryItem` se colaría en disponibilidad, listas, presupuestos, tienda y conteos.
- **Por qué no ejes normalizados en tablas (eje, valor, variante-valor):** hay como mucho 2 ejes y pocos valores. Un JSON validado en un módulo puro, más una clave única por combinación, da la misma garantía con mucho menos código.

`InventoryFamily`:
- `id, organizationId, name(≤120), code(≤60, mismas reglas que el SKU)`;
- `categoryId?`, `publicDescription?(≤600)`, `coverItemId?` (la variante cuya foto es la portada; no se duplican binarios);
- `axes Json`: `[{ key:"color", label:"Color", values:[{value:"Verde"},{value:"Lila"}] }]`, con ≤2 ejes, ≤30 valores y valores de ≤40 caracteres;
- `webSortOrder`, `archivedAt?`, los campos de papelera (`deletedAt`, `deletedById`, `deleteReason`) y fechas;
- `@@unique([organizationId, code])`, `@@index([organizationId, deletedAt])`.

`InventoryItem` (columnas nuevas):
- `familyId?` (FK SetNull);
- `variantOptions Json?`, por ejemplo `{"color":"Verde","talle":"35"}`;
- `variantKey String?`: la combinación normalizada, por ejemplo `color=verde|talle=35`;
- `variantOwnPrice Boolean @default(false)`;
- `variantSortOrder Int @default(0)`.

`InventoryComponent`: `anyVariant Boolean @default(false)`. Se crea ya, pero queda apagado hasta la etapa D.

Migración `202611010001`, todo con `IF NOT EXISTS` y la FK en `DO $$` con chequeo en `pg_constraint`:
- un índice único **parcial** `("familyId","variantKey") WHERE "familyId" IS NOT NULL AND "deletedAt" IS NULL`;
- un índice `("organizationId","familyId")`.

No hay backfill porque nadie tiene familias todavía. Antes de crearla, confirmar en la rama de integración que la última migración sigue siendo `202610300001`.

**Reglas del módulo puro `lib/inventory-variants.ts` (con tests):**
- Las claves de eje se normalizan: minúsculas, sin tildes («Talle» → `talle`).
- Toda variante tiene exactamente los ejes de su familia.
- Hay `variantKey` y `variantDisplayName(familyName, options, axes)`, que da «Plato Arabesco · Verde» o «Zapato Ola · Negro · 35».
- Un combo no puede ser variante (v1), y un ítem pertenece a una sola familia.

**Escritor único `lib/server/inventory-families.ts`.** Al renombrar la familia, cambiar su categoría o los valores de los ejes, reescribe en la misma transacción el `name` y la categoría (vía `resolveInventoryCategory`) de todas sus variantes. Así cada lector actual (presupuestos, PDF, remitos, buscador, selector) muestra el nombre completo sin hacer joins. Un test de fuente verifica que nadie más escribe `name` en una variante.

## 3. Efecto en cada subsistema
- **Disponibilidad y lock:** sin cambios. Cada variante tiene su stock, y el stock de la familia es la suma, solo para mostrar. `lockInventoryItems` nunca bloquea la fila de la familia.
- **Combos:**
  - Etapa A: un componente apunta a una variante concreta. Ya funciona hoy.
  - Etapa D, «cualquier variante»: `anyVariant = true` y `componentId` = variante de referencia.
    - Capacidad = **máximo** entre hermanas de `floor(libres/cantidad)`. No se reparte entre colores: los 8 platos de un juego salen del mismo color.
    - Al comprometer: se leen los ids de las hermanas sin bloquear la familia, se llama `lockInventoryItems(todas)` (ordenadas) y se revalida `familyId` con los ítems ya bloqueados.
    - Si la de referencia no alcanza, se elige la hermana con más stock libre (en empate decide `variantSortOrder`) y se guarda en `comboSubstitutions` `{definición: variante}`. Así heredan solos el vencimiento perezoso, la liberación, la sustitución manual y el precio de sustitución.
- **Precios:** la variante sigue siendo la única verdad. `line-pricing`, `price-tiers` y los snapshots no cambian.
  - «Mismo precio para todas» (en el editor de la familia) copia lista, mayorista, mínimo, cobro y escalones (`replacePriceTiers`) a las variantes con `variantOwnPrice = false`, en una sola transacción.
  - Se descarta heredar el precio al leerlo: chocaría con «0 = a consultar» y obligaría a tocar cada lector.
- **Aprobación (`approval-stock`):** sin cambios, porque la línea ya lleva la variante. `findSubstitutes` pone primero a las hermanas de la familia como «reemplazo posible», para el mensaje de faltante.
- **Presupuestos y pedidos:** sin cambio de esquema. `BudgetItem` y `QuoteItem` guardan la variante y el nombre completo (`QuoteItem.productSlug` = SKU de la variante). Convertir un pedido en presupuesto conserva la variante.
- **Tienda:** el DTO público suma el campo `family` y la grilla muestra una tarjeta por familia (ver etapa B). Nunca se expone `quantity`: solo pistas por variante.
- **Importación:** ver §5.
- **Papelera:**
  - Una variante en la papelera sale del índice parcial, así que su combinación queda libre.
  - Borrar una familia la manda a la papelera y desvincula sus variantes (`familyId = NULL`; vuelven a ser productos sueltos con su nombre y stock).
  - Al restaurar no se re-vincula sola.

## 4. Etapas (cada una se publica sola)
**A · Modelo + panel** (infra: migración y schema; ops: servidor y API; ui: pantallas). Tamaño M.
- **Archivos:**
  - `prisma/schema.prisma` y `prisma/migrations/202611010001_inventory_families/migration.sql`;
  - `lib/inventory-variants.ts` y `lib/server/inventory-families.ts`;
  - `app/api/admin/inventory/families/route.ts` (GET y POST) y `families/[id]/route.ts` (GET, PATCH y DELETE);
  - `families/[id]/variants/route.ts` (POST: crear variante nueva o sumar productos existentes) y `variants/[itemId]/route.ts` (DELETE: desvincular);
  - `lib/server/inventory-grid.ts` (agrega `familyId`, el nombre de la familia y `variantOptions` al payload);
  - `findSubstitutes`, la ficha y los diálogos de inventario;
  - `lib/server/demo-data*.ts` (Plato Arabesco verde/lila y Zapato Ola negro/blanco 35/36).
- **Pantalla:**
  - En la lista, las variantes siguen siendo filas, con el chip «Familia» y un filtro por familia, en la misma `--inventario-cols`.
  - Acción masiva «Agrupar en familia»: se eligen ejes y se asigna valor a cada producto.
  - En la ficha, pestaña «Variantes» con hermanas, stock libre, precio propio y «Agregar variante». Esa acción copia cobro, precios, categoría y medidas; pide código nuevo y crea 0 unidades, o N vía `createInventoryUnits`.
- **Permisos:** mutar exige `inventory.write`; VIEWER y FINANCE solo leen.
- **Riesgos:**
  - El nombre se sobreescribe al agrupar: avisar en la vista previa y auditar el nombre viejo.
  - Choques en `route.ts` e `InventoryItemDialogs` con trabajos paralelos.

**B · Tienda** (crm, con QA visual). Tamaño M. Espera a A.
- **Archivos:**
  - `lib/server/catalog-public.ts`: `loadVisibleRows` suma `familyId`, `variantOptions` y la familia; `loadPublicCatalogItems` agrupa.
  - `PublicCatalogItem.family`, campo aditivo: `{ code, name, axes, defaultId, variants:[{ id, sku, options, imageUrl, price, availability }] } | null`.
  - `lib/server/catalog-product.ts`: `/p/<códigoFamilia>` es la URL canónica y `/p/<skuVariante>` abre la ficha con esa variante elegida. Relacionados y similares excluyen a las hermanas.
  - `ProductTile`, `QuickView`, `BuyPanel`, `ProductPage`, `CartDrawer`, `MiniAdd`, `cart-add.ts`;
  - `lib/storefront-order.ts` y `lib/server/storefront-order.ts`: la familia es una sola fila en Ajustes → Tienda y su orden se escribe en todas sus variantes.
- **Comportamiento:**
  - Una tarjeta por familia, con «Desde Gs. X» si los precios difieren.
  - «Agregar» abre la vista rápida si hay más de una variante visible.
  - Chips por eje con texto siempre (sin muestras de color solas) y `aria-pressed`. Las combinaciones inexistentes van deshabilitadas, y las que no tienen stock en las fechas llevan «Sin disponibilidad en esas fechas».
  - Cambian foto, precio y código de la variante.
  - En el carrito se ve «Plato Arabesco · Verde».
  - Las variantes ocultas o archivadas no salen. La familia sale si tiene al menos una variante visible.
- **Riesgos:**
  - `loadVisibleRows` corta en `take: 500` y las variantes cuentan para ese tope: subirlo a 1500 o paginar, con un test.
  - Ningún dato de stock o costo puede salir en el DTO nuevo (test de forma).

**C · Importación** (ops; docs y prompt: crm). Tamaño S/M. Espera a A, puede ir en paralelo con B.
- **Archivos:** `lib/import-catalog.ts` (normalizar y planificar), `lib/server/import-catalog.ts` (aplicar), `import-tabular.ts`, `import-ia.ts` e `ia-carga.ts`, `docs/IMPORTAR-EMPRESA.md`, y la plantilla y el prompt de ChatGPT.
- **Riesgo:** al reimportar, un código que cambia de familia. Se mueve con un aviso; si la combinación choca, es un error de esa fila.

**D · Combos con «cualquier variante»** (ops, con QA). Tamaño M. Opcional, después de A. Prende `anyVariant` según §3.

## 5. Importación JSON (recomendación)
- **Por variante:** `"familia": "Plato Arabesco"` + `"opciones": {"color": "Verde"}`, y opcionalmente `"codigo_familia": "PLATO-ARABESCO"`. Si viene `codigo_familia`, se empareja por código, que es estable aunque cambie el nombre. Si no, por el nombre normalizado, y el código se deriva del nombre (mayúsculas, guiones).
- **Sección opcional `familias`** (al nivel de `productos`, igual que `categorias`): `[{ "nombre", "codigo", "descripcion", "foto", "opciones": [{ "nombre": "color", "valores": ["Verde","Lila"] }] }]`. Fija el orden de los valores y la descripción. Ausente = se infiere de las variantes.
- **Planilla:** columnas `Familia`, `Opción 1` y `Valor 1`, `Opción 2` y `Valor 2`.
- **Errores bloqueantes por fila:**
  - variantes de una misma familia con categorías distintas;
  - ejes distintos dentro de la familia;
  - combinación repetida;
  - `tipo: juego` con `familia`;
  - más de 2 ejes;
  - un valor de más de 40 caracteres.
- **Avisos:** una familia con una sola variante (se acepta) y `opciones` sin `familia` (se ignora).
- **Precio:** si todas las variantes traen el mismo precio, `variantOwnPrice = false`; si difieren, `true`.
- **Vista previa:** tarjeta «Familias: N (M variantes)», y aplicar es idempotente porque actualiza por código.

## 6. Aislamiento entre empresas y concurrencia
- **Aislamiento:**
  - Todo `familyId`, `itemId` y `coverItemId` recibido se valida con `findFirst({ id, organizationId })`; si es ajeno, 404. Los ítems que se agrupan tienen que ser todos de la empresa activa.
  - La tienda resuelve la familia solo dentro de la empresa del slug.
  - El código de familia no puede coincidir con un SKU de la misma empresa (se valida en las dos direcciones; el resolvedor prueba SKU primero, así que el resultado es determinístico).
  - Se descartó una FK compuesta `(familyId, organizationId)`: con SetNull anularía también `organizationId`. En su lugar va un test .pg de aislamiento.
- **Concurrencia:**
  - Dos personas que crean «Verde» a la vez: el índice parcial único hace que una gane y la otra reciba 409.
  - Los cambios de familia toman `SELECT … FOR UPDATE` de la fila de la familia y propagan a las variantes en la misma transacción.
  - Orden de locks: familia → ítems (por id) → evento. El motor de stock nunca toma la familia, así que no hay ciclo.
  - Desvincular o agrupar no toca stock, así que no compite con las reservas.

## 7. Criterios de QA
**A**
1. La migración corre dos veces sin error sobre una base con datos (.pg), y `npx prisma validate` pasa.
2. Agrupar el plato verde y el lila da «Plato Arabesco · Verde/Lila». Unidades, reservas y precios no cambian (comparación antes/después).
3. Dos POST simultáneos con «Verde»: uno 201 y otro 409 (.pg).
4. Una familia o un ítem de la empresa B usado desde A da 404. VIEWER recibe 403 en todo lo mutante.
5. «Mismo precio para todas» actualiza solo las variantes sin precio propio, escalones incluidos.
6. Renombrar la familia cambia el nombre de las variantes. Los presupuestos ya creados conservan el nombre viejo (snapshot).
7. Un presupuesto con «Zapato Ola · Negro · 35» × 2 reserva solo esa variante. Con stock 1, la aprobación lo frena y propone «Blanco · 35» como reemplazo.
8. Mandar la familia a la papelera deja las variantes sueltas, con stock intacto.
9. La demo carga completa.
10. Pasan los checks de §6 de EQUIPO-AGENTES.md.

**B**
1. En la grilla, el plato es una sola tarjeta con chips Verde y Lila. Cambiar el chip cambia foto, precio y código.
2. El zapato muestra 2 ejes; «Blanco · 36» inexistente queda deshabilitado.
3. Con fechas, una variante sin stock dice «Sin disponibilidad en esas fechas» y las demás siguen agregables.
4. Recorrido elegir → Agregar → carrito → enviar: el pedido y su conversión a presupuesto llevan la variante exacta.
5. `/p/<SKU>` abre la variante elegida y `/p/<códigoFamilia>` la de por defecto.
6. El DTO no tiene `quantity` ni costos (test).
7. Con 600 ítems visibles la tienda no pierde productos.
8. Capturas a 390, 768 y 1440 en los 4 temas, sin cortes ni scroll horizontal.

**C**
1. El JSON del plato (2 filas con `familia` y `opciones`) crea 1 familia y 2 variantes; reimportarlo no duplica.
2. Cada error de §5 bloquea solo su fila con un mensaje claro.
3. La planilla con las columnas Opción y Valor da el mismo resultado.
4. Precios distintos marcan precio propio.
5. La guía y el prompt de ChatGPT quedan actualizados.

**D**
1. Juego de 8 platos «cualquier variante» con 5 verdes y 10 lilas: capacidad 1 (por los 10 lilas), y reserva 8 lilas vía `comboSubstitutions`.
2. Dos reservas simultáneas del último stock: una gana (.pg).
3. Liberar el combo libera la variante sustituida.

## 8. Riesgos y vuelta atrás
- **Volver atrás es barato:** revertir el código deja las variantes como productos sueltos, con nombre completo, stock y precio propios, y todo sigue funcionando. Las columnas y la tabla quedan sin uso y no hace falta tocar la base.
- Nombres sobrescritos al agrupar: queda auditado el nombre anterior, y desvincular ofrece restaurarlo.
- Topes de listas (`take: 500` en la tienda, 300 en el panel): cubiertos en B y en el payload por cursor de A.
- Choques con trabajos paralelos en `catalog-public.ts`, los componentes de la tienda y `import-catalog.ts`: B y C nunca a la vez sobre el mismo archivo. Máximo 3 agentes en paralelo.

## 9. Dudas para el dueño
1. ¿Hacen falta muestras de color en los chips, además del texto? Sería un campo hex opcional por valor, solo en el eje color.
2. En un juego, «cualquier variante»: ¿todo de un mismo color (lo propuesto) o se puede mezclar?
