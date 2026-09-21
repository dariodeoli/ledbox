import { randomInt, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AdminRole, TeamInvitation, TeamInvitationStatus } from "@prisma/client";
import { adminRoleLabel } from "@/lib/admin-format";
import type { AdminInvitationAccountState, AdminInvitationPublicView, AdminTeamInvitation } from "@/lib/admin-types";
import { FIELD_MESSAGES, normalizeEmail, normalizePersonName, personNameValid } from "@/lib/field-rules";
import { INVITATION_TOKEN_LENGTH, UNAMBIGUOUS_ALPHABET } from "@/lib/public-config";
import { recordAudit } from "./audit";
import { hashPassword, tokenDigest, verifyPassword } from "./auth";
import { db } from "./db";

/**
 * Invitaciones al equipo (issue #31): única capa de creación, reenvío,
 * revocación y aceptación.
 *
 * Decisiones:
 * - **Token**: aleatorio y no enumerable (`randomInt` sobre el alfabeto sin
 *   caracteres ambiguos, el mismo del código del portal) de 24 caracteres (120
 *   bits). El plano solo viaja en el correo; en la base queda su SHA-256
 *   (`tokenHash`), igual que los tokens de reset. Reenviar genera un token
 *   nuevo y el link viejo deja de resolver.
 * - **Vencimiento**: 7 días (`INVITATION_TTL_DAYS`). Una invitación `pending`
 *   con `expiresAt` pasado es `expired` y no acepta; el equipo puede reenviarla.
 * - **Una sola fila por correo + empresa**: invitar o reenviar **actualiza** la
 *   existente (rol, token, vencimiento, quién invita) y limpia la aceptación o
 *   la revocación previas.
 * - **Aceptación**: el token es la credencial; la persona entra con contraseña
 *   (cuenta nueva o cuenta existente verificada) o con Google (la identidad
 *   verificada por Google tiene que ser el correo invitado). Quien ya es miembro
 *   de la empresa recibe aviso y no se duplica. La invitación se marca
 *   `accepted` en la misma transacción que crea la cuenta y la membresía, y se
 *   cierran las sesiones previas.
 * - La aceptación queda auditada con el actor real (la persona que acepta).
 */

/** Días de vigencia del link de invitación. */
export const INVITATION_TTL_DAYS = 7;

export type InvitationWithOrganization = TeamInvitation & {
  organization: { id: string; name: string; slug: string };
};

export function invitationTokenDigest(token: string | null | undefined): string {
  return tokenDigest(String(token ?? "").trim().toUpperCase());
}

/** Token de invitación nuevo: 24 caracteres del alfabeto sin ambiguos. */
export function createInvitationToken(): string {
  let token = "";
  for (let index = 0; index < INVITATION_TOKEN_LENGTH; index += 1) {
    token += UNAMBIGUOUS_ALPHABET[randomInt(0, UNAMBIGUOUS_ALPHABET.length)];
  }
  return token;
}

/** Vencimiento del link: `days` días desde `now` (default 7). */
export function invitationExpiry(now: Date = new Date(), days: number = INVITATION_TTL_DAYS): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

/** Estado real: una invitación pendiente con el vencimiento pasado ya está vencida. */
export function effectiveInvitationStatus(
  invitation: Pick<TeamInvitation, "status" | "expiresAt">,
  now: Date = new Date(),
): TeamInvitationStatus {
  if (invitation.status === "pending" && invitation.expiresAt.getTime() <= now.getTime()) return "expired";
  return invitation.status;
}

/** Marca las invitaciones vencidas de la empresa (idempotente; la llama la lista). */
export async function expireDueInvitations(organizationId: string, now: Date = new Date()): Promise<number> {
  const expired = await db.teamInvitation.updateMany({
    where: { organizationId, status: "pending", expiresAt: { lte: now } },
    data: { status: "expired" },
  });
  return expired.count;
}

/** Busca una invitación por el token del link (hash); `null` si no existe. */
export async function findInvitationByToken(token: string | null | undefined): Promise<InvitationWithOrganization | null> {
  const digest = invitationTokenDigest(token);
  if (!digest) return null;
  return db.teamInvitation.findUnique({
    where: { tokenHash: digest },
    include: { organization: { select: { id: true, name: true, slug: true } } },
  });
}

/** Motivo por el que una invitación no se puede aceptar todavía (o `null` si sí). */
function invitationBlockedReason(invitation: TeamInvitation, now: Date): string | null {
  if (invitation.status === "accepted") return "Esta invitación ya fue aceptada. Entrá al panel con tu cuenta.";
  if (invitation.status === "revoked") return "Esta invitación fue revocada por el equipo. Pedí una nueva.";
  if (effectiveInvitationStatus(invitation, now) === "expired") return "Esta invitación venció. Pedí que te la reenvíen.";
  return null;
}

/** Estado de la cuenta invitada (para la página y para decidir el camino de aceptación). */
export async function invitationAccountState(
  invitation: InvitationWithOrganization,
): Promise<AdminInvitationAccountState> {
  const user = await db.adminUser.findUnique({
    where: { email: invitation.email },
    select: {
      active: true,
      memberships: { where: { organizationId: invitation.organizationId }, select: { id: true } },
    },
  });
  if (!user) {
    return { exists: false, active: false, alreadyMember: false };
  }
  return {
    exists: true,
    active: user.active,
    alreadyMember: user.memberships.length > 0,
  };
}

/** Vista pública de la invitación para la página de aceptación. */
export async function invitationPublicView(
  invitation: InvitationWithOrganization,
  now: Date = new Date(),
): Promise<AdminInvitationPublicView> {
  const status = effectiveInvitationStatus(invitation, now);
  const account = await invitationAccountState(invitation);
  return {
    status,
    email: invitation.email,
    role: invitation.role,
    organization: invitation.organization.name,
    invitedByName: invitation.invitedByName,
    expiresAt: invitation.expiresAt.toISOString(),
    account,
    // Pendiente y vigente, sin membresía previa y con la cuenta usable (una
    // cuenta desactivada no puede sumarse hasta que el equipo la reactive).
    canAccept: status === "pending" && !account.alreadyMember && (account.exists ? account.active : true),
  };
}

export type UpsertInvitationInput = {
  organizationId: string;
  email: string;
  role: AdminRole;
  /** Actor real del panel que invita (lo audita el llamador). */
  inviter: { id: string; name: string; email: string };
  now?: Date;
};

export type UpsertInvitationResult = {
  invitation: TeamInvitation;
  /** Token plano del link; solo existe acá y en el correo. */
  token: string;
  created: boolean;
};

/**
 * Crea o actualiza la invitación de un correo en la empresa y devuelve el token
 * nuevo. Reenviar es volver a llamar a esta función: la fila única se actualiza
 * (rol, token, vencimiento, quién invita) y vuelve a `pending`.
 */
export async function upsertInvitation(input: UpsertInvitationInput): Promise<UpsertInvitationResult> {
  const email = normalizeEmail(input.email);
  const now = input.now ?? new Date();
  const token = createInvitationToken();
  const base = {
    email,
    role: input.role,
    tokenHash: invitationTokenDigest(token),
    status: "pending" as const,
    invitedById: input.inviter.id,
    invitedByName: input.inviter.name,
    invitedByEmail: input.inviter.email,
    expiresAt: invitationExpiry(now),
    lastSentAt: now,
    acceptedAt: null,
    acceptedById: null,
    acceptedByName: null,
    revokedAt: null,
    revokedByName: null,
  };
  // Upsert por la clave única (correo + empresa): dos invitaciones simultáneas
  // del mismo correo no pueden duplicar la fila.
  const existing = await db.teamInvitation.findUnique({
    where: { organizationId_email: { organizationId: input.organizationId, email } },
    select: { id: true },
  });
  if (existing) {
    const invitation = await db.teamInvitation.update({
      where: { id: existing.id },
      data: { ...base, sentCount: { increment: 1 } },
    });
    return { invitation, token, created: false };
  }
  try {
    const invitation = await db.teamInvitation.create({
      data: { id: randomUUID(), organizationId: input.organizationId, ...base, sentCount: 1 },
    });
    return { invitation, token, created: true };
  } catch (error) {
    // Otra invitación del mismo correo ganó la carrera: se actualiza la suya.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    const invitation = await db.teamInvitation.update({
      where: { organizationId_email: { organizationId: input.organizationId, email } },
      data: { ...base, sentCount: { increment: 1 } },
    });
    return { invitation, token, created: false };
  }
}

/** Último intento de correo registrado para una invitación (historial `MailLog`). */
export type InvitationLastMail = { status: string; error: string | null; sentAt: Date };

export function invitationRow(
  invitation: TeamInvitation,
  lastMail: InvitationLastMail | null,
  now: Date = new Date(),
): AdminTeamInvitation {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: effectiveInvitationStatus(invitation, now),
    invitedByName: invitation.invitedByName,
    invitedByEmail: invitation.invitedByEmail,
    expiresAt: invitation.expiresAt.toISOString(),
    lastSentAt: invitation.lastSentAt?.toISOString() ?? null,
    sentCount: invitation.sentCount,
    createdAt: invitation.createdAt.toISOString(),
    lastMail: lastMail ? { status: lastMail.status, error: lastMail.error, sentAt: lastMail.sentAt.toISOString() } : null,
  };
}

/** Resultado de aceptar una invitación (la sesión la abre el route handler). */
export type AcceptInvitationResult =
  | { ok: true; userId: string; accountCreated: boolean; organizationId: string; organization: string; role: AdminRole }
  | { ok: false; status: number; error: string };

type JoinTeamInput = {
  invitation: InvitationWithOrganization;
  /** Cuenta existente verificada; `null` cuando hay que crearla. */
  existingUserId: string | null;
  /** Nombre que queda en la cuenta nueva y en la traza de aceptación. */
  name: string;
  /** Hash ya calculado; obligatorio cuando hay que crear la cuenta. */
  passwordHash?: string;
  /** Cómo aceptó: lo guarda el detalle de auditoría. */
  method: "password" | "google";
  now: Date;
};

/** Marca la invitación, crea/reusa la cuenta y la membresía, y cierra sesiones previas. */
async function joinTeam(input: JoinTeamInput): Promise<{ userId: string; accountCreated: boolean }> {
  const { invitation, now } = input;
  try {
    return await db.$transaction(async (tx: Prisma.TransactionClient) => {
      const claimed = await tx.teamInvitation.updateMany({
        where: { id: invitation.id, status: "pending", expiresAt: { gt: now } },
        data: { status: "accepted", acceptedAt: now, acceptedById: input.existingUserId, acceptedByName: input.name },
      });
      if (claimed.count !== 1) throw new Error("INVITATION_NOT_AVAILABLE");

      let userId = input.existingUserId;
      let accountCreated = false;
      if (!userId) {
        if (!input.passwordHash) throw new Error("INVITATION_PASSWORD_REQUIRED");
        const user = await tx.adminUser.create({
          data: {
            id: randomUUID(),
            name: input.name,
            email: invitation.email,
            passwordHash: input.passwordHash,
            role: invitation.role,
            active: true,
          },
        });
        userId = user.id;
        accountCreated = true;
      } else {
        await tx.teamInvitation.update({ where: { id: invitation.id }, data: { acceptedById: userId } });
      }

      await tx.adminMembership.upsert({
        where: { adminUserId_organizationId: { adminUserId: userId, organizationId: invitation.organizationId } },
        create: { id: randomUUID(), adminUserId: userId, organizationId: invitation.organizationId, role: invitation.role, active: true },
        update: { role: invitation.role, active: true },
      });

      // La sesión previa de esa cuenta se cierra: vuelve a entrar con su clave
      // (o con Google) y el acceso nuevo.
      await tx.adminSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      return { userId, accountCreated };
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITATION_NOT_AVAILABLE") {
      throw new InvitationNotAvailableError(invitation.id);
    }
    throw error;
  }
}

export class InvitationNotAvailableError extends Error {
  readonly invitationId: string;
  constructor(invitationId: string) {
    super("INVITATION_NOT_AVAILABLE");
    this.name = "InvitationNotAvailableError";
    this.invitationId = invitationId;
  }
}

/** Traza de la aceptación con el actor real (la persona que aceptó). */
async function auditAcceptance(
  invitation: InvitationWithOrganization,
  person: { id: string; name: string; email: string },
  method: "password" | "google",
  accountCreated: boolean,
): Promise<void> {
  await recordAudit({
    context: { organizationId: invitation.organizationId, user: { ...person, role: invitation.role } },
    action: "status",
    entity: "TeamInvitation",
    entityId: invitation.id,
    summary: `Aceptó la invitación y se sumó a «${invitation.organization.name}» como ${adminRoleLabel(invitation.role)}`,
    detail: { fields: { email: invitation.email, role: invitation.role, via: method, newAccount: accountCreated } },
  });
}

/**
 * Acepta la invitación con contraseña. Cuenta nueva: el nombre y la contraseña
 * (mínimo 8) son obligatorios. Cuenta existente: se **verifica** la contraseña
 * actual (nunca se reemplaza desde acá) y no se toca el nombre.
 */
export async function acceptInvitationWithPassword(input: {
  token: string | null | undefined;
  name?: string;
  password: string;
  now?: Date;
}): Promise<AcceptInvitationResult> {
  const now = input.now ?? new Date();
  const invitation = await findInvitationByToken(input.token);
  if (!invitation) return { ok: false, status: 404, error: "No encontramos esta invitación. Revisá el link del correo." };
  const blocked = invitationBlockedReason(invitation, now);
  if (blocked) return { ok: false, status: 410, error: blocked };

  const user = await db.adminUser.findUnique({ where: { email: invitation.email } });
  const membership = user
    ? await db.adminMembership.findUnique({
        where: { adminUserId_organizationId: { adminUserId: user.id, organizationId: invitation.organizationId } },
        select: { id: true },
      })
    : null;
  if (membership) return { ok: false, status: 409, error: "Ya sos miembro de este equipo. Entrá al panel con tu cuenta." };
  if (user && !user.active) return { ok: false, status: 409, error: "Tu cuenta está desactivada. Pedile al equipo que la reactive." };
  if (user) {
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      return { ok: false, status: 401, error: "La contraseña no coincide con tu cuenta de LedBox." };
    }
    try {
      const joined = await joinTeam({ invitation, existingUserId: user.id, name: user.name, method: "password", now });
      await auditAcceptance(invitation, { id: user.id, name: user.name, email: user.email }, "password", joined.accountCreated);
      return { ok: true, userId: joined.userId, accountCreated: false, organizationId: invitation.organizationId, organization: invitation.organization.name, role: invitation.role };
    } catch (error) {
      if (error instanceof InvitationNotAvailableError) {
        return { ok: false, status: 409, error: "La invitación cambió mientras la aceptabas. Probá de nuevo." };
      }
      throw error;
    }
  }

  const name = normalizePersonName(input.name);
  if (!personNameValid(name)) return { ok: false, status: 400, error: FIELD_MESSAGES.name };
  if (input.password.length < 8) return { ok: false, status: 400, error: "La contraseña debe tener al menos 8 caracteres." };

  const passwordHash = await hashPassword(input.password);
  try {
    const joined = await joinTeam({ invitation, existingUserId: null, name, passwordHash, method: "password", now });
    await auditAcceptance(invitation, { id: joined.userId, name, email: invitation.email }, "password", joined.accountCreated);
    return { ok: true, userId: joined.userId, accountCreated: true, organizationId: invitation.organizationId, organization: invitation.organization.name, role: invitation.role };
  } catch (error) {
    if (error instanceof InvitationNotAvailableError) {
      return { ok: false, status: 409, error: "La invitación cambió mientras la aceptabas. Probá de nuevo." };
    }
    throw error;
  }
}

/**
 * Acepta la invitación con la identidad de Google (issue #31). El correo de
 * Google tiene que ser **exactamente** el invitado —es la misma regla con la que
 * el panel entra con Google—; la cuenta se crea si todavía no existe (la
 * identidad la verificó Google y el token prueba la invitación) y si existe se
 * reusa sin tocar su contraseña. El nombre solo se usa en el alta.
 */
export async function acceptInvitationWithGoogle(input: {
  token: string | null | undefined;
  /** Correo que devolvió Google, ya normalizado. */
  email: string;
  /** Nombre de la cuenta de Google (para el alta). */
  name?: string;
  now?: Date;
}): Promise<AcceptInvitationResult> {
  const now = input.now ?? new Date();
  const invitation = await findInvitationByToken(input.token);
  if (!invitation) return { ok: false, status: 404, error: "No encontramos esta invitación. Revisá el link del correo." };
  const blocked = invitationBlockedReason(invitation, now);
  if (blocked) return { ok: false, status: 410, error: blocked };
  if (normalizeEmail(input.email) !== invitation.email) {
    return { ok: false, status: 409, error: "La cuenta de Google no coincide con el correo invitado." };
  }

  const user = await db.adminUser.findUnique({ where: { email: invitation.email } });
  if (user) {
    const membership = await db.adminMembership.findUnique({
      where: { adminUserId_organizationId: { adminUserId: user.id, organizationId: invitation.organizationId } },
      select: { id: true },
    });
    if (membership) return { ok: false, status: 409, error: "Ya sos miembro de este equipo. Entrá al panel con tu cuenta." };
    if (!user.active) return { ok: false, status: 409, error: "Tu cuenta está desactivada. Pedile al equipo que la reactive." };
  } else {
    const name = normalizePersonName(input.name);
    if (!personNameValid(name)) return { ok: false, status: 400, error: FIELD_MESSAGES.name };
  }

  const name = user ? user.name : normalizePersonName(input.name);
  try {
    const joined = await joinTeam({
      invitation,
      existingUserId: user?.id ?? null,
      name,
      method: "google",
      now,
    });
    await auditAcceptance(invitation, { id: joined.userId, name, email: invitation.email }, "google", joined.accountCreated);
    return {
      ok: true,
      userId: joined.userId,
      accountCreated: joined.accountCreated,
      organizationId: invitation.organizationId,
      organization: invitation.organization.name,
      role: invitation.role,
    };
  } catch (error) {
    if (error instanceof InvitationNotAvailableError) {
      return { ok: false, status: 409, error: "La invitación cambió mientras la aceptabas. Probá de nuevo." };
    }
    throw error;
  }
}
