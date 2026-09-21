import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicBudget } from "@/lib/server/budget-portal";
import { PortalBudgetView } from "../../_components/PortalBudgetView";

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
 * `?demo=1` (issue #29) es el marcador que deja `GET /api/portal/demo` al entrar
 * por el ejemplo: muestra el aviso de datos simulados. Los links reales no lo
 * llevan y no cambian en nada.
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
  return <PortalBudgetView budget={budget} token={token} demo={search.demo === "1"} />;
}
