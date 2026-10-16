# Papelera: archivar → eliminar → eliminados → definitivo

Diseño aprobado el 13-10-2026 (arquitecto). Fuente para todas las etapas.

## Entidades
| Prioridad | Entidad | Archivar | Eliminar (a papelera) |
|---|---|---|---|
| 1 | Event | Solo COMPLETED, CANCELLED o DRAFT. Sale de listas activas y calendario; queda en el historial del cliente. | Oculta de todo. Bloqueado si CONFIRMED o IN_PROGRESS con reservas sin liberar. |
| 2 | InventoryItem | Reusa `archivedAt` existente (no toca disponibilidad). | Bloqueado con asignaciones futuras sin liberar, incidentes abiertos o si es componente de un combo vivo. Al eliminar deja de contar en disponibilidad y catálogo. |
| 3 | Client | `archivedAt` sincronizado con `active=false`. | Bloqueado con eventos o presupuestos vivos (no eliminados). |
| 4 | Lead | `archivedAt` si WON/LOST o >30 días sin actividad. | Bloqueado con presupuesto vivo. |
| 5 | Supplier | `archivedAt` ↔ `active`. | Bloqueado con SupplierJob PENDING. |
| 6 | Promoter | `archivedAt` ↔ `active`. | Bloqueado con tareas en eventos futuros. |
| 7 | Budget | Solo DRAFT, LOST o CANCELLED. | Solo sin SignatureRequest, ClientPayment, Proof, ExpectedPayment confirmado ni Invoice. |

Ciclo: activo → archivado → eliminado (papelera) → borrado definitivo o anonimizado. Restaurar desde la papelera vuelve a **archivado**.

## Modelo de datos (columnas por entidad, sin tabla genérica)
`archivedAt`, `archivedById`, `deletedAt`, `deletedById`, `deleteReason`, `anonymizedAt` en las 7 tablas, índice `(organizationId, deletedAt)`. Los `*ById` son texto sin FK. Backfill: Client/Supplier/Promoter con `active=false` → `archivedAt` (solo si es nulo). `OrganizationRentalSettings.trashPurgeDays INTEGER` (NULL = sin purga). Migración aditiva e idempotente (`DO $$ … FOREACH … ADD COLUMN IF NOT EXISTS`). Acciones de auditoría nuevas en `AUDIT_ACTIONS`: archive, restore, trash, purge, anonymize.

## Reglas
- Eliminar solo lo archivado: `updateMany({ where: { id, organizationId, archivedAt: { not: null }, deletedAt: null } })`; count 0 → 409 «Archivalo primero o ya fue eliminado».
- Archiva y elimina quien tiene la capacidad de escritura de la entidad. Papelera (ver, restaurar, definitivo, purga): capacidad nueva `trash.manage`, solo OWNER/ADMIN, 403 en el servidor.
- Lo eliminado no aparece en listas, búsqueda, nav-counts, overview, resumen, KPIs, catálogo público, disponibilidad, selectores ni portal (portal y catálogo con token → 404). Excepción: cobros, facturas, tesorería y libros siguen contando, con el snapshot y el rótulo «(eliminado)».
- Restaurar: limpia deletedAt/deletedById/deleteReason, vuelve a archivado, auditado. Lo anonimizado no se restaura.
- Definitivo: AdminDialog escribiendo el nombre exacto (normalizado) + motivo obligatorio (≤200). El servidor revalida.
- Purga a N días: perezosa al abrir la papelera, con `pg_try_advisory_xact_lock(hashtext(orgId))`; solo lo que pasa la regla de bloqueos; lo bloqueado queda «Conservado (contable)». Apagada por defecto.

## Punto crítico: datos contables
Nunca `db.<x>.delete` sobre un registro con historial contable (las cascadas Client→ClientPayment y Supplier→SupplierJob destruirían libros). `blockersFor(entity)` dentro de la transacción, con `_count` y `SELECT … FOR UPDATE` de la fila.
- Client con presupuestos aprobados o firmados, cobros, facturas o eventos con cobros → bloqueado; se ofrece **Anonimizar**: name/company/tradeName → «Cliente eliminado ·#abcd», nulos email, phone, contactos, whatsapp, instagram, address, notas, rucSnapshot; borrar ClientLogo; revocar CatalogAccessToken; `anonymizedAt`. legalName/ruc se conservan solo si una Invoice los necesita (la factura tiene su snapshot inmutable). Sin historial: borrado real.
- Event con cobros (vía presupuesto), Invoice, Expense, SupplierJob ≠ CANCELLED o InventoryIncident → bloqueado; se ofrece anonimizar responsable, contacto y notas.
- InventoryItem con EventInventory, InventoryIncident o usedInCombos → bloqueado. BudgetItem/QuoteItem pasan a null (tienen snapshot). Sin nada: borrar y liberar SKU.
- Supplier con SupplierJob, Expense o PurchaseInvoice → bloqueado; anonimizar contacto.
- Promoter con tareas → anonimizar; sin tareas → borrar.
- Lead con presupuesto → anonimizar; sin presupuesto → borrar (supresión legítima, Ley 7593).
- Budget: definitivo solo DRAFT sin firma, cobro, comprobante ni factura. Un documento firmado nunca se borra ni se anonimiza en su snapshot.
- Bloqueo: 409 `{ blockers: [{ kind, count }] }` con mensaje concreto.

## Filtrado
Extensión de Prisma en `lib/server/db.ts` que agrega `deletedAt: null` (AND) en findMany/findFirst/findUnique/count/aggregate/groupBy de los 7 modelos, salvo que el where ya mencione deletedAt. `dbWithDeleted` solo para `lib/server/trash.ts` y la purga. Riesgos: no filtra include/select anidados ni `_count` → helper `live = { deletedAt: null }` en los include y test de fuente; update/delete por id no se filtran → `assertLive` (404) en mutaciones; los reportes de dinero no deben ocultar cobros.

## UI
Menú «•••» (AdminActionsMenu) con Archivar/Restaurar/Eliminar en filas y fichas de las 7 entidades. Ajustes → Eliminados (`/ajustes/eliminados`, OWNER/ADMIN, en `lib/admin-routes.ts`) con filtros por tipo, quién y cuándo; columnas tipo, nombre, eliminado por, fecha y motivo, días hasta la purga y bloqueos; acciones Restaurar y Eliminar definitivamente (o **Anonimizar** si hay bloqueos).

## Etapas
1. E1 infra: migración, extensión `db.ts` + `dbWithDeleted`, `live`, `assertLive`, `trash.manage`, auditoría, `lib/server/trash.ts` con archive/trash/restore genéricos y `blockersFor` puros. Sin UI.
2. E2 ops: Event e InventoryItem (archivar, eliminar, definitivo con bloqueos), disponibilidad y catálogo; corregir `ia/anular` (usedInCombos e incidentes).
3. E3 crm: Client, Lead, Supplier, Promoter, Budget DRAFT; sincronización active↔archivedAt; anonimización; revocación de tokens.
4. E4 ui: menú «•••», Ajustes → Eliminados, diálogo de nombre, avisos de bloqueo.
5. E5 infra (opcional): purga perezosa.

## Vuelta atrás
Columnas aditivas y nulas: quitar la extensión y la UI vuelve a mostrar todo sin pérdida. Irreversible solo el definitivo y la anonimización (OWNER/ADMIN, nombre, motivo, auditado; respaldo diario de 30 días).

## Familias de variantes (#205)

InventoryFamily forma parte de Eliminados y del filtro vivo compartido. Su modelo no necesita anonymizedAt ni archivedById: no admite anonimización. La eliminación existente desvincula variantes, preservando nombre, stock, precios y unidades. Restaurar conserva archivedAt (o la archiva si una eliminación histórica no lo tenía), limpia la marca de eliminación y **no vuelve a vincular variantes ni portada**. Si el código ya pertenece a otra familia o SKU vivo, responde409 sin renombrar ni sobrescribir. Se cambia ese código antes de recuperar la familia.

Restaurar y borrar definitivamente exigen trash.manage (OWNER/ADMIN), empresa activa y fila bloqueada. El definitivo requiere nombre exacto y motivo; conserva la familia si aún tiene variantes, incluidas las eliminadas. No las desvincula por cascada. El vaciado automático usa la misma guardia. Familias eliminadas históricamente aparecen con autor y motivo cuando fueron registrados.
