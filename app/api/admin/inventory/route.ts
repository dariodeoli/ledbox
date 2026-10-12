import { randomUUID } from "node:crypto";
import { readBulkChanges, readBulkSelection } from "@/lib/inventory-bulk";
import type { InventoryKind, InventoryStatus, Prisma } from "@prisma/client";
import { damageSummary, inventoryStatusLabel } from "@/lib/admin-format";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { inventoryImageUrl, readInventoryImageUrl } from "@/lib/server/inventory-images";
import {
  MAX_UNIT_NOTES,
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
  assignmentIsActiveNow,
  assignmentRange,
  availabilityForRange,
  buildAvailability,
  findSubstitutes,
  loadAssignments,
  maintenanceUnits,
  parseDate,
  rangeLabel,
} from "@/lib/server/inventory-availability";

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
  "visibleOnWeb",
  "imageUrl",
] as const;

type InventoryItemUpdate = Partial<{
  name: string;
  category: string;
  kind: InventoryKind;
  status: InventoryStatus;
  replacementCost: number;
  dailyCost: number;
  notes: string | null;
  visibleOnWeb: boolean;
  imageUrl: string | null;
}>;

/** Datos del ítem (issue #111) normalizados: `undefined` = no tocar el campo. */
function readInventoryItemUpdate(body: Record<string, unknown>):
  | { ok: true; data: InventoryItemUpdate }
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
  if (body.category !== undefined) {
    if (typeof body.category !== "string") return { ok: false, error: "La categoría no es válida." };
    data.category = body.category.trim().slice(0, 80) || "General";
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
  if (body.visibleOnWeb !== undefined) {
    if (typeof body.visibleOnWeb !== "boolean") return { ok: false, error: "La visibilidad web tiene que ser sí o no." };
    data.visibleOnWeb = body.visibleOnWeb;
  }
  if (body.imageUrl !== undefined) {
    const imageUrl = readInventoryImageUrl(body.imageUrl);
    if (imageUrl === false) return { ok: false, error: FIELD_MESSAGES.image };
    data.imageUrl = imageUrl;
  }
  return { ok: true, data };
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const url = new URL(request.url);
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
    const availability = await availabilityForRange({
      organizationId,
      item: { ...item, maintenance: maintenanceUnits(item) },
      startsAt,
      endsAt,
      excludeId,
    });
    const substitutes = await findSubstitutes({
      organizationId,
      item: { id: item.id, category: item.category, status: item.status },
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
            event: { select: EVENT_RANGE_SELECT },
          },
        })
      : [];
    const now = new Date();
    const inventory = items.map((item) => {
      const committedNow = rows
        .filter((row) => row.inventoryId === item.id && assignmentIsActiveNow(row, now))
        .reduce((sum, row) => sum + row.quantity, 0);
      const blocked = BLOCKED_INVENTORY_STATUSES.includes(item.status);
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
    return Response.json({ inventory });
  }

  // Sin el binario de la foto (issue #109): la lista solo necesita la URL
  // efectiva. Con las unidades (issue #112) y el conteo de mantenimiento.
  const items = await db.inventoryItem.findMany({
    where: { organizationId },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    take: 300,
    omit: { imageData: true },
    include: {
      units: { orderBy: { code: "asc" } },
      _count: { select: MAINTENANCE_UNITS_SELECT },
    },
  });
  const assignments = items.length
    ? await db.eventInventory.findMany({
        where: { inventoryId: { in: items.map((item) => item.id) }, event: { organizationId } },
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        take: 1000,
        include: { event: { select: EVENT_RANGE_SELECT } },
      })
    : [];

  // Rango opcional de la vista por rango (mismo cálculo compartido que la
  // disponibilidad puntual). Si falta o es inválido, solo se devuelve "hoy".
  const rangeStart = parseDate(url.searchParams.get("startsAt"));
  const rangeEnd = parseDate(url.searchParams.get("endsAt"));
  const range = rangeStart && rangeEnd && rangeEnd.getTime() >= rangeStart.getTime() ? { start: rangeStart, end: rangeEnd } : null;

  const now = new Date();
  const inventory = items.map((item) => {
    // La URL efectiva (issue #109): la manual manda; si no, la foto subida.
    const { imageMime: _imageMime, _count, ...row } = item;
    const rows = assignments.filter((assignment) => assignment.inventoryId === item.id);
    const activeNow = rows.filter((row) => assignmentIsActiveNow(row, now));
    const committedNow = activeNow.reduce((sum, row) => sum + row.quantity, 0);
    const blocked = BLOCKED_INVENTORY_STATUSES.includes(item.status);
    const maintenanceNow = maintenanceUnits(item);
    const usable = Math.max(0, item.quantity - maintenanceNow);
    const rangeAvailability = range
      ? buildAvailability({ ...item, maintenance: maintenanceNow }, rows, range.start, range.end)
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

  return Response.json({ inventory });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("inventory.write");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = (await readJson(request)) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";

  if (kind === "item-archive" || kind === "item-restore") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta el producto.", 400);
    const existing = await db.inventoryItem.findFirst({ where: { id, organizationId }, select: { id: true, name: true, archivedAt: true } });
    if (!existing) return jsonError("El producto no existe en esta empresa.", 404);
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
    if (isUnits) {
      const status = changes.status === undefined ? undefined : readInventoryUnitStatus(changes.status);
      if (changes.status !== undefined && !status) return jsonError("Estado de unidad inválido. No se aplicó ningún cambio.", 400);
      if (typeof changes.notes === "string" && changes.notes.length > MAX_UNIT_NOTES) return jsonError("Las notas de la unidad no pueden superar 400 caracteres.", 400);
      data = { ...changes, ...(status ? { status } : {}) };
      if (typeof data.notes === "string") data.notes = data.notes.trim() || null;
    } else {
      const item = readInventoryItemUpdate(changes);
      const prices = readInventoryPriceValues(changes);
      if (!item.ok) return jsonError(item.error, 400);
      if (!prices.ok) return jsonError(prices.error, 400);
      data = { ...item.data, ...Object.fromEntries(Object.entries(prices.values).filter(([, value]) => value !== null)) };
    }
    // Selección completa scopeada y guardado atómico: cero cambios ante un ID ajeno/inexistente.
    const result = await db.$transaction(async tx => {
      const before = isUnits
        ? await tx.inventoryUnit.findMany({ where: { id: { in: ids }, organizationId } })
        : await tx.inventoryItem.findMany({ where: { id: { in: ids }, organizationId }, omit: { imageData: true } });
      if (before.length !== ids.length) return null;
      if (isUnits) {
        await tx.inventoryUnit.updateMany({ where: { id: { in: ids }, organizationId }, data: data as Prisma.InventoryUnitUpdateManyMutationInput });
        if (data.status !== undefined) for (const id of new Set(before.map(row => (row as { inventoryId: string }).inventoryId))) await syncInventoryQuantity(tx, id);
      } else {
        await tx.inventoryItem.updateMany({ where: { id: { in: ids }, organizationId }, data: data as Prisma.InventoryItemUpdateManyMutationInput });
      }
      return before;
    });
    if (!result) return jsonError("La selección contiene registros que no existen en esta empresa. No se aplicó ningún cambio.", 404);
    for (const row of result) {
      const audit = auditChanges(row, { ...row, ...data }, Object.keys(data));
      if (audit) await recordAudit({ context: auth.context, action: "update", entity: isUnits ? "InventoryUnit" : "InventoryItem", entityId: row.id, summary: "Edición masiva de inventario sobre selección explícita", detail: { changes: audit } });
    }
    const warnings = isUnits ? [] : result.flatMap(row => {
      const merged = { ...row, ...data } as typeof row & { listPrice: number; listFromPrice: number; wholesalePrice: number; wholesaleFromPrice: number; minimumPrice: number };
      const warning = inventoryPriceWarning(merged);
      return warning ? [`${(row as { name: string }).name}: ${warning}`] : [];
    });
    return Response.json({ updatedIds: ids, updated: ids.length, warnings });
  }

  if (kind === "status") {
    const id = typeof body.id === "string" ? body.id : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!id) return jsonError("Falta el ítem de inventario.", 400);
    if (!(INVENTORY_STATUSES as readonly string[]).includes(status)) return jsonError("Estado de inventario inválido.", 400);
    const existing = await db.inventoryItem.findFirst({ where: { id, organizationId }, select: { id: true, name: true, status: true } });
    if (!existing) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
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
        kind: true,
        status: true,
        replacementCost: true,
        dailyCost: true,
        notes: true,
        visibleOnWeb: true,
        imageUrl: true,
      },
    });
    if (!existing) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
    const inventory = await db.inventoryItem.update({
      where: { id: existing.id },
      data: update.data,
      omit: { imageData: true },
    });
    const changes = auditChanges(existing, inventory, INVENTORY_ITEM_FIELDS);
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

    let unit;
    try {
      unit = await db.$transaction(async (tx) => {
        const code = requestedCode || (await nextInventoryUnitCode(tx, organizationId, item.name));
        const created = await tx.inventoryUnit.create({
          data: {
            id: randomUUID(),
            organizationId,
            inventoryId: item.id,
            code,
            status,
            purchaseCost: purchaseCost ?? 0,
            notes: notes || null,
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
      detail: { fields: auditPick(unit, ["code", "status", "purchaseCost", "notes"]) },
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
        status: true,
        purchaseCost: true,
        notes: true,
        inventory: { select: { name: true } },
      },
    });
    if (!existing) return jsonError("La unidad no existe en esta empresa.", 404);

    const data: Prisma.InventoryUnitUpdateInput = {};
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
    try {
      unit = await db.$transaction(async (tx) => {
        const updated = await tx.inventoryUnit.update({ where: { id: existing.id }, data });
        // Cambiar el estado cambia la cantidad activa del ítem (issue #112).
        if (data.status !== undefined) await syncInventoryQuantity(tx, existing.inventoryId);
        return updated;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return jsonError("Ese código ya está en uso; probá con otro.", 409);
      throw error;
    }
    const changes = auditChanges(existing, unit, ["code", "status", "purchaseCost", "notes"]);
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

  if (kind === "prices") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta el ítem de inventario.", 400);
    const prices = readInventoryPriceValues(body);
    if (!prices.ok) return jsonError(prices.error, 400);
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
    const inventory = await db.inventoryItem.update({
      where: { id: existing.id },
      data: {
        listPrice: prices.values.listPrice ?? undefined,
        listFromDays: prices.values.listFromDays ?? undefined,
        listFromPrice: prices.values.listFromPrice ?? undefined,
        wholesalePrice: prices.values.wholesalePrice ?? undefined,
        wholesaleFromDays: prices.values.wholesaleFromDays ?? undefined,
        wholesaleFromPrice: prices.values.wholesaleFromPrice ?? undefined,
        minimumPrice: prices.values.minimumPrice ?? undefined,
      },
    });
    const priceFields = [
      "listPrice",
      "listFromDays",
      "listFromPrice",
      "wholesalePrice",
      "wholesaleFromDays",
      "wholesaleFromPrice",
      "minimumPrice",
    ] as const;
    const changes = auditChanges(existing, inventory, priceFields);
    if (changes) {
      await recordAudit({
        context: auth.context,
        action: "update",
        entity: "InventoryItem",
        entityId: inventory.id,
        summary: `Actualizó los precios de «${existing.name}»`,
        detail: { changes },
      });
    }
    const warning = inventoryPriceWarning(inventory);
    return Response.json(warning ? { inventory, warning } : { inventory });
  }

  if (kind === "assignment") {
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const inventoryId = typeof body.inventoryId === "string" ? body.inventoryId : "";
    if (!eventId || !inventoryId) return jsonError("Elegí el evento y el ítem de inventario.", 400);
    const [event, item] = await Promise.all([
      db.event.findFirst({ where: { id: eventId, organizationId }, select: EVENT_RANGE_SELECT }),
      db.inventoryItem.findFirst({
        where: { id: inventoryId, organizationId },
        omit: { imageData: true },
        include: { _count: { select: MAINTENANCE_UNITS_SELECT } },
      }),
    ]);
    if (!event) return jsonError("El evento no existe en esta empresa.", 404);
    if (!item) return jsonError("El ítem de inventario no existe en esta empresa.", 404);

    const quantity = Number(body.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) return jsonError("La cantidad debe ser un entero mayor a cero.", 400);

    const startsAt = parseDate(body.startsAt) ?? event.setupAt ?? event.startsAt;
    const endsAt = parseDate(body.endsAt) ?? event.strikeAt ?? event.endsAt;
    if (!startsAt || !endsAt) return jsonError("Indicá el rango de fechas de la asignación (el evento todavía no tiene fechas).", 400);
    if (endsAt.getTime() < startsAt.getTime()) return jsonError("El fin del rango no puede ser anterior al inicio.", 400);

    if (BLOCKED_INVENTORY_STATUSES.includes(item.status)) {
      return jsonError(`«${item.name}» está ${item.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}: no se puede asignar.`, 409);
    }

    const existing = await db.eventInventory.findUnique({
      where: { eventId_inventoryId: { eventId: event.id, inventoryId: item.id } },
      select: { id: true, quantity: true, startsAt: true, endsAt: true },
    });
    const rows = await loadAssignments(item.id, organizationId, existing?.id);
    const availability = buildAvailability({ ...item, maintenance: maintenanceUnits(item) }, rows, startsAt, endsAt);
    if (quantity > availability.available) {
      const detail = availability.conflicts.length
        ? ` En el rango: ${availability.conflicts.map((conflict) => `${conflict.eventName} (${conflict.quantity})`).join(", ")}.`
        : "";
      return Response.json(
        {
          error: `Sin disponibilidad: pediste ${quantity} y hay ${availability.available} de ${availability.total} libres entre ${rangeLabel(startsAt, endsAt)}.${detail}`,
          availability,
        },
        { status: 409 },
      );
    }

    const assignment = await db.eventInventory.upsert({
      where: { eventId_inventoryId: { eventId: event.id, inventoryId: item.id } },
      create: { id: randomUUID(), eventId: event.id, inventoryId: item.id, quantity, startsAt, endsAt },
      update: { quantity, startsAt, endsAt },
    });
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
    const existing = await db.eventInventory.findFirst({
      where: { id, event: { organizationId } },
      select: {
        id: true,
        checkedOut: true,
        checkedOutAt: true,
        conditionOut: true,
        inventory: { select: { name: true } },
        event: { select: { name: true } },
      },
    });
    if (!existing) return jsonError("La asignación no existe en esta empresa.", 404);
    if (existing.checkedOutAt || existing.checkedOut) return jsonError("La salida ya está registrada para esta asignación.", 409);
    const at = parseDate(body.at) ?? new Date();
    const assignment = await db.eventInventory.update({
      where: { id: existing.id },
      data: { checkedOut: true, checkedOutAt: at, conditionOut },
    });
    const changes = auditChanges(existing, assignment, ["checkedOut", "checkedOutAt", "conditionOut"]);
    if (changes) {
      await recordAudit({
        context: auth.context,
        action: "checkout",
        entity: "EventInventory",
        entityId: assignment.id,
        summary: `Registró la salida de «${existing.inventory.name}» para «${existing.event.name}»`,
        detail: { changes },
      });
    }
    return Response.json({ assignment });
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
    const damageNotes = typeof body.damageNotes === "string" ? body.damageNotes.trim() : "";
    if (damageNotes.length > 400) return jsonError("Las notas de daños no pueden superar 400 caracteres.", 400);

    const existing = await db.eventInventory.findFirst({
      where: { id, event: { organizationId } },
      select: {
        id: true,
        quantity: true,
        checkedOut: true,
        checkedOutAt: true,
        checkedIn: true,
        checkedInAt: true,
        conditionIn: true,
        damagedQuantity: true,
        missingQuantity: true,
        damageNotes: true,
        inventory: { select: { name: true } },
        event: { select: { name: true } },
      },
    });
    if (!existing) return jsonError("La asignación no existe en esta empresa.", 404);
    if (!existing.checkedOutAt && !existing.checkedOut) return jsonError("Registrá primero la salida del equipo.", 409);
    if (existing.checkedInAt || existing.checkedIn) return jsonError("La devolución ya está registrada para esta asignación.", 409);
    if (damagedQuantity + missingQuantity > existing.quantity) {
      return jsonError(`Dañadas y faltantes no pueden superar las ${existing.quantity} unidades asignadas.`, 400);
    }
    const at = parseDate(body.at) ?? new Date();
    const assignment = await db.eventInventory.update({
      where: { id: existing.id },
      data: { checkedIn: true, checkedInAt: at, conditionIn, damagedQuantity, missingQuantity, damageNotes: damageNotes || null },
    });
    const changes = auditChanges(
      existing,
      assignment,
      ["checkedIn", "checkedInAt", "conditionIn", "damagedQuantity", "missingQuantity", "damageNotes"],
    );
    if (changes) {
      const damages = damageSummary(assignment.damagedQuantity, assignment.missingQuantity);
      await recordAudit({
        context: auth.context,
        action: "checkin",
        entity: "EventInventory",
        entityId: assignment.id,
        summary: `Registró la devolución de «${existing.inventory.name}» de «${existing.event.name}»${damages ? ` (${damages})` : ""}`,
        detail: { changes },
      });
    }
    return Response.json({ assignment });
  }

  if (kind === "assignment-delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonError("Falta la asignación.", 400);
    const existing = await db.eventInventory.findFirst({
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
        inventory: { select: { name: true } },
        event: { select: { name: true } },
      },
    });
    if (!existing) return jsonError("La asignación no existe en esta empresa.", 404);
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
}
