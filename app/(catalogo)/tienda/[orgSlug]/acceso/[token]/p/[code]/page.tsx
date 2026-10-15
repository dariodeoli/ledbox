import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductPage } from "@/components/catalog-public/ProductPage";
import { loadProductDetail } from "@/lib/server/catalog-product";
import { loadStorefront, resolveAccessCatalog } from "@/lib/server/catalog-public";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ orgSlug: string; code: string; token: string }> };

const PRIVATE_ROBOTS = { index: false, follow: false, nocache: true } as const;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { orgSlug, code, token } = await params;
  const context = await resolveAccessCatalog(orgSlug, token);
  const detail = context ? await loadProductDetail(context, code) : null;
  if (!context || !detail) return { title: { absolute: "Producto no encontrado" }, robots: { index: false, follow: false } };
  return { title: { absolute: `${detail.item.name} · ${context.organization.name}` }, robots: PRIVATE_ROBOTS };
}

/** Ficha de producto (`/tienda/<slug>/acceso/<token>/p/<id o código>`): 404 si la tienda, el link o el producto no existen en ESE catálogo. */
export default async function ProductRoute({ params }: PageProps) {
  const { orgSlug, code, token } = await params;
  const context = await resolveAccessCatalog(orgSlug, token);
  if (!context || !context.access) notFound();
  
  const detail = await loadProductDetail(context, code);
  if (!detail) notFound();
  const store = await loadStorefront(context);
  const slug = encodeURIComponent(context.organization.slug);
  return (
    <ProductPage
      store={store}
      detail={detail}
      showPrices={context.settings.publicShowPrices}
      basePath={`/tienda/${slug}/acceso/${encodeURIComponent(token)}`}
      scope="acceso"
      cartPath={`/api/catalog/${slug}/acceso/${encodeURIComponent(token)}/cart`}
    />
  );
}
