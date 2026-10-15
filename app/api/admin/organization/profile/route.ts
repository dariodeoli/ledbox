import { readOrgProfile } from "@/lib/org-profile";
import { db } from "@/lib/server/db";
import { readJson } from "@/lib/server/http";
import { saveOrgProfile } from "@/lib/server/org-presentation";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET/PATCH /api/admin/organization/profile`: perfil de la empresa activa (contacto,
 * ubicación con link de Google Maps, horario de atención, horarios de entrega/retiro/
 * devolución, medios de pago aceptados y condiciones comerciales). Solo OWNER/ADMIN
 * (`org.manage`); siempre la empresa de la sesión. El cuerpo es el perfil completo y se
 * revalida acá: el panel solo ayuda.
 */
export async function GET() {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  const row = await db.organization.findUnique({ where: { id: auth.context.organizationId }, select: { profile: true } });
  return Response.json({ profile: readOrgProfile(row?.profile) });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("org.manage");
  if (!auth.ok) return auth.response;
  return saveOrgProfile(auth.context, await readJson(request));
}
