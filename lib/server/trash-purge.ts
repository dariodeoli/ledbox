import type { AuditContext } from "./audit";
import { dbWithDeleted } from "./db";
import { TrashError, type TrashModel } from "./trash";
import { CRM_MODELS, purgeCrm, type CrmModel } from "./trash-crm";
import { purgeEvent, purgeInventoryItem } from "./trash-ops";
import { trashPurgeCutoff } from "../trash-shared";

/**
 * Papelera, etapa 5 (docs/PAPELERA.md «Purga a N días»): vaciado automático y perezoso.
 * Se dispara al abrir la papelera (`GET /api/admin/trash`), solo si la empresa configuró
 * `trashPurgeDays`. No duplica reglas: cada borrado pasa por `purgeEvent`, `purgeInventoryItem`
 * o `purgeCrm`, que revalidan los bloqueos con `FOR UPDATE`. Lo bloqueado (contable) se conserva.
 */

/** Tope de borrados por pasada: la request que abre la papelera no se cuelga. */
export const PURGE_BATCH_LIMIT = 50;
/** Tope de candidatos revisados por pasada (los bloqueados no cuentan como borrados). */
export const PURGE_SCAN_LIMIT = 150;

export const SYSTEM_PURGE_USER = { id: "system", name: "Sistema", email: "", role: "OWNER" as const };

export const autoPurgeReason = (days: number) => `Vaciado automático a ${days} días`;

export type PurgeSweepResult = { skipped: boolean; purged: number; retained: number; failed: number };

type Candidate = { type: TrashModel; id: string; name: string };

async function loadCandidates(organizationId: string, cutoff: Date, take: number): Promise<Candidate[]> {
  const where = { organizationId, deletedAt: { lt: cutoff }, anonymizedAt: null } as const;
  const orderBy = { deletedAt: "asc" } as const;
  const named = { id: true, name: true } as const;
  const [events, items, clients, leads, suppliers, promoters, budgets] = await Promise.all([
    dbWithDeleted.event.findMany({ where, select: named, orderBy, take }),
    dbWithDeleted.inventoryItem.findMany({ where, select: named, orderBy, take }),
    dbWithDeleted.client.findMany({ where, select: named, orderBy, take }),
    dbWithDeleted.lead.findMany({ where, select: named, orderBy, take }),
    dbWithDeleted.supplier.findMany({ where, select: named, orderBy, take }),
    dbWithDeleted.promoter.findMany({ where, select: named, orderBy, take }),
    dbWithDeleted.budget.findMany({ where, select: { id: true, title: true, deletedAt: true }, orderBy, take }),
  ]);
  const tag = (type: TrashModel) => (row: { id: string; name: string }): Candidate => ({ type, id: row.id, name: row.name });
  return [
    ...events.map(tag("Event")),
    ...items.map(tag("InventoryItem")),
    ...clients.map(tag("Client")),
    ...leads.map(tag("Lead")),
    ...suppliers.map(tag("Supplier")),
    ...promoters.map(tag("Promoter")),
    ...budgets.map((row) => ({ type: "Budget" as const, id: row.id, name: row.title })),
  ];
}

async function purgeOne(candidate: Candidate, days: number, context: AuditContext): Promise<void> {
  const input = { confirmName: candidate.name, reason: autoPurgeReason(days) };
  if (candidate.type === "Event") return purgeEvent(candidate.id, input, context);
  if (candidate.type === "InventoryItem") return purgeInventoryItem(candidate.id, input, context);
  if (CRM_MODELS.includes(candidate.type as CrmModel)) return purgeCrm(candidate.type as CrmModel, candidate.id, input, context);
  throw new TrashError("Tipo desconocido.", 404);
}

/**
 * Vacía lo eliminado hace más de `days` días en la empresa. Un solo barrido a la vez por empresa:
 * con el candado asesor tomado por otra request, esta sigue sin purgar (`skipped`).
 * Nunca lanza por un registro: lo bloqueado se cuenta como conservado y cualquier otro error se registra.
 */
export async function purgeExpiredTrash(organizationId: string, days: number | null | undefined, now: Date = new Date()): Promise<PurgeSweepResult> {
  const result: PurgeSweepResult = { skipped: false, purged: 0, retained: 0, failed: 0 };
  if (!days || days < 1) return { ...result, skipped: true };
  const context: AuditContext = { organizationId, user: SYSTEM_PURGE_USER };
  const cutoff = trashPurgeCutoff(days, now);
  try {
    await dbWithDeleted.$transaction(
      async (tx) => {
        const lock = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${organizationId})) AS locked`;
        if (!lock[0]?.locked) {
          result.skipped = true;
          return;
        }
        const candidates = await loadCandidates(organizationId, cutoff, PURGE_SCAN_LIMIT);
        let scanned = 0;
        for (const candidate of candidates) {
          if (result.purged >= PURGE_BATCH_LIMIT || scanned >= PURGE_SCAN_LIMIT) break;
          scanned += 1;
          try {
            await purgeOne(candidate, days, context);
            result.purged += 1;
          } catch (error) {
            if (error instanceof TrashError && error.status === 409) result.retained += 1;
            else if (error instanceof TrashError && error.status === 404) continue; // otra request ya lo borró
            else {
              result.failed += 1;
              console.error(`[trash-purge] No se pudo vaciar ${candidate.type}:${candidate.id}:`, error instanceof Error ? error.message : error);
            }
          }
        }
      },
      { timeout: 60_000, maxWait: 5_000 },
    );
  } catch (error) {
    console.error(`[trash-purge] Falló el vaciado de la empresa ${organizationId}:`, error instanceof Error ? error.message : error);
    result.failed += 1;
  }
  return result;
}
