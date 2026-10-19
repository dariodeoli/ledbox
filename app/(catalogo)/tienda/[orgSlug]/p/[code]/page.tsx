import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPage } from "@/components/catalog-public/ProductPage";
import { loadProductDetail } from "@/lib/server/catalog-product";
import { loadPublicZones, loadStorefront, parsePublicRange, resolvePublicCatalog } from "@/lib/server/catalog-public";
import { loadStoreSocialImage } from "@/lib/server/store-seo";
import { storefrontMetadata } from "@/lib/store-seo";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ orgSlug: string; code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);


export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, code } = await params;
  const context = await resolvePublicCatalog(orgSlug);
  const detail = context?.settings.catalogAccessMode === "OPEN" ? await loadProductDetail(context, code) : null;
  if (!context || !detail) return { title: { absolute: "Producto no encontrado" }, robots: { index: false, follow: false } };
  const image = context.demo ? null : await loadStoreSocialImage(context.organization.id, context.organization.slug);
  return storefrontMetadata({
    organizationSlug: context.organization.slug,
    organizationName: context.organization.name,
    title: `${detail.item.name} · ${context.organization.name}`,
    description: detail.item.description || `${detail.item.name} en la tienda de ${context.organization.name}.`,
    canonicalPath: `/tienda/${encodeURIComponent(context.organization.slug)}/p/${encodeURIComponent(detail.item.id)}`,
    socialImagePath: image,
    indexable: !context.demo,
  });
}

/** Ficha de producto (`/tienda/<slug>/p/<id o código>`): 404 si la tienda, el link o el producto no existen en ESE catálogo. */
export default async function ProductRoute({ params, searchParams }: PageProps) {
  const query = await searchParams;
  const { orgSlug, code } = await params;
  const context = await resolvePublicCatalog(orgSlug);
  if (!context) notFound();
    if (context.settings.catalogAccessMode !== "OPEN") notFound();
  const range = parsePublicRange(first(query.desde), first(query.hasta));
  const detail = await loadProductDetail(context, code, range);
  if (!detail) notFound();
  const zones = (await loadPublicZones(context)).map((zone) => zone.name);
  const store = await loadStorefront(context);
  const slug = encodeURIComponent(context.organization.slug);
  return (
    <ProductPage
      store={store}
      detail={detail}
      showPrices={context.settings.publicShowPrices}
      basePath={`/tienda/${slug}`}
      scope="public"
      range={range ? { fromKey: range.fromKey, toKey: range.toKey, days: range.days } : null}
      zones={zones}
      cartPath={null}
    />
  );
}
