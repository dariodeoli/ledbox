import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessPage } from "@/components/catalog-public/AccessPage";
import { StoreFront } from "@/components/catalog-public/StoreFront";
import { loadCategoryImages, loadPublicCollections, loadPublicCatalogItems, loadPublicZones, loadStorefront, parsePublicRange, resolvePublicCatalog } from "@/lib/server/catalog-public";
import { loadStoreSocialImage } from "@/lib/server/store-seo";
import { storefrontMetadata } from "@/lib/store-seo";

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
  const description = context.settings.storefrontTagline || `Catálogo de alquiler de ${name}. Consultá productos y disponibilidad directamente con la empresa.`;
  const indexable = !context.demo && context.settings.catalogAccessMode === "OPEN";
  const image = indexable ? await loadStoreSocialImage(context.organization.id, context.organization.slug) : null;
  return storefrontMetadata({
    organizationSlug: context.organization.slug,
    organizationName: name,
    title: `${name} · Tienda de alquiler`,
    description,
    canonicalPath: `/tienda/${encodeURIComponent(context.organization.slug)}`,
    socialImagePath: image,
    indexable,
  });
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
  if (context.settings.catalogAccessMode !== "OPEN") {
    // «Con solicitud» o «Privada»: sin el link personal no se muestra el catálogo.
    const store = await loadStorefront(context);
    return <AccessPage store={store} demo={context.demo} endpoint={`/api/catalog/${encodeURIComponent(context.organization.slug)}/access-request`} />;
  }
  const range = parsePublicRange(first(query.desde), first(query.hasta));
  const [store, items, zones, categoryImages] = await Promise.all([loadStorefront(context), loadPublicCatalogItems(context, range), loadPublicZones(context), loadCategoryImages(context.organization.id)]);
  const requestedCategory = first(query.categoria);
  const initialCategory = requestedCategory && items.some((item) => item.category === requestedCategory) ? requestedCategory : null;
  const collections = await loadPublicCollections(context.organization.id, new Set(items.map((item) => item.id)));
  const slug = encodeURIComponent(context.organization.slug);
  return (
    <StoreFront
      store={store}
      items={items}
      categoryImages={categoryImages}
      collections={collections}
      collectionsBase={`/tienda/${slug}`}
      initialCollection={first(query.coleccion) ?? null}
      zones={zones}
      showPrices={context.settings.publicShowPrices}
      demo={context.demo}
      range={range ? { fromKey: range.fromKey, toKey: range.toKey, days: range.days } : null}
      initialCategory={initialCategory}
      basePath={`/tienda/${slug}`}
      preorderPath={`/api/catalog/${slug}/preorder`}
    />
  );
}
