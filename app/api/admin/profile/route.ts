import type { AdminRole } from "@prisma/client";
import { auditChanges, recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { requireAdminContext } from "@/lib/server/tenancy";
import { FIELD_MESSAGES, normalizePersonName, personNameValid } from "@/lib/field-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Perfil propio (issue #22): `GET` devuelve los datos de la cuenta y `PATCH`
 * edita el nombre. Cualquier rol puede editar su perfil (capacidad
 * `profile.write`), pero la organización demo queda en solo lectura.
 *
 * El **correo no se edita desde acá**: es la identidad de acceso (lo cambia un
 * OWNER/ADMIN desde Equipo, con auditoría y cierre de sesiones). La contraseña
 * tiene su propio endpoint (`/api/admin/profile/password`) y el avatar el suyo
 * (`/api/admin/profile/avatar`).
 */

type ProfileUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string | null;
  avatar: { updatedAt: Date } | null;
};

function profilePayload(user: ProfileUser, role: AdminRole) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role,
    hasPassword: Boolean(user.passwordHash),
    avatarUpdatedAt: user.avatar?.updatedAt.toISOString() ?? null,
  };
}

const profileSelect = {
  id: true,
  name: true,
  email: true,
  passwordHash: true,
  avatar: { select: { updatedAt: true } },
} as const;

/** Nombre normalizado como se guarda: sin espacios de más y con tope del panel. */
function profileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = normalizePersonName(value);
  return personNameValid(name) ? name : null;
}

export async function GET() {
  const auth = await requireAdminContext();
  if (!auth.ok) return auth.response;

  const user = await db.adminUser.findUnique({ where: { id: auth.context.user.id }, select: profileSelect });
  if (!user) return jsonError("No encontramos tu cuenta.", 404);
  return Response.json({ profile: profilePayload(user, auth.context.role) });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("profile.write");
  if (!auth.ok) return auth.response;
  const { user: actor, role } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const name = profileName(body.name);
  if (!name) return jsonError(FIELD_MESSAGES.name, 400);

  const before = await db.adminUser.findUnique({ where: { id: actor.id }, select: profileSelect });
  if (!before) return jsonError("No encontramos tu cuenta.", 404);

  const changes = auditChanges({ name: before.name }, { name }, ["name"]);
  if (changes) {
    await db.adminUser.update({ where: { id: actor.id }, data: { name } });
    await recordAudit({
      context: auth.context,
      action: "update",
      entity: "AdminUser",
      entityId: actor.id,
      summary: `Actualizó su perfil: nombre «${name}»`,
      detail: { changes },
    });
  }

  return Response.json({ profile: profilePayload({ ...before, name }, role), unchanged: !changes });
}
