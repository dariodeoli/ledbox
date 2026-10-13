import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * `/catalogo/<slug>` es la dirección vieja del catálogo: ahora la empresa tiene su
 * tienda web en `/tienda/<slug>`. Los links ya compartidos siguen funcionando (con las
 * fechas elegidas). Si la tienda está apagada, la tienda responde 404.
 */
export default async function LegacyCatalogRedirect({ params, searchParams }: PageProps) {
  const { orgSlug } = await params;
  const query = await searchParams;
  const search = new URLSearchParams();
  for (const key of ["desde", "hasta", "categoria"]) {
    const value = Array.isArray(query[key]) ? query[key]?.[0] : query[key];
    if (typeof value === "string" && value.length <= 40) search.set(key, value);
  }
  const suffix = search.toString();
  redirect(`/tienda/${encodeURIComponent(orgSlug)}${suffix ? `?${suffix}` : ""}`);
}
