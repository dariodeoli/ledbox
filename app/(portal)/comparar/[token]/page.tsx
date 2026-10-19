import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicComparison } from "@/lib/server/quote-comparison-view";
import { PortalComparisonView } from "../../_components/PortalComparisonView";
import { PortalBrandScope } from "../../_components/PortalCompany";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const group = await loadPublicComparison(token);
  const title = group ? `Propuestas de ${group.company.name}` : "Comparación de presupuestos";
  const description = group
    ? `Compará las alternativas preparadas por ${group.company.name} y elegí una.`
    : "Compará las alternativas de tu presupuesto.";
  return {
    title,
    description,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}
export default async function ComparisonPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const group = await loadPublicComparison(token);
  if (!group) notFound();
  return <PortalBrandScope company={group.company}><PortalComparisonView initial={group} token={token} /></PortalBrandScope>;
}
