import { randomUUID } from "node:crypto";
import type { AdminRole } from "@prisma/client";
import { adminRoleLabel } from "@/lib/admin-format";
import { hashPassword } from "@/lib/server/auth";
import { ASSIGNABLE_ROLES } from "@/lib/server/permissions";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, recordAudit } from "@/lib/server/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Usuarios y accesos de la empresa activa. La lista sale de las membresías
 * (`AdminMembership`), el rol efectivo es el de la membresía y `active` combina
 * la cuenta global con la membresía. Desactivar acá solo corta el acceso a esta
 * empresa, no borra la cuenta.
 */

function isAssignableRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

export async function GET() {
  const auth = await requireAdminContext("users.manage");
  if (!auth.ok) return auth.response;
  const memberships = await db.adminMembership.findMany({
    where: { organizationId: auth.context.organizationId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true, active: true } } },
  });
  const users = memberships.map((membership) => ({
    id: membership.user.id,
    membershipId: membership.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    active: membership.user.active && membership.active,
    createdAt: membership.createdAt,
  }));
  return Response.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("users.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role: AdminRole = isAssignableRole(body.role) ? body.role : "VIEWER";
  if (!email.includes("@") || name.length < 2 || password.length < 12) return jsonError("Name, valid email and password of at least 12 characters are required.", 400);

  const existing = await db.adminUser.findUnique({ where: { email } });
  if (existing) {
    const membership = await db.adminMembership.findUnique({
      where: { adminUserId_organizationId: { adminUserId: existing.id, organizationId } },
    });
    if (membership) return jsonError("A user with this email already belongs to this organization.", 409);
    // Cuenta existente de otra empresa: se suma la membresía sin tocar credenciales.
    const created = await db.adminMembership.create({ data: { id: randomUUID(), adminUserId: existing.id, organizationId, role, active: true } });
    await recordAudit({
      context: auth.context,
      action: "create",
      entity: "AdminUser",
      entityId: existing.id,
      summary: `Agregó el acceso de «${existing.name}» (${existing.email}) a la empresa`,
      detail: { fields: { name: existing.name, email: existing.email, role: created.role, newAccount: false } },
    });
    return Response.json({ user: { id: existing.id, name: existing.name, email: existing.email, role: created.role, active: existing.active } }, { status: 201 });
  }

  const created = await db.$transaction(async (tx) => {
    const user = await tx.adminUser.create({
      data: { id: randomUUID(), name, email, passwordHash: await hashPassword(password), role, active: true },
    });
    const membership = await tx.adminMembership.create({
      data: { id: randomUUID(), adminUserId: user.id, organizationId, role, active: true },
    });
    return { user, membership };
  });
  await recordAudit({
    context: auth.context,
    action: "create",
    entity: "AdminUser",
    entityId: created.user.id,
    summary: `Creó el usuario «${created.user.name}» (${created.user.email}) con rol ${adminRoleLabel(created.membership.role)}`,
    detail: { fields: { name: created.user.name, email: created.user.email, role: created.membership.role, newAccount: true } },
  });
  return Response.json({ user: { id: created.user.id, name: created.user.name, email: created.user.email, role: created.membership.role, active: created.user.active } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("users.manage");
  if (!auth.ok) return auth.response;
  const { organizationId, user: actor, role: actorRole } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.id !== "string") return jsonError("User id is required.", 400);

  const membership = await db.adminMembership.findFirst({
    where: { adminUserId: body.id, organizationId },
    include: { user: { select: { id: true, name: true, email: true, active: true, _count: { select: { memberships: true } } } } },
  });
  if (!membership) return jsonError("User not found.", 404);

  const data: { role?: AdminRole; active?: boolean } = {};
  if (typeof body.active === "boolean") data.active = body.active;
  if (isAssignableRole(body.role)) data.role = body.role;
  if (membership.role === "OWNER" && actorRole !== "OWNER") return jsonError("Only an owner can modify an owner.", 403);
  if (body.id === actor.id) {
    if (data.active === false) return jsonError("You cannot deactivate your current user.", 400);
    if (data.role && data.role !== membership.role) return jsonError("You cannot change your own role.", 400);
  }

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.adminMembership.update({ where: { id: membership.id }, data });
    // Si la cuenta pertenece a una sola empresa, el rol global acompaña al de la membresía.
    if (data.role && membership.user._count.memberships === 1) {
      await tx.adminUser.update({ where: { id: membership.adminUserId }, data: { role: data.role } });
    }
    return next;
  });
  const changes = auditChanges(
    { role: membership.role, active: membership.active },
    { role: updated.role, active: updated.active },
    ["role", "active"],
  );
  if (changes) {
    const who = `«${membership.user.name}» (${membership.user.email})`;
    await recordAudit({
      context: auth.context,
      action: "active" in changes ? "status" : "update",
      entity: "AdminUser",
      entityId: membership.user.id,
      summary:
        "active" in changes
          ? `${updated.active ? "Activó" : "Desactivó"} el acceso de ${who}`
          : `Cambió el rol de ${who} a ${adminRoleLabel(updated.role)}`,
      detail: { changes },
    });
  }
  return Response.json({
    user: {
      id: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      role: updated.role,
      active: membership.user.active && updated.active,
    },
  });
}
