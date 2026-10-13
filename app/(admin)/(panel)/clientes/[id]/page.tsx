import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ClienteFichaModule } from "@/components/admin/modules/ClienteFichaModule";
import { db } from "@/lib/server/db";
import { requireAdminContext } from "@/lib/server/tenancy";

export const metadata: Metadata = { title: "Ficha del cliente" };
export const dynamic = "force-dynamic";

/**
 * Ficha 360 del cliente como página propia. El cliente tiene que existir en la
 * empresa activa: uno de otra empresa (o inexistente) responde 404 antes de
 * dibujar nada. Los datos los pide el módulo a `GET /api/admin/clients/[id]`.
 */
export default async function ClienteFichaPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) redirect("/login");
  const { id } = await params;
  const client = await db.client.findFirst({ where: { id, organizationId: auth.context.organizationId }, select: { id: true } });
  if (!client) notFound();
  return <ClienteFichaModule clientId={client.id} />;
}
