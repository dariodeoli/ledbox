import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogBrowser } from "@/components/catalog-public/CatalogBrowser";
import { loadPublicCatalogItems, parsePublicRange, resolvePublicCatalog } from "@/lib/server/catalog-public";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const context = await resolvePublicCatalog(orgSlug);
  if (!context) return { title: { absolute: "Catálogo no encontrado" }, robots: { index: false, follow: false } };
  return {
    title: { absolute: `${context.organization.name} · Catálogo de alquiler` },
    description: `Equipos disponibles para alquilar con ${context.organization.name}. Armá tu pedido y te respondemos con una cotización.`,
    robots: context.demo ? { index: false, follow: false } : { index: true, follow: true },
  };
}

/**
 * Catálogo público de una empresa (`/catalogo/<slug>`): solo si la empresa lo
 * encendió; si no, 404. Muestra únicamente los artículos marcados como visibles
 * en la web, de ESA empresa, y la disponibilidad como pista («Disponible»,
 * «Pocas unidades» o «Consultar»), nunca el número exacto.
 */
export default async function CatalogPage({ params, searchParams }: PageProps) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const context = await resolvePublicCatalog(orgSlug);
  if (!context) notFound();
  const range = parsePublicRange(first(query.desde), first(query.hasta));
  const items = await loadPublicCatalogItems(context, range);
  return (
    <CatalogBrowser
      slug={context.organization.slug}
      organizationName={context.organization.name}
      whatsappPhone={context.settings.whatsappPhone}
      showPrices={context.settings.publicShowPrices}
      demo={context.demo}
      items={items}
      range={range ? { fromKey: range.fromKey, toKey: range.toKey, days: range.days } : null}
    />
  );
}
