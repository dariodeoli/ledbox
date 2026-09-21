import { adminRoleLabel } from "@/lib/admin-format";
import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import {
  createInvitationToken,
  effectiveInvitationStatus,
  invitationExpiry,
  invitationRow,
  invitationTokenDigest,
} from "@/lib/server/invitations";
import { buildInvitationMail, sendMail } from "@/lib/server/mail";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Acciones sobre una invitación de la empresa activa (issue #31):
 * `resend` (token y vencimiento nuevos + correo nuevo; el link viejo muere) y
 * `revoke` (corta el acceso de inmediato). Ambas exigen `users.manage`, la
 * invitación tiene que ser de la empresa activa y quedan auditadas.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminContext("users.manage");
  if (!auth.ok) return auth.response;
  const { organizationId, organization, user: actor } = auth.context;
  const { id } = await params;

  const body = (await readJson(request)) as Record<string, unknown>;
  const action = body.action === "resend" || body.action === "revoke" ? body.action : null;
  if (!action) return jsonError("Acción inválida: usá resend o revoke.", 400);

  const invitation = await db.teamInvitation.findFirst({ where: { id, organizationId } });
  if (!invitation) return jsonError("Invitación no encontrada.", 404);

  const now = new Date();
  const status = effectiveInvitationStatus(invitation, now);

  if (action === "revoke") {
    if (status === "accepted") return jsonError("La invitación ya fue aceptada: la persona es parte del equipo.", 409);
    if (status === "revoked") return jsonError("La invitación ya estaba revocada.", 409);
    const updated = await db.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: "revoked", revokedAt: now, revokedByName: actor.name },
    });
    await recordAudit({
      context: auth.context,
      action: "status",
      entity: "TeamInvitation",
      entityId: invitation.id,
      summary: `Revocó la invitación de «${invitation.email}» (rol ${adminRoleLabel(invitation.role)})`,
      detail: { fields: { email: invitation.email, role: invitation.role, status: "revoked" } },
    });
    return Response.json({ invitation: invitationRow(updated, null) });
  }

  // Reenviar: token y vencimiento nuevos (el link anterior deja de resolver).
  if (status === "accepted") return jsonError("La invitación ya fue aceptada: la persona es parte del equipo.", 409);
  const token = createInvitationToken();
  const updated = await db.teamInvitation.update({
    where: { id: invitation.id },
    data: {
      tokenHash: invitationTokenDigest(token),
      status: "pending",
      role: invitation.role,
      invitedById: actor.id,
      invitedByName: actor.name,
      invitedByEmail: actor.email,
      expiresAt: invitationExpiry(now),
      lastSentAt: now,
      sentCount: { increment: 1 },
      acceptedAt: null,
      acceptedById: null,
      acceptedByName: null,
      revokedAt: null,
      revokedByName: null,
    },
  });

  const content = buildInvitationMail({
    organizationName: organization.name,
    email: updated.email,
    role: updated.role,
    invitedByName: actor.name,
    token,
    expiresAt: updated.expiresAt,
    resend: true,
  });
  const result = await sendMail({
    to: updated.email,
    subject: content.subject,
    category: "invitation",
    html: content.html,
    text: content.text,
    organizationId,
    entity: "TeamInvitation",
    entityId: updated.id,
    actor,
  });

  await recordAudit({
    context: auth.context,
    action: "send",
    entity: "TeamInvitation",
    entityId: updated.id,
    summary: `Reenvió la invitación a «${updated.email}» (rol ${adminRoleLabel(updated.role)})`,
    detail: {
      fields: {
        email: updated.email,
        role: updated.role,
        status: result.status,
        expiresAt: updated.expiresAt.toISOString(),
        ...(result.error ? { error: result.error } : {}),
      },
    },
  });

  return Response.json({
    invitation: invitationRow(updated, { status: result.status, error: result.error ?? null, sentAt: now }),
    mail: { status: result.status, error: result.error ?? null },
  });
}
