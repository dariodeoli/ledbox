import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreFront } from "@/components/catalog-public/StoreFront";
import { loadPublicCatalogItems, loadPublicZones, loadStorefront, parsePublicRange, resolvePublicCatalog } from "@/lib/server/catalog-public";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug } = await params;
  const context = await resolvePublicCatalog(orgSlug);
  if (!context) return { title: { absolute: "Tienda no encontrada" }, robots: { index: false, follow: false } };
  const name = context.organization.name;
  const description = context.settings.storefrontTagline || `Alquiler de equipos con ${name}. Elegí lo que necesitás y te respondemos con una cotización.`;
  return {
    title: { absolute: `${name} · Tienda de alquiler` },
    description,
    openGraph: { title: `${name} · Tienda de alquiler`, description, type: "website", siteName: name, locale: "es_PY" },
    robots: context.demo ? { index: false, follow: false } : { index: true, follow: true },
  };
}

/**
 * Tienda web de una empresa (`/tienda/<slug>`): solo si la empresa la encendió; si no,
 * 404. Muestra únicamente los productos de cliente final (RETAIL y BOTH) de ESA empresa,
 * con su precio de lista (o «Consultar») y la disponibilidad como pista, nunca el
 * número exacto. El catálogo mayorista vive en un link privado aparte.
 */
export default async function StorePage({ params, searchParams }: PageProps) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const context = await resolvePublicCatalog(orgSlug);
  if (!context) notFound();
  const range = parsePublicRange(first(query.desde), first(query.hasta));
  const [store, items, zones] = await Promise.all([loadStorefront(context), loadPublicCatalogItems(context, range), loadPublicZones(context)]);
  const slug = encodeURIComponent(context.organization.slug);
  return (
    <StoreFront
      store={store}
      items={items}
      zones={zones}
      showPrices={context.settings.publicShowPrices}
      demo={context.demo}
      range={range ? { fromKey: range.fromKey, toKey: range.toKey, days: range.days } : null}
      initialCategory={first(query.categoria) ?? null}
      basePath={`/tienda/${slug}`}
      preorderPath={`/api/catalog/${slug}/preorder`}
    />
  );
}
