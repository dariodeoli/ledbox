import { readBulkSelection as readBulkSelectionPage, bulkSelectionErrorResponse } from "@/lib/server/bulk-selection";
import { InventoryOriginError, validatedStockOrigin, newPhysicalUnitOrigin, assertOriginExpected } from "@/lib/server/inventory-stock-origin";
import { confirmInventoryCount } from "@/lib/server/inventory-stock-count";
import { pendingStockCount } from "@/lib/stock-count";
import { readBillingUnit } from "@/lib/quote-sharing";
import { readAudienceInput, visibleOnWebFor, type CatalogAudience } from "@/lib/catalog-audience";
import { randomUUID } from "node:crypto";
import { beginBulkOperationRun, finishBulkOperationRun, idempotencyForBulkRun, type BulkRowOutcome } from "@/lib/server/bulk-operation-run";
import { bulkUnitPlacementError, readBulkChanges, readBulkSelection } from "@/lib/inventory-bulk";
import type { InventoryKind, InventoryStatus, Prisma } from "@prisma/client";
import { damageSummary, inventoryStatusLabel } from "@/lib/admin-format";
import { requireAdminContext } from "@/lib/server/tenancy";
import { deadResponse } from "@/lib/server/trash-ops";
import { db } from "@/lib/server/db";
import { isJsonObject, jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { inventoryImageUrl, readInventoryImageUrl } from "@/lib/server/inventory-images";
import {
  MAX_UNIT_NOTES,
  InventoryUnitIncidentConflict,
  assertUnitsAvailableWithoutIncidents,
  createInventoryUnits,
  isUniqueConstraintError,
  nextInventoryUnitCode,
  readInventoryUnitCode,
  readInventoryUnitStatus,
  syncInventoryQuantity,
} from "@/lib/server/inventory-units";
import {
  FIELD_LIMITS,
  FIELD_MESSAGES,
  inventoryPriceValue,
  inventoryPriceWarning,
  inventoryUnitCodeValid,
  readInventoryPriceValues,
} from "@/lib/field-rules";
import {
  BLOCKED_INVENTORY_STATUSES,
  EVENT_RANGE_SELECT,
  MAINTENANCE_UNITS_SELECT,
  assignmentCountsAt,
  committedAssignmentWhere,
  assignmentIsActiveNow,
  assignmentRange,
  availabilityForRange,
  buildAvailability,
  commitInventoryAssignment,
  confirmHold,
  releaseAssignment,
  findSubstitutes,
  lockInventoryItems,
  insufficientMessage,
  isComboAssignment,
  isComboItem,
  settleComboContributions,
  loadAssignments,
  loadRentalSettings,
  resolveRentalBuffers,
  maintenanceUnits,
  parseDate,
  rangeLabel,
} from "@/lib/server/inventory-availability";
import { dispatchAssignment, returnAssignment } from "@/lib/server/inventory-operations";
import { replacePriceTiers } from "@/lib/server/price-tier-store";
import { readAudienceTiers, tierWarnings, tiersForAudience } from "@/lib/price-tiers";
import { categoryWriteData, resolveInventoryCategory, type ResolveCategoryInput } from "@/lib/server/inventory-categories";
import { readInventoryTrace } from "@/lib/server/inventory-details";
import { stripInventoryCosts } from "@/lib/server/inventory-costs";
import { GridCursorError, listInventoryGrid, loadGridExtras, matchInventoryByUnitCode, readGridLimit } from "@/lib/server/inventory-grid";
import { resolveUnitPlacement } from "@/lib/server/inventory-units";
import { lockUsableWarehouse } from "@/lib/server/inventory-warehouses";
import { markOwnPrice } from "@/lib/server/inventory-families";
import { comboCapacitiesForRange, loadComboDefinitions, releaseComboAssignment, withComboAvailability } from "@/lib/server/inventory-combos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inventario operativo por evento.
 *
 * - `GET` sin parámetros: ítems de la empresa con sus asignaciones y la
 *   disponibilidad de hoy (`committedNow` / `availableNow`).
 * - `GET ?startsAt&endsAt`: disponibilidad de todos los ítems **en ese rango**
 *   (`availability.range`), además de la de hoy; es la vista por rango del
 *   módulo de inventario.
 * - `GET ?inventoryId&startsAt&endsAt[&excludeId]`: disponibilidad del ítem en el
 *   rango pedido, con el detalle de las asignaciones que se solapan y los
 *   **sustitutos** de la misma categoría con stock libre en el rango.
 * - `GET ?fields=selector` (issue #62): opción mínima para los selectores —ítem
 *   con su disponibilidad de hoy y **sin** el historial de asignaciones—. Sin el
 *   parámetro la respuesta es la de siempre (compatible).
 * - `POST`: `status` (estado del ítem), `prices` (precios de venta: lista,
 *   mayorista con su umbral de días y mínimo), `assignment` (alta/edición con
 *   validación de disponibilidad), `checkout` (salida), `checkin` (devolución
 *   con estado, daños y faltantes) y `assignment-delete`.
 *
 * La disponibilidad es server-side y vive en `lib/server/inventory-availability.ts`
 * (fuente única): la usan este endpoint, la reserva automática al aprobar un
 * presupuesto y los sustitutos. Nunca se permite asignar más unidades que las
 * libres y los ítems en MAINTENANCE o RETIRED quedan bloqueados.
 */

const INVENTORY_STATUSES: readonly InventoryStatus[] = ["AVAILABLE", "RESERVED", "IN_USE", "MAINTENANCE", "RETIRED"];

const INVENTORY_KINDS: readonly InventoryKind[] = ["REUSABLE", "CONSUMABLE", "DISPOSABLE"];

/** Campos del ítem que se editan (issue #111); la cantidad va en #112. */
const INVENTORY_ITEM_FIELDS = [
  "name",
  "category",
  "kind",
  "status",
  "replacementCost",
  "dailyCost",
  "notes",
  "capacity",
  "dimensions",
  "publicDescription",
  "visibleOnWeb",
  "catalogAudience",
  "saleCatalogEnabled",
  "imageUrl",
  "bufferBeforeMin",
  "bufferAfterMin",
  "billingUnit",
  "categoryId",
  "defaultWarehouseId",
  "defaultLocation",
  "defaultStockOrigin", "defaultSourceSupplierId",
  "supplierId",
  "purchasedAt",
  "warrantyUntil",
] as const;

type InventoryItemUpdate = Partial<{
  name: string;
  kind: InventoryKind;
  status: InventoryStatus;
  replacementCost: number;
  dailyCost: number;
  notes: string | null;
  publicDescription: string | null;
  capacity: number | null;
  dimensions: string | null;
  visibleOnWeb: boolean;
  catalogAudience: CatalogAudience;
  saleCatalogEnabled: boolean;
  imageUrl: string | null;
  bufferBeforeMin: number | null;
  bufferAfterMin: number | null;
  billingUnit: "DAILY" | "EVENT";
}>;

/** Tope de un colchón de preparación: 30 días en minutos. */
const MAX_BUFFER_MIN = 30 * 24 * 60;

/** Datos del ítem (issue #111) normalizados: `undefined` = no tocar el campo. */
function readInventoryItemUpdate(body: Record<string, unknown>):
  | { ok: true; data: InventoryItemUpdate; taxonomy: ResolveCategoryInput | null }
  | { ok: false; error: string } {
  const data: InventoryItemUpdate = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) return { ok: false, error: "Ingresá el nombre del artículo." };
    const name = body.name.trim();
    if (name.length > FIELD_LIMITS.name) {
      return { ok: false, error: `El nombre no puede superar los ${FIELD_LIMITS.name} caracteres.` };
    }
    data.name = name;
  }
  // Categoría y subcategoría: nadie escribe `category` directo; el helper único resuelve el id y el espejo de texto.
  let taxonomy: ResolveCategoryInput | null = null;
  if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== "") {
    if (typeof body.categoryId !== "string") return { ok: false, error: "La categoría no es válida." };
    taxonomy = { categoryId: body.categoryId };
  } else if (body.category !== undefined || body.subcategory !== undefined) {
    if (body.category !== undefined && typeof body.category !== "string") return { ok: false, error: "La categoría no es válida." };
    if (body.subcategory !== undefined && body.subcategory !== null && typeof body.subcategory !== "string") return { ok: false, error: "La subcategoría no es válida." };
    if (body.category === undefined && typeof body.subcategory === "string" && body.subcategory.trim()) return { ok: false, error: "Elegí también la categoría de la subcategoría." };
    taxonomy = { category: body.category, subcategory: body.subcategory };
  }
  if (body.inventoryKind !== undefined) {
    const kind = String(body.inventoryKind);
    if (!(INVENTORY_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "El tipo de inventario no es válido." };
    data.kind = kind as InventoryKind;
  }
  if (body.status !== undefined) {
    const status = String(body.status);
    if (!(INVENTORY_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Estado de inventario inválido." };
    data.status = status as InventoryStatus;
  }
  for (const field of ["replacementCost", "dailyCost"] as const) {
    if (body[field] === undefined) continue;
    const cost = inventoryPriceValue(body[field]);
    if (cost === false) return { ok: false, error: "Ingresá un costo válido en guaraníes." };
    if (cost !== null) data[field] = cost;
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string") return { ok: false, error: "Las notas no son válidas." };
    const notes = body.notes.trim();
    if (notes.length > FIELD_LIMITS.notes) {
      return { ok: false, error: `Las notas no pueden superar los ${FIELD_LIMITS.notes} caracteres.` };
    }
    data.notes = notes || null;
  }
  if (body.publicDescription !== undefined) {
    if (body.publicDescription !== null && typeof body.publicDescription !== "string") return { ok: false, error: "La descripción para el catálogo no es válida." };
    const description = (body.publicDescription ?? "").trim();
    if (description.length > FIELD_LIMITS.publicDescription) {
      return { ok: false, error: `La descripción para el catálogo no puede superar los ${FIELD_LIMITS.publicDescription} caracteres.` };
    }
    data.publicDescription = description || null;
  }
  // Capacidad (personas) y medidas: los datos que distinguen a dos productos parecidos en la tienda.
  if (body.capacity !== undefined) {
    const capacity = body.capacity === null || body.capacity === "" ? null : Number(body.capacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1 || capacity > 9999)) return { ok: false, error: "La capacidad tiene que ser un entero de 1 a 9999 personas." };
    data.capacity = capacity;
  }
  if (body.dimensions !== undefined) {
    if (body.dimensions !== null && typeof body.dimensions !== "string") return { ok: false, error: "Las medidas no son válidas." };
    const dimensions = (body.dimensions ?? "").trim().replace(/\s+/g, " ");
    if (dimensions.length > 60) return { ok: false, error: "Las medidas no pueden superar los 60 caracteres." };
    data.dimensions = dimensions || null;
  }
  // Alcance en la tienda (Oculto / Cliente final / Mayorista / Ambos); `visibleOnWeb` queda sincronizado.
  const audience = readAudienceInput(body);
  if (!audience.ok) return { ok: false, error: audience.error };
  if (audience.audience !== undefined) {
    data.catalogAudience = audience.audience;
    data.visibleOnWeb = visibleOnWebFor(audience.audience);
  }
  if (body.saleCatalogEnabled !== undefined) {
    if (typeof body.saleCatalogEnabled !== "boolean") return { ok: false, error: "La inclusión en el catálogo de venta debe ser verdadera o falsa." };
    data.saleCatalogEnabled = body.saleCatalogEnabled;
  }
  for (const field of ["bufferBeforeMin", "bufferAfterMin"] as const) {
    if (body[field] === undefined) continue;
    // null / vacío = hereda el tiempo de la empresa.
    if (body[field] === null || body[field] === "") {
      data[field] = null;
      continue;
    }
    const minutes = Number(body[field]);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_BUFFER_MIN) {
      return { ok: false, error: "El tiempo debe ser un número entero de minutos entre 0 y 43200 (30 días)." };
    }
    data[field] = minutes;
  }
  if (body.billingUnit !== undefined) {
    const billingUnit = readBillingUnit(body.billingUnit);
    if (!billingUnit) return { ok: false, error: "«Se cobra» debe ser por día o por evento." };
    data.billingUnit = billingUnit;
  }
  if (body.imageUrl !== undefined) {
    const imageUrl = readInventoryImageUrl(body.imageUrl);
    if (imageUrl === false) return { ok: false, error: FIELD_MESSAGES.image };
    data.imageUrl = imageUrl;
  }
  return { ok: true, data, taxonomy };
}

/** Reserva viva: sin liberar y con fin (propio o del evento) desde hoy en adelante, o sin fin. */
function liveAssignmentWhere(startOfToday: Date): Prisma.EventInventoryWhereInput {
  return {
    releasedAt: null,
    OR: [
      { endsAt: { gte: startOfToday } },
      {
        endsAt: null,
        OR: [
          { event: { endsAt: { gte: startOfToday } } },
          { event: { endsAt: null, startsAt: { gte: startOfToday } } },
          { event: { endsAt: null, startsAt: null } },
        ],
      },
    ],
  };
}

/** Campos de precio de la edición en lote: si cambian en una variante, su precio pasa a ser propio. */
class BulkFamilyCategoryConflict extends Error {}

const PRICE_KEYS = ["listPrice", "wholesalePrice", "minimumPrice", "listFromDays", "listFromPrice", "wholesaleFromDays", "wholesaleFromPrice"];

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const url = new URL(request.url);
  const bulkOperationRunId = url.searchParams.get("bulkOperationRunId");
  if (bulkOperationRunId) {
    const run = await db.bulkOperationRun.findFirst({ where: { id: bulkOperationRunId, organizationId } });
    if (!run) return jsonError("La operación masiva no existe en esta empresa.", 404);
    return Response.json({ run });
  }
  const inventoryId = url.searchParams.get("inventoryId");

  if (inventoryId) {
    // Sin el binario de la foto (issue #109): la disponibilidad no lo necesita.
    // Con las unidades en mantenimiento contadas (issue #112).
    const item = await db.inventoryItem.findFirst({
      where: { id: inventoryId, organizationId },
      omit: { imageData: true },
      include: { _count: { select: MAINTENANCE_UNITS_SELECT } },
    });
    if (!item) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
    const startsAt = parseDate(url.searchParams.get("startsAt"));
    const endsAt = parseDate(url.searchParams.get("endsAt"));
    if (!startsAt || !endsAt) return jsonError("Indicá el rango de fechas para calcular la disponibilidad.", 400);
    if (endsAt.getTime() < startsAt.getTime()) return jsonError("El fin del rango no puede ser anterior al inicio.", 400);
    const excludeId = url.searchParams.get("excludeId");
    if (await isComboItem(db, organizationId, item.id)) {
      // Un combo no tiene stock propio: su disponibilidad es la capacidad de sus componentes.
      const capacities = await comboCapacitiesForRange({ organizationId, comboIds: [item.id], startsAt, endsAt });
      const capacity = capacities.get(item.id);
      const definition = (await loadComboDefinitions(organizationId, [item.id])).get(item.id);
      const pending = Boolean(definition?.components.some(pendingStockCount));
      return Response.json({
        availability: {
          inventoryId: item.id,
          name: item.name,
          status: item.status,
          total: capacity?.capacity ?? 0,
          stockCountStatus: pending ? "PENDING_COUNT" : "CONFIRMED",
          committed: 0,
          maintenance: 0,
          available: pending || BLOCKED_INVENTORY_STATUSES.includes(item.status) ? 0 : (capacity?.capacity ?? 0),
          blocked: pending || BLOCKED_INVENTORY_STATUSES.includes(item.status),
          startsAt,
          endsAt,
          conflicts: [],
        },
        substitutes: [],
        combo: capacity ? { capacity: capacity.capacity, limiting: capacity.limiting, components: capacity.components.map((c) => ({ ...c, category: definition?.components.find((d) => d.componentId === c.componentId)?.category ?? "" })) } : null,
      });
    }
    const availability = await availabilityForRange({
      organizationId,
      item: { ...item, maintenance: maintenanceUnits(item) },
      startsAt,
      endsAt,
      excludeId,
    });
    const substitutes = await findSubstitutes({
      organizationId,
      item: { id: item.id, category: item.category, categoryId: item.categoryId, status: item.status },
      startsAt,
      endsAt,
    });
    return Response.json({ availability, substitutes });
  }

  if (url.searchParams.get("fields") === "selector") {
    const items = await db.inventoryItem.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      take: 300,
      select: {
        id: true,
        name: true,
        sku: true,
        category: true,
        kind: true,
        status: true,
        quantity: true,
        stockCountStatus: true,
        incidentHold: true,
        _count: { select: MAINTENANCE_UNITS_SELECT },
      },
    });
    const rows = items.length
      ? await db.eventInventory.findMany({
          where: { inventoryId: { in: items.map((item) => item.id) }, event: { organizationId } },
          select: {
            inventoryId: true,
            quantity: true,
            startsAt: true,
            endsAt: true,
            checkedIn: true,
            checkedInAt: true,
            releasedAt: true,
            holdExpiresAt: true,
            event: { select: EVENT_RANGE_SELECT },
          },
        })
      : [];
    const now = new Date();
    const inventory = items.map((item) => {
      const committedNow = rows
        .filter((row) => row.inventoryId === item.id && assignmentIsActiveNow(row, now))
        .reduce((sum, row) => sum + row.quantity, 0);
      const blocked = pendingStockCount(item) || BLOCKED_INVENTORY_STATUSES.includes(item.status);
      const maintenanceNow = maintenanceUnits(item);
      const usable = Math.max(0, item.quantity - maintenanceNow);
      return {
        ...item,
        availability: {
          committedNow,
          availableNow: blocked ? 0 : Math.max(0, usable - committedNow),
          overcommittedNow: committedNow > usable,
          maintenanceNow,
        },
      };
    });
    const definitions = await loadComboDefinitions(organizationId, inventory.map((row) => row.id));
    return Response.json({ inventory: withComboAvailability(inventory, definitions) });
  }

  if (["grid", "bulk-selection"].includes(url.searchParams.get("fields") ?? "")) {
    // Payload liviano de la pantalla (rediseño E2): sin unidades ni asignaciones, paginado por cursor.
    const unitMatch = url.searchParams.get("unitMatch");
    try {
      const bulk = await readBulkSelectionPage(request, auth.context, "InventoryItem");
      if (!bulk && unitMatch !== null) return Response.json({ matchedIds: await matchInventoryByUnitCode(organizationId, unitMatch) });
      const gridStart = parseDate(url.searchParams.get("startsAt"));
      const gridEnd = parseDate(url.searchParams.get("endsAt"));
      const query = (url.searchParams.get("q") ?? "").trim();
      if (query.length > 200) return jsonError("La búsqueda admite hasta 200 caracteres.", 400);
      const saleCatalog = url.searchParams.get("saleCatalog");
      if (saleCatalog !== null && saleCatalog !== "1") return jsonError("El filtro del catálogo de venta no es válido.", 400);
      const page = await listInventoryGrid({
        query,
        organizationId,
        saleCatalogOnly: saleCatalog === "1",
        cursor: bulk?.after ?? (bulk ? null : url.searchParams.get("cursor")),
        createdBefore: bulk?.at,
        limit: bulk?.limit ?? readGridLimit(url.searchParams.get("limit")),
        range: gridStart && gridEnd && gridEnd.getTime() >= gridStart.getTime() ? { start: gridStart, end: gridEnd } : null,
      });
      const bulkPage = bulk ? await bulk.finishKnown(page.inventory, bulk.total ?? page.total ?? 0, page.nextCursor) : null;
      const unitQuery = (url.searchParams.get("unitQuery") ?? "").trim();
      if (unitQuery.length > 200) return jsonError("La búsqueda admite hasta 200 caracteres.", 400);
      const incidents = bulk ? await db.inventoryIncident.groupBy({ by: ["inventoryId"], where: { organizationId, inventoryId: { in: page.inventory.map(row => row.id) }, status: { in: ["OPEN", "IN_REPAIR"] } } }) : [];
      const incidentIds = new Set(incidents.map(row => row.inventoryId));
      const matches = new Set(bulk && unitQuery ? await matchInventoryByUnitCode(organizationId, unitQuery, page.inventory.map(row => row.id)) : []);
      return Response.json({ ...page, inventory: page.inventory.map((row) => ({ ...stripInventoryCosts(row, auth.context), ...(bulk ? { bulkUnitMatch: matches.has(row.id), bulkOpenIncident: incidentIds.has(row.id) } : {}) })), ...(bulkPage ? { bulkSelection: bulkPage.meta } : {}) });
    } catch (error) {
      const bulkError = bulkSelectionErrorResponse(error); if (bulkError) return bulkError;
      if (error instanceof GridCursorError) return jsonError(error.message, 400);
      console.error("[inventory/grid] no se pudo leer", error);
      return jsonError("No pudimos leer el inventario.", 500);
    }
  }

  // Detalle de un producto para la ficha (rediseño E2): mismo payload completo, un solo ítem.
  const detailId = url.searchParams.get("itemId");

  // Sin el binario de la foto (issue #109): la lista solo necesita la URL
  // efectiva. Con las unidades (issue #112) y el conteo de mantenimiento.
  const items = await db.inventoryItem.findMany({
    where: { organizationId, ...(detailId ? { id: detailId } : {}) },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    take: 300,
    omit: { imageData: true },
    include: {
      units: { orderBy: { code: "asc" } },
      priceTiers: { orderBy: [{ audience: "asc" }, { fromDays: "asc" }], select: { audience: true, fromDays: true, mode: true, price: true } },
      _count: { select: MAINTENANCE_UNITS_SELECT },
    },
  });
  if (detailId && items.length === 0) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
  // `?vivas=1` (ficha y línea de tiempo): solo reservas sin liberar cuyo fin no
  // pasó, de la más próxima a la más lejana, para que el tope de 1000 no deje
  // afuera las próximas. Sin el parámetro el comportamiento no cambia.
  const soloVivas = url.searchParams.get("vivas") === "1";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const assignments = items.length
    ? await db.eventInventory.findMany({
        where: {
          inventoryId: { in: items.map((item) => item.id) },
          event: { organizationId },
          ...(soloVivas ? liveAssignmentWhere(startOfToday) : {}),
        },
        orderBy: soloVivas ? [{ startsAt: { sort: "asc", nulls: "last" } }, { id: "asc" }] : [{ startsAt: "desc" }, { id: "asc" }],
        take: 1000,
        include: { event: { select: EVENT_RANGE_SELECT } },
      })
    : [];

  // Rango opcional de la vista por rango (mismo cálculo compartido que la
  // disponibilidad puntual). Si falta o es inválido, solo se devuelve "hoy".
  const rangeStart = parseDate(url.searchParams.get("startsAt"));
  const rangeEnd = parseDate(url.searchParams.get("endsAt"));
  const range = rangeStart && rangeEnd && rangeEnd.getTime() >= rangeStart.getTime() ? { start: rangeStart, end: rangeEnd } : null;

  // La vista por rango solo cuenta lo comprometido de verdad (eventos cancelados
  // no cuentan); el listado sigue mostrando todas las filas con su estado.
  const committedIds = range && assignments.length
    ? new Set(
        (
          await db.eventInventory.findMany({
            where: { id: { in: assignments.map((row) => row.id) }, ...committedAssignmentWhere(organizationId) },
            select: { id: true },
          })
        ).map((row) => row.id),
      )
    : null;

  const now = new Date();
  const rentalSettings = range ? await loadRentalSettings(organizationId) : null;
  // La ficha pide el estado visual con los mismos agregados que la pantalla.
  const extras = detailId ? await loadGridExtras({ organizationId, itemIds: items.map((item) => item.id), assignments, now }) : null;
  const inventory = items.map((item) => {
    // La URL efectiva (issue #109): la manual manda; si no, la foto subida.
    const { imageMime: _imageMime, _count, ...row } = item;
    const rows = assignments.filter((assignment) => assignment.inventoryId === item.id);
    const activeNow = rows.filter((row) => assignmentIsActiveNow(row, now));
    const committedNow = activeNow.reduce((sum, row) => sum + row.quantity, 0);
    const blocked = pendingStockCount(item) || BLOCKED_INVENTORY_STATUSES.includes(item.status);
    const maintenanceNow = maintenanceUnits(item);
    const usable = Math.max(0, item.quantity - maintenanceNow);
    const rangeAvailability = range
      ? buildAvailability({ ...item, maintenance: maintenanceNow, buffers: resolveRentalBuffers(rentalSettings, item) }, rows.filter((row) => committedIds?.has(row.id) && assignmentCountsAt(row, now)), range.start, range.end)
      : null;
    return {
      ...row,
      imageUrl: inventoryImageUrl(item),
      imageUploaded: Boolean(item.imageMime),
      assignments: rows,
      availability: {
        committedNow,
        availableNow: blocked ? 0 : Math.max(0, usable - committedNow),
        overcommittedNow: committedNow > usable,
        maintenanceNow,
        ...(extras
          ? {
              unitsByStatus: extras.get(item.id)?.unitsByStatus,
              holdByKind: extras.get(item.id)?.holdByKind,
              nextCommittedAt: extras.get(item.id)?.nextCommittedAt,
              overduePending: extras.get(item.id)?.overduePending,
              overdueTruncated: extras.get(item.id)?.overdueTruncated,
            }
          : {}),
        range: rangeAvailability
          ? {
              startsAt: rangeAvailability.startsAt,
              endsAt: rangeAvailability.endsAt,
              committed: rangeAvailability.committed,
              maintenance: rangeAvailability.maintenance,
              available: rangeAvailability.available,
              overcommitted: rangeAvailability.committed > usable,
              conflicts: rangeAvailability.conflicts,
            }
          : null,
      },
    };
  });

  // Combos: sin stock propio; «libres» es la capacidad de sus componentes (fase 2c).
  const definitions = await loadComboDefinitions(organizationId, inventory.map((row) => row.id));
  const rangeCapacities =
    range && definitions.size > 0
      ? await comboCapacitiesForRange({ organizationId, comboIds: [...definitions.keys()], startsAt: range.start, endsAt: range.end })
      : null;
  return Response.json({ inventory: withComboAvailability(inventory, definitions, rangeCapacities).map((row) => stripInventoryCosts(row, auth.context)) });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  let activeBulkRunId: string | null = null;
  try {
  const { organizationId } = auth.context;
  const body = await readJson(request);
  if (!isJsonObject(body)) return jsonError("Los datos deben ser un objeto JSON.", 400);
  const kind = typeof body.kind === "string" ? body.kind : "";

  if (kind === "item-archive" || kind === "item-restore") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta el producto.", 400);
    const existing = await db.inventoryItem.findFirst({ where: { id, organizationId }, select: { id: true, name: true, archivedAt: true } });
    if (!existing) return jsonError("El producto no existe en esta empresa.", 404);
    const dead = await deadResponse("InventoryItem", existing.id, organizationId);
    if (dead) return dead;
    const archivedAt = kind === "item-archive" ? existing.archivedAt ?? new Date() : null;
    const inventory = await db.inventoryItem.update({ where: { id: existing.id }, data: { archivedAt }, omit: { imageData: true } });
    const changes = auditChanges(existing, inventory, ["archivedAt"]);
    if (changes) await recordAudit({ context: auth.context, action: "update", entity: "InventoryItem", entityId: inventory.id, summary: `${kind === "item-archive" ? "Archivó" : "Restauró"} el producto «${existing.name}»`, detail: { changes } });
    return Response.json({ inventory: { ...inventory, imageUrl: inventoryImageUrl(inventory), imageUploaded: Boolean(inventory.imageMime) } });
  }

  if (kind === "bulk-items" || kind === "bulk-units") {
    const ids = readBulkSelection(body.ids);
    const isUnits = kind === "bulk-units";
    const changes = readBulkChanges(isUnits ? "units" : "items", body.changes);
    if (!ids || !changes) return jsonError("Elegí de 1 a 100 registros únicos y cambios explícitos válidos. No se aplicó ningún cambio.", 400);
    let data: Record<string, unknown>;
    let taxonomy: ResolveCategoryInput | null = null;
    if (isUnits) {
      const status = changes.status === undefined ? undefined : readInventoryUnitStatus(changes.status);
      if (changes.status !== undefined && !status) return jsonError("Estado de unidad inválido. No se aplicó ningún cambio.", 400);
      if (typeof changes.notes === "string" && changes.notes.length > MAX_UNIT_NOTES) return jsonError("Las notas de la unidad no pueden superar 400 caracteres.", 400);
      // Depósito, ubicación, condición, proveedor y fechas: mismas reglas y mismo 404 por id ajeno que el alta.
      const trace = await readInventoryTrace(changes, { organizationId, allow: { warehouse: "unit", condition: true } });
      if (!trace.ok) return jsonError(`${trace.error} No se aplicó ningún cambio.`, trace.status);
      const { status: _status, notes, warehouseId: _w, location: _l, conditionScore: _c, supplierId: _s, purchasedAt: _p, warrantyUntil: _u, ...rest } = changes as Record<string, unknown>;
      data = { ...rest, ...trace.values, ...(status ? { status } : {}) };
      if (typeof notes === "string") data.notes = notes.trim() || null;
    } else {
      const item = readInventoryItemUpdate(changes);
      const prices = readInventoryPriceValues(changes);
      if (!item.ok) return jsonError(item.error, 400);
      if (!prices.ok) return jsonError(prices.error, 400);
      const trace = await readInventoryTrace(changes, { organizationId, allow: { warehouse: "default" } }, { warehouse: "defaultWarehouseId", location: "defaultLocation" });
      if (!trace.ok) return jsonError(`${trace.error} No se aplicó ningún cambio.`, trace.status);
      const { location: defaultLocation, ...traceRest } = trace.values;
      taxonomy = item.taxonomy;
      data = {
        ...item.data,
        ...Object.fromEntries(Object.entries(prices.values).filter(([, value]) => value !== null)),
        ...traceRest,
        ...(defaultLocation !== undefined ? { defaultLocation } : {}),
      };
    }
    // La unidad durable cubre primero al escritor masivo de artículos; las
    // unidades tienen un flujo distinto porque cambian estado/cantidad real.
    let bulkRunId: string | null = null;
    if (kind === "bulk-items") {
      const idem = idempotencyForBulkRun(request, body);
      if (!idem) return jsonError("Esta acción requiere una clave Idempotency-Key válida.", 400);
      const begun = await beginBulkOperationRun({
        context: auth.context,
        operation: "inventory.bulk-items",
        ids,
        ...idem,
      });
      if (begun.kind === "conflict") return jsonError("Esa clave de idempotencia ya se usó para otra operación: generá una nueva.", 409);
      if (begun.kind === "existing") {
        if (begun.run.status === "IN_PROGRESS") return Response.json({ runId: begun.run.id, status: begun.run.status, outcomes: begun.run.outcomes }, { status: 202, headers: { "Idempotent-Replay": "true" } });
        const saved = begun.run.response as { payload?: Record<string, unknown>; httpStatus?: number } | null;
        return Response.json(saved?.payload ?? { runId: begun.run.id, status: begun.run.status, outcomes: begun.run.outcomes }, {
          status: saved?.httpStatus ?? 200,
          headers: { "Idempotent-Replay": "true" },
        });
      }
      bulkRunId = begun.run.id;
      activeBulkRunId = bulkRunId;
    }
    // Selección completa scopeada y guardado atómico: cero cambios ante un ID ajeno/inexistente.
    const result = await db.$transaction(async tx => {
      // El producto se bloquea antes de tocar unidades o leer su cantidad agregada.
      const parents = isUnits
        ? (await tx.inventoryUnit.findMany({ where: { id: { in: ids }, organizationId }, select: { inventoryId: true } })).map(row => row.inventoryId)
        : ids;
      await lockInventoryItems(tx, organizationId, parents);
      const before = isUnits
        ? await tx.inventoryUnit.findMany({ where: { id: { in: ids }, organizationId } })
        : await tx.inventoryItem.findMany({ where: { id: { in: ids }, organizationId }, omit: { imageData: true } });
      if (before.length !== ids.length) return null;
      if (isUnits && (data.warehouseId !== undefined || data.location !== undefined)) {
        const inventoryIds = [...new Set(before.map((row) => (row as { inventoryId: string }).inventoryId))];
        const hasCommittedAssignments = inventoryIds.length > 0 && await tx.eventInventory.count({
          where: { organizationId, inventoryId: { in: inventoryIds }, ...committedAssignmentWhere(organizationId) },
        }) > 0;
        const placementError = bulkUnitPlacementError(
          before as Array<{ status: string; warehouseId: string | null; location: string | null }>,
          data,
          hasCommittedAssignments,
        );
        if (placementError) return "unit-placement" as const;
        // readInventoryTrace validates before the transaction for a fast error,
        // but the warehouse may be archived before this write starts. Lock and
        // revalidate the destination inside the same transaction as the update.
        if (data.warehouseId !== undefined && !await lockUsableWarehouse(tx, organizationId, data.warehouseId as string)) {
          return "unit-placement-warehouse" as const;
        }
      }
      if (taxonomy) {
        const resolved = await resolveInventoryCategory(tx, organizationId, taxonomy);
        if (!resolved) return null;
        if (before.some(row => "familyId" in row && row.familyId && "categoryId" in row && row.categoryId !== resolved.categoryId)) throw new BulkFamilyCategoryConflict();
        data = { ...data, ...categoryWriteData(resolved) };
      }
      if (isUnits) {
        await assertUnitsAvailableWithoutIncidents(tx, organizationId, ids, data.status);
        await tx.inventoryUnit.updateMany({ where: { id: { in: ids }, organizationId }, data: { ...data, ...(data.status === "AVAILABLE" ? { incidentCycle: { increment: 1 } } : {}) } as Prisma.InventoryUnitUpdateManyMutationInput });
        if (data.status !== undefined) for (const id of new Set(before.map(row => (row as { inventoryId: string }).inventoryId))) await syncInventoryQuantity(tx, id);
      } else {
        await tx.inventoryItem.updateMany({ where: { id: { in: ids }, organizationId }, data: data as Prisma.InventoryItemUpdateManyMutationInput });
        if (PRICE_KEYS.some((key) => key in data)) await markOwnPrice(tx, organizationId, ids);
      }
      return before;
    }).catch((error: unknown) => {
      if (error instanceof BulkFamilyCategoryConflict) return "family-category" as const;
      if (error instanceof InventoryUnitIncidentConflict) return "open-incidents" as const;
      throw error;
    });
    if (result === "family-category" || result === "open-incidents" || result === "unit-placement" || result === "unit-placement-warehouse" || !result) {
      const status = result === "family-category" || result === "open-incidents" || result === "unit-placement" ? 409 : 404;
      const error = result === "family-category"
        ? "La selección incluye variantes. Cambiá la categoría desde Variantes. No se aplicó ningún cambio."
        : result === "open-incidents"
          ? new InventoryUnitIncidentConflict().message
          : result === "unit-placement"
            ? "Solo se pueden mover o reubicar unidades disponibles sin reservas vigentes del producto. No se aplicó ningún cambio."
            : result === "unit-placement-warehouse"
              ? "El depósito de destino ya no está activo en esta empresa. No se aplicó ningún cambio."
          : "La selección contiene registros que no existen en esta empresa. No se aplicó ningún cambio.";
      if (bulkRunId) {
        const outcomes: BulkRowOutcome[] = ids.map(id => ({ id, status: "failed", message: error }));
        const payload = { runId: bulkRunId, status: "FAILED", updated: 0, outcomes, error: `${error} Operación: ${bulkRunId}.` };
        await finishBulkOperationRun({ id: bulkRunId, status: "FAILED", outcomes, response: { payload, httpStatus: status } });
        activeBulkRunId = null;
      }
      return Response.json({ error: bulkRunId ? `${error} Operación: ${bulkRunId}.` : error, runId: bulkRunId, status: "FAILED", outcomes: bulkRunId ? ids.map(id => ({ id, status: "failed", message: error })) : undefined }, { status });
    }
    for (const row of result) {
      const audit = auditChanges(row, { ...row, ...data }, Object.keys(data));
      if (audit) await recordAudit({ context: auth.context, action: "update", entity: isUnits ? "InventoryUnit" : "InventoryItem", entityId: row.id, summary: "Edición masiva de inventario sobre selección explícita", detail: { changes: audit } });
    }
    const warnings = isUnits ? [] : result.flatMap(row => {
      const merged = { ...row, ...data } as typeof row & { listPrice: number; listFromPrice: number; wholesalePrice: number; wholesaleFromPrice: number; minimumPrice: number };
      const warning = inventoryPriceWarning({ ...merged, listFromPrice: 0, wholesaleFromPrice: 0 });
      return warning ? [`${(row as { name: string }).name}: ${warning}`] : [];
    });
    if (bulkRunId) {
      const outcomes: BulkRowOutcome[] = ids.map(id => ({ id, status: "succeeded" }));
      const payload = { runId: bulkRunId, status: "COMPLETED", updatedIds: ids, updated: ids.length, warnings, outcomes };
      await finishBulkOperationRun({ id: bulkRunId, status: "COMPLETED", outcomes, response: { payload, httpStatus: 200 } });
      activeBulkRunId = null;
      return Response.json(payload);
    }
    return Response.json({ updatedIds: ids, updated: ids.length, warnings });
  }

  if (kind === "status") {
    const id = typeof body.id === "string" ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!id) return jsonError("Falta el ítem de inventario.", 400);
    if (!(INVENTORY_STATUSES as readonly string[]).includes(status)) return jsonError("Estado de inventario inválido.", 400);
    const existing = await db.inventoryItem.findFirst({ where: { id, organizationId }, select: { id: true, name: true, status: true } });
    if (!existing) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
    const dead = await deadResponse("InventoryItem", existing.id, organizationId);
    if (dead) return dead;
    const inventory = await db.inventoryItem.update({ where: { id: existing.id }, data: { status: status as InventoryStatus } });
    const changes = auditChanges({ status: existing.status }, { status: inventory.status }, ["status"]);
    if (changes) {
      await recordAudit({
        context: auth.context,
        action: "status",
        entity: "InventoryItem",
        entityId: inventory.id,
        summary: `Cambió «${existing.name}» a ${inventoryStatusLabel(inventory.status)}`,
        detail: { changes },
      });
    }
    return Response.json({ inventory });
  }

  if (kind === "item-confirm-count") {
    const id = typeof body.id === "string" ? body.id : "";
    const quantity = typeof body.quantity === "number" ? body.quantity : NaN;
    if (!id || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 100_000) return jsonError("Indicá el producto y un conteo entero de 0 a 100.000.", 400);
    try {
      const inventory = await db.$transaction((tx) => confirmInventoryCount(tx, auth.context, id, quantity));
      return Response.json({ inventory });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : "No se pudo confirmar el conteo.", 409);
    }
  }

  if (kind === "item") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta el ítem de inventario.", 400);
    const update = readInventoryItemUpdate(body);
    if (!update.ok) return jsonError(update.error, 400);
    const existing = await db.inventoryItem.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        category: true,
        categoryId: true,
        kind: true,
        status: true,
        replacementCost: true,
        dailyCost: true,
        notes: true,
        publicDescription: true,
        capacity: true,
        dimensions: true,
        visibleOnWeb: true,
        catalogAudience: true,
        saleCatalogEnabled: true,
        imageUrl: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
        billingUnit: true,
        defaultWarehouseId: true,
        defaultLocation: true,
        defaultStockOrigin: true, defaultSourceSupplierId: true,
        supplierId: true,
        purchasedAt: true,
        warrantyUntil: true,
        defaultWarehouse: { select: { code: true } },
        familyId: true,
      },
    });
    if (!existing) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
    const dead = await deadResponse("InventoryItem", existing.id, organizationId);
    if (dead) return dead;
    // Una variante se llama «Familia · Opción» y hereda la categoría de su familia: solo el escritor de familias las cambia.
    if (existing.familyId && update.data.name !== undefined && update.data.name !== existing.name) {
      return jsonError("El nombre de una variante lo define su familia: cambialo desde la pestaña «Variantes».", 409);
    }
    const trace = await readInventoryTrace(body, { organizationId, currentWarehouseCode: existing.defaultWarehouse?.code, allow: { warehouse: "default" } }, { warehouse: "defaultWarehouseId", location: "defaultLocation" });
    if (!trace.ok) return jsonError(trace.error, trace.status);
    const { location: defaultLocation, ...traceRest } = trace.values;
    let auditBefore: Record<string, unknown> = existing;
    const inventory = await db.$transaction(async (tx) => {
      await lockInventoryItems(tx, organizationId, [existing.id]);
      const fresh = await tx.inventoryItem.findFirstOrThrow({ where: { id: existing.id, organizationId }, omit: { imageData: true } });
      auditBefore = fresh;
      const currentOrigin = { origin: fresh.defaultStockOrigin, supplierId: fresh.defaultSourceSupplierId };
      const origin = await validatedStockOrigin(tx, organizationId, body, "item", currentOrigin);
      if (origin.changed) assertOriginExpected(body, currentOrigin, origin.value, "item");
      // Categoría + espejo de texto: solo el helper único las escribe.
      const resolved = update.taxonomy ? await resolveInventoryCategory(tx, organizationId, update.taxonomy) : undefined;
      if (resolved === null) return null;
      if (existing.familyId && resolved && resolved.categoryId !== existing.categoryId) return "family-category" as const;
      return tx.inventoryItem.update({
        where: { id: existing.id },
        data: { ...update.data, ...(origin.changed ? { defaultStockOrigin: origin.value.origin, defaultSourceSupplierId: origin.value.supplierId } : {}), ...traceRest, ...(defaultLocation !== undefined ? { defaultLocation } : {}), ...(resolved ? categoryWriteData(resolved) : {}) },
        omit: { imageData: true },
      });
    });
    if (!inventory) return jsonError("La categoría no existe en esta empresa.", 404);
    if (inventory === "family-category") return jsonError("La categoría de una variante la define su familia: cambiala desde la pestaña «Variantes».", 409);
    const changes = auditChanges(auditBefore, inventory, INVENTORY_ITEM_FIELDS);
    if (changes) {
      await recordAudit({
        context: auth.context,
        action: "update",
        entity: "InventoryItem",
        entityId: inventory.id,
        summary: `Editó el ítem de inventario «${inventory.name}»`,
        detail: { changes },
      });
    }
    return Response.json({
      inventory: { ...inventory, imageUrl: inventoryImageUrl(inventory), imageUploaded: Boolean(inventory.imageMime) },
    });
  }

  if (kind === "unit") {
    const inventoryId = typeof body.inventoryId === "string" ? body.inventoryId : "";
    if (!inventoryId) return jsonError("Falta el ítem de inventario.", 400);
    const item = await db.inventoryItem.findFirst({
      where: { id: inventoryId, organizationId },
      select: { id: true, name: true },
    });
    if (!item) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
    if (await isComboItem(db, organizationId, item.id)) return jsonError("Un combo no tiene unidades propias: sus unidades son las de sus componentes.", 409);

    // Código: el que mandan (validado) o autogenerado con el prefijo del ítem.
    const requestedCode = readInventoryUnitCode(body.code);
    if (body.code !== undefined && !requestedCode) return jsonError(FIELD_MESSAGES.unitCode, 400);
    const status = body.status === undefined ? "AVAILABLE" : readInventoryUnitStatus(body.status);
    if (!status) return jsonError("Estado de unidad inválido.", 400);
    const purchaseCost = inventoryPriceValue(body.purchaseCost);
    if (purchaseCost === false) return jsonError("Ingresá un costo válido en guaraníes.", 400);
    const notes = typeof body.notes === "string" ? body.notes.trim() : "";
    if (notes.length > MAX_UNIT_NOTES) {
      return jsonError(`Las notas de la unidad no pueden superar los ${MAX_UNIT_NOTES} caracteres.`, 400);
    }

    const trace = await readInventoryTrace(body, { organizationId, allow: { warehouse: "unit", condition: true } });
    if (!trace.ok) return jsonError(trace.error, trace.status);

    let unit;
    try {
      unit = await db.$transaction(async (tx) => {
        await lockInventoryItems(tx, organizationId, [item.id]);
        const origin = await newPhysicalUnitOrigin(tx, organizationId, item.id, body);
        const code = requestedCode || (await nextInventoryUnitCode(tx, organizationId, item.name));
        // Toda unidad nace con depósito: el pedido, el del producto o el principal de la empresa.
        const placement = await resolveUnitPlacement(tx, organizationId, item.id, { warehouseId: trace.values.warehouseId, location: trace.values.location });
        const created = await tx.inventoryUnit.create({
          data: {
            id: randomUUID(),
            organizationId,
            inventoryId: item.id,
            code,
            status,
            ...origin,
            purchaseCost: purchaseCost ?? 0,
            notes: notes || null,
            warehouseId: placement.warehouseId,
            location: placement.location,
            conditionScore: trace.values.conditionScore ?? null,
            supplierId: trace.values.supplierId ?? null,
            purchasedAt: trace.values.purchasedAt ?? null,
            warrantyUntil: trace.values.warrantyUntil ?? null,
          },
        });
        await syncInventoryQuantity(tx, item.id);
        return created;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return jsonError(`El código «${requestedCode}» ya está en uso; probá con otro.`, 409);
      }
      throw error;
    }
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "InventoryUnit",
      entityId: unit.id,
      summary: `Agregó la unidad «${unit.code}» a «${item.name}»`,
      detail: { fields: auditPick(unit, ["code", "stockOrigin", "ownerSupplierId", "status", "purchaseCost", "notes", "warehouseId", "location", "conditionScore", "supplierId"]) },
    });
    return Response.json({ unit }, { status: 201 });
  }

  if (kind === "unit-update") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta la unidad.", 400);
    const existing = await db.inventoryUnit.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        inventoryId: true,
        code: true,
        stockOrigin: true, ownerSupplierId: true,
        status: true,
        purchaseCost: true,
        notes: true,
        warehouseId: true,
        location: true,
        conditionScore: true,
        supplierId: true,
        purchasedAt: true,
        warrantyUntil: true,
        warehouse: { select: { code: true } },
        inventory: { select: { name: true } },
      },
    });
    if (!existing) return jsonError("La unidad no existe en esta empresa.", 404);

    const trace = await readInventoryTrace(body, { organizationId, currentWarehouseCode: existing.warehouse?.code, allow: { warehouse: "unit", condition: true } });
    if (!trace.ok) return jsonError(trace.error, trace.status);
    const data: Prisma.InventoryUnitUncheckedUpdateInput = { ...trace.values };
    if (body.code !== undefined) {
      const code = readInventoryUnitCode(body.code);
      if (!inventoryUnitCodeValid(code)) return jsonError(FIELD_MESSAGES.unitCode, 400);
      data.code = code;
    }
    if (body.status !== undefined) {
      const status = readInventoryUnitStatus(body.status);
      if (!status) return jsonError("Estado de unidad inválido.", 400);
      data.status = status;
    }
    if (body.purchaseCost !== undefined) {
      const cost = inventoryPriceValue(body.purchaseCost);
      if (cost === false) return jsonError("Ingresá un costo válido en guaraníes.", 400);
      if (cost !== null) data.purchaseCost = cost;
    }
    if (body.notes !== undefined) {
      if (typeof body.notes !== "string") return jsonError("Las notas de la unidad no son válidas.", 400);
      const notes = body.notes.trim();
      if (notes.length > MAX_UNIT_NOTES) {
        return jsonError(`Las notas de la unidad no pueden superar los ${MAX_UNIT_NOTES} caracteres.`, 400);
      }
      data.notes = notes || null;
    }

    let unit;
    let auditBefore: Record<string, unknown> = existing;
    try {
      unit = await db.$transaction(async (tx) => {
        await lockInventoryItems(tx, organizationId, [existing.inventoryId]);
        const fresh = await tx.inventoryUnit.findFirstOrThrow({ where: { id: existing.id, organizationId } });
        auditBefore = fresh;
        const currentOrigin = { origin: fresh.stockOrigin, supplierId: fresh.ownerSupplierId };
        const origin = await validatedStockOrigin(tx, organizationId, body, "unit", currentOrigin);
        if (origin.changed) {
          assertOriginExpected(body, currentOrigin, origin.value, "unit");
          // Reservations identify a product pool, never a particular physical unit.
          // Reclassifying its owner while committed would rewrite that pool ambiguously.
          const committed = await tx.eventInventory.count({ where: { inventoryId: existing.inventoryId, ...committedAssignmentWhere(organizationId) } });
          if (committed > 0) throw new InventoryOriginError("No se puede cambiar el dueño de una unidad con reservas activas del producto. Liberá o completá esas reservas primero.", 409);
        }
        if (origin.changed) Object.assign(data, { stockOrigin: origin.value.origin, ownerSupplierId: origin.value.supplierId });
        await assertUnitsAvailableWithoutIncidents(tx, organizationId, [existing.id], data.status);
        const updated = await tx.inventoryUnit.update({ where: { id: existing.id }, data: { ...data, ...(data.status === "AVAILABLE" ? { incidentCycle: { increment: 1 } } : {}) } });
        // Cambiar el estado cambia la cantidad activa del ítem (issue #112).
        if (data.status !== undefined) await syncInventoryQuantity(tx, existing.inventoryId);
        return updated;
      });
    } catch (error) {
      if (error instanceof InventoryUnitIncidentConflict) return jsonError(error.message, 409);
      if (isUniqueConstraintError(error)) return jsonError("Ese código ya está en uso; probá con otro.", 409);
      throw error;
    }
    const changes = auditChanges(auditBefore, unit, ["code", "stockOrigin", "ownerSupplierId", "status", "purchaseCost", "notes", "warehouseId", "location", "conditionScore", "supplierId", "purchasedAt", "warrantyUntil"]);
    if (changes) {
      await recordAudit({
        context: auth.context,
        action: "update",
        entity: "InventoryUnit",
        entityId: unit.id,
        summary: `Actualizó la unidad «${unit.code}» de «${existing.inventory.name}»`,
        detail: { changes },
      });
    }
    return Response.json({ unit });
  }

  if (kind === "purchase") {
    // «Registrar compra»: unidades nuevas con proveedor, fecha, costo por unidad, garantía y depósito.
    const inventoryId = typeof body.inventoryId === "string" ? body.inventoryId : "";
    if (!inventoryId) return jsonError("Falta el ítem de inventario.", 400);
    const item = await db.inventoryItem.findFirst({ where: { id: inventoryId, organizationId }, select: { id: true, name: true } });
    if (!item) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
    if (await isComboItem(db, organizationId, item.id)) return jsonError("Un combo no tiene unidades propias: sus unidades son las de sus componentes.", 409);
    const dead = await deadResponse("InventoryItem", item.id, organizationId);
    if (dead) return dead;
    const quantity = typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) return jsonError("La cantidad comprada debe ser un entero de 1 a 500.", 400);
    const unitCost = inventoryPriceValue(body.unitCost);
    if (unitCost === false) return jsonError("Ingresá un costo válido en guaraníes.", 400);
    const trace = await readInventoryTrace(body, { organizationId, allow: { warehouse: "unit", condition: true } });
    if (!trace.ok) return jsonError(trace.error, trace.status);
    let created: { quantity: number };
    try {
      created = await db.$transaction(async (tx) => {
        // Más unidades = más capacidad; el lock del ítem serializa con las confirmaciones en curso.
        await lockInventoryItems(tx, organizationId, [item.id]);
        await createInventoryUnits(tx, {
          organizationId,
          inventoryId: item.id,
          name: item.name,
          quantity,
          stockOrigin: "OWNED", ownerSupplierId: null,
          purchaseCost: unitCost ?? 0,
          warehouseId: trace.values.warehouseId,
          location: trace.values.location,
          conditionScore: trace.values.conditionScore,
          supplierId: trace.values.supplierId,
          purchasedAt: trace.values.purchasedAt,
          warrantyUntil: trace.values.warrantyUntil,
        });
        return tx.inventoryItem.findFirstOrThrow({ where: { id: item.id }, select: { quantity: true } });
      });
    } catch (error) {
      // Colisión de código de unidad (otra compra o alta en curso): se reintenta, no es un error del servidor.
      if (isUniqueConstraintError(error)) return jsonError("Un código de unidad ya está en uso; reintentá la compra.", 409);
      throw error;
    }
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "InventoryItem",
      entityId: item.id,
      summary: `Registró la compra de ${quantity} unidad${quantity === 1 ? "" : "es"} de «${item.name}»`,
      detail: { fields: { cantidad: quantity, costoPorUnidad: unitCost ?? 0, proveedor: trace.values.supplierId ?? null, depósito: trace.values.warehouseId ?? null } },
    });
    return Response.json({ ok: true, added: quantity, quantity: created.quantity }, { status: 201 });
  }

  if (kind === "prices") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta el ítem de inventario.", 400);
    const prices = readInventoryPriceValues(body);
    if (!prices.ok) return jsonError(prices.error, 400);
    // Precio por días (escalones): ausente = no cambia; lista = reemplaza todos los escalones del producto.
    const tiers = body.priceTiers === undefined ? null : readAudienceTiers(body.priceTiers);
    if (tiers && !tiers.ok) return jsonError(tiers.error, 400);
    const existing = await db.inventoryItem.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        listPrice: true,
        listFromDays: true,
        listFromPrice: true,
        wholesalePrice: true,
        wholesaleFromDays: true,
        wholesaleFromPrice: true,
        minimumPrice: true,
      },
    });
    if (!existing) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
    // Los campos sin valor no cambian: es una edición parcial de precios.
    const saved = await db.$transaction(async (tx) => {
      const inventory = await tx.inventoryItem.update({
        where: { id: existing.id },
        data: {
          listPrice: prices.values.listPrice ?? undefined,
          wholesalePrice: prices.values.wholesalePrice ?? undefined,
          minimumPrice: prices.values.minimumPrice ?? undefined,
        },
      });
      // Si es una variante, el precio pasa a ser propio: «mismo precio para todas» no lo pisa.
      await markOwnPrice(tx, organizationId, [existing.id]);
      const tierChange = tiers?.ok ? await replacePriceTiers(tx, organizationId, existing.id, tiers.tiers) : null;
      const priceTiers = await tx.inventoryPriceTier.findMany({ where: { organizationId, inventoryId: existing.id }, orderBy: [{ audience: "asc" }, { fromDays: "asc" }], select: { audience: true, fromDays: true, mode: true, price: true } });
      return { inventory, tierChange, priceTiers };
    });
    const { inventory, tierChange, priceTiers } = saved;
    const priceFields = ["listPrice", "wholesalePrice", "minimumPrice"] as const;
    const changes = auditChanges(existing, inventory, priceFields);
    if (changes || tierChange?.changed) {
      await recordAudit({
        context: auth.context,
        action: "update",
        entity: "InventoryItem",
        entityId: inventory.id,
        summary: `Actualizó los precios de «${existing.name}»`,
        detail: { changes: { ...(changes ?? {}), ...(tierChange?.changed ? { priceTiers: { from: tierChange.before, to: priceTiers } } : {}) } },
      });
    }
    const warning = [inventoryPriceWarning({ ...inventory, listFromPrice: 0, wholesaleFromPrice: 0 }), tiers?.ok ? tierWarnings(inventory.listPrice, tiersForAudience(tiers.tiers, "RETAIL")) : null].filter(Boolean).join(" ") || null;
    return Response.json(warning ? { inventory: { ...inventory, priceTiers }, warning } : { inventory: { ...inventory, priceTiers } });
  }

  if (kind === "assignment") {
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const inventoryId = typeof body.inventoryId === "string" ? body.inventoryId : "";
    if (!eventId || !inventoryId) return jsonError("Elegí el evento y el ítem de inventario.", 400);
    const quantity = Number(body.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) return jsonError("La cantidad debe ser un entero mayor a cero.", 400);

    const event = await db.event.findFirst({ where: { id: eventId, organizationId }, select: EVENT_RANGE_SELECT });
    if (!event) return jsonError("El evento no existe en esta empresa.", 404);

    const startsAt = parseDate(body.startsAt) ?? event.setupAt ?? event.startsAt;
    const endsAt = parseDate(body.endsAt) ?? event.strikeAt ?? event.endsAt;
    if (!startsAt || !endsAt) return jsonError("Indicá el rango de fechas de la asignación (el evento todavía no tiene fechas).", 400);
    if (endsAt.getTime() < startsAt.getTime()) return jsonError("El fin del rango no puede ser anterior al inicio.", 400);

    // Lock del ítem + disponibilidad recalculada + escritura en una transacción:
    // dos asignaciones concurrentes no pueden pasar las dos.
    if (body.hold !== undefined && typeof body.hold !== "boolean") return jsonError("La retención tiene que ser sí o no.", 400);
    const committed = await commitInventoryAssignment({
      organizationId,
      eventId: event.id,
      inventoryId,
      quantity,
      startsAt,
      endsAt,
      ...(typeof body.hold === "boolean" ? { hold: body.hold } : {}),
    });
    if (!committed.ok) {
      if (committed.reason === "event-missing") return jsonError("El evento no existe en esta empresa.", 404);
      if (committed.reason === "item-missing") return jsonError("El ítem de inventario no existe en esta empresa.", 404);
      if (committed.reason === "blocked") {
        return jsonError(`«${committed.item.name}» está ${committed.item.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}: no se puede asignar.`, 409);
      }
      if (committed.reason === "conflict") return jsonError(committed.message, 409);
      return Response.json({ error: insufficientMessage(committed), availability: committed.availability }, { status: 409 });
    }
    const { assignment, previous: existing, item } = committed;
    const assignmentChanges = existing
      ? auditChanges(existing, assignment, ["quantity", "startsAt", "endsAt"])
      : null;
    if (!existing || assignmentChanges) {
      await recordAudit({
        context: auth.context,
        action: existing ? "update" : "create",
        entity: "EventInventory",
        entityId: assignment.id,
        summary: existing
          ? `Actualizó la asignación de «${item.name}» en «${event.name}»`
          : `Asignó «${item.name}» a «${event.name}» (${quantity} unidad${quantity === 1 ? "" : "es"})`,
        detail: existing
          ? { changes: assignmentChanges ?? {} }
          : { fields: { ...auditPick(assignment, ["quantity", "startsAt", "endsAt"]), eventId: event.id, inventoryId: item.id } },
      });
    }
    return Response.json({ assignment }, { status: 201 });
  }

  if (kind === "checkout") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta la asignación.", 400);
    const conditionOut = typeof body.conditionOut === "string" ? body.conditionOut.trim() : "";
    if (!conditionOut) return jsonError("Indicá el estado del equipo al retirar.", 400);
    if (conditionOut.length > 160) return jsonError("El estado al retirar no puede superar 160 caracteres.", 400);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (note.length > 400) return jsonError("La nota de la salida no puede superar 400 caracteres.", 400);
    const quantity = body.quantity === undefined || body.quantity === "" ? undefined : Number(body.quantity);
    if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) return jsonError("La cantidad a despachar debe ser un entero mayor a cero.", 400);
    if (await isComboAssignment({ organizationId, assignmentId: id })) {
      return jsonError("Un combo no sale ni vuelve como unidad: registrá el movimiento de cada componente.", 409);
    }
    const result = await dispatchAssignment({
      organizationId,
      assignmentId: id,
      ...(quantity !== undefined ? { quantity } : {}),
      at: parseDate(body.at) ?? new Date(),
      condition: conditionOut,
      note,
      actorId: auth.context.user.id,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    const { assignment, before } = result;
    await recordAudit({
      context: auth.context,
      action: "checkout",
      entity: "EventInventory",
      entityId: assignment.id,
      summary: `Despachó ${result.quantity} unidad${result.quantity === 1 ? "" : "es"} de «${before.inventory.name}» para «${before.event.name}»${result.remaining > 0 ? ` (faltan despachar ${result.remaining})` : ""}`,
      detail: { fields: { quantity: result.quantity, checkoutQuantity: assignment.checkoutQuantity, conditionOut, note: note || null } },
    });
    return Response.json({ assignment, deliveryNote: result.deliveryNote });
  }

  if (kind === "checkin") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta la asignación.", 400);
    const conditionIn = typeof body.conditionIn === "string" ? body.conditionIn.trim() : "";
    if (!conditionIn) return jsonError("Indicá el estado del equipo al devolver.", 400);
    if (conditionIn.length > 160) return jsonError("El estado al devolver no puede superar 160 caracteres.", 400);
    const damagedQuantity = Number(body.damagedQuantity ?? 0);
    const missingQuantity = Number(body.missingQuantity ?? 0);
    if (!Number.isInteger(damagedQuantity) || damagedQuantity < 0 || !Number.isInteger(missingQuantity) || missingQuantity < 0) {
      return jsonError("Dañadas y faltantes deben ser enteros mayores o iguales a cero.", 400);
    }
    const returnQuantity = body.quantity === undefined || body.quantity === "" ? undefined : Number(body.quantity);
    if (returnQuantity !== undefined && (!Number.isInteger(returnQuantity) || returnQuantity < 0)) {
      return jsonError("Las unidades devueltas deben ser un entero mayor o igual a cero.", 400);
    }
    const damageNotes = typeof body.damageNotes === "string" ? body.damageNotes.trim() : "";
    if (damageNotes.length > 400) return jsonError("Las notas de daños no pueden superar 400 caracteres.", 400);
    const unitIds = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
    if (await isComboAssignment({ organizationId, assignmentId: id })) {
      return jsonError("Un combo no sale ni vuelve como unidad: registrá el movimiento de cada componente.", 409);
    }
    const result = await returnAssignment({
      organizationId,
      assignmentId: id,
      ...(returnQuantity !== undefined ? { quantity: returnQuantity } : {}),
      damaged: damagedQuantity,
      missing: missingQuantity,
      damagedUnitIds: unitIds(body.damagedUnitIds),
      missingUnitIds: unitIds(body.missingUnitIds),
      at: parseDate(body.at) ?? new Date(),
      condition: conditionIn,
      notes: damageNotes,
      actorId: auth.context.user.id,
    });
    if (!result.ok) return jsonError(result.error, result.status);
    const { assignment, before } = result;
    const damages = damageSummary(result.damaged, result.missing);
    await recordAudit({
      context: auth.context,
      action: "checkin",
      entity: "EventInventory",
      entityId: assignment.id,
      summary: `Registró la devolución de ${result.returned} unidad${result.returned === 1 ? "" : "es"} de «${before.inventory.name}» de «${before.event.name}»${damages ? ` (${damages})` : ""}${result.pending > 0 ? `, faltan ${result.pending} por devolver` : ""}`,
      detail: {
        fields: {
          returned: result.returned,
          damaged: result.damaged,
          missing: result.missing,
          pending: result.pending,
          incidents: result.incidents.map((incident) => incident.id),
        },
      },
    });
    return Response.json({ assignment, incidents: result.incidents, pending: result.pending, closed: result.closed, deliveryNote: result.deliveryNote });
  }

  if (kind === "hold-confirm" || kind === "assignment-release") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta la asignación.", 400);
    const result =
      kind === "hold-confirm"
        ? await confirmHold({ organizationId, assignmentId: id })
        : await releaseAssignment({ organizationId, assignmentId: id });
    if (!result.ok) {
      if (result.reason === "not-found") return jsonError("La asignación no existe en esta empresa.", 404);
      if (result.reason === "released") return jsonError("La retención ya fue liberada: volvé a asignar el equipo.", 409);
      if (result.reason === "in-movement") return jsonError("El equipo está afuera: registrá la devolución antes de liberarlo.", 409);
      if (result.reason === "blocked") return jsonError(`«${result.item.name}» no se puede asignar en su estado actual.`, 409);
      if (result.reason === "conflict") return jsonError(result.message, 409);
      return Response.json({ error: insufficientMessage(result), availability: result.availability }, { status: 409 });
    }
    if (!result.unchanged) {
      await recordAudit({
        context: auth.context,
        action: "update",
        entity: "EventInventory",
        entityId: result.assignment.id,
        summary: kind === "hold-confirm" ? "Confirmó una retención de inventario" : "Liberó una asignación de inventario",
        detail: { fields: { kind, revalidated: result.revalidated } },
      });
    }
    return Response.json({ assignment: result.assignment });
  }

  if (kind === "assignment-delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta la asignación.", 400);
    const readAssignment = () =>
      db.eventInventory.findFirst({
        where: { id, event: { organizationId } },
        select: {
          id: true,
          quantity: true,
          startsAt: true,
          endsAt: true,
          checkedOut: true,
          checkedOutAt: true,
          checkedIn: true,
          checkedInAt: true,
          conditionOut: true,
          conditionIn: true,
          comboQuantity: true,
          releasedAt: true,
          holdExpiresAt: true,
          inventoryId: true,
          inventory: { select: { name: true } },
          event: { select: { name: true } },
        },
      });
    let existing = await readAssignment();
    if (!existing) return jsonError("La asignación no existe en esta empresa.", 404);
    if (existing.comboQuantity > 0) {
      // Un combo cuya retención venció ya no aporta: se descuenta antes de decidir.
      await settleComboContributions(organizationId, existing.inventoryId);
      existing = await readAssignment();
      if (!existing) return jsonError("La asignación no existe en esta empresa.", 404);
    }
    if (existing.comboQuantity > 0 && assignmentCountsAt(existing, new Date())) {
      return jsonError(`Hay unidades de «${existing.inventory.name}» que vienen de un combo del evento: quitá el combo en lugar del componente.`, 409);
    }
    if (await isComboItem(db, organizationId, existing.inventoryId)) {
      // Quitar un combo devuelve al stock exactamente sus componentes.
      const removed = await releaseComboAssignment({ organizationId, assignmentId: existing.id, remove: true });
      if (!removed.ok) {
        if (removed.reason === "in-movement") return jsonError(`Un componente de «${existing.inventory.name}» está afuera: registrá la devolución antes de quitarlo.`, 409);
        return jsonError("La asignación no existe en esta empresa.", 404);
      }
      await recordAudit({
        context: auth.context,
        action: "delete",
        entity: "EventInventory",
        entityId: existing.id,
        summary: `Quitó el combo «${existing.inventory.name}» de «${existing.event.name}» y liberó sus componentes`,
        detail: { before: auditPick(existing, ["quantity", "startsAt", "endsAt"]) },
      });
      return Response.json({ ok: true });
    }
    const isOut = Boolean(existing.checkedOutAt || existing.checkedOut);
    const isBack = Boolean(existing.checkedInAt || existing.checkedIn);
    if (isOut && !isBack) {
      return jsonError(`«${existing.inventory.name}» está afuera en «${existing.event.name}»: registrá la devolución antes de quitarlo.`, 409);
    }
    await db.eventInventory.delete({ where: { id: existing.id } });
    await recordAudit({
      context: auth.context,
      action: "delete",
      entity: "EventInventory",
      entityId: existing.id,
      summary: `Quitó «${existing.inventory.name}» de «${existing.event.name}»`,
      detail: {
        before: auditPick(existing, ["quantity", "startsAt", "endsAt", "checkedOutAt", "checkedInAt", "conditionOut", "conditionIn"]),
      },
    });
    return Response.json({ ok: true });
  }

  return jsonError("Operación de inventario desconocida.", 400);
  } catch (error) {
    if (activeBulkRunId) {
      const run = await db.bulkOperationRun.findUnique({ where: { id: activeBulkRunId }, select: { requestedIds: true } }).catch(() => null);
      const ids = Array.isArray(run?.requestedIds) ? run.requestedIds.filter((id): id is string => typeof id === "string") : [];
      const outcomes: BulkRowOutcome[] = ids.map(id => ({ id, status: "unknown", message: "La solicitud terminó sin confirmación; consultá el estado antes de reintentar." }));
      await finishBulkOperationRun({
        id: activeBulkRunId,
        status: "INCOMPLETE",
        outcomes,
        response: { payload: { runId: activeBulkRunId, status: "INCOMPLETE", outcomes, error: "La operación quedó sin confirmación." }, httpStatus: 500 },
      }).catch(() => undefined);
      return Response.json({ runId: activeBulkRunId, status: "INCOMPLETE", outcomes, error: `La operación quedó sin confirmación. Consultá el estado antes de reintentar. Operación: ${activeBulkRunId}.` }, { status: 500 });
    }
    if (error instanceof InventoryOriginError) return jsonError(error.message, error.status);
    throw error;
  }
}
