import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreFront } from "@/components/catalog-public/StoreFront";
import { loadPublicCatalogItems, loadPublicZones, loadStorefront, parsePublicRange, resolveVisitorCartCatalog } from "@/lib/server/catalog-public";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orgSlug: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const PRIVATE_ROBOTS = { index: false, follow: false, nocache: true } as const;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, token } = await params;
  const context = await resolveVisitorCartCatalog(orgSlug, token);
  if (!context) return { title: { absolute: "Carrito no encontrado" }, robots: PRIVATE_ROBOTS, referrer: "no-referrer" };
  return { title: { absolute: `${context.organization.name} · Tu carrito` }, robots: PRIVATE_ROBOTS, referrer: "no-referrer" };
}

/**
 * Enlace mágico del carrito (`/tienda/<slug>/carrito/<token>`): la tienda pública con el carrito guardado de
 * quien dejó su contacto. Enlace inexistente, vencido o de otra empresa: 404. Nunca se indexa.
 */
export default async function VisitorCartPage({ params, searchParams }: PageProps) {
  const { orgSlug, token } = await params;
  const query = await searchParams;
  const context = await resolveVisitorCartCatalog(orgSlug, token);
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
      basePath={`/tienda/${slug}/carrito/${encodeURIComponent(token)}`}
      preorderPath={`/api/catalog/${slug}/preorder`}
      cartPath={`/api/catalog/${slug}/carrito/${encodeURIComponent(token)}/cart`}
      cartScope="visitor"
      fichaBase={`/tienda/${slug}`}
    />
  );
}
