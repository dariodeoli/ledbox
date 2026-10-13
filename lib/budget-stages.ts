/**
 * Etapas del recorrido comercial de un presupuesto:
 * Lead → Presupuesto → Aprobado → Evento → Cobrado. Lógica pura: el componente
 * `StageTrail` solo la dibuja.
 */

export type StageState = "done" | "current" | "todo";
export type BudgetStage = {
  key: "lead" | "budget" | "approved" | "event" | "paid";
  label: string;
  state: StageState;
  /** Link a la pantalla de la etapa cuando existe. */
  href?: string;
  /** Texto corto bajo la etapa (ej.: «2/3 cuotas»). */
  detail?: string;
};

export type BudgetStageInput = {
  leadId?: string | null;
  status: string;
  approvedAt?: string | Date | null;
  event?: { id: string; name: string } | null;
  total: number;
  /** Pagos esperados vigentes (sin cancelar). `CONFIRMED` cuenta como cuota pagada. */
  expectedPayments?: ReadonlyArray<{ status: string }>;
  /** Plata efectivamente cobrada (suma de cobros). */
  collected: number;
};

/** Cuotas pagadas / total según el plan; `null` si el presupuesto no tiene plan generado. */
export function installmentProgress(expected: ReadonlyArray<{ status: string }> | undefined): { paid: number; total: number } | null {
  const rows = (expected ?? []).filter((row) => row.status !== "CANCELLED");
  if (rows.length === 0) return null;
  return { paid: rows.filter((row) => row.status === "CONFIRMED").length, total: rows.length };
}

export function budgetStages(input: BudgetStageInput): BudgetStage[] {
  const approved = input.status === "APPROVED" || Boolean(input.approvedAt);
  const closed = input.status === "LOST" || input.status === "CANCELLED";
  const progress = installmentProgress(input.expectedPayments);
  const paidFull = input.total > 0 && input.collected >= input.total;
  const paid: BudgetStage = {
    key: "paid",
    label: "Cobrado",
    state: paidFull ? "done" : approved && input.collected > 0 ? "current" : "todo",
    href: approved ? "/finanzas" : undefined,
    detail: progress ? `${progress.paid}/${progress.total} cuotas` : undefined,
  };
  const stages: BudgetStage[] = [];
  if (input.leadId) stages.push({ key: "lead", label: "Lead", state: "done", href: `/leads?lead=${encodeURIComponent(input.leadId)}` });
  stages.push({ key: "budget", label: "Presupuesto", state: approved || closed ? "done" : "current" });
  stages.push({ key: "approved", label: "Aprobado", state: approved ? "done" : "todo" });
  stages.push({
    key: "event",
    label: "Evento",
    state: input.event ? "done" : approved ? "current" : "todo",
    href: input.event ? `/eventos?evento=${encodeURIComponent(input.event.id)}` : undefined,
    detail: input.event?.name,
  });
  stages.push(paid);
  return stages;
}
