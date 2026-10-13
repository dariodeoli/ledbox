import type { Ref } from "react";
import { AdminIcon } from "@/components/admin/AdminIcons";
import type { AdminTone } from "@/lib/admin-format";
import type { AdminIconName } from "@/lib/admin-types";

/**
 * «Qué tenés que hacer ahora»: la tarjeta que sigue al encabezado y dice, según
 * el estado real del presupuesto, la UNA cosa pendiente del cliente —autorizar,
 * pagar o nada—. Es solo presentación: qué corresponde lo decide
 * `PortalBudgetView` (con `lib/portal-view.ts`), que conoce el estado de la visita.
 */

export type PortalNextStepProgress = {
  confirmed: number;
  total: number;
  confirmedAmount: string;
  totalAmount: string;
};

export function PortalNextStep({
  icon,
  tone,
  title,
  detail,
  cta,
  progress = null,
  innerRef,
}: {
  icon: AdminIconName;
  tone: AdminTone;
  title: string;
  detail: string;
  /** Acción principal: ancla interna de la sección que la resuelve. */
  cta?: { label: string; href: string };
  /** Avance de cobros confirmados sobre el plan (solo cuando hay plan real). */
  progress?: PortalNextStepProgress | null;
  /** Foco al cambiar de estado (lectores de pantalla anuncian el resultado). */
  innerRef?: Ref<HTMLElement>;
}) {
  return (
    <section className="portal-card portal-next" aria-labelledby="portal-next" data-tone={tone} ref={innerRef} tabIndex={-1}>
      <p className="portal-next-eyebrow">Qué tenés que hacer ahora</p>
      <div className="portal-next-body">
        <span className="portal-next-icon" aria-hidden="true">
          <AdminIcon name={icon} size={20} />
        </span>
        <div className="portal-next-copy">
          <h2 className="portal-next-title" id="portal-next">
            {title}
          </h2>
          <p className="portal-next-detail">{detail}</p>
        </div>
      </div>
      {progress && progress.total > 1 ? (
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
      {cta ? (
        <a className="portal-btn portal-btn--primary portal-btn--block portal-print-hide" href={cta.href}>
          {cta.label}
        </a>
      ) : null}
    </section>
  );
}
