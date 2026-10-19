import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { CategoryPage } from "@/components/catalog-public/CategoryPage";
import { storeCategoryHref } from "@/lib/store-categories";
import { loadPublicCategory } from "@/lib/server/store-categories";
import { loadPublicCollections, loadPublicZones, loadStorefront, parsePublicRange } from "@/lib/server/catalog-public";
import { loadStoreSocialImage } from "@/lib/server/store-seo";
import { storefrontMetadata } from "@/lib/store-seo";

export const dynamic = "force-dynamic";
type PageProps = {
  params: Promise<{ orgSlug: string; categoria: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, categoria } = await params;
  const data = await loadPublicCategory(orgSlug, categoria, null);
  if (!data) return { title: { absolute: "Categoría no encontrada" }, robots: { index: false, follow: false } };
  const title = `${data.category.name} · ${data.context.organization.name}`;
  const basePath = `/tienda/${encodeURIComponent(data.context.organization.slug)}`;
  const image = data.context.demo ? null : await loadStoreSocialImage(data.context.organization.id, data.context.organization.slug);
  return storefrontMetadata({
    organizationSlug: data.context.organization.slug,
    organizationName: data.context.organization.name,
    title,
    description: `Productos de ${data.category.name} de ${data.context.organization.name}.`,
    canonicalPath: storeCategoryHref(basePath, data.category, null),
    socialImagePath: image,
    indexable: !data.context.demo,
  });
}

export default async function CategoryRoute({ params, searchParams }: PageProps) {
  const { orgSlug, categoria } = await params;
  const query = await searchParams;
  const range = parsePublicRange(first(query.desde), first(query.hasta));
  const data = await loadPublicCategory(orgSlug, categoria, range);
  if (!data) notFound();
  const { context, category, categories, items } = data;
  const basePath = `/tienda/${encodeURIComponent(context.organization.slug)}`;
  if (categoria !== category.slug) permanentRedirect(storeCategoryHref(basePath, category, range));
  const [store, zones, collections] = await Promise.all([
    loadStorefront(context), loadPublicZones(context), loadPublicCollections(context.organization.id, new Set(items.map((item) => item.id))),
  ]);
  return <CategoryPage store={store} category={category} categories={categories} items={items} collections={collections} zones={zones} range={range} basePath={basePath} showPrices={context.settings.publicShowPrices} demo={context.demo} />;
}
