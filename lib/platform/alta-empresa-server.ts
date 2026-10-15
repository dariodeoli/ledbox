import { assertOrganizationSlugAvailable, claimOrganizationSlug, OrganizationSlugTaken } from "@/lib/server/organization-slugs";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { adminRoleLabel } from "@/lib/admin-format";
import { validateAltaInput, type AltaEmpresaErrors, type AltaEmpresaInput, type InviteeRole } from "@/lib/platform/alta-empresa";
import { recordAudit, type AuditContext } from "@/lib/server/audit";
import { db } from "@/lib/server/db";
import { upsertInvitation } from "@/lib/server/invitations";
import { PLATFORM_BRAND, buildInvitationMail, sendMail } from "@/lib/server/mail";
import { DEFAULT_MESSAGE_TEMPLATES } from "@/lib/server/message-templates";

/**
 * Alta de empresa desde /superadmin (docs/SUPERADMIN.md §4b). El llamador ya pasó por
 * `requirePlatformAdmin()` y el rate limit; acá solo se escribe.
 *
 * Una transacción crea la empresa (activa, plan elegido, plantillas de mensajes de arranque como
 * hace el seed), la invitación OWNER —la misma de `lib/server/invitations.ts`: token de 24 caracteres,
 * solo su hash en la base, 7 días— y la auditoría con actor «Plataforma». No se crea ninguna cuenta ni
 * contraseña: la persona acepta por el link del correo. El correo se envía DESPUÉS de confirmar la
 * transacción (un fallo del proveedor no deshace el alta; se informa y se puede reenviar).
 *
 * El token plano no se guarda ni se devuelve: solo viaja en el correo, igual que en el panel de equipo.
 */

export const PLATFORM_ACTOR = "Plataforma";

/** Contexto de auditoría con actor «Plataforma» (el correo es el del dueño que operó el panel). */
export function platformAuditContext(organizationId: string, userId: string, email: string): AuditContext {
  return { organizationId, user: { id: userId, name: PLATFORM_ACTOR, email, role: "OWNER" } };
}

export type MailOutcome = { status: "sent" | "failed" | "skipped"; error: string | null };

export type AltaEmpresaResult =
  | { ok: true; organizationId: string; invitations: Array<{ id: string; email: string; role: InviteeRole; expiresAt: Date; mail: MailOutcome }> }
  | { ok: false; status: 400 | 409; error: string; fieldErrors: AltaEmpresaErrors };

async function sendPlatformInvitation(input: {
  organization: { id: string; name: string };
  invitation: { id: string; email: string; role: string; expiresAt: Date };
  token: string;
  resend: boolean;
  actor: { userId: string; email: string };
}): Promise<MailOutcome> {
  const content = buildInvitationMail({
    organizationName: input.organization.name,
    brand: PLATFORM_BRAND,
    email: input.invitation.email,
    role: input.invitation.role,
    invitedByName: PLATFORM_ACTOR,
    token: input.token,
    expiresAt: input.invitation.expiresAt,
    resend: input.resend,
  });
  const result = await sendMail({
    to: input.invitation.email,
    subject: content.subject,
    category: "invitation",
    html: content.html,
    text: content.text,
    organizationId: input.organization.id,
    platform: true,
    entity: "TeamInvitation",
    entityId: input.invitation.id,
    actor: { id: input.actor.userId, name: PLATFORM_ACTOR, email: input.actor.email },
  });
  if (result.status === "failed") {
    console.error(`[plataforma] El correo de invitación a ${input.invitation.email} falló: ${result.error ?? "sin detalle"}`);
  }
  return { status: result.status, error: result.error ?? null };
}

export async function createOrganizationWithOwnerInvite(
  input: AltaEmpresaInput,
  actor: { userId: string; email: string },
): Promise<AltaEmpresaResult> {
  const fieldErrors = validateAltaInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 400, error: "Revisá los campos marcados.", fieldErrors };
  }
  const slugTaken: AltaEmpresaResult = {
    ok: false,
    status: 409,
    error: "Ya existe una empresa con ese identificador.",
    fieldErrors: { slug: "Ya existe una empresa con ese identificador. Elegí otro." },
  };

  const plan = await db.plan.findFirst({ where: { code: input.planCode, active: true }, select: { id: true } });
  if (!plan) {
    return { ok: false, status: 400, error: "Revisá los campos marcados.", fieldErrors: { planCode: "Elegí un plan vigente." } };
  }

  const organizationId = randomUUID();
  const now = new Date();
  let created: Array<{ invitation: { id: string; email: string; role: InviteeRole; expiresAt: Date }; token: string }>;
  try {
    created = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await assertOrganizationSlugAvailable(tx, input.slug, organizationId);
      await tx.organization.create({
        data: { id: organizationId, name: input.name, slug: input.slug, active: true, planId: plan.id, planStartedAt: now },
      });
      await claimOrganizationSlug(tx, input.slug, organizationId);
      await tx.messageTemplate.createMany({
        data: DEFAULT_MESSAGE_TEMPLATES.map((template) => ({
          id: `${organizationId}_tpl_${template.key}`,
          organizationId,
          category: template.category,
          title: template.title,
          body: template.body,
          active: true,
          sortOrder: template.sortOrder,
          createdByName: PLATFORM_ACTOR,
          updatedByName: PLATFORM_ACTOR,
        })),
        skipDuplicates: true,
      });
      const context = platformAuditContext(organizationId, actor.userId, actor.email);
      await recordAudit(
        {
          context,
          action: "create",
          entity: "Organization",
          entityId: organizationId,
          summary: `Plataforma dio de alta la empresa «${input.name}» e invitó a ${input.invitees.length} ${input.invitees.length === 1 ? "persona" : "personas"}`,
          detail: { fields: { name: input.name, slug: input.slug, planCode: input.planCode, invitees: input.invitees.map((i) => `${i.email} (${i.role})`) } },
        },
        tx,
      );
      const rows: typeof created = [];
      for (const invitee of input.invitees) {
        const { invitation, token } = await upsertInvitation({
          organizationId,
          email: invitee.email,
          role: invitee.role,
          inviter: { id: actor.userId, name: PLATFORM_ACTOR, email: actor.email },
          now,
          tx,
        });
        await recordAudit(
          {
            context,
            action: "create",
            entity: "TeamInvitation",
            entityId: invitation.id,
            summary: `Plataforma invitó a «${invitee.email}» como ${adminRoleLabel(invitee.role)}`,
            detail: { fields: { email: invitee.email, role: invitee.role, expiresAt: invitation.expiresAt.toISOString() } },
          },
          tx,
        );
        rows.push({ invitation: { id: invitation.id, email: invitation.email, role: invitee.role, expiresAt: invitation.expiresAt }, token });
      }
      return rows;
    });
  } catch (error) {
    // Carrera: otra alta tomó el slug entre la validación y el INSERT (la restricción única decide).
    if (error instanceof OrganizationSlugTaken || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) return slugTaken;
    throw error;
  }

  const invitations: Extract<AltaEmpresaResult, { ok: true }>["invitations"] = [];
  for (const row of created) {
    const mail = await sendPlatformInvitation({
      organization: { id: organizationId, name: input.name },
      invitation: row.invitation,
      token: row.token,
      resend: false,
      actor,
    });
    await recordAudit({
      context: platformAuditContext(organizationId, actor.userId, actor.email),
      action: "send",
      entity: "TeamInvitation",
      entityId: row.invitation.id,
      summary: `Correo de invitación a «${row.invitation.email}»: ${mail.status}`,
      detail: { fields: { status: mail.status, ...(mail.error ? { error: mail.error } : {}) } },
    });
    invitations.push({ ...row.invitation, mail });
  }
  return { ok: true, organizationId, invitations };
}

/** Peor resultado de correo de un conjunto (failed > skipped > sent): lo que resume el aviso. */
export function overallMailStatus(outcomes: MailOutcome[]): MailOutcome["status"] {
  if (outcomes.some((o) => o.status === "failed")) return "failed";
  if (outcomes.some((o) => o.status === "skipped")) return "skipped";
  return "sent";
}

export type ResendResult =
  | { ok: true; mail: MailOutcome; expiresAt: Date }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Reenvía la invitación (dueño o administrador) todavía no aceptada de una empresa real (token nuevo, 7 días más; el link
 * viejo deja de servir). La empresa se ubica por id; la demo y los ids inexistentes dan 404.
 */
export async function resendInvitation(
  input: { organizationId: string; invitationId: string },
  actor: { userId: string; email: string },
): Promise<ResendResult> {
  const invitation = await db.teamInvitation.findFirst({
    where: { id: input.invitationId, organizationId: input.organizationId, role: { in: ["OWNER", "ADMIN"] } },
    include: { organization: { select: { id: true, name: true, slug: true } } },
  });
  if (!invitation || invitation.organization.slug === "demo") {
    return { ok: false, status: 404, error: "No encontramos esa invitación." };
  }
  if (invitation.status === "accepted") {
    return { ok: false, status: 409, error: "Esa invitación ya fue aceptada." };
  }
  const { invitation: updated, token } = await upsertInvitation({
    organizationId: invitation.organizationId,
    email: invitation.email,
    role: invitation.role,
    inviter: { id: actor.userId, name: PLATFORM_ACTOR, email: actor.email },
  });
  const mail = await sendPlatformInvitation({
    organization: invitation.organization,
    invitation: { id: updated.id, email: updated.email, role: updated.role, expiresAt: updated.expiresAt },
    token,
    resend: true,
    actor,
  });
  await recordAudit({
    context: platformAuditContext(invitation.organizationId, actor.userId, actor.email),
    action: "send",
    entity: "TeamInvitation",
    entityId: updated.id,
    summary: `Plataforma reenvió la invitación a «${invitation.email}» (${adminRoleLabel(invitation.role)}): ${mail.status}`,
    detail: { fields: { email: invitation.email, status: mail.status, expiresAt: updated.expiresAt.toISOString(), ...(mail.error ? { error: mail.error } : {}) } },
  });
  return { ok: true, mail, expiresAt: updated.expiresAt };
}
