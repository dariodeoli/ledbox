import { randomUUID } from "node:crypto";
import type { InventoryStatus } from "@prisma/client";
import { damageSummary, inventoryStatusLabel } from "@/lib/admin-format";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inventario operativo por evento.
 *
 * - `GET` sin parámetros: ítems de la empresa con sus asignaciones y la
 *   disponibilidad de hoy (`committedNow` / `availableNow`).
 * - `GET ?inventoryId&startsAt&endsAt[&excludeId]`: disponibilidad del ítem en
 *   el rango pedido, con el detalle de las asignaciones que se solapan.
 * - `POST`: `status` (estado del ítem), `assignment` (alta/edición con
 *   validación de disponibilidad), `checkout` (salida), `checkin` (devolución
 *   con estado, daños y faltantes) y `assignment-delete`.
 *
 * La disponibilidad es server-side: se suman las asignaciones que se solapan
 * con el rango y nunca se permite asignar más unidades que las libres. Los
 * ítems en MAINTENANCE o RETIRED quedan bloqueados para asignar.
 */

const INVENTORY_STATUSES: readonly InventoryStatus[] = ["AVAILABLE", "RESERVED", "IN_USE", "MAINTENANCE", "RETIRED"];
const BLOCKED_STATUSES: readonly InventoryStatus[] = ["MAINTENANCE", "RETIRED"];
const MAX_ASSIGNMENTS = 500;

const EVENT_RANGE_SELECT = { id: true, name: true, startsAt: true, endsAt: true, setupAt: true, strikeAt: true } as const;

type EventRangeRef = {
  id: string;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  setupAt: Date | null;
  strikeAt: Date | null;
};

type AssignmentRecord = {
  id: string;
  quantity: number;
  startsAt: Date | null;
  endsAt: Date | null;
  event: EventRangeRef;
};

const rangeFormat = new Intl.DateTimeFormat("es-PY", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rangeLabel(startsAt: Date, endsAt: Date): string {
  return `${rangeFormat.format(startsAt)} → ${rangeFormat.format(endsAt)}`;
}

/** Rango efectivo de una asignación: el propio y, si falta, el del evento. */
function assignmentRange(assignment: AssignmentRecord): { start: Date | null; end: Date | null } {
  const start = assignment.startsAt ?? assignment.event.setupAt ?? assignment.event.startsAt;
  const end = assignment.endsAt ?? assignment.event.strikeAt ?? assignment.event.endsAt ?? start;
  return { start, end };
}

/** Solape inclusivo: un rango sin fechas se trata como abierto (conservador). */
function overlaps(startA: Date | null, endA: Date | null, startB: Date, endB: Date): boolean {
  if (endA && endA.getTime() < startB.getTime()) return false;
  if (startA && startA.getTime() > endB.getTime()) return false;
  return true;
}

async function loadAssignments(inventoryId: string, organizationId: string, excludeId?: string | null): Promise<AssignmentRecord[]> {
  return db.eventInventory.findMany({
    where: {
      inventoryId,
      event: { organizationId },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { startsAt: "asc" },
    take: MAX_ASSIGNMENTS,
    include: { event: { select: EVENT_RANGE_SELECT } },
  });
}

function buildAvailability(item: { id: string; name: string; quantity: number; status: InventoryStatus }, rows: AssignmentRecord[], startsAt: Date, endsAt: Date) {
  const conflicts = rows
    .filter((row) => {
      const { start, end } = assignmentRange(row);
      return overlaps(start, end, startsAt, endsAt);
    })
    .map((row) => {
      const { start, end } = assignmentRange(row);
      return {
        id: row.id,
        eventId: row.event.id,
        eventName: row.event.name,
        quantity: row.quantity,
        startsAt: start,
        endsAt: end,
      };
    });
  const committed = conflicts.reduce((sum, conflict) => sum + conflict.quantity, 0);
  const blocked = BLOCKED_STATUSES.includes(item.status);
  return {
    inventoryId: item.id,
    name: item.name,
    status: item.status,
    total: item.quantity,
    committed,
    available: blocked ? 0 : Math.max(0, item.quantity - committed),
    blocked,
    startsAt,
    endsAt,
    conflicts,
  };
}

export async function GET(request: Request) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const url = new URL(request.url);
  const inventoryId = url.searchParams.get("inventoryId");

  if (inventoryId) {
    const item = await db.inventoryItem.findFirst({ where: { id: inventoryId, organizationId } });
    if (!item) return jsonError("El ítem de inventario no existe en esta empresa.", 404);
    const startsAt = parseDate(url.searchParams.get("startsAt"));
    const endsAt = parseDate(url.searchParams.get("endsAt"));
    if (!startsAt || !endsAt) return jsonError("Indicá el rango de fechas para calcular la disponibilidad.", 400);
    if (endsAt.getTime() < startsAt.getTime()) return jsonError("El fin del rango no puede ser anterior al inicio.", 400);
    const excludeId = url.searchParams.get("excludeId");
    const rows = await loadAssignments(item.id, organizationId, excludeId);
    return Response.json({ availability: buildAvailability(item, rows, startsAt, endsAt) });
  }

  const items = await db.inventoryItem.findMany({ where: { organizationId }, orderBy: { name: "asc" }, take: 300 });
  const assignments = items.length
    ? await db.eventInventory.findMany({
        where: { inventoryId: { in: items.map((item) => item.id) }, event: { organizationId } },
        orderBy: [{ startsAt: "desc" }, { id: "asc" }],
        take: 1000,
        include: { event: { select: EVENT_RANGE_SELECT } },
      })
    : [];

  const now = new Date();
  const inventory = items.map((item) => {
    const rows = assignments.filter((assignment) => assignment.inventoryId === item.id);
    const activeNow = rows.filter((row) => {
      if (row.checkedInAt || row.checkedIn) return false;
      const { start, end } = assignmentRange(row);
      if (!start && !end) return true;
      if (start && start.getTime() > now.getTime()) return false;
      if (end && end.getTime() < now.getTime()) return false;
      return true;
    });
    const committedNow = activeNow.reduce((sum, row) => sum + row.quantity, 0);
    const blocked = BLOCKED_STATUSES.includes(item.status);
    return {
      ...item,
      assignments: rows,
      availability: {
        committedNow,
        availableNow: blocked ? 0 : Math.max(0, item.quantity - committedNow),
        overcommittedNow: committedNow > item.quantity,
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

  if (kind === "assignment") {
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const inventoryId = typeof body.inventoryId === "string" ? body.inventoryId : "";
    if (!eventId || !inventoryId) return jsonError("Elegí el evento y el ítem de inventario.", 400);
    const [event, item] = await Promise.all([
      db.event.findFirst({ where: { id: eventId, organizationId }, select: EVENT_RANGE_SELECT }),
      db.inventoryItem.findFirst({ where: { id: inventoryId, organizationId } }),
    ]);
    if (!event) return jsonError("El evento no existe en esta empresa.", 404);
    if (!item) return jsonError("El ítem de inventario no existe en esta empresa.", 404);

    const quantity = Number(body.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) return jsonError("La cantidad debe ser un entero mayor a cero.", 400);

    const startsAt = parseDate(body.startsAt) ?? event.setupAt ?? event.startsAt;
    const endsAt = parseDate(body.endsAt) ?? event.strikeAt ?? event.endsAt;
    if (!startsAt || !endsAt) return jsonError("Indicá el rango de fechas de la asignación (el evento todavía no tiene fechas).", 400);
    if (endsAt.getTime() < startsAt.getTime()) return jsonError("El fin del rango no puede ser anterior al inicio.", 400);

    if (BLOCKED_STATUSES.includes(item.status)) {
      return jsonError(`«${item.name}» está ${item.status === "MAINTENANCE" ? "en mantenimiento" : "retirado"}: no se puede asignar.`, 409);
    }

    const existing = await db.eventInventory.findUnique({
      where: { eventId_inventoryId: { eventId: event.id, inventoryId: item.id } },
      select: { id: true, quantity: true, startsAt: true, endsAt: true },
    });
    const rows = await loadAssignments(item.id, organizationId, existing?.id);
    const availability = buildAvailability(item, rows, startsAt, endsAt);
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
