"use client";

import { BUDGET_EVENT_NOTICE, type BudgetEventPrompt } from "@/lib/budget-event";
import { AdminButton } from "./AdminUI";

/**
 * Aviso destacado de un presupuesto aprobado: falta crear el evento (botón
 * principal «Crear evento») o el evento sigue en borrador («Confirmar evento»).
 * Sin permiso de eventos solo informa. Una sola pieza para la tabla, las
 * tarjetas y el detalle.
 */
export function BudgetEventNotice({
  prompt,
  title,
  canAct,
  busy,
  onCreate,
  onConfirm,
}: {
  prompt: Exclude<BudgetEventPrompt, null>;
  /** Título del presupuesto, para el nombre accesible de la acción. */
  title: string;
  canAct: boolean;
  busy: boolean;
  onCreate: () => void;
  onConfirm: () => void;
}) {
  const create = prompt === "create";
  return (
    <div className="admin-event-alert" role="status" data-prompt={prompt}>
      <span className="admin-event-alert-text">{create ? `${BUDGET_EVENT_NOTICE}.` : "El cliente aprobó el presupuesto. El evento sigue en borrador."}</span>
      {canAct ? (
        <AdminButton
          variant="primary"
          icon={create ? "plus" : "check"}
          busy={busy}
          title={`${create ? "Crear el evento" : "Confirmar el evento"} de ${title}`}
          onClick={create ? onCreate : onConfirm}
        >
          {create ? "Crear evento" : "Confirmar evento"}
        </AdminButton>
      ) : null}
    </div>
  );
}
