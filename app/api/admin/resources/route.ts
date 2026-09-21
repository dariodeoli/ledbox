import { randomUUID } from "node:crypto";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import { dayStart, isValidDayKey } from "@/lib/server/notifications";
import { PROMOTER_AVAILABILITIES, type PromoterAvailabilityValue } from "@/lib/admin-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Límite de la nota de disponibilidad (mismo criterio que las notas cortas del panel). */
const MAX_AVAILABILITY_NOTE = 300;

/**
 * Disponibilidad declarada (enum `PromoterAvailability`, issue #24). Sin valor
 * devuelve `null` (no cambia) y con un valor desconocido, `false`.
 */
function readAvailability(raw: unknown): PromoterAvailabilityValue | null | false {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return false;
  const value = raw.trim().toUpperCase();
  return PROMOTER_AVAILABILITIES.find((candidate) => candidate === value) ?? false;
}

/** Nota de disponibilidad normalizada; `null` cuando viene vacía. */
function readNote(raw: unknown): string | null | false {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return false;
  const note = raw.trim();
  if (!note) return null;
  return note.length <= MAX_AVAILABILITY_NOTE ? note : false;
}

/**
 * "Hasta" de la no disponibilidad: día `YYYY-MM-DD` del `DateField` convertido
 * al 00:00 de Asunción (misma regla que los vencimientos de cobro). Sin valor,
 * `null`; con un día inválido, `false`.
 */
function readUntil(raw: unknown): Date | null | false {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return false;
  const key = raw.trim().slice(0, 10);
  return isValidDayKey(key) ? dayStart(key) : false;
}

/**
 * Datos de disponibilidad normalizados: el "hasta" solo acompaña a una
 * promotora no disponible (`AVAILABLE`/`TO_DEFINE` lo limpian).
 */
function availabilityData(body: Record<string, unknown>):
  | { ok: true; data: { availability?: PromoterAvailabilityValue; availabilityNote?: string | null; unavailableUntil?: Date | null } }
  | { ok: false; response: Response } {
  const availability = readAvailability(body.availability);
  if (availability === false) {
    return { ok: false, response: jsonError("La disponibilidad es AVAILABLE, UNAVAILABLE o TO_DEFINE.", 400) };
  }
  const note = readNote(body.availabilityNote);
  if (note === false) {
    return { ok: false, response: jsonError(`La nota de disponibilidad no puede superar los ${MAX_AVAILABILITY_NOTE} caracteres.`, 400) };
  }
  const until = readUntil(body.unavailableUntil);
  if (until === false) return { ok: false, response: jsonError("La fecha «hasta» tiene que ser un día válido (AAAA-MM-DD).", 400) };

  return {
    ok: true,
    data: {
      availability: availability ?? undefined,
      availabilityNote: note,
      unavailableUntil: (availability ?? "AVAILABLE") === "UNAVAILABLE" ? until : null,
    },
  };
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const [suppliers, inventory, promoters] = await Promise.all([
    db.supplier.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 200 }),
    db.inventoryItem.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 300 }),
    db.promoter.findMany({ where: { organizationId, active: true }, orderBy: { name: "asc" }, take: 200 }),
  ]);
  return Response.json({ suppliers, inventory, promoters });
}

export async function POST(request: Request) {
  const body = await readJson(request) as Record<string, unknown>;
  const kind = typeof body.kind === "string" ? body.kind : "";

  if (kind === "supplier") {
    const auth = await requireAdminContext("suppliers.write");
    if (!auth.ok) return auth.response;
    if (typeof body.name !== "string") return jsonError("Name is required.", 400);
    const supplier = await db.supplier.create({
      data: {
        id: randomUUID(),
        organizationId: auth.context.organizationId,
        name: body.name.trim(),
        company: typeof body.company === "string" ? body.company.trim() : undefined,
        phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
        category: "OTHER",
      },
    });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "Supplier",
      entityId: supplier.id,
      summary: `Cargó el proveedor «${supplier.name}»`,
      detail: { fields: auditPick(supplier, ["name", "company", "phone", "category", "active"]) },
    });
    return Response.json({ supplier }, { status: 201 });
  }

  if (kind === "inventory") {
    const auth = await requireAdminContext("inventory.write");
    if (!auth.ok) return auth.response;
    if (typeof body.name !== "string") return jsonError("Name is required.", 400);
    const inventory = await db.inventoryItem.create({
      data: {
        id: randomUUID(),
        organizationId: auth.context.organizationId,
        name: body.name.trim(),
        category: typeof body.category === "string" ? body.category.trim() : "General",
        kind: body.inventoryKind === "CONSUMABLE" ? "CONSUMABLE" : body.inventoryKind === "DISPOSABLE" ? "DISPOSABLE" : "REUSABLE",
        quantity: typeof body.quantity === "number" ? body.quantity : 1,
      },
    });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "InventoryItem",
      entityId: inventory.id,
      summary: `Cargó el ítem de inventario «${inventory.name}»`,
      detail: { fields: auditPick(inventory, ["name", "category", "kind", "quantity", "status", "sku"]) },
    });
    return Response.json({ inventory }, { status: 201 });
  }

  if (kind === "promoter") {
    const auth = await requireAdminContext("promoters.write");
    if (!auth.ok) return auth.response;
    if (typeof body.name !== "string") return jsonError("Name is required.", 400);
    const availability = availabilityData(body);
    if (!availability.ok) return availability.response;
    const promoter = await db.promoter.create({
      data: {
        id: randomUUID(),
        organizationId: auth.context.organizationId,
        name: body.name.trim(),
        phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
        specialties: typeof body.specialties === "string" ? body.specialties.trim() : undefined,
        availability: availability.data.availability ?? "AVAILABLE",
        availabilityNote: availability.data.availabilityNote ?? null,
        unavailableUntil: availability.data.unavailableUntil ?? null,
      },
    });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "Promoter",
      entityId: promoter.id,
      summary: `Cargó la promotora «${promoter.name}»`,
      detail: { fields: auditPick(promoter, ["name", "phone", "email", "specialties", "active", "availability"]) },
    });
    return Response.json({ promoter }, { status: 201 });
  }

  if (kind === "promoter-update") {
    const auth = await requireAdminContext("promoters.write");
    if (!auth.ok) return auth.response;
    if (typeof body.id !== "string") return jsonError("Promoter id is required.", 400);
    const availability = availabilityData(body);
    if (!availability.ok) return availability.response;
    if (!availability.data.availability) return jsonError("Indicá la disponibilidad.", 400);
    const existing = await db.promoter.findFirst({
      where: { id: body.id, organizationId: auth.context.organizationId },
      select: { id: true, name: true, availability: true, availabilityNote: true, unavailableUntil: true },
    });
    if (!existing) return jsonError("Promoter not found.", 404);
    const promoter = await db.promoter.update({
      where: { id: existing.id },
      data: {
        availability: availability.data.availability ?? undefined,
        availabilityNote: availability.data.availabilityNote ?? null,
        unavailableUntil: availability.data.unavailableUntil ?? null,
      },
    });
    const changes = auditChanges(existing, promoter, ["availability", "availabilityNote", "unavailableUntil"]);
    if (changes) {
      await recordAudit({
        context: auth.context,
        action: "status",
        entity: "Promoter",
        entityId: promoter.id,
        summary: `Actualizó la disponibilidad de «${promoter.name}»`,
        detail: { changes },
      });
    }
    return Response.json({ promoter });
  }

  return jsonError("Invalid resource.", 400);
}
