import type { AdminRole } from "@prisma/client";
import type { AdminTeamInvitation } from "@/lib/admin-types";
import { adminRoleLabel } from "@/lib/admin-format";
import { emailError, normalizeEmail } from "@/lib/field-rules";
import { recordAudit } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { jsonError, readJson } from "@/lib/server/http";
import {
  expireDueInvitations,
  invitationRow,
  upsertInvitation,
  type InvitationLastMail,
} from "@/lib/server/invitations";
import { buildInvitationMail, sendMail } from "@/lib/server/mail";
import { ASSIGNABLE_ROLES } from "@/lib/server/permissions";
import { requireAdminContext } from "@/lib/server/tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Invitaciones al equipo de la empresa activa (issue #31).
 *
 * - `GET`: invitaciones por aceptar (`pending` y `expired`) con el rol, quién
 *   invita, el vencimiento y el resultado real del último correo (historial
 *   `MailLog`). Antes de listar marca las vencidas.
 * - `POST`: crea o **actualiza** la invitación del correo (una sola por correo +
 *   empresa) y envía el correo de invitación con la plantilla única. Reenviar es
 *   volver a invitar el mismo correo.
 *
 * Capacidad `users.manage`: solo OWNER/ADMIN invitan, y el rol debe estar entre
 * los asignables (`OWNER` nunca se invita, igual que el alta manual de usuarios).
 * Todo queda auditado con el actor real de la sesión.
 */

function isAssignableRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

/** Último correo de cada invitación, para no mostrar un envío viejo como vigente. */
async function lastMailsByInvitation(organizationId: string, ids: string[]): Promise<Map<string, InvitationLastMail>> {
  if (ids.length === 0) return new Map();
  const logs = await db.mailLog.findMany({
    where: { organizationId, category: "invitation", entity: "TeamInvitation", entityId: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, status: true, error: true, sentAt: true },
  });
  const map = new Map<string, InvitationLastMail>();
  for (const log of logs) {
    if (!log.entityId || map.has(log.entityId)) continue;
    map.set(log.entityId, { status: log.status, error: log.error, sentAt: log.sentAt });
  }
  return map;
}

export async function GET() {
  const auth = await requireAdminContext("users.manage");
  if (!auth.ok) return auth.response;
  const { organizationId } = auth.context;

  await expireDueInvitations(organizationId);
  const invitations = await db.teamInvitation.findMany({
    where: { organizationId, status: { in: ["pending", "expired"] } },
    orderBy: [{ status: "asc" }, { expiresAt: "asc" }],
  });
  const lastMails = await lastMailsByInvitation(organizationId, invitations.map((invitation) => invitation.id));
  const rows: AdminTeamInvitation[] = invitations.map((invitation) =>
    invitationRow(invitation, lastMails.get(invitation.id) ?? null),
  );
  return Response.json({ invitations: rows });
}

export async function POST(request: Request) {
  const auth = await requireAdminContext("users.manage");
  if (!auth.ok) return auth.response;
  const { organizationId, organization, user: actor } = auth.context;

  const body = (await readJson(request)) as Record<string, unknown>;
  const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
  const invalidEmail = emailError(email);
  if (invalidEmail) return jsonError(invalidEmail, 400);
  if (!isAssignableRole(body.role)) {
    return jsonError("Elegí un rol válido para la invitación (el propietario no se invita por correo).", 400);
  }
  const role = body.role;

  // Invitar a quien ya es miembro no tiene sentido: no se duplica la membresía.
  const existing = await db.adminUser.findUnique({
    where: { email },
    select: { id: true, name: true, memberships: { where: { organizationId }, select: { id: true } } },
  });
  if (existing?.memberships.length) {
    return jsonError(`«${existing.name}» ya es miembro del equipo de esta empresa.`, 409);
  }

  const { invitation, token, created } = await upsertInvitation({
    organizationId,
    email,
    role,
    inviter: { id: actor.id, name: actor.name, email: actor.email },
  });

  const content = buildInvitationMail({
    organizationName: organization.name,
    email,
    role,
    invitedByName: actor.name,
    token,
    expiresAt: invitation.expiresAt,
    resend: !created,
  });
  const result = await sendMail({
    to: email,
    subject: content.subject,
    category: "invitation",
    html: content.html,
    text: content.text,
    organizationId,
    entity: "TeamInvitation",
    entityId: invitation.id,
    actor,
  });

  await recordAudit({
    context: auth.context,
    action: created ? "create" : "send",
    entity: "TeamInvitation",
    entityId: invitation.id,
    summary: created
      ? `Invitó a «${email}» a sumarse al equipo como ${adminRoleLabel(role)}`
      : `Reenvió la invitación a «${email}» (rol ${adminRoleLabel(role)})`,
    detail: {
      fields: {
        email,
        role,
        status: result.status,
        expiresAt: invitation.expiresAt.toISOString(),
        ...(result.error ? { error: result.error } : {}),
      },
    },
  });

  const lastMail: InvitationLastMail | null = {
    status: result.status,
    error: result.error ?? null,
    sentAt: new Date(),
  };
  return Response.json(
    { invitation: invitationRow(invitation, lastMail), mail: { status: result.status, error: result.error ?? null } },
    { status: created ? 201 : 200 },
  );
}
