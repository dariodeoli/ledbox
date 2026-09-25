import { AdminIcon } from "@/components/admin/AdminIcons";
import type { AdminTone } from "@/lib/admin-format";
import type { AdminIconName } from "@/lib/admin-types";
import { PortalCardTitle } from "./PortalCardTitle";

/**
 * Pendientes del cliente (25-09-2026): lo que falta hacer con el presupuesto,
 * en una sola tarjeta y con acceso directo a la sección que lo resuelve.
 * Es solo presentación: qué pendiente corresponde lo decide
 * `PortalBudgetView`, que es quien conoce el estado real de la visita.
 */

export type PortalPendingItem = {
  id: string;
  icon: AdminIconName;
  tone: AdminTone;
  title: string;
  detail: string;
  /** Ancla interna de la sección que resuelve el pendiente. */
  href?: string;
  /** Texto del atajo, cuando hay ancla. */
  action?: string;
};

export type PortalPendingProgress = {
  confirmed: number;
  total: number;
  confirmedAmount: string;
  totalAmount: string;
};

export function PortalPending({
  items,
  progress = null,
}: {
  items: PortalPendingItem[];
  /** Avance de cobros confirmados sobre el plan (solo cuando hay plan real). */
  progress?: PortalPendingProgress | null;
}) {
  const pending = items.length > 0;
  return (
    <section className="portal-card portal-pending" aria-labelledby="portal-pending">
      <div className="portal-card-head">
        <PortalCardTitle id="portal-pending" icon={pending ? "alert" : "check"}>
          {pending ? "Tus pendientes" : "Sin pendientes"}
        </PortalCardTitle>
        <p className="portal-card-lead">
          {pending
            ? "Lo que falta para que tu presupuesto avance, con acceso directo a cada paso."
            : "No tenés nada pendiente: si algo cambia, te avisamos por el correo con el que te enviamos el presupuesto."}
        </p>
      </div>

      {progress && progress.total > 0 ? (
        <div className="portal-pending-progress">
          <p className="portal-help">
            Pagos confirmados: <strong className="portal-num">{progress.confirmed}</strong> de{" "}
            <strong className="portal-num">{progress.total}</strong> · {progress.confirmedAmount} de {progress.totalAmount}
          </p>
          <div
            className="portal-pending-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.confirmed}
            aria-label="Pagos confirmados del plan"
          >
            <span style={{ width: `${Math.round((progress.confirmed / progress.total) * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {pending ? (
        <ul className="portal-pending-list">
          {items.map((item) => (
            <li className="portal-pending-item" key={item.id} data-tone={item.tone}>
              <span className="portal-pending-icon">
                <AdminIcon name={item.icon} size={18} />
              </span>
              <span className="portal-pending-body">
                <strong>{item.title}</strong>
                <small>{item.detail}</small>
              </span>
              {item.href ? (
                <a className="portal-btn portal-btn--ghost portal-btn--sm portal-pending-action" href={item.href}>
                  {item.action ?? "Ver"}
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
