import { randomUUID } from "node:crypto";
import { recordAudit } from "@/lib/server/audit";
import { parseImageUpload } from "@/lib/server/branding";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Avatar propio (issue #22): foto de perfil del usuario del panel.
 *
 * `POST` recibe `{ data, mime?, width?, height? }` —la imagen ya recortada y
 * comprimida por el navegador— y la guarda en la base (`bytea`), igual que los
 * comprobantes: nunca es pública y se sirve solo con sesión desde
 * `/api/admin/users/avatars/[id]`. `DELETE` la quita y el avatar vuelve a las
 * iniciales (borrado explícito, sin restauración automática).
 *
 * El tipo real se valida por magic bytes y el tope es 1 MB; cualquier rol puede
 * editar su avatar y la demo queda en solo lectura.
 */

function userId(auth: { context: { user: { id: string } } }): string {
  return auth.context.user.id;
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("profile.write");
  if (!auth.ok) return auth.response;
  const id = userId(auth);

  const parsed = parseImageUpload(await readJson(request));
  if (!parsed.ok) return jsonError(parsed.error, 400);
  const { bytes, mime, width, height } = parsed.image;

  const avatar = await db.adminUserAvatar.upsert({
    where: { userId: id },
    create: { id: randomUUID(), userId: id, mime, size: bytes.byteLength, width, height, data: bytes },
    update: { mime, size: bytes.byteLength, width, height, data: bytes },
    select: { updatedAt: true },
  });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "AdminUser",
    entityId: id,
    summary: "Actualizó su foto de perfil",
    detail: { fields: { avatar: "subida", mime, size: bytes.byteLength } },
  });

  return Response.json({ avatarUpdatedAt: avatar.updatedAt.toISOString() });
}

export async function DELETE() {
  const auth = await requireAdminContext("profile.write");
  if (!auth.ok) return auth.response;
  const id = userId(auth);

  const removed = await db.adminUserAvatar.deleteMany({ where: { userId: id } });
  if (removed.count > 0) {
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "AdminUser",
      entityId: id,
      summary: "Quitó su foto de perfil; el avatar vuelve a las iniciales",
      detail: { fields: { avatar: "quitada" } },
    });
  }
  return Response.json({ avatarUpdatedAt: null, unchanged: removed.count === 0 });
}
