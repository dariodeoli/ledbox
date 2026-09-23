import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicBudget } from "@/lib/server/budget-portal";
import { PortalBudgetView } from "../../_components/PortalBudgetView";
import { PortalDemoBanner, PortalHeadFacts, PortalHeadTitle, PortalTimeline } from "../../_components/PortalBudgetStatic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Presupuesto", robots: { index: false, follow: false } };

/**
 * Vista pública de un presupuesto por código de link (issue #12).
 * Un código inválido, revocado o inexistente no revela nada: 404.
 *
 * Es la primera apertura del link: `loadPublicBudget` sella `Budget.viewedAt`
 * una sola vez (issue #33) y arma la cronología cliente que la página dibuja.
 *
 * El modo demo se detecta **en el servidor** por la empresa del presupuesto
 * (issue #52): la vista de la empresa de ejemplo muestra el aviso de datos
 * simulados y simula las acciones del cliente sin escribir nada. `?demo=1`
 * (issue #29) se sigue aceptando por compatibilidad con links viejos, pero ya no
 * hace falta.
 *
 * Las secciones de solo lectura (encabezado, cronología y el aviso de la demo)
 * se arman acá, en el servidor (issue #63), y viajan a la vista como nodos: el
 * cliente solo hidrata lo que el visitante puede cambiar.
 */
export default async function PortalBudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ demo?: string | string[] }>;
}) {
  const [{ token }, search] = await Promise.all([params, searchParams]);
  const budget = await loadPublicBudget(token, { sealView: true });
  if (!budget) notFound();
  const demo = budget.demo || search.demo === "1";
  return (
    <PortalBudgetView
      budget={budget}
      token={token}
      demo={demo}
      demoBanner={demo ? <PortalDemoBanner /> : null}
      headTitle={<PortalHeadTitle budget={budget} />}
      headFacts={<PortalHeadFacts budget={budget} />}
      timeline={budget.timeline.length > 0 ? <PortalTimeline entries={budget.timeline} /> : null}
    />
  );
}
