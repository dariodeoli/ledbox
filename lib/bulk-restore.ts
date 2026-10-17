export type RestoreCandidate = { key: string; id: string; name: string; restorable: boolean };
export type RestoreAttempt = { ok: boolean; uncertain?: boolean; error?: string };
export type RestoreOutcome = { candidate: RestoreCandidate; status: "success" | "blocked" | "failed" | "unknown"; message: string };

/** Restores only explicitly selected, eligible rows. A lost response stops the batch. */
export async function restoreTrashBatch(
  candidates: readonly RestoreCandidate[],
  restoreOne: (candidate: RestoreCandidate) => Promise<RestoreAttempt>,
): Promise<RestoreOutcome[]> {
  const outcomes: RestoreOutcome[] = [];
  for (const candidate of candidates) {
    if (!candidate.restorable) {
      outcomes.push({ candidate, status: "blocked", message: "No se puede restaurar este registro." });
      continue;
    }
    let attempt: RestoreAttempt;
    try { attempt = await restoreOne(candidate); }
    catch (error) { attempt = { ok: false, uncertain: true, error: error instanceof Error ? error.message : "Error de conexión." }; }
    if (attempt.ok) outcomes.push({ candidate, status: "success", message: "Volvió a archivados." });
    else if (attempt.uncertain) {
      outcomes.push({ candidate, status: "unknown", message: "Resultado por confirmar. No se reintentó; revisá la papelera antes de volver a actuar." });
      break;
    } else outcomes.push({ candidate, status: "failed", message: attempt.error || "No se pudo restaurar." });
  }
  return outcomes;
}
