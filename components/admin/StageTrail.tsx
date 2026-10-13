import Link from "next/link";
import type { BudgetStage } from "@/lib/budget-stages";
import { AdminIcon } from "./AdminIcons";

/**
 * Barra de etapas chica: Lead → Presupuesto → Aprobado → Evento → Cobrado.
 * Solo dibuja las etapas que le llegan (la lógica vive en `lib/budget-stages`);
 * cada etapa lleva link cuando existe. Reutilizable en cualquier detalle.
 */
export function StageTrail({ stages, label = "Etapas" }: { stages: readonly BudgetStage[]; label?: string }) {
  return (
    <ol className="admin-stage-trail" aria-label={label}>
      {stages.map((stage) => {
        const content = (
          <>
            <span className="admin-stage-dot" aria-hidden="true">
              {stage.state === "done" ? <AdminIcon name="check" size={10} /> : null}
            </span>
            <span className="admin-stage-text">
              <span className="admin-stage-label">{stage.label}</span>
              {stage.detail ? <small className="admin-stage-detail" title={stage.detail}>{stage.detail}</small> : null}
            </span>
          </>
        );
        return (
          <li key={stage.key} className="admin-stage" data-state={stage.state} aria-current={stage.state === "current" ? "step" : undefined}>
            {stage.href ? (
              <Link className="admin-stage-link" href={stage.href} title={`Abrir ${stage.label.toLowerCase()}`}>
                {content}
              </Link>
            ) : (
              <span className="admin-stage-link">{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
