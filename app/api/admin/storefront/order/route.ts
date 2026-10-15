import { recordAudit } from "@/lib/server/audit";
import { jsonError, readJson } from "@/lib/server/http";
import { loadStorefrontOrder, saveStorefrontOrder } from "@/lib/server/storefront-order";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET/PATCH /api/admin/storefront/order`: el orden de la tienda web que decide la empresa
 * (Ajustes → Tienda): secciones por categoría y productos dentro de cada una. Solo OWNER/ADMIN
 * (`org.manage`); siempre la empresa de la sesión: un id ajeno responde 404.
 */
function ownerOrAdmin(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export async function GET() {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  if (!ownerOrAdmin(auth.context.role)) return jsonError("Forbidden", 403);
  return Response.json(await loadStorefrontOrder(auth.context.organizationId));
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  if (!ownerOrAdmin(auth.context.role)) return jsonError("Forbidden", 403);
  const result = await saveStorefrontOrder(auth.context.organizationId, await readJson(request).catch(() => null));
  if (!result.ok) return jsonError(result.error, result.status);
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "Organization",
    entityId: auth.context.organizationId,
    summary: "Cambió el orden de la tienda web",
    detail: { fields: { secciones: result.sections, productos: result.items } },
  });
  return Response.json({ ok: true, ...(await loadStorefrontOrder(auth.context.organizationId)) });
}
