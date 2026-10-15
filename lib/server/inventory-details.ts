import { db } from "@/lib/server/db";
import { FIELD_MESSAGES, readConditionScore, readInventoryLocation } from "@/lib/field-rules";
import { dayStart, isValidDayKey } from "@/lib/server/notifications";
import { findUsableWarehouse } from "@/lib/server/inventory-warehouses";

/**
 * Lectura y validación de los datos de trazabilidad de un producto o una unidad (rediseño E1):
 * depósito, ubicación, condición 1 a 10, proveedor, fecha de compra y garantía. Todo `id` recibido
 * se valida contra la empresa activa: uno ajeno responde 404, nunca se escribe.
 *
 * `undefined` = no tocar el campo; `null` (o vacío) = quitarlo.
 */

export type TraceFailure = { ok: false; status: 400 | 404; error: string };

export type ReadTraceOptions = {
  organizationId: string;
  /** Código del depósito actual de la unidad: la ubicación «D1 E3 B2» se interpreta contra él. */
  currentWarehouseCode?: string | null;
  /** Campos que el llamador admite (el producto no lleva condición). */
  allow: { warehouse?: "unit" | "default"; condition?: boolean };
};

export type TraceValues = {
  supplierId?: string | null;
  purchasedAt?: Date | null;
  warrantyUntil?: Date | null;
  warehouseId?: string;
  defaultWarehouseId?: string | null;
  location?: string | null;
  conditionScore?: number | null;
};

const failure = (status: TraceFailure["status"], error: string): TraceFailure => ({ ok: false, status, error });

function readDay(raw: unknown): Date | null | false {
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return false;
  const key = raw.trim().slice(0, 10);
  return isValidDayKey(key) ? dayStart(key) : false;
}

export async function readInventoryTrace(
  body: Record<string, unknown>,
  options: ReadTraceOptions,
  keys: { warehouse: string; location: string } = { warehouse: "warehouseId", location: "location" },
): Promise<{ ok: true; values: TraceValues } | TraceFailure> {
  const { organizationId } = options;
  const values: TraceValues = {};

  if (body.supplierId !== undefined) {
    if (body.supplierId === null || body.supplierId === "") values.supplierId = null;
    else if (typeof body.supplierId !== "string") return failure(400, "El proveedor no es válido.");
    else {
      const supplier = await db.supplier.findFirst({ where: { id: body.supplierId, organizationId }, select: { id: true } });
      if (!supplier) return failure(404, "El proveedor no existe en esta empresa.");
      values.supplierId = supplier.id;
    }
  }
  for (const field of ["purchasedAt", "warrantyUntil"] as const) {
    if (body[field] === undefined) continue;
    const day = readDay(body[field]);
    if (day === false) return failure(400, "La fecha tiene que ser un día válido (AAAA-MM-DD).");
    values[field] = day;
  }
  if (options.allow.condition && body.conditionScore !== undefined) {
    const score = readConditionScore(body.conditionScore);
    if (score === false) return failure(400, FIELD_MESSAGES.condition);
    values.conditionScore = score;
  }

  let warehouseCode = options.currentWarehouseCode ?? null;
  const warehouseRaw = body[keys.warehouse];
  if (options.allow.warehouse && warehouseRaw !== undefined) {
    if (warehouseRaw === null || warehouseRaw === "") {
      if (options.allow.warehouse === "unit") return failure(400, "Elegí el depósito de la unidad.");
      values.defaultWarehouseId = null;
      warehouseCode = null;
    } else if (typeof warehouseRaw !== "string") {
      return failure(400, "El depósito no es válido.");
    } else {
      const warehouse = await findUsableWarehouse(db, organizationId, warehouseRaw);
      if (!warehouse) return failure(404, "El depósito no existe en esta empresa.");
      if (options.allow.warehouse === "unit") values.warehouseId = warehouse.id;
      else values.defaultWarehouseId = warehouse.id;
      warehouseCode = warehouse.code;
    }
  }
  const locationRaw = body[keys.location];
  if (options.allow.warehouse && locationRaw !== undefined) {
    const location = readInventoryLocation(locationRaw, warehouseCode);
    if (location === false) return failure(400, FIELD_MESSAGES.location);
    values.location = location;
  }
  return { ok: true, values };
}
