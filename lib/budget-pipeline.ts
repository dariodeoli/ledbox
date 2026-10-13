import { budgetCollectionStep, type BudgetCollectionConcept } from "./budget-collection-step";
import { budgetEventPrompt } from "./budget-event";

/**
 * Etapas comerciales de la lista de Presupuestos y su próxima acción lógica.
 * Lógica pura de presentación: no cambia estados ni montos, solo agrupa y
 * decide qué botón se muestra en la fila. Los permisos reales los valida el API.
 */
export type BudgetPipelineStage = "draft" | "sent" | "approved_pending_event" | "approved" | "lost";
/** Filtro de la lista: una etapa, todos los aprobados juntos o nada. */
export type BudgetPipelineFilter = BudgetPipelineStage | "approved_any" | "all";

export const PIPELINE_STAGE_LABEL: Record<BudgetPipelineStage, string> = {
  draft: "Borrador",
  sent: "Enviado",
  approved_pending_event: "Aprobado sin evento",
  approved: "Aprobado",
  lost: "Perdido",
};

export type BudgetPipelineInput = {
  status: string;
  approvedAt?: string | null;
  eventId?: string | null;
  event?: { status: string } | null;
  total: number;
  advanceAmount: number;
  revisionRequested?: boolean;
  expectedPayments?: readonly BudgetCollectionConcept[];
  /** Plata efectivamente cobrada. */
  collected: number;
};

export function budgetPipelineStage(budget: Pick<BudgetPipelineInput, "status" | "event" | "eventId">): BudgetPipelineStage {
  switch (budget.status) {
    case "APPROVED":
      return budgetEventPrompt(budget) === "create" ? "approved_pending_event" : "approved";
    case "LOST":
    case "CANCELLED":
      return "lost";
    case "SENT":
    case "NEGOTIATING":
      return "sent";
    default:
      return "draft";
  }
}

export function matchesPipelineFilter(stage: BudgetPipelineStage, filter: BudgetPipelineFilter): boolean {
  if (filter === "all") return true;
  if (filter === "approved_any") return stage === "approved" || stage === "approved_pending_event";
  return stage === filter;
}

export type BudgetPrimaryAction =
  | { kind: "send" | "approve" | "edit" | "create_event" | "confirm_event" | "collect" | "review_proof"; label: string };

/** La única acción visible de la fila: la siguiente lógica según la etapa. */
export function budgetPrimaryAction(
  budget: BudgetPipelineInput,
  can: { write: boolean; createEvent: boolean },
): BudgetPrimaryAction | null {
  const stage = budgetPipelineStage(budget);
  if (stage === "draft") return can.write ? { kind: "send", label: "Enviar" } : null;
  if (stage === "sent") {
    if (!can.write) return null;
    if (budget.revisionRequested) return { kind: "edit", label: "Responder" };
    return { kind: "approve", label: "Aprobar" };
  }
  if (stage === "lost") return null;
  const prompt = budgetEventPrompt(budget);
  if (prompt && can.createEvent) return prompt === "create" ? { kind: "create_event", label: "Crear evento" } : { kind: "confirm_event", label: "Confirmar evento" };
  if (!can.write) return null;
  const step = budgetCollectionStep(budget);
  if (step.kind === "payment") return { kind: "collect", label: step.label.includes("anticipo") ? "Cobrar seña" : "Cobrar" };
  if (step.kind === "review") return { kind: "review_proof", label: "Revisar pago" };
  return null;
}
