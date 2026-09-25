import Link from "next/link";
import { AdminIcon } from "@/components/admin/AdminIcons";
import type { AdminTimelineEntry } from "@/lib/admin-types";
import { countdownTone, formatCountdown, formatDate, formatDateTime, timelineKindLabel } from "@/lib/admin-format";
import type { PortalBudget } from "@/lib/server/budget-portal";
import { PortalCardTitle } from "./PortalCardTitle";

/**
 * Secciones **estáticas** del portal (issue #63): no dependen de ningún estado
 * del navegador —solo del presupuesto que ya llegó del servidor—, así que se
 * dibujan en el servidor y viajan como nodos al componente cliente
 * (`PortalBudgetView`), que las coloca en su lugar sin hidratarlas.
 *
 * Lo interactivo (chips de estado, ítems, acción, comprobante y pedidos) sigue
 * viviendo en el cliente porque cambia con lo que hace el visitante —y, en la
 * demo, con la simulación por sesión—. El HTML es el mismo de siempre: estos
 * componentes existen para que ese HTML no necesite JavaScript.
 */

/** Aviso de datos simulados (issue #29): en la demo el visitante ve que no escribe. */
export function PortalDemoBanner() {
  return (
    <section className="portal-banner portal-banner--demo" aria-labelledby="portal-demo">
      <h2 className="portal-banner-title" id="portal-demo">
        <AdminIcon name="info" size={16} />
        <span>Presupuesto de ejemplo · datos simulados</span>
      </h2>
      <p className="portal-banner-note">
        Estás en el modo demo del portal: el cliente, los ítems y los montos son ficticios. Lo que hagas acá se simula{" "}
        <strong>en tu navegador</strong> y no modifica el ejemplo —otro visitante ve el mismo estado—, así que podés probar
        la autogestión sin compromiso. <Link href="/portal">Volver a la portada</Link>.
      </p>
    </section>
  );
}

/** Nombre visible del cliente: razón social si existe, nombre de la persona si no. */
function clientLabelOf(budget: PortalBudget): string {
  return budget.client.company?.trim() || budget.client.name;
}

/** Encabezado del documento: referencia, título y quién lo preparó. */
export function PortalHeadTitle({ budget }: { budget: PortalBudget }) {
  return (
    <div className="portal-budget-head-title">
      <p className="portal-kicker">Presupuesto Nº {budget.reference}</p>
      <h1 className="portal-budget-title">{budget.title}</h1>
      <p className="portal-budget-meta">
        {clientLabelOf(budget)} · preparado por {budget.organization}
      </p>
    </div>
  );
}

/** Datos del encabezado: emisión, validez con cuenta regresiva y evento. */
export function PortalHeadFacts({ budget }: { budget: PortalBudget }) {
  return (
    <dl className="portal-facts portal-facts--head">
      <div>
        <dt>Emitido</dt>
        <dd>{formatDateTime(budget.createdAt)}</dd>
      </div>
      <div>
        <dt>Válido hasta</dt>
        <dd>
          {budget.validUntil ? (
            <>
              <span className="portal-nowrap">{formatDate(budget.validUntil)}</span>
              <span className="portal-countdown" data-tone={countdownTone(budget.validUntil)}>
                {formatCountdown(budget.validUntil, "client")}
              </span>
            </>
          ) : (
            "Sin fecha de vencimiento"
          )}
        </dd>
      </div>
      <div>
        <dt>Evento</dt>
        <dd>{budget.event?.name || "Sin evento asociado"}</dd>
      </div>
      <div>
        <dt>Inicio del evento</dt>
        <dd>{budget.event?.startsAt ? formatDateTime(budget.event.startsAt) : "—"}</dd>
      </div>
    </dl>
  );
}

/**
 * Cronología cliente (issue #33): los hitos reales del presupuesto. Es de solo
 * lectura y no cambia con lo que hace el visitante, así que va del servidor.
 */
export function PortalTimeline({ entries }: { entries: AdminTimelineEntry[] }) {
  return (
    <section className="portal-card" aria-labelledby="portal-timeline">
      <div className="portal-card-head">
        <PortalCardTitle id="portal-timeline" icon="clock">
          Cronología
        </PortalCardTitle>
        <p className="portal-card-lead">
          Todo lo que pasó con tu presupuesto, con la fecha real de cada paso: envío, cambios, autorización, pagos y evento.
        </p>
      </div>
      <ol className="portal-timeline">
        {entries.map((entry) => (
          <li className="portal-timeline-step" key={entry.id} data-tone={entry.tone}>
            <span className="portal-timeline-when">{formatDateTime(entry.at)}</span>
            <span className="portal-timeline-body">
              <strong>{entry.title}</strong>
              {entry.detail ? <small>{entry.detail}</small> : null}
              <small className="portal-timeline-kind">
                {timelineKindLabel(entry.kind)}
                {entry.actor ? ` · ${entry.actor}` : ""}
              </small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
