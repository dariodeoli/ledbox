import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreFront } from "@/components/catalog-public/StoreFront";
import { loadPublicCatalogItems, loadPublicZones, loadStorefront, parsePublicRange, resolveWholesaleCatalog } from "@/lib/server/catalog-public";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orgSlug: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Catálogo privado: nunca se indexa ni se previsualiza con datos del cliente. */
const PRIVATE_ROBOTS = { index: false, follow: false, nocache: true } as const;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, token } = await params;
  const context = await resolveWholesaleCatalog(orgSlug, token);
  if (!context) return { title: { absolute: "Catálogo no encontrado" }, robots: PRIVATE_ROBOTS, referrer: "no-referrer" };
  return { title: { absolute: `${context.organization.name} · Catálogo mayorista` }, robots: PRIVATE_ROBOTS, referrer: "no-referrer" };
}

/**
 * Catálogo mayorista (`/tienda/<slug>/mayorista/<token>`): link privado de UN cliente,
 * sin cuentas. Muestra los productos WHOLESALE y BOTH con el precio mayorista. Un token
 * inexistente, revocado o de otra empresa —o la tienda apagada— responde 404.
 */
export default async function WholesaleStorePage({ params, searchParams }: PageProps) {
  const { orgSlug, token } = await params;
  const query = await searchParams;
  const context = await resolveWholesaleCatalog(orgSlug, token);
  if (!context || !context.access) notFound();
  const range = parsePublicRange(first(query.desde), first(query.hasta));
  const [store, items, zones] = await Promise.all([loadStorefront(context), loadPublicCatalogItems(context, range), loadPublicZones(context)]);
  const slug = encodeURIComponent(context.organization.slug);
  const base = `/tienda/${slug}/mayorista/${encodeURIComponent(token)}`;
  return (
    <StoreFront
      store={store}
      items={items}
      zones={zones}
      showPrices={context.settings.publicShowPrices}
      demo={context.demo}
      range={range ? { fromKey: range.fromKey, toKey: range.toKey, days: range.days } : null}
      initialCategory={first(query.categoria) ?? null}
      basePath={base}
      preorderPath={`/api/catalog/${slug}/mayorista/${encodeURIComponent(token)}/preorder`}
      wholesale={{ clientName: context.access.client.displayName }}
    />
  );
}
