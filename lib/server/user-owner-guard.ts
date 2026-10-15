import type { AdminRole, Prisma } from "@prisma/client";
import { canAssignTeamRole } from "@/lib/server/permissions";

export class UserOwnerGuardError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = "UserOwnerGuardError";
  }
}

/** Call inside the same transaction as the membership update. The tenant row
 * serializes PATCH operations on different members: locking only the target
 * would allow two owners to each observe the other before both disappear.
 * Re-read after the lock; neither the preflight role nor active flag is current.
 */
export async function guardUserOwnerChange(
  tx: Pick<Prisma.TransactionClient, "$queryRaw" | "adminMembership">,
  input: {
    organizationId: string;
    adminUserId: string;
    actorId: string;
    actorRole: AdminRole;
    patch: { role?: AdminRole; active?: boolean };
  },
) {
  const organizations = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Organization" WHERE "id" = ${input.organizationId} FOR UPDATE
  `;
  if (!organizations.length) throw new UserOwnerGuardError("User not found.", 404);
  const membership = await tx.adminMembership.findFirst({
    where: { adminUserId: input.adminUserId, organizationId: input.organizationId },
    include: { user: { select: { active: true, _count: { select: { memberships: true } } } } },
  });
  if (!membership) throw new UserOwnerGuardError("User not found.", 404);
  if (membership.role === "OWNER" && input.actorRole !== "OWNER") {
    throw new UserOwnerGuardError("Only an owner can modify an owner.", 403);
  }
  if (input.patch.role === "OWNER" && membership.role !== "OWNER" && !canAssignTeamRole(input.actorRole, "OWNER")) {
    throw new UserOwnerGuardError("Only an owner can assign the owner role.", 403);
  }
  if (input.adminUserId === input.actorId) {
    if (input.patch.active === false) throw new UserOwnerGuardError("You cannot deactivate your current user.", 400);
    if (input.patch.role && input.patch.role !== membership.role) {
      throw new UserOwnerGuardError("You cannot change your own role.", 400);
    }
  }
  const removesEffectiveOwner = membership.role === "OWNER" && membership.active && membership.user.active
    && ((input.patch.role !== undefined && input.patch.role !== "OWNER") || input.patch.active === false);
  if (removesEffectiveOwner) {
    const owners = await tx.adminMembership.count({
      where: { organizationId: input.organizationId, role: "OWNER", active: true, user: { active: true } },
    });
    if (owners <= 1) {
      throw new UserOwnerGuardError("No se puede quitar el acceso del último propietario activo de la empresa.", 409);
    }
  }
  return membership;
}
