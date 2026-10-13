import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuditEntity } from "@/lib/admin-types";
import { db, dbWithDeleted } from "./db";
import { recordAudit, type AuditContext } from "./audit";
import { formatBlockers } from "@/lib/trash-shared";
import { isTrashModel, live, TRASH_MODELS, type TrashModel } from "./trash-filter";

/**
 * Papelera (docs/PAPELERA.md): archivar -> eliminar (papelera) -> definitivo/anonimizar.
 *
 * Este módulo es el único que escribe las columnas `archivedAt/deletedAt/...` y el
 * único (con la purga) que usa `dbWithDeleted`. Todo está acotado por `organizationId`
 * y cada transición es un `updateMany` condicional: el `count` decide, sin carreras.
 * Los permisos (`trash.manage`, capacidad de escritura de la entidad) los resuelve la
 * ruta con `requireAdminContext`; acá solo viven las reglas de datos.
 */

export { live };
export type { TrashModel };
export const TRASH_ENTITIES = TRASH_MODELS;

export class TrashError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 501,
    readonly blockers?: Blocker[],
  ) {
    super(message);
    this.name = "TrashError";
  }
}

/** Respuesta HTTP de un `TrashError` (404/409 con `{ blockers }` cuando hay bloqueos). */
export function trashErrorResponse(error: unknown): Response | null {
  if (!(error instanceof TrashError)) return null;
  return Response.json(error.blockers ? { error: error.message, blockers: error.blockers } : { error: error.message }, { status: error.status });
}

export type Blocker = { kind: string; count: number };

/**
 * `deletedAt` presente (aunque `undefined`) hace que la extensión de `db` respete el
 * `where` tal cual: las consultas de papelera y bloqueos ven también lo eliminado,
 * venga el `tx` del cliente extendido o del base.
 */
const anyState = { deletedAt: undefined } as const;
type Tx = Prisma.TransactionClient;
type Delegate = {
  findFirst(args: unknown): Promise<Record<string, unknown> | null>;
  updateMany(args: unknown): Promise<{ count: number }>;
  update(args: unknown): Promise<unknown>;
};

const DELEGATES: Record<TrashModel, string> = {
  Event: "event",
  InventoryItem: "inventoryItem",
  Client: "client",
  Lead: "lead",
  Supplier: "supplier",
  Promoter: "promoter",
  Budget: "budget",
};

const LABELS: Record<TrashModel, string> = {
  Event: "El evento",
  InventoryItem: "El ítem de inventario",
  Client: "El cliente",
  Lead: "La oportunidad",
  Supplier: "El proveedor",
  Promoter: "La promotora",
  Budget: "El presupuesto",
};

function delegate(client: Tx | PrismaClient, model: TrashModel): Delegate {
  if (!isTrashModel(model)) throw new TypeError(`Entidad sin papelera: ${String(model)}`);
  return (client as unknown as Record<string, Delegate>)[DELEGATES[model]];
}

/**
 * 404 si la fila no existe en la empresa o está eliminada. Pasa por el cliente
 * extendido (`db`), que ya filtra lo eliminado. Usar antes de update/delete por id.
 */
export async function assertLive(model: TrashModel, id: string, organizationId: string, client: Tx | PrismaClient = db): Promise<void> {
  const row = await delegate(client, model).findFirst({ where: { id, organizationId, ...live }, select: { id: true } });
  if (!row) throw new TrashError(`${LABELS[model]} no existe.`, 404);
}

async function existsIncludingDeleted(model: TrashModel, id: string, organizationId: string, client: Tx | PrismaClient) {
  return delegate(client, model).findFirst({ where: { id, organizationId, ...anyState }, select: { id: true, archivedAt: true, deletedAt: true, anonymizedAt: true } });
}

export type TrashActionOptions = {
  /** Cliente de transacción del llamador; sin él se abre una propia. */
  tx?: Tx;
  /** Nombre legible para el resumen de auditoría. */
  label?: string;
  /** Motivo que se guarda en el detalle de la auditoría (anonimizar). */
  reason?: string;
};

async function run<T>(options: TrashActionOptions | undefined, work: (tx: Tx) => Promise<T>): Promise<T> {
  if (options?.tx) return work(options.tx);
  return dbWithDeleted.$transaction((tx) => work(tx));
}

function auditSummary(verb: string, model: TrashModel, id: string, label?: string) {
  return `${verb} ${LABELS[model].toLowerCase()} ${label ? `«${label}»` : `#${id.slice(0, 8)}`}`;
}

/** Archivar: solo lo vivo y no archivado. Las reglas por estado (p. ej. Event solo COMPLETED/CANCELLED/DRAFT) las valida la etapa de cada entidad antes de llamar. */
export async function archive(model: TrashModel, id: string, context: AuditContext, options?: TrashActionOptions): Promise<void> {
  await run(options, async (tx) => {
    const now = new Date();
    const result = await delegate(tx, model).updateMany({
      where: { id, organizationId: context.organizationId, deletedAt: null, archivedAt: null },
      data: { archivedAt: now, archivedById: context.user.id },
    });
    if (result.count === 0) {
      const row = await existsIncludingDeleted(model, id, context.organizationId, tx);
      if (!row || row.deletedAt) throw new TrashError(`${LABELS[model]} no existe.`, 404);
      throw new TrashError("Ya está archivado.", 409);
    }
    await recordAudit({ context, action: "archive", entity: model as AuditEntity, entityId: id, summary: auditSummary("Archivó", model, id, options?.label) }, tx);
  });
}

/** Desarchivar: vuelve a activo. No toca lo eliminado. */
export async function unarchive(model: TrashModel, id: string, context: AuditContext, options?: TrashActionOptions): Promise<void> {
  await run(options, async (tx) => {
    const result = await delegate(tx, model).updateMany({
      where: { id, organizationId: context.organizationId, deletedAt: null, archivedAt: { not: null } },
      data: { archivedAt: null, archivedById: null },
    });
    if (result.count === 0) {
      const row = await existsIncludingDeleted(model, id, context.organizationId, tx);
      if (!row || row.deletedAt) throw new TrashError(`${LABELS[model]} no existe.`, 404);
      throw new TrashError("No está archivado.", 409);
    }
    await recordAudit({ context, action: "restore", entity: model as AuditEntity, entityId: id, summary: auditSummary("Desarchivó", model, id, options?.label) }, tx);
  });
}

/**
 * Eliminar (a la papelera): solo lo archivado y no eliminado. Sin archivar previo,
 * el `updateMany` devuelve 0 y la respuesta es 409 «Archivalo primero o ya fue eliminado».
 * `guard` permite a cada etapa agregar sus bloqueos (p. ej. Event CONFIRMED con reservas) dentro de la misma transacción.
 */
export async function trash(
  model: TrashModel,
  id: string,
  reason: string | null,
  context: AuditContext,
  options?: TrashActionOptions & { guard?: (tx: Tx) => Promise<void> },
): Promise<void> {
  await run(options, async (tx) => {
    await options?.guard?.(tx);
    const result = await delegate(tx, model).updateMany({
      where: { id, organizationId: context.organizationId, archivedAt: { not: null }, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: context.user.id, deleteReason: reason?.trim().slice(0, 200) || null },
    });
    if (result.count === 0) throw new TrashError("Archivalo primero o ya fue eliminado.", 409);
    await recordAudit({ context, action: "trash", entity: model as AuditEntity, entityId: id, summary: auditSummary("Eliminó", model, id, options?.label), detail: reason ? { fields: { reason: reason.trim().slice(0, 200) } } : null }, tx);
  });
}

/** Restaurar desde la papelera: limpia lo eliminado y deja la fila ARCHIVADA. Lo anonimizado no se restaura. */
export async function restore(model: TrashModel, id: string, context: AuditContext, options?: TrashActionOptions): Promise<void> {
  await run(options, async (tx) => {
    const result = await delegate(tx, model).updateMany({
      where: { id, organizationId: context.organizationId, deletedAt: { not: null }, anonymizedAt: null },
      data: { deletedAt: null, deletedById: null, deleteReason: null },
    });
    if (result.count === 0) {
      const row = await existsIncludingDeleted(model, id, context.organizationId, tx);
      if (!row) throw new TrashError(`${LABELS[model]} no existe.`, 404);
      throw new TrashError(row.anonymizedAt ? "Lo anonimizado no se puede restaurar." : "No está en la papelera.", 409);
    }
    await recordAudit({ context, action: "restore", entity: model as AuditEntity, entityId: id, summary: auditSummary("Restauró de la papelera", model, id, options?.label) }, tx);
  });
}

// ── Bloqueos del borrado definitivo ──────────────────────────────────────────

/** Tabla de cada entidad para el `SELECT … FOR UPDATE` (nombres de modelo, sin @@map). */
const TABLES = {
  Event: '"Event"',
  InventoryItem: '"InventoryItem"',
  Client: '"Client"',
  Lead: '"Lead"',
  Supplier: '"Supplier"',
  Promoter: '"Promoter"',
  Budget: '"Budget"',
} as const satisfies Record<TrashModel, string>;

function pick(counts: Record<string, number>, kinds: Record<string, string>): Blocker[] {
  return Object.entries(kinds).flatMap(([key, kind]) => (counts[key] > 0 ? [{ kind, count: counts[key] }] : []));
}

/**
 * Qué impide borrar de verdad una entidad (datos contables o históricos que el
 * borrado destruiría por cascada). Vacío = se puede borrar. Bloqueo = ofrecer anonimizar
 * (o conservar). Bloquea la fila con `FOR UPDATE` dentro de la transacción del llamador
 * para que nadie le agregue historial mientras se decide. 404 si la fila no es de la empresa.
 */
export async function blockersFor(model: TrashModel, id: string, organizationId: string, tx: Tx, options?: { lock?: boolean }): Promise<Blocker[]> {
  if (!isTrashModel(model)) throw new TypeError(`Entidad sin papelera: ${String(model)}`);
  // `lock: false` es para listar (solo lectura): no toma FOR UPDATE.
  const locked = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM ${TABLES[model as keyof typeof TABLES]} WHERE "id" = $1 AND "organizationId" = $2${options?.lock === false ? "" : " FOR UPDATE"}`, id, organizationId);
  if (locked.length === 0) throw new TrashError(`${LABELS[model]} no existe.`, 404);
  const where = { id, organizationId, ...anyState };
  const count = async (rows: Promise<{ _count: Record<string, number> } | null>) => (await rows)?._count ?? {};

  switch (model) {
    case "Client":
      return clientBlockers(id, organizationId, tx);
    case "Event":
      return pick(
        await count(
          tx.event.findFirst({
            where,
            select: {
              _count: {
                select: {
                  invoices: true,
                  expenses: true,
                  incidents: true,
                  supplierJobs: { where: { status: { not: "CANCELLED" } } },
                },
              },
            },
          }) as never,
        ),
        { invoices: "invoices", expenses: "expenses", supplierJobs: "supplierJobs", incidents: "incidents" },
      ).concat(await paymentsViaBudget(id, tx));
    case "InventoryItem":
      return pick(
        await count(tx.inventoryItem.findFirst({ where, select: { _count: { select: { assignments: true, incidents: true, usedInCombos: true } } } }) as never),
        { assignments: "assignments", incidents: "incidents", usedInCombos: "usedInCombos" },
      );
    case "Supplier":
      return pick(
        await count(tx.supplier.findFirst({ where, select: { _count: { select: { jobs: true, expenses: true, purchaseInvoices: true } } } }) as never),
        { jobs: "supplierJobs", expenses: "expenses", purchaseInvoices: "purchaseInvoices" },
      );
    case "Promoter":
      return pick(await count(tx.promoter.findFirst({ where, select: { _count: { select: { tasks: true } } } }) as never), { tasks: "tasks" });
    case "Lead":
      return pick(await count(tx.lead.findFirst({ where, select: { _count: { select: { budgets: true } } } }) as never), { budgets: "budgets" });
    case "Budget":
      return pick(
        await count(
          tx.budget.findFirst({
            where,
            select: {
              _count: {
                select: {
                  signatureRequests: true,
                  payments: true,
                  paymentProofs: true,
                  invoices: true,
                  expectedPayments: { where: { status: "CONFIRMED" } },
                },
              },
            },
          }) as never,
        ),
        { signatureRequests: "signatureRequests", payments: "payments", paymentProofs: "paymentProofs", expectedPayments: "confirmedExpectedPayments", invoices: "invoices" },
      );
  }
}

/** Cobros que entraron a un evento a través de sus presupuestos. */
async function paymentsViaBudget(eventId: string, tx: Tx): Promise<Blocker[]> {
  const n = await tx.clientPayment.count({ where: { budget: { eventId, ...anyState } } });
  return n > 0 ? [{ kind: "payments", count: n }] : [];
}

async function clientBlockers(id: string, organizationId: string, tx: Tx): Promise<Blocker[]> {
  const base = { organizationId, clientId: id, ...anyState };
  const [approvedBudgets, signedBudgets, payments, invoices, eventsWithPayments] = await Promise.all([
    tx.budget.count({ where: { ...base, status: "APPROVED" } }),
    tx.budget.count({ where: { ...base, signatureRequests: { some: { status: { in: ["SIGNED", "VALIDATED"] } } } } }),
    tx.clientPayment.count({ where: { organizationId, clientId: id } }),
    tx.invoice.count({ where: { organizationId, clientId: id } }),
    tx.event.count({ where: { ...base, budgets: { some: { payments: { some: {} } } } } }),
  ]);
  return Object.entries({ approvedBudgets, signedBudgets, payments, invoices, eventsWithPayments }).flatMap(([kind, count]) => (count > 0 ? [{ kind, count }] : []));
}

/**
 * Bloqueos del borrado definitivo con las reglas extra de la etapa 3 sobre `blockersFor`:
 * - Budget: el definitivo es solo de borradores (`notDraft`).
 * - Client: eventos (incluso eliminados) con gastos, facturas, trabajos, incidentes o reservas sin liberar; presupuestos con firma, cobro, comprobante, factura o pago esperado confirmado
 *   (incluso eliminados) bloquean, porque borrar el cliente los arrastraría por cascada.
 */
export async function purgeBlockers(model: TrashModel, id: string, organizationId: string, tx: Tx, options?: { lock?: boolean }): Promise<Blocker[]> {
  const blockers = await blockersFor(model, id, organizationId, tx, options);
  if (model === "Budget") {
    const row = await tx.budget.findFirst({ where: { id, organizationId, ...anyState }, select: { status: true } });
    if (row && row.status !== "DRAFT") blockers.push({ kind: "notDraft", count: 1 });
  } else if (model === "Client") {
    const withHistory = await tx.budget.count({
      where: {
        organizationId,
        clientId: id,
        ...anyState,
        OR: [
          { signatureRequests: { some: {} } },
          { payments: { some: {} } },
          { paymentProofs: { some: {} } },
          { invoices: { some: {} } },
          { expectedPayments: { some: { status: "CONFIRMED" } } },
        ],
      },
    });
    if (withHistory > 0 && !blockers.some((b) => b.kind === "budgetsWithHistory")) blockers.push({ kind: "budgetsWithHistory", count: withHistory });
    // Borrar el cliente cascadea TODOS sus eventos (también los eliminados): lo que cuelga de ellos
    // (gastos, facturas, trabajos de proveedor, incidentes; todo SetNull) perdería su vínculo.
    const event = { organizationId, clientId: id, ...anyState };
    const [expenses, invoices, supplierJobs, incidents, assignments] = await Promise.all([
      tx.expense.count({ where: { event } }),
      tx.invoice.count({ where: { event } }),
      tx.supplierJob.count({ where: { event, status: { not: "CANCELLED" } } }),
      tx.inventoryIncident.count({ where: { event } }),
      tx.eventInventory.count({ where: { event, releasedAt: null, checkedIn: false } }),
    ]);
    for (const [kind, count] of Object.entries({ eventExpenses: expenses, eventInvoices: invoices, eventSupplierJobs: supplierJobs, eventIncidents: incidents, eventAssignments: assignments })) {
      if (count > 0) blockers.push({ kind, count });
    }
  }
  return blockers;
}

/** Mensaje concreto del 409 de bloqueo. */
export function blockersMessage(blockers: Blocker[]): string {
  return `No se puede borrar definitivamente. ${formatBlockers(blockers).join(". ")}. Podés anonimizarlo para conservar el historial contable.`;
}

export function blockedError(blockers: Blocker[]): TrashError {
  return new TrashError(blockersMessage(blockers), 409, blockers);
}

// ── Anonimizar ───────────────────────────────────────────────────────────────

const ANON_NAME: Partial<Record<TrashModel, string>> = {
  Client: "Cliente eliminado",
  Lead: "Contacto eliminado",
  Supplier: "Proveedor eliminado",
  Promoter: "Promotora eliminada",
};

/**
 * Anonimiza una fila ya eliminada (PII fuera, historial contable intacto). Base para
 * Client y Lead; las demás entidades las implementan sus etapas (E2/E3) y hoy responden 501.
 * No se puede deshacer; la ruta exige `trash.manage`, nombre exacto y motivo.
 */
export async function anonymize(model: TrashModel, id: string, context: AuditContext, options?: TrashActionOptions): Promise<void> {
  if (model === "Budget") throw new TrashError("Un presupuesto no se anonimiza: su documento y snapshot se conservan o se borra el borrador sin historial.", 409);
  if (model === "InventoryItem") throw new TrashError(`Anonimizar ${LABELS[model].toLowerCase()} todavía no está disponible.`, 501);
  await run(options, async (tx) => {
    const row = await existsIncludingDeleted(model, id, context.organizationId, tx);
    if (!row) throw new TrashError(`${LABELS[model]} no existe.`, 404);
    if (!row.deletedAt) throw new TrashError("Eliminalo primero: solo se anonimiza lo que está en la papelera.", 409);
    if (row.anonymizedAt) throw new TrashError("Ya está anonimizado.", 409);
    const now = new Date();
    if (model === "Event") {
      // El evento conserva nombre, fechas y vínculos contables; salen las personas y las notas.
      await tx.event.update({
        where: { id },
        data: {
          responsibleName: null, responsiblePhone: null, responsibleEmail: null,
          venueContactName: null, venueContactPhone: null, venueContactEmail: null,
          notes: null, anonymizedAt: now,
        },
      });
      await recordAudit({ context, action: "anonymize", entity: "Event", entityId: id, summary: auditSummary("Anonimizó", model, id, options?.label), detail: options?.reason ? { fields: { reason: options.reason } } : null }, tx);
      return;
    }
    const name = `${ANON_NAME[model]} ·#${id.replace(/-/g, "").slice(-4)}`;
    if (model === "Client") {
      // legalName/ruc se conservan solo si una factura los necesita (la factura tiene su snapshot inmutable).
      const invoices = await tx.invoice.count({ where: { organizationId: context.organizationId, clientId: id } });
      await tx.client.update({
        where: { id },
        data: {
          name, company: null, tradeName: null, email: null, billingEmail: null, phone: null,
          contactName: null, contactRole: null, contactPhone: null, contactEmail: null,
          contacts: [], whatsapp: null, instagram: null, website: null, address: null, city: null, department: null, addressReference: null, locationUrl: null,
          notes: null, rucSnapshot: Prisma.DbNull,
          ...(invoices > 0 ? {} : { legalName: null, ruc: null }),
          anonymizedAt: now,
        },
      });
      await tx.clientLogo.deleteMany({ where: { clientId: id } });
      await tx.catalogAccessToken.updateMany({ where: { organizationId: context.organizationId, clientId: id, revokedAt: null }, data: { revokedAt: now } });
    } else if (model === "Supplier") {
      // El proveedor conserva trabajos, gastos y facturas de compra (libros); salen el contacto y las notas.
      await tx.supplier.update({ where: { id }, data: { name, company: null, phone: null, email: null, paymentTerms: null, notes: null, anonymizedAt: now } });
    } else if (model === "Promoter") {
      await tx.promoter.update({ where: { id }, data: { name, phone: null, email: null, photoUrl: null, specialties: null, notes: null, availabilityNote: null, anonymizedAt: now } });
    } else {
      await tx.lead.update({
        where: { id },
        data: { name, phone: "", email: "", company: null, ruc: null, reason: null, message: null, internalNotes: null, location: null, anonymizedAt: now },
      });
    }
    await recordAudit({ context, action: "anonymize", entity: model as AuditEntity, entityId: id, summary: auditSummary("Anonimizó", model, id) }, tx);
  });
}
