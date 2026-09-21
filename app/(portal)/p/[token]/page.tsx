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
 */
export default async function PortalBudgetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const budget = await loadPublicBudget(token);
  if (!budget) notFound();
  return <PortalBudgetView budget={budget} token={token} />;
}
