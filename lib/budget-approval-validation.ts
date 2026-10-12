/** Same trimmed-note contract as /api/admin/budgets/approval. */
export const BUDGET_APPROVAL_NOTE_MAX = 1000;

export function budgetApprovalNoteError(decision: "approve" | "request_revision", note: string): string | null {
  const trimmed = note.trim();
  if (trimmed.length > BUDGET_APPROVAL_NOTE_MAX) return `La nota no puede superar los ${BUDGET_APPROVAL_NOTE_MAX} caracteres.`;
  if (decision === "request_revision" && !trimmed) return "Indicá qué cambios se piden.";
  return null;
}
