import { readAppearance } from "@/lib/appearance";
import { db } from "@/lib/server/db";
import { readJson } from "@/lib/server/http";
import { loadCoverVersions, saveOrgAppearance } from "@/lib/server/org-presentation";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET/PATCH /api/admin/organization/appearance`: apariencia de las superficies del cliente
 * (plantilla cerrada, tipografía de una lista cerrada, fondo claro opcional y color de marca).
 * Solo OWNER/ADMIN (`org.manage`); siempre la empresa de la sesión.
 *
 * El color de marca se valida acá con contraste AA (≥ 4,5:1): si no alcanza se **ajusta** (se
 * oscurece lo mínimo) y la respuesta lo avisa en `brandNotice`; nunca se guarda un color
 * ilegible. La portada son dos archivos aparte (`/appearance/covers/[kind]`).
 */
export async function GET() {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const [row, settings, covers] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { appearance: true, slug: true } }),
    db.organizationRentalSettings.findUnique({ where: { organizationId }, select: { storefrontAccent: true } }),
    loadCoverVersions(organizationId),
  ]);
  return Response.json({ appearance: readAppearance(row?.appearance), brandColor: settings?.storefrontAccent ?? null, covers, slug: row?.slug ?? null });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  return saveOrgAppearance(auth.context, await readJson(request));
}
