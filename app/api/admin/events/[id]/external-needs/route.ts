import { randomUUID } from "node:crypto";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";
import { readIdempotencyKey, withIdempotency } from "@/lib/server/idempotency";
import { recordAudit } from "@/lib/server/audit";
import { isJsonObject, jsonError, readJson } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DTO = {
  id: true, organizationId: true, eventId: true, inventoryId: true,
  requestedQuantity: true, startsAt: true, endsAt: true,
  preferredSupplierId: true, status: true, revision: true, notes: true,
  createdAt: true, updatedAt: true,
  inventory: { select: { id: true, name: true, sku: true } },
  preferredSupplier: { select: { id: true, name: true } },
} as const;
const fields = ["inventoryId", "requestedQuantity", "startsAt", "endsAt", "preferredSupplierId", "notes", "status"] as const;
type Fields = { inventoryId: string; requestedQuantity: number; startsAt: Date; endsAt: Date; preferredSupplierId: string | null; notes: string | null };

function parseFields(input: Record<string, unknown>, partial = false): { data?: Partial<Fields>; error?: string } {
  const data: Partial<Fields> = {};
  if (!partial || "inventoryId" in input) {
    if (typeof input.inventoryId !== "string" || !input.inventoryId.trim()) return { error: "Seleccioná un producto." };
    data.inventoryId = input.inventoryId.trim();
  }
  if (!partial || "requestedQuantity" in input) {
    if (!Number.isInteger(input.requestedQuantity) || (input.requestedQuantity as number) < 1 || (input.requestedQuantity as number) > 100000) return { error: "La cantidad debe ser un entero entre 1 y 100000." };
    data.requestedQuantity = input.requestedQuantity as number;
  }
  for (const field of ["startsAt", "endsAt"] as const) {
    if (!partial || field in input) {
      if (typeof input[field] !== "string" || !Number.isFinite(Date.parse(input[field] as string))) return { error: "Ingresá un rango de fechas válido." };
      data[field] = new Date(input[field] as string);
    }
  }
  if (!partial || "preferredSupplierId" in input) {
    if (input.preferredSupplierId !== undefined && input.preferredSupplierId !== null && (typeof input.preferredSupplierId !== "string" || !input.preferredSupplierId.trim())) return { error: "El tercero sugerido no es válido." };
    data.preferredSupplierId = typeof input.preferredSupplierId === "string" ? input.preferredSupplierId.trim() : null;
  }
  if (!partial || "notes" in input) {
    if (input.notes !== undefined && input.notes !== null && typeof input.notes !== "string") return { error: "La nota no es válida." };
    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (notes.length > 1000) return { error: "La nota no puede superar 1000 caracteres." };
    data.notes = notes || null;
  }
  if (data.startsAt && data.endsAt && data.startsAt >= data.endsAt) return { error: "El fin del rango debe ser posterior al inicio." };
  return { data };
}

async function hasEvent(organizationId: string, eventId: string) {
  return db.event.findFirst({ where: { id: eventId, organizationId }, select: { id: true } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id: eventId } = await params;
  if (!await hasEvent(auth.context.organizationId, eventId)) return jsonError("Event not found.", 404);
  const needs = await db.eventExternalNeed.findMany({
    where: { organizationId: auth.context.organizationId, eventId },
    orderBy: [{ status: "asc" }, { startsAt: "asc" }, { createdAt: "asc" }],
    select: DTO,
  });
  return Response.json({ needs: needs.map(({ organizationId: _tenant, ...need }) => need), coverage: "none" });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const inventoryAuth = await requireAdminContext("inventory.write");
  if (!inventoryAuth.ok) return inventoryAuth.response;
  const { id: eventId } = await params;
  const body = await readJson(request);
  if (!isJsonObject(body)) return jsonError("Datos de necesidad inválidos.", 400);
  const key = readIdempotencyKey(request, body);
  if (!key) return jsonError("Enviá una clave de idempotencia para registrar la necesidad.", 400);
  const parsed = parseFields(body);
  if (parsed.error || !parsed.data) return jsonError(parsed.error ?? "Datos inválidos.", 400);
  const data = parsed.data as Fields;
  try {
    return await withIdempotency({ request, organizationId: auth.context.organizationId, scope: "event-external-needs:POST", body }, async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} AND "organizationId" = ${auth.context.organizationId} FOR UPDATE`;
      const event = await tx.event.findFirst({ where: { id: eventId, organizationId: auth.context.organizationId }, select: { id: true } });
      if (!event) return jsonError("Event not found.", 404);
      const item = await tx.inventoryItem.findFirst({ where: { id: data.inventoryId, organizationId: auth.context.organizationId }, select: { id: true } });
      if (!item) return jsonError("Inventory item not found.", 404);
      if (data.preferredSupplierId && !await tx.supplier.findFirst({ where: { id: data.preferredSupplierId, organizationId: auth.context.organizationId }, select: { id: true } })) return jsonError("Supplier not found.", 404);
      const id = randomUUID();
      const need = await tx.eventExternalNeed.create({ data: { id, organizationId: auth.context.organizationId, eventId, ...data, createdById: auth.context.user.id, updatedById: auth.context.user.id }, select: DTO });
      await recordAudit({ context: auth.context, action: "create", entity: "EventExternalNeed", entityId: id, summary: `Registró una necesidad externa pendiente para el evento ${eventId}`, detail: { fields: { inventoryId: data.inventoryId, requestedQuantity: data.requestedQuantity, startsAt: data.startsAt, endsAt: data.endsAt, preferredSupplierId: data.preferredSupplierId, status: "OPEN" } } }, tx);
      return { status: 201, body: { need } };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return jsonError("Ya existe una necesidad abierta para ese producto y rango.", 409);
    throw error;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("events.write");
  if (!auth.ok) return auth.response;
  const inventoryAuth = await requireAdminContext("inventory.write");
  if (!inventoryAuth.ok) return inventoryAuth.response;
  const { id: eventId } = await params;
  const body = await readJson(request);
  if (!isJsonObject(body) || typeof body.id !== "string" || !Number.isInteger(body.expectedRevision) || !isJsonObject(body.changes)) return jsonError("Indicá la necesidad, expectedRevision y changes.", 400);
  const key = readIdempotencyKey(request, body);
  if (!key) return jsonError("Enviá una clave de idempotencia para actualizar la necesidad.", 400);
  const changesInput = body.changes;
  const allowed = new Set([...fields]);
  if (Object.keys(changesInput).some(key => !allowed.has(key as typeof fields[number]))) return jsonError("El cambio incluye un campo no permitido.", 400);
  const parsed = parseFields(changesInput, true);
  if (parsed.error || !parsed.data) return jsonError(parsed.error ?? "Datos inválidos.", 400);
  if ("status" in changesInput && changesInput.status !== "CANCELLED") return jsonError("La única transición disponible en Fase A es cancelar.", 400);
  const patch = { ...parsed.data, ...(changesInput.status === "CANCELLED" ? { status: "CANCELLED" as const } : {}) };
  try {
    return await withIdempotency({ request, organizationId: auth.context.organizationId, scope: "event-external-needs:PATCH", body }, async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} AND "organizationId" = ${auth.context.organizationId} FOR UPDATE`;
      const current = await tx.eventExternalNeed.findFirst({ where: { id: body.id as string, eventId, organizationId: auth.context.organizationId } });
      if (!current) return jsonError("External need not found.", 404);
      if (current.status !== "OPEN") return jsonError("La necesidad ya está cancelada.", 409);
      if (current.revision !== body.expectedRevision) return jsonError("La necesidad cambió. Actualizá la ficha antes de guardar.", 409);
      if (patch.inventoryId && !await tx.inventoryItem.findFirst({ where: { id: patch.inventoryId, organizationId: auth.context.organizationId }, select: { id: true } })) return jsonError("Inventory item not found.", 404);
      if (patch.preferredSupplierId && !await tx.supplier.findFirst({ where: { id: patch.preferredSupplierId, organizationId: auth.context.organizationId }, select: { id: true } })) return jsonError("Supplier not found.", 404);
      const next = { ...current, ...patch };
      if (next.startsAt >= next.endsAt) return jsonError("El fin del rango debe ser posterior al inicio.", 400);
      const updated = await tx.eventExternalNeed.update({ where: { id: current.id }, data: { ...patch, revision: { increment: 1 }, updatedById: auth.context.user.id }, select: DTO });
      await recordAudit({ context: auth.context, action: patch.status ? "status" : "update", entity: "EventExternalNeed", entityId: current.id, summary: patch.status ? `Canceló una necesidad externa del evento ${eventId}` : `Actualizó una necesidad externa del evento ${eventId}`, detail: { changes: Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { from: current[key as keyof typeof current] ?? null, to: value }])) } }, tx);
      return { status: 200, body: { need: updated } };
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return jsonError("Ya existe una necesidad abierta para ese producto y rango.", 409);
    throw error;
  }
}
