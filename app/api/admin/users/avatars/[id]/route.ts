import { identityImageExtension } from "@/lib/admin-types";
import { db } from "@/lib/server/db";
import { jsonError } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/admin/users/avatars/[id]` (issue #22): sirve el avatar **con
 * sesión**. Lo ve cualquiera que comparta la empresa activa con el dueño de la
 * foto (y el propio usuario, siempre); un id de otra empresa no existe para esta
 * consulta (404), igual que uno sin foto subida.
 *
 * `Cache-Control: private` con la versión en la query (`?v=<updatedAt>`) que
 * arma `adminAvatarUrl`: la foto se cachea solo en el navegador del panel y se
 * refresca al volver a subirla. El binario nunca se expone sin sesión.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!id) return jsonError("No encontramos esa foto de perfil.", 404);

  const avatar = await db.adminUserAvatar.findUnique({
    where: { userId: id },
    select: { mime: true, size: true, data: true, user: { select: { name: true } } },
  });
  if (!avatar) return jsonError("No encontramos esa foto de perfil.", 404);

  if (id !== auth.context.user.id) {
    const shared = await db.adminMembership.findFirst({
      where: { adminUserId: id, organizationId: auth.context.organizationId, active: true },
      select: { id: true },
    });
    if (!shared) return jsonError("No encontramos esa foto de perfil.", 404);
  }

  const slug = avatar.user.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const filename = `avatar-${slug || "perfil"}.${identityImageExtension(avatar.mime)}`;

  return new Response(new Uint8Array(avatar.data), {
    status: 200,
    headers: {
      "Content-Type": avatar.mime,
      "Content-Length": String(avatar.size),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
