import type { AuditContext } from "./audit";
import { dbWithDeleted } from "./db";
import { TrashError, type TrashModel } from "./trash";
import { CRM_MODELS, purgeCrm, type CrmModel } from "./trash-crm";
import { purgeEvent, purgeInventoryItem, purgeInventoryFamily } from "./trash-ops";
import { trashPurgeCutoff } from "../trash-shared";

/**
 * Papelera, etapa 5 (docs/PAPELERA.md «Purga a N días»): vaciado automático y perezoso.
 * Se dispara al abrir la papelera (`GET /api/admin/trash`), solo si la empresa configuró
 * `trashPurgeDays`. No duplica reglas: cada borrado pasa por `purgeEvent`, `purgeInventoryItem`
 * o `purgeCrm`, que revalidan los bloqueos con `FOR UPDATE`. Lo bloqueado (contable) se conserva.
 */

/** Tope de borrados por pasada: la request que abre la papelera no se cuelga. */
export const PURGE_BATCH_LIMIT = 50;
/** Presupuesto de tiempo de un barrido (la apertura de la papelera no espera más). */
export const PURGE_TIME_BUDGET_MS = 3_000;
/** Candidatos que se leen por tipo y por vuelta del reparto round-robin. */
export const PURGE_PAGE_SIZE = 10;
/** No más de un barrido por empresa cada 10 minutos (evita reintentar siempre los mismos bloqueados). */
export const PURGE_COOLDOWN_MS = 10 * 60_000;

export const SYSTEM_PURGE_USER = { id: "system", name: "Sistema", email: "", role: "OWNER" as const };

export const autoPurgeReason = (days: number) => `Vaciado automático a ${days} días`;

export type PurgeSweepResult = { skipped: boolean; purged: number; retained: number; failed: number };

type Candidate = { type: TrashModel; id: string; name: string; deletedAt: Date };
type Cursor = { at: Date; id: string } | null;

type Page = (where: object, take: number) => Promise<Candidate[]>;

const orderBy = [{ deletedAt: "asc" }, { id: "asc" }] as const;

function named(type: TrashModel, find: (args: object) => Promise<{ id: string; name: string; deletedAt: Date | null }[]>): Page {
  return async (where, take) =>
    (await find({ where, select: { id: true, name: true, deletedAt: true }, orderBy, take })).map((row) => ({ type, id: row.id, name: row.name, deletedAt: row.deletedAt! }));
}

const PAGERS: Page[] = [
  named("Event", (a) => dbWithDeleted.event.findMany(a as never) as never),
  named("InventoryFamily", (a) => {
    const args = a as { where: Record<string, unknown> };
    const { anonymizedAt: _unsupported, ...where } = args.where;
    return dbWithDeleted.inventoryFamily.findMany({ ...a, where } as never) as never;
  }),
  named("InventoryItem", (a) => dbWithDeleted.inventoryItem.findMany(a as never) as never),
  named("Client", (a) => dbWithDeleted.client.findMany(a as never) as never),
  named("Lead", (a) => dbWithDeleted.lead.findMany(a as never) as never),
  named("Supplier", (a) => dbWithDeleted.supplier.findMany(a as never) as never),
  named("Promoter", (a) => dbWithDeleted.promoter.findMany(a as never) as never),
  async (where, take) =>
    (await dbWithDeleted.budget.findMany({ where, select: { id: true, title: true, deletedAt: true }, orderBy: [...orderBy], take })).map((row) => ({
      type: "Budget" as const,
      id: row.id,
      name: row.title,
      deletedAt: row.deletedAt!,
    })),
];

/** Página siguiente de vencidos de un tipo, después del cursor `(deletedAt, id)`. */
function nextPage(pager: Page, organizationId: string, cutoff: Date, cursor: Cursor): Promise<Candidate[]> {
  const base = { organizationId, deletedAt: { lt: cutoff }, anonymizedAt: null };
  const where = cursor ? { ...base, AND: [{ OR: [{ deletedAt: { gt: cursor.at } }, { deletedAt: cursor.at, id: { gt: cursor.id } }] }] } : base;
  return pager(where, PURGE_PAGE_SIZE);
}

async function purgeOne(candidate: Candidate, days: number, context: AuditContext): Promise<void> {
  const input = { confirmName: candidate.name, reason: autoPurgeReason(days) };
  if (candidate.type === "Event") return purgeEvent(candidate.id, input, context);
  if (candidate.type === "InventoryFamily") return purgeInventoryFamily(candidate.id, input, context);
  if (candidate.type === "InventoryItem") return purgeInventoryItem(candidate.id, input, context);
  if (CRM_MODELS.includes(candidate.type as CrmModel)) return purgeCrm(candidate.type as CrmModel, candidate.id, input, context);
  throw new TrashError("Tipo desconocido.", 404);
}

/** Barrido acotado: reparte entre los tipos (round-robin con cursor) y corta por borrados o por tiempo. */
async function sweep(organizationId: string, days: number, now: Date): Promise<PurgeSweepResult> {
  const result: PurgeSweepResult = { skipped: false, purged: 0, retained: 0, failed: 0 };
  const context: AuditContext = { organizationId, user: SYSTEM_PURGE_USER };
  const cutoff = trashPurgeCutoff(days, now);
  const deadline = Date.now() + PURGE_TIME_BUDGET_MS;
  const cursors: Cursor[] = PAGERS.map(() => null);
  const done = PAGERS.map(() => false);
  const over = () => result.purged >= PURGE_BATCH_LIMIT || Date.now() >= deadline;
  try {
    while (!over() && done.some((flag) => !flag)) {
      for (let i = 0; i < PAGERS.length && !over(); i += 1) {
        if (done[i]) continue;
        const page = await nextPage(PAGERS[i], organizationId, cutoff, cursors[i]);
        if (page.length < PURGE_PAGE_SIZE) done[i] = true;
        for (const candidate of page) {
          if (over()) break;
          cursors[i] = { at: candidate.deletedAt, id: candidate.id };
          try {
            await purgeOne(candidate, days, context);
            result.purged += 1;
          } catch (error) {
            // 409: bloqueado (contable) o tomado por otro barrido → se conserva y se sigue. 404: ya lo borró otro.
            if (error instanceof TrashError && error.status === 409) result.retained += 1;
            else if (!(error instanceof TrashError && error.status === 404)) {
              result.failed += 1;
              console.error(`[trash-purge] No se pudo vaciar ${candidate.type}:${candidate.id}:`, error instanceof Error ? error.message : error);
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`[trash-purge] Falló el vaciado de la empresa ${organizationId}:`, error instanceof Error ? error.message : error);
    result.failed += 1;
  }
  return result;
}

// Por proceso: un barrido en vuelo por empresa (las llamadas simultáneas lo comparten) y un enfriamiento.
const inFlight = new Map<string, Promise<PurgeSweepResult>>();
const lastSweep = new Map<string, number>();

export type PurgeOptions = { now?: Date; cooldownMs?: number; shared?: boolean };

/**
 * Vacía lo eliminado hace más de `days` días en la empresa. Sin transacción larga: cada borrado
 * revalida bloqueos con el `FOR UPDATE` de su fila (otro barrido que la tenga primero da 404/409 y se
 * ignora). Dedupe por proceso (`inFlight`) y como máximo un barrido cada 10 min por empresa.
 * Nunca lanza por un registro; `shared: false` (pruebas) desactiva el dedupe y el enfriamiento.
 */
export function purgeExpiredTrash(organizationId: string, days: number | null | undefined, options: PurgeOptions = {}): Promise<PurgeSweepResult> {
  const skipped: PurgeSweepResult = { skipped: true, purged: 0, retained: 0, failed: 0 };
  if (!days || days < 1) return Promise.resolve(skipped);
  const now = options.now ?? new Date();
  if (options.shared === false) return sweep(organizationId, days, now);
  const running = inFlight.get(organizationId);
  if (running) return running;
  const cooldown = options.cooldownMs ?? PURGE_COOLDOWN_MS;
  const last = lastSweep.get(organizationId);
  if (last !== undefined && Date.now() - last < cooldown) return Promise.resolve(skipped);
  lastSweep.set(organizationId, Date.now());
  const promise = sweep(organizationId, days, now).finally(() => inFlight.delete(organizationId));
  inFlight.set(organizationId, promise);
  return promise;
}

/** Solo pruebas: olvida enfriamientos y barridos en vuelo. */
export function resetPurgeState(): void {
  inFlight.clear();
  lastSweep.clear();
}
