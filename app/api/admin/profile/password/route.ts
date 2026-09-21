import { hashPassword, verifyPassword } from "@/lib/server/auth";
import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cambio de contraseña propio (issue #22): exige la contraseña actual y la
 * nueva (mínimo 8, máximo 128). Cualquier rol puede cambiar la suya; la
 * organización demo queda en solo lectura.
 *
 * Al cambiarla se cierran las **demás** sesiones abiertas de la cuenta (la
 * sesión actual sigue viva) y queda auditado con el actor real. Las cuentas que
 * entran solo con Google no tienen contraseña que verificar: para esas, el
 * camino es «¿La olvidaste?» del login, que prueba el correo.
 */

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

export async function POST(request: Request) {
  const auth = await requireAdminContext("profile.write");
  if (!auth.ok) return auth.response;
  const { user: actor } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword.length < MIN_LENGTH || newPassword.length > MAX_LENGTH) {
    return jsonError(`La contraseña nueva debe tener entre ${MIN_LENGTH} y ${MAX_LENGTH} caracteres.`, 400);
  }
  if (newPassword === currentPassword) {
    return jsonError("La contraseña nueva tiene que ser distinta de la actual.", 400);
  }

  const user = await db.adminUser.findUnique({
    where: { id: actor.id },
    select: { id: true, passwordHash: true },
  });
  if (!user) return jsonError("No encontramos tu cuenta.", 404);
  if (!user.passwordHash) {
    return jsonError("Tu cuenta ingresa con Google: usá «¿La olvidaste?» en el login para crear una contraseña.", 400);
  }
  if (!currentPassword) return jsonError("Ingresá tu contraseña actual.", 400);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return jsonError("La contraseña actual no coincide.", 400);
  }

  await db.adminUser.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  const revoked = await db.adminSession.updateMany({
    where: { userId: user.id, id: { not: auth.context.session.id }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await recordAudit({
    context: auth.context,
    action: "update",
    entity: "AdminUser",
    entityId: user.id,
    summary: `Cambió su contraseña del panel${revoked.count > 0 ? ` y se cerraron ${revoked.count} sesiones abiertas` : ""}`,
    detail: { fields: { password: "actualizada" } },
  });

  return Response.json({ ok: true, otherSessionsClosed: revoked.count });
}
