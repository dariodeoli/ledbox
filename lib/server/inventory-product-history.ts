import type { Prisma } from "@prisma/client";
import { listInventoryCountHistory } from "./inventory-counts";

type Tx = Prisma.TransactionClient;

export type InventoryProductHistoryEntry = {
  id: string;
  at: string;
  kind: "event" | "activity" | "incident" | "count";
  title: string;
  description: string;
  actor?: string;
};

/** Reads a tenant-scoped product history assembled from persisted operations and count snapshots. */
export async function readInventoryProductHistory(
  tx: Tx,
  options: { organizationId: string; inventoryId: string; take?: number },
) {
  const item = await tx.inventoryItem.findFirst({
    where: { id: options.inventoryId, organizationId: options.organizationId },
    select: { id: true },
  });
  if (!item) return null;

  const take = Math.min(100, Math.max(1, options.take ?? 50));
  const [assignments, counts, incidents, units] = await Promise.all([
    tx.eventInventory.findMany({
      where: { inventoryId: item.id, event: { organizationId: options.organizationId } },
      orderBy: [{ endsAt: "desc" }, { id: "desc" }], take,
      select: {
        id: true, quantity: true, startsAt: true, endsAt: true,
        checkedOutAt: true, checkedInAt: true, checkoutQuantity: true,
        returnedQuantity: true, damagedQuantity: true, missingQuantity: true,
        releasedAt: true, event: { select: { id: true, name: true, startsAt: true, endsAt: true } },
      },
    }),
    listInventoryCountHistory(tx, { organizationId: options.organizationId, take, inventoryId: item.id }),
    tx.inventoryIncident.findMany({
      where: { organizationId: options.organizationId, inventoryId: item.id },
      orderBy: [{ openedAt: "desc" }, { id: "desc" }], take,
      select: {
        id: true, kind: true, quantity: true, status: true, openedAt: true, resolvedAt: true,
        unit: { select: { code: true } }, event: { select: { name: true } },
      },
    }),
    tx.inventoryUnit.findMany({ where: { organizationId: options.organizationId, inventoryId: item.id }, select: { id: true } }),
  ]);

  const assignmentIds = assignments.map((row) => row.id);
  const unitIds = units.map((row) => row.id);
  const auditLogs = assignmentIds.length || unitIds.length
    ? await tx.auditLog.findMany({
        where: {
          organizationId: options.organizationId,
          OR: [
            ...(assignmentIds.length ? [{ entity: "EventInventory", entityId: { in: assignmentIds } }] : []),
            ...(unitIds.length ? [{ entity: "InventoryUnit", entityId: { in: unitIds } }] : []),
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take,
        select: { id: true, createdAt: true, summary: true, actorName: true },
      })
    : [];

  const entries: InventoryProductHistoryEntry[] = [];
  for (const assignment of assignments) {
    const startsAt = assignment.startsAt ?? assignment.event.startsAt;
    const endsAt = assignment.endsAt ?? assignment.event.endsAt;
    const at = assignment.checkedInAt ?? assignment.checkedOutAt ?? endsAt ?? startsAt;
    if (!at) continue;
    const movement = assignment.releasedAt
      ? "Asignación liberada"
      : assignment.checkedInAt
        ? `Devolución registrada · ${assignment.returnedQuantity} devueltas${assignment.damagedQuantity ? ` · ${assignment.damagedQuantity} dañadas` : ""}${assignment.missingQuantity ? ` · ${assignment.missingQuantity} faltantes` : ""}`
        : assignment.checkedOutAt
          ? `Salida registrada · ${assignment.checkoutQuantity || assignment.quantity} despachadas`
          : "Asignado al evento";
    entries.push({
      id: `event:${assignment.id}`, at: at.toISOString(), kind: "event", title: assignment.event.name,
      description: `${movement} · ${assignment.quantity} unidades${startsAt && endsAt ? ` · ${startsAt.toLocaleDateString("es-PY")}–${endsAt.toLocaleDateString("es-PY")}` : ""}`,
    });
  }
  for (const session of counts) {
    for (const line of session.lines) entries.push({
      id: `count:${line.id}`, at: session.countedAt.toISOString(), kind: "count", title: "Conteo físico",
      description: `${line.warehouseName} · esperado ${line.expectedQuantity} · contado ${line.countedQuantity} · diferencia ${line.discrepancy > 0 ? "+" : ""}${line.discrepancy}`,
      actor: session.actorName,
    });
  }
  for (const incident of incidents) {
    const context = [incident.unit?.code, incident.event?.name].filter(Boolean).join(" · ");
    entries.push({
      id: `incident:${incident.id}`, at: incident.openedAt.toISOString(), kind: "incident",
      title: `Incidente: ${incident.kind === "DAMAGE" ? "daño" : incident.kind === "MISSING" ? "faltante" : incident.kind === "REPAIR" ? "reparación" : "limpieza"}`,
      description: `${incident.quantity} unidad${incident.quantity === 1 ? "" : "es"} · ${incident.status}${context ? ` · ${context}` : ""}`,
    });
    if (incident.resolvedAt) entries.push({
      id: `incident-resolved:${incident.id}`, at: incident.resolvedAt.toISOString(), kind: "incident",
      title: "Incidente actualizado", description: `${incident.kind} · ${incident.status}${context ? ` · ${context}` : ""}`,
    });
  }
  for (const log of auditLogs) entries.push({
    id: `audit:${log.id}`, at: log.createdAt.toISOString(), kind: "activity", title: log.summary, description: "Actividad registrada", actor: log.actorName,
  });

  entries.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const latestCount = counts[0] ?? null;
  return {
    entries: entries.slice(0, take),
    verification: latestCount ? {
      countedAt: latestCount.countedAt.toISOString(), actorName: latestCount.actorName,
      lines: latestCount.lines,
    } : null,
  };
}
