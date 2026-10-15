import { listAccessRequests } from "@/lib/server/catalog-access-requests";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `GET /api/admin/catalog-access-requests`: solicitudes de acceso al catálogo de la empresa activa. */
export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  return Response.json({ requests: await listAccessRequests(auth.context.organizationId) });
}
