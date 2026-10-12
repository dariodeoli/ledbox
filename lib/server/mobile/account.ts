import type { Prisma } from "@prisma/client";

export class MobileDeletionError extends Error {
  constructor(public code: "OWNER_TRANSFER_REQUIRED" | "reauthentication_required", public status: number) { super(code); }
}

/** Se ejecuta exclusivamente dentro de transacción SERIALIZABLE, sin retry ciego. */
export async function deleteMobileIdentity(tx: Prisma.TransactionClient, input: { userId: string; sessionId: string; verifiedPasswordHash: string }, now = new Date()) {
  const user = await tx.adminUser.findUnique({ where: { id: input.userId } });
  const session = await tx.adminSession.findFirst({ where: { id: input.sessionId, userId: input.userId, revokedAt: null, expiresAt: { gt: now } } });
  if (!user?.active || !session || user.passwordHash !== input.verifiedPasswordHash) throw new MobileDeletionError("reauthentication_required", 401);
  const memberships = await tx.adminMembership.findMany({ where: { adminUserId: user.id, role: "OWNER", active: true }, select: { organizationId: true } });
  for (const membership of memberships) {
    const successor = await tx.adminMembership.findFirst({ where: { organizationId: membership.organizationId, adminUserId: { not: user.id }, role: "OWNER", active: true, user: { active: true } }, select: { id: true } });
    if (!successor) throw new MobileDeletionError("OWNER_TRANSFER_REQUIRED", 409);
  }
  // Revocar credenciales antes de borrar la fila: cascades quitan sesiones,
  // membresías, avatar, PIN/password y reset tokens. Nunca se borra la empresa.
  await tx.adminSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
  await tx.apiToken.updateMany({ where: { createdById: user.id }, data: { revokedAt: now, createdByName: "Cuenta eliminada", createdByEmail: null } });
  // Invitaciones dirigidas a esta identidad: email ya no reutilizable para login.
  await tx.teamInvitation.updateMany({ where: { email: user.email, status: "pending" }, data: { status: "revoked", revokedAt: now } });
  await tx.teamInvitation.updateMany({ where: { email: user.email }, data: { email: `deleted-${user.id}@account.invalid` } });
  await tx.teamInvitation.updateMany({ where: { invitedById: user.id }, data: { invitedByName: "Cuenta eliminada", invitedByEmail: null } });
  await tx.teamInvitation.updateMany({ where: { acceptedById: user.id }, data: { acceptedByName: "Cuenta eliminada" } });
  await tx.adminUser.delete({ where: { id: user.id } });
}
