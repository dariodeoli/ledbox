import type { Prisma } from "@prisma/client";
import type { AuditContext } from "./audit";
import { recordAudit } from "./audit";
import { db, dbWithDeleted } from "./db";
import { anonymize, archive, restore, assertLive, blockedError, blockersFor, purgeBlockers, TrashError, trash, trashErrorResponse, unarchive, type Blocker, type TrashModel } from "./trash";
import type { AdminCapability } from "./permissions";
import { live } from "./trash-filter";

/**
 * Papelera, etapa 2 (docs/PAPELERA.md): reglas de Evento y Producto de inventario.
 * Las rutas resuelven permisos; acá viven las reglas de datos, siempre acotadas por
 * `organizationId` y dentro de una transacción con `FOR UPDATE` de la fila.
 */

type Tx = Prisma.TransactionClient;

export const SKU_IN_TRASH_MESSAGE = "Hay un producto con ese SKU en la papelera: restaurálo o eliminálo definitivamente";

/** Archivar un evento solo desde estos estados (no tiene sentido archivar uno en curso). */
export const EVENT_ARCHIVABLE_STATUSES = ["COMPLETED", "CANCELLED", "DRAFT"] as const;

/** Normaliza para comparar nombres: sin tildes, minúsculas y espacios colapsados. */
export function normalizeName(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function namesMatch(typed: unknown, actual: string): boolean {
  return typeof typed === "string" && normalizeName(typed) !== "" && normalizeName(typed) === normalizeName(actual);
}

/** Motivo del borrado definitivo: obligatorio, hasta 200 caracteres. */
export function readPurgeReason(value: unknown): string {
  const reason = typeof value === "string" ? value.trim() : "";
  if (!reason) throw new TrashError("Escribí el motivo del borrado definitivo.", 400);
  if (reason.length > 200) throw new TrashError("El motivo no puede superar 200 caracteres.", 400);
  return reason;
}

async function lockRow(tx: Tx, table: "Event" | "InventoryItem", id: string, organizationId: string): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "${table}" WHERE "id" = $1 AND "organizationId" = $2 FOR UPDATE`, id, organizationId);
  return rows.length > 0;
}

/** Mensaje del 409 por SKU repetido: distingue si el SKU lo tiene un producto en la papelera. */
export async function skuConflictMessage(organizationId: string, sku: string | null | undefined): Promise<string> {
  if (sku) {
    const inTrash = await dbWithDeleted.inventoryItem.findFirst({ where: { organizationId, sku, deletedAt: { not: null } }, select: { id: true } });
    if (inTrash) return SKU_IN_TRASH_MESSAGE;
  }
  return `Ya hay un ítem con el SKU «${sku ?? ""}»; probá con otro.`;
}

/** `null` si la fila está viva; la respuesta 404 si no (para rutas que mutan por id). */
export async function deadResponse(model: TrashModel, id: string, organizationId: string): Promise<Response | null> {
  try {
    await assertLive(model, id, organizationId);
    return null;
  } catch (error) {
    const response = trashErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

// ── Evento ───────────────────────────────────────────────────────────────────

/** Asignaciones que todavía comprometen o retienen equipo: sin liberar y sin devolver. */
const unreleasedAssignment = { releasedAt: null, checkedIn: false } as const;

export async function archiveEvent(id: string, context: AuditContext): Promise<void> {
  await dbWithDeleted.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Event", id, context.organizationId))) throw new TrashError("El evento no existe.", 404);
    const event = await tx.event.findFirst({ where: { id, organizationId: context.organizationId, ...live }, select: { name: true, status: true } });
    if (!event) throw new TrashError("El evento no existe.", 404);
    if (!(EVENT_ARCHIVABLE_STATUSES as readonly string[]).includes(event.status)) {
      throw new TrashError("Solo se archivan eventos finalizados, cancelados o en borrador.", 409);
    }
    await archive("Event", id, context, { tx, label: event.name });
  });
}

export async function unarchiveEvent(id: string, context: AuditContext): Promise<void> {
  await dbWithDeleted.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id, organizationId: context.organizationId, ...live }, select: { name: true } });
    await unarchive("Event", id, context, { tx, label: event?.name });
  });
}

/** Eliminar (a la papelera): archivado, y sin reservas vivas ni estado CONFIRMED/IN_PROGRESS. */
export async function trashEvent(id: string, reason: string | null, context: AuditContext): Promise<void> {
  await dbWithDeleted.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Event", id, context.organizationId))) throw new TrashError("El evento no existe.", 404);
    const event = await tx.event.findFirst({ where: { id, organizationId: context.organizationId, ...live }, select: { name: true, status: true } });
    if (!event) throw new TrashError("El evento no existe.", 404);
    await trash("Event", id, reason, context, {
      tx,
      label: event.name,
      guard: async (inner) => {
        const blockers: Blocker[] = [];
        if (event.status === "CONFIRMED" || event.status === "IN_PROGRESS") blockers.push({ kind: "status", count: 1 });
        const open = await inner.eventInventory.count({ where: { eventId: id, ...unreleasedAssignment } });
        if (open > 0) blockers.push({ kind: "assignments", count: open });
        if (blockers.length) {
          throw new TrashError(
            event.status === "CONFIRMED" || event.status === "IN_PROGRESS"
              ? "Un evento confirmado o en curso no se puede eliminar: cancelalo o finalizalo primero."
              : "El evento tiene reservas sin liberar: liberalas antes de eliminarlo.",
            409,
            blockers,
          );
        }
      },
    });
  });
}

async function eventPurgeBlockers(id: string, organizationId: string, tx: Tx, options?: { lock?: boolean }): Promise<Blocker[]> {
  const blockers = await blockersFor("Event", id, organizationId, tx, options);
  const open = await tx.eventInventory.count({ where: { eventId: id, ...unreleasedAssignment } });
  return open > 0 ? [...blockers, { kind: "assignments", count: open }] : blockers;
}

async function loadTrashed(tx: Tx, table: "event" | "inventoryItem", id: string, organizationId: string): Promise<{ name: string; anonymizedAt: Date | null }> {
  const delegate = (tx as unknown as Record<string, { findFirst(args: unknown): Promise<{ name: string; deletedAt: Date | null; anonymizedAt: Date | null } | null> }>)[table];
  const row = await delegate.findFirst({ where: { id, organizationId, deletedAt: undefined }, select: { name: true, deletedAt: true, anonymizedAt: true } });
  if (!row) throw new TrashError(table === "event" ? "El evento no existe." : "El producto no existe.", 404);
  if (!row.deletedAt) throw new TrashError("Eliminalo primero: solo se borra definitivamente lo que está en la papelera.", 409);
  return row;
}

export type PurgeInput = { confirmName: unknown; reason: unknown };

/** Borrado definitivo de un evento: bloqueos → 409 `{ blockers }`; si no hay, borra lo no contable. */
export async function purgeEvent(id: string, input: PurgeInput, context: AuditContext): Promise<void> {
  const reason = readPurgeReason(input.reason);
  await dbWithDeleted.$transaction(async (tx) => {
    const blockers = await eventPurgeBlockers(id, context.organizationId, tx); // FOR UPDATE + 404 ajeno
    const row = await loadTrashed(tx, "event", id, context.organizationId);
    if (!namesMatch(input.confirmName, row.name)) throw new TrashError("El nombre escrito no coincide con el del evento.", 400);
    if (blockers.length) throw blockedError(blockers);
    await tx.eventTask.deleteMany({ where: { eventId: id } });
    await tx.eventInventory.deleteMany({ where: { eventId: id } });
    await tx.event.delete({ where: { id } }); // presupuestos DRAFT/LOST quedan sueltos (SetNull)
    await recordAudit({ context, action: "purge", entity: "Event", entityId: id, summary: `Borró definitivamente el evento «${row.name}»`, detail: { fields: { reason } } }, tx);
  });
}

/** Anonimizar un evento ya eliminado (con bloqueos contables): borra responsable, contacto del lugar y notas. */
export async function anonymizeEvent(id: string, input: PurgeInput, context: AuditContext): Promise<void> {
  const reason = readPurgeReason(input.reason);
  await dbWithDeleted.$transaction(async (tx) => {
    if (!(await lockRow(tx, "Event", id, context.organizationId))) throw new TrashError("El evento no existe.", 404);
    const row = await loadTrashed(tx, "event", id, context.organizationId);
    if (!namesMatch(input.confirmName, row.name)) throw new TrashError("El nombre escrito no coincide con el del evento.", 400);
    await anonymize("Event", id, context, { tx, label: row.name, reason });
  });
}

// ── Producto de inventario ───────────────────────────────────────────────────

/** Asignaciones que todavía comprometen el producto hacia adelante (no liberadas, no devueltas, no terminadas). */
function futureAssignmentWhere(inventoryId: string, now: Date): Prisma.EventInventoryWhereInput {
  return {
    inventoryId,
    releasedAt: null,
    checkedIn: false,
    OR: [
      { checkedOut: true },
      {
        event: { status: { not: "CANCELLED" } },
        OR: [{ endsAt: { gte: now } }, { endsAt: null, event: { OR: [{ endsAt: { gte: now } }, { endsAt: null }] } }],
      },
    ],
  };
}

/** Eliminar un producto archivado: bloqueado con asignaciones futuras, incidentes abiertos o si es componente de un combo vivo. */
export async function trashInventoryItem(id: string, reason: string | null, context: AuditContext): Promise<void> {
  await dbWithDeleted.$transaction(async (tx) => {
    // Mismo FOR UPDATE que usa la disponibilidad: una asignación concurrente espera o ve el borrado.
    if (!(await lockRow(tx, "InventoryItem", id, context.organizationId))) throw new TrashError("El producto no existe.", 404);
    const item = await tx.inventoryItem.findFirst({ where: { id, organizationId: context.organizationId, ...live }, select: { name: true } });
    if (!item) throw new TrashError("El producto no existe.", 404);
    await trash("InventoryItem", id, reason, context, {
      tx,
      label: item.name,
      guard: async (inner) => {
        const [assignments, incidents, usedInCombos] = await Promise.all([
          inner.eventInventory.count({ where: futureAssignmentWhere(id, new Date()) }),
          inner.inventoryIncident.count({ where: { inventoryId: id, status: { in: ["OPEN", "IN_REPAIR"] } } }),
          inner.inventoryComponent.count({ where: { componentId: id, parent: live } }),
        ]);
        const blockers = [
          ...(assignments ? [{ kind: "assignments", count: assignments }] : []),
          ...(incidents ? [{ kind: "incidents", count: incidents }] : []),
          ...(usedInCombos ? [{ kind: "usedInCombos", count: usedInCombos }] : []),
        ];
        if (blockers.length) {
          throw new TrashError(
            `No se puede eliminar: ${blockers.map((b) => `${b.count} ${b.kind === "assignments" ? "asignaciones sin liberar" : b.kind === "incidents" ? "incidentes abiertos" : "combos que lo usan"}`).join(", ")}.`,
            409,
            blockers,
          );
        }
      },
    });
  });
}

export async function purgeInventoryItem(id: string, input: PurgeInput, context: AuditContext): Promise<void> {
  const reason = readPurgeReason(input.reason);
  await dbWithDeleted.$transaction(async (tx) => {
    const blockers = await blockersFor("InventoryItem", id, context.organizationId, tx);
    const row = await loadTrashed(tx, "inventoryItem", id, context.organizationId);
    if (!namesMatch(input.confirmName, row.name)) throw new TrashError("El nombre escrito no coincide con el del producto.", 400);
    if (blockers.length) throw blockedError(blockers);
    // Presupuestos y pedidos conservan su snapshot (nombre, precio); solo pierden el vínculo.
    await tx.budgetItem.updateMany({ where: { inventoryId: id }, data: { inventoryId: null } });
    await tx.quoteItem.updateMany({ where: { inventoryId: id }, data: { inventoryId: null } });
    await tx.inventoryItem.delete({ where: { id } }); // unidades y componentes propios caen en cascada; el SKU queda libre
    await recordAudit({ context, action: "purge", entity: "InventoryItem", entityId: id, summary: `Borró definitivamente el producto «${row.name}»`, detail: { fields: { reason } } }, tx);
  });
}

export type AnnulOutcome = { status: 200; id: string } | { status: 404 } | { status: 409; blockers: Blocker[] };

/**
 * Anulación de un producto creado por la Carga con IA (`/api/admin/ia/anular`). Mismo criterio
 * que el borrado definitivo (`blockersFor`): asignaciones, incidentes, combos que lo usan y
 * presupuestos bloquean con 409 (antes un combo daba 500 por la FK Restrict y los incidentes
 * se borraban en cascada). Todo en una transacción con FOR UPDATE.
 */
export async function annulInventoryItem(id: string, lote: string, context: AuditContext): Promise<AnnulOutcome> {
  const { organizationId } = context;
  return db.$transaction(async (tx): Promise<AnnulOutcome> => {
    const item = await tx.inventoryItem.findFirst({ where: { id, organizationId }, select: { id: true, name: true, _count: { select: { budgetItems: true } } } });
    if (!item) return { status: 404 };
    const blockers = await blockersFor("InventoryItem", item.id, organizationId, tx);
    if (item._count.budgetItems > 0) blockers.push({ kind: "budgetItems", count: item._count.budgetItems });
    if (blockers.length > 0) return { status: 409, blockers };
    // Las unidades del ítem se borran en cascada (relación propia).
    await tx.inventoryItem.delete({ where: { id: item.id } });
    await recordAudit({
      context,
      action: "delete",
      entity: "InventoryItem",
      entityId: item.id,
      summary: `Anuló el ítem «${item.name}» creado por la Carga con IA`,
      detail: { fields: { nombre: item.name, lote: lote || null } },
    }, tx);
    return { status: 200, id: item.id };
  });
}

// ── Lectura de la papelera ───────────────────────────────────────────────────

export type TrashRow = {
  type: TrashModel;
  id: string;
  name: string;
  deletedAt: string;
  deletedById: string | null;
  deletedByName: string | null;
  reason: string | null;
  anonymized: boolean;
  blockers: Blocker[];
};

const MAX_ROWS = 200;

type TrashSource = { type: TrashModel; load: (organizationId: string) => Promise<{ id: string; name: string; deletedAt: Date | null; deletedById: string | null; deleteReason: string | null; anonymizedAt: Date | null }[]> };

const trashWhere = (organizationId: string) => ({ organizationId, deletedAt: { not: null } }) as const;
const nameSelect = { id: true, name: true, deletedAt: true, deletedById: true, deleteReason: true, anonymizedAt: true } as const;
const orderBy = { deletedAt: "desc" } as const;

const SOURCES: TrashSource[] = [
  { type: "Event", load: (o) => dbWithDeleted.event.findMany({ where: trashWhere(o), select: nameSelect, orderBy, take: MAX_ROWS }) },
  { type: "InventoryItem", load: (o) => dbWithDeleted.inventoryItem.findMany({ where: trashWhere(o), select: nameSelect, orderBy, take: MAX_ROWS }) },
  { type: "Client", load: (o) => dbWithDeleted.client.findMany({ where: trashWhere(o), select: nameSelect, orderBy, take: MAX_ROWS }) },
  { type: "Lead", load: (o) => dbWithDeleted.lead.findMany({ where: trashWhere(o), select: nameSelect, orderBy, take: MAX_ROWS }) },
  { type: "Supplier", load: (o) => dbWithDeleted.supplier.findMany({ where: trashWhere(o), select: nameSelect, orderBy, take: MAX_ROWS }) },
  { type: "Promoter", load: (o) => dbWithDeleted.promoter.findMany({ where: trashWhere(o), select: nameSelect, orderBy, take: MAX_ROWS }) },
  {
    type: "Budget",
    load: async (o) => {
      const rows = await dbWithDeleted.budget.findMany({ where: trashWhere(o), select: { id: true, title: true, deletedAt: true, deletedById: true, deleteReason: true, anonymizedAt: true }, orderBy, take: MAX_ROWS });
      return rows.map(({ title, ...rest }) => ({ ...rest, name: title }));
    },
  },
];

/** Lo eliminado de la empresa (las 7 entidades con papelera), con bloqueos del borrado definitivo. */
export async function listTrash(organizationId: string): Promise<TrashRow[]> {
  const groups = await Promise.all(SOURCES.map(async (source) => ({ type: source.type, rows: await source.load(organizationId) })));
  const userIds = [...new Set(groups.flatMap((group) => group.rows.map((row) => row.deletedById)).filter((value): value is string => Boolean(value)))];
  const users = userIds.length ? await db.adminUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  const blockersOf = (type: TrashModel, id: string) =>
    dbWithDeleted.$transaction((tx) => (type === "Event" ? eventPurgeBlockers(id, organizationId, tx, { lock: false }) : purgeBlockers(type, id, organizationId, tx, { lock: false })));
  const rows = await Promise.all(
    groups.flatMap((group) =>
      group.rows.map(async (row): Promise<TrashRow> => ({
        type: group.type,
        id: row.id,
        name: row.name,
        deletedAt: row.deletedAt!.toISOString(),
        deletedById: row.deletedById,
        deletedByName: row.deletedById ? names.get(row.deletedById) ?? null : null,
        reason: row.deleteReason,
        anonymized: Boolean(row.anonymizedAt),
        blockers: await blockersOf(group.type, row.id),
      })),
    ),
  );
  return rows.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

// ── Acciones de las rutas (permiso por acción + despacho) ───────────────────

/** Capacidad que exige cada acción de `POST /api/admin/events/[id]/[action]`. */
export const EVENT_ACTION_CAPABILITY: Record<string, AdminCapability> = {
  archive: "events.write",
  unarchive: "events.write",
  trash: "events.write",
  restore: "trash.manage",
  purge: "trash.manage",
  anonymize: "trash.manage",
};

/** Capacidad que exige cada acción de `POST /api/admin/inventory/[id]/[action]`. */
export const INVENTORY_ACTION_CAPABILITY: Record<string, AdminCapability> = {
  trash: "inventory.write",
  restore: "trash.manage",
  purge: "trash.manage",
};

export async function runEventAction(action: string, id: string, body: Record<string, unknown>, context: AuditContext): Promise<void> {
  if (action === "archive") return archiveEvent(id, context);
  if (action === "unarchive") return unarchiveEvent(id, context);
  if (action === "trash") return trashEvent(id, typeof body.reason === "string" ? body.reason : null, context);
  if (action === "restore") return restore("Event", id, context);
  if (action === "purge") return purgeEvent(id, { confirmName: body.confirmName, reason: body.reason }, context);
  if (action === "anonymize") return anonymizeEvent(id, { confirmName: body.confirmName, reason: body.reason }, context);
  throw new TrashError("Acción desconocida.", 404);
}

export async function runInventoryAction(action: string, id: string, body: Record<string, unknown>, context: AuditContext): Promise<void> {
  if (action === "trash") return trashInventoryItem(id, typeof body.reason === "string" ? body.reason : null, context);
  if (action === "restore") return restore("InventoryItem", id, context);
  if (action === "purge") return purgeInventoryItem(id, { confirmName: body.confirmName, reason: body.reason }, context);
  throw new TrashError("Acción desconocida.", 404);
}
