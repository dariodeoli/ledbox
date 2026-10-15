import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStoreLab } from "@/lib/server/store-lab";
import { loadPublicCatalogItems, loadPublicZones, loadStorefront, parsePublicRange } from "@/lib/server/catalog-public";
import { LandingStoreLab } from "@/components/store-lab/LandingStoreLab";
import "@/app/tienda.css";
import "./laboratorio.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Laboratorio de tienda · Prueba interna", robots: { index: false, follow: false } };
export default async function StoreLabPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireStoreLab();
  if (!auth.ok) {
    if (auth.response.status === 401) redirect("/login");
    return <main><h1>Laboratorio de tienda</h1><p>No tenés acceso o tu sesión está bloqueada.</p><a href="/ajustes/tienda">Volver a Tienda</a></main>;
  }
  const query = await searchParams;
  const range = parsePublicRange(query.desde, query.hasta);
  const [store, items, zones] = await Promise.all([loadStorefront(auth.context), loadPublicCatalogItems(auth.context, range), loadPublicZones(auth.context)]);
  return <LandingStoreLab key={auth.context.organization.id} store={store} items={items} zones={zones} organizationId={auth.context.organization.id} range={range ? { fromKey: range.fromKey, toKey: range.toKey, days: range.days } : null} />;
}
