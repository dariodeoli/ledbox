import { randomUUID } from "node:crypto";
import type { InventoryStatus } from "@prisma/client";
import { damageSummary, inventoryStatusLabel } from "@/lib/admin-format";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, auditPick, recordAudit } from "@/lib/server/audit";
import {
  BLOCKED_INVENTORY_STATUSES,
  EVENT_RANGE_SELECT,
  assignmentRange,
  availabilityForRange,
  buildAvailability,
  findSubstitutes,
  loadAssignments,
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
 * - `POST`: `status` (estado del ítem), `assignment` (alta/edición con
 *   validación de disponibilidad), `checkout` (salida), `checkin` (devolución
 *   con estado, daños y faltantes) y `assignment-delete`.
 *
 * La disponibilidad es server-side y vive en `lib/server/inventory-availability.ts`
 * (fuente única): la usan este endpoint, la reserva automática al aprobar un
 * presupuesto y los sustitutos. Nunca se permite asignar más unidades que las
 * libres y los ítems en MAINTENANCE o RETIRED quedan bloqueados.
 */

const INVENTORY_STATUSES: readonly InventoryStatus[] = ["AVAILABLE", "RESERVED", "IN_USE", "MAINTENANCE", "RETIRED"];

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
    const availability = await availabilityForRange({ organizationId, item, startsAt, endsAt, excludeId });
    const substitutes = await findSubstitutes({
      organizationId,
      item: { id: item.id, category: item.category, status: item.status },
      startsAt,
      endsAt,
    });
    return Response.json({ availability, substitutes });
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

  // Rango opcional de la vista por rango (mismo cálculo compartido que la
  // disponibilidad puntual). Si falta o es inválido, solo se devuelve "hoy".
  const rangeStart = parseDate(url.searchParams.get("startsAt"));
  const rangeEnd = parseDate(url.searchParams.get("endsAt"));
  const range = rangeStart && rangeEnd && rangeEnd.getTime() >= rangeStart.getTime() ? { start: rangeStart, end: rangeEnd } : null;

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
    const blocked = BLOCKED_INVENTORY_STATUSES.includes(item.status);
    const rangeAvailability = range ? buildAvailability(item, rows, range.start, range.end) : null;
    return {
      ...item,
      assignments: rows,
      availability: {
        committedNow,
        availableNow: blocked ? 0 : Math.max(0, item.quantity - committedNow),
        overcommittedNow: committedNow > item.quantity,
        range: rangeAvailability
          ? {
              startsAt: rangeAvailability.startsAt,
              endsAt: rangeAvailability.endsAt,
              committed: rangeAvailability.committed,
              available: rangeAvailability.available,
              overcommitted: rangeAvailability.committed > item.quantity,
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

    if (BLOCKED_INVENTORY_STATUSES.includes(item.status)) {
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
