import { randomUUID } from "node:crypto";
import type { AdminRole } from "@prisma/client";
import { adminRoleLabel } from "@/lib/admin-format";
import { clearSessionCookie, hashPassword } from "@/lib/server/auth";
import { ASSIGNABLE_ROLES } from "@/lib/server/permissions";
import { requireAdminContext } from "@/lib/server/tenancy";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import { auditChanges, recordAudit } from "@/lib/server/audit";
import { emailError, FIELD_MESSAGES, normalizeEmail, normalizePersonName, personNameValid } from "@/lib/field-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Usuarios y accesos de la empresa activa. La lista sale de las membresías
 * (`AdminMembership`), el rol efectivo es el de la membresía y `active` combina
 * la cuenta global con la membresía. Desactivar acá solo corta el acceso a esta
 * empresa, no borra la cuenta.
 *
 * Issue #22: además de crear, cambiar el rol y activar/desactivar, un
 * OWNER/ADMIN edita el **nombre** y el **correo** de un usuario del equipo (con
 * las reglas compartidas de campos y auditoría). El correo es la identidad de
 * acceso: al cambiarlo se cierran las sesiones abiertas de esa cuenta y vuelve a
 * entrar con el correo nuevo.
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
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          active: true,
          avatar: { select: { updatedAt: true } },
        },
      },
    },
  });
  const users = memberships.map((membership) => ({
    id: membership.user.id,
    membershipId: membership.id,
    name: membership.user.name,
    email: membership.user.email,
    role: membership.role,
    active: membership.user.active && membership.active,
    createdAt: membership.createdAt,
    avatarUpdatedAt: membership.user.avatar?.updatedAt.toISOString() ?? null,
  }));
  return Response.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("users.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  const name = normalizePersonName(typeof body.name === "string" ? body.name : "");
  const password = typeof body.password === "string" ? body.password : "";
  const role: AdminRole = isAssignableRole(body.role) ? body.role : "VIEWER";
  if (!personNameValid(name)) return jsonError(FIELD_MESSAGES.name, 400);
  if (emailError(email)) return jsonError(emailError(email) ?? "Correo inválido.", 400);
  if (password.length < 12) return jsonError("La contraseña inicial debe tener al menos 12 caracteres.", 400);

  const existing = await db.adminUser.findUnique({ where: { email } });
  if (existing) {
    const membership = await db.adminMembership.findUnique({
      where: { adminUserId_organizationId: { adminUserId: existing.id, organizationId } },
    });
    if (membership) return jsonError("Ya existe un usuario con este correo en la empresa.", 409);
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
    return Response.json({ user: { id: existing.id, name: existing.name, email: existing.email, role: created.role, active: existing.active, avatarUpdatedAt: null } }, { status: 201 });
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
  return Response.json({ user: { id: created.user.id, name: created.user.name, email: created.user.email, role: created.membership.role, active: created.user.active, avatarUpdatedAt: null } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminContext("users.manage");
  if (!auth.ok) return auth.response;
  const { organizationId, user: actor, role: actorRole } = auth.context;
  const body = await readJson(request) as Record<string, unknown>;
  if (typeof body.id !== "string") return jsonError("User id is required.", 400);

  const membership = await db.adminMembership.findFirst({
    where: { adminUserId: body.id, organizationId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          active: true,
          avatar: { select: { updatedAt: true } },
          _count: { select: { memberships: true } },
        },
      },
    },
  });
  if (!membership) return jsonError("User not found.", 404);

  const membershipData: { role?: AdminRole; active?: boolean } = {};
  if (typeof body.active === "boolean") membershipData.active = body.active;
  if (isAssignableRole(body.role)) membershipData.role = body.role;

  // Datos de la cuenta (issue #22): nombre y correo con las reglas compartidas.
  const accountData: { name?: string; email?: string } = {};
  if (typeof body.name === "string") {
    const name = normalizePersonName(body.name);
    if (!personNameValid(name)) return jsonError(FIELD_MESSAGES.name, 400);
    if (name !== membership.user.name) accountData.name = name;
  }
  let emailChanged = false;
  if (typeof body.email === "string") {
    const email = normalizeEmail(body.email);
    const invalid = emailError(email);
    if (invalid) return jsonError(invalid, 400);
    if (email !== membership.user.email) {
      const taken = await db.adminUser.findUnique({ where: { email }, select: { id: true } });
      if (taken) return jsonError("Ya existe otro usuario con ese correo.", 409);
      accountData.email = email;
      emailChanged = true;
    }
  }

  if (membership.role === "OWNER" && actorRole !== "OWNER") return jsonError("Only an owner can modify an owner.", 403);
  if (body.id === actor.id) {
    if (membershipData.active === false) return jsonError("You cannot deactivate your current user.", 400);
    if (membershipData.role && membershipData.role !== membership.role) return jsonError("You cannot change your own role.", 400);
  }

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.adminMembership.update({ where: { id: membership.id }, data: membershipData });
    // Si la cuenta pertenece a una sola empresa, el rol global acompaña al de la membresía.
    if (membershipData.role && membership.user._count.memberships === 1) {
      await tx.adminUser.update({ where: { id: membership.adminUserId }, data: { role: membershipData.role } });
    }
    if (Object.keys(accountData).length > 0) {
      await tx.adminUser.update({ where: { id: membership.adminUserId }, data: accountData });
    }
    return next;
  });

  // El correo es la identidad de acceso: al cambiarlo se cierran las sesiones
  // abiertas de esa cuenta (si el cambio es del propio actor, también la suya).
  let sessionsClosed = 0;
  if (emailChanged) {
    const revoked = await db.adminSession.updateMany({
      where: { userId: membership.adminUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    sessionsClosed = revoked.count;
    if (body.id === actor.id) await clearSessionCookie();
  }

  const next = {
    name: accountData.name ?? membership.user.name,
    email: accountData.email ?? membership.user.email,
    role: updated.role,
    active: membership.user.active && updated.active,
  };
  const changes = auditChanges(
    { name: membership.user.name, email: membership.user.email, role: membership.role, active: membership.active },
    { name: next.name, email: next.email, role: updated.role, active: updated.active },
    ["name", "email", "role", "active"],
  );
  if (changes) {
    const who = `«${membership.user.name}» (${membership.user.email})`;
    let action: "update" | "status" = "update";
    let summary: string;
    if ("email" in changes) {
      summary = `Cambió el correo de ${who} a ${next.email}${sessionsClosed > 0 ? " y cerró sus sesiones abiertas" : ""}`;
    } else if ("active" in changes) {
      action = "status";
      summary = `${updated.active ? "Activó" : "Desactivó"} el acceso de ${who}`;
    } else if ("role" in changes) {
      summary = `Cambió el rol de ${who} a ${adminRoleLabel(updated.role)}`;
    } else {
      summary = `Editó el nombre de ${who} a «${next.name}»`;
    }
    await recordAudit({
      context: auth.context,
      action,
      entity: "AdminUser",
      entityId: membership.user.id,
      summary,
      detail: { changes },
    });
  }

  return Response.json({
    user: {
      id: membership.user.id,
      name: next.name,
      email: next.email,
      role: updated.role,
      active: next.active,
      avatarUpdatedAt: membership.user.avatar?.updatedAt.toISOString() ?? null,
    },
    sessionsClosed,
    loggedOut: emailChanged && body.id === actor.id,
  });
}
