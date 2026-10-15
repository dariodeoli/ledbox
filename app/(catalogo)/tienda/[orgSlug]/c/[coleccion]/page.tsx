import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CollectionPage } from "@/components/catalog-public/CollectionPage";
import { loadCollectionMeta, loadPublicCatalogItems, loadPublicCollections, loadPublicZones, loadStorefront, parsePublicRange, resolvePublicCatalog } from "@/lib/server/catalog-public";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orgSlug: string; coleccion: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, coleccion } = await params;
  const context = await resolvePublicCatalog(orgSlug);
  if (!context || context.settings.catalogAccessMode !== "OPEN") return { title: { absolute: "Colección no encontrada" }, robots: { index: false, follow: false } };
  const collection = await loadCollectionMeta(context.organization.id, coleccion);
  if (!collection) return { title: { absolute: "Colección no encontrada" }, robots: { index: false, follow: false } };
  const title = `${collection.name} · ${context.organization.name}`;
  return {
    title: { absolute: title },
    description: collection.description ?? `Colección ${collection.name} de ${context.organization.name}.`,
    openGraph: { title, type: "website", siteName: context.organization.name, locale: "es_PY" },
    robots: context.demo ? { index: false, follow: false } : { index: true, follow: true },
  };
}

/**
 * Landing de una colección (`/tienda/<slug>/c/<coleccion>`): solo con la tienda abierta; la colección tiene que ser de ESA
 * empresa, estar visible y tener productos publicados (si no, 404). Muestra únicamente esos productos, en su orden.
 */
export default async function CollectionRoute({ params, searchParams }: PageProps) {
  const { orgSlug, coleccion } = await params;
  const query = await searchParams;
  const context = await resolvePublicCatalog(orgSlug);
  if (!context || context.settings.catalogAccessMode !== "OPEN") notFound();
  const range = parsePublicRange(first(query.desde), first(query.hasta));
  const [store, items, zones] = await Promise.all([loadStorefront(context), loadPublicCatalogItems(context, range), loadPublicZones(context)]);
  const collections = await loadPublicCollections(context.organization.id, new Set(items.map((item) => item.id)));
  const collection = collections.find((entry) => entry.slug === coleccion);
  if (!collection) notFound();
  const byId = new Map(items.map((item) => [item.id, item]));
  const inCollection = collection.itemIds.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const slug = encodeURIComponent(context.organization.slug);
  return (
    <CollectionPage
      store={store}
      collection={collection}
      items={inCollection}
      otherCollections={collections.filter((entry) => entry.id !== collection.id)}
      showPrices={context.settings.publicShowPrices}
      demo={context.demo}
      range={range ? { fromKey: range.fromKey, toKey: range.toKey, days: range.days } : null}
      zones={zones}
      basePath={`/tienda/${slug}`}
    />
  );
}
