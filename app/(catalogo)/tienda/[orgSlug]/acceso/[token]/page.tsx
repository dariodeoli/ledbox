import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreFront } from "@/components/catalog-public/StoreFront";
import { loadPublicCatalogItems, loadPublicZones, loadStorefront, parsePublicRange, resolveAccessCatalog } from "@/lib/server/catalog-public";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orgSlug: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Acceso personal: nunca se indexa ni se previsualiza. */
const PRIVATE_ROBOTS = { index: false, follow: false, nocache: true } as const;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, token } = await params;
  const context = await resolveAccessCatalog(orgSlug, token);
  if (!context) return { title: { absolute: "Catálogo no encontrado" }, robots: PRIVATE_ROBOTS, referrer: "no-referrer" };
  return { title: { absolute: `${context.organization.name} · Tienda de alquiler` }, robots: PRIVATE_ROBOTS, referrer: "no-referrer" };
}

/**
 * Catálogo de cliente final por link de acceso (`/tienda/<slug>/acceso/<token>`): el que recibe
 * quien pidió acceso en una tienda «Con solicitud» o «Privada». Token inexistente, revocado,
 * de otra empresa, de un link mayorista o con la tienda apagada: 404.
 */
export default async function AccessStorePage({ params, searchParams }: PageProps) {
  const { orgSlug, token } = await params;
  const query = await searchParams;
  const context = await resolveAccessCatalog(orgSlug, token);
  if (!context || !context.access) notFound();
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
      basePath={`/tienda/${slug}/acceso/${encodeURIComponent(token)}`}
      preorderPath={`/api/catalog/${slug}/acceso/${encodeURIComponent(token)}/preorder`}
      member={{ clientName: context.access.client.displayName }}
    />
  );
}
