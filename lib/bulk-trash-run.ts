export type StoredTrashOutcome = { id: string; name: string; status: "success" | "blocked" | "failed" | "unknown"; message: string };

/** Accepts only the documented row/result fields before saving a tenant audit snapshot. */
export function readStoredTrashOutcomes(value: unknown): StoredTrashOutcome[] | null {
  if (!Array.isArray(value) || value.length > 2000) return null;
  const output: StoredTrashOutcome[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const candidate = row.row && typeof row.row === "object" ? row.row as Record<string, unknown> : row;
    const id = candidate.id, name = candidate.name, status = row.status, message = row.message;
    if (typeof id !== "string" || !id.length || id.length > 128 || typeof name !== "string" || name.length > 240 ||
      !["success", "blocked", "failed", "unknown"].includes(String(status)) || typeof message !== "string" || message.length > 500) return null;
    output.push({ id, name, status: status as StoredTrashOutcome["status"], message });
  }
  return output;
}
