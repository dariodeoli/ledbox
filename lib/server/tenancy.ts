import type { AdminRole } from "@prisma/client";
import { getAuthenticatedAdmin, type AuthenticatedAdmin, type PublicAdminUser } from "./auth";
import { isDemoOrganizationSlug } from "./demo-data";
import { db } from "./db";
import { jsonError } from "./http";
import { roleCan, type AdminCapability } from "./permissions";

/**
 * Capa de tenancy del panel: resuelve la sesión, la empresa activa y la
 * membresía del usuario, y es la única puerta de entrada de `app/api/admin/*`.
 *
 * - Sin sesión → 401.
 * - Sesión bloqueada por PIN (issue #21) → 423, salvo `allowLocked`.
 * - Con sesión pero sin membresía activa (o sin empresa activa) → 403.
 * - Con membresía pero sin la capacidad pedida → 403.
 * - La organización demo (issue #14) es de solo lectura: toda capacidad de
 *   escritura responde 403 «Modo demo: solo lectura», sin importar el rol.
 *
 * Toda lectura se filtra por `context.organizationId` y toda alta lo setea; así
 * ninguna consulta puede cruzar datos entre empresas.
 */

export type AdminContext = {
  /** Usuario con el rol efectivo de la empresa activa (no el rol global). */
  user: PublicAdminUser;
  session: AuthenticatedAdmin["session"];
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  role: AdminRole;
  organizationId: string;
  /** La empresa activa es la demo pública: el panel va en modo solo lectura. */
  demo: boolean;
};

export type AdminContextResult = { ok: true; context: AdminContext } | { ok: false; response: Response };

const organizationSelect = { id: true, name: true, slug: true } as const;

async function findMembership(adminUserId: string, organizationId: string | null) {
  const base = { adminUserId, active: true, organization: { active: true } } as const;
  if (organizationId) {
    const current = await db.adminMembership.findFirst({
      where: { ...base, organizationId },
      include: { organization: { select: organizationSelect } },
    });
    if (current) return current;
  }
  // Sin empresa activa (o si la membresía se desactivó) se usa la primera membresía.
  return db.adminMembership.findFirst({
    where: base,
    orderBy: { createdAt: "asc" },
    include: { organization: { select: organizationSelect } },
  });
}

/**
 * Resuelve la sesión, la empresa activa y la membresía. Por defecto una sesión
 * **bloqueada** (PIN, issue #21) no entrega datos ni permite mutar: responde 423
 * y solo los endpoints de sesión/PIN pueden operar con `allowLocked`.
 */
export async function requireAdminContext(
  capability?: AdminCapability,
  options?: { allowLocked?: boolean },
): Promise<AdminContextResult> {
  const auth = await getAuthenticatedAdmin();
  if (!auth) return { ok: false, response: jsonError("Unauthorized", 401) };

  // Bloqueo rápido del panel (issue #21): mientras la sesión está bloqueada no
  // sale ningún dato; el desbloqueo (PIN o login completo) es lo único habilitado.
  if (auth.session.lockedAt && !options?.allowLocked) {
    return { ok: false, response: jsonError("El panel está bloqueado. Desbloquealo con tu PIN.", 423) };
  }

  const membership = await findMembership(auth.user.id, auth.session.activeOrganizationId);
  if (!membership) return { ok: false, response: jsonError("Forbidden", 403) };

  if (auth.session.activeOrganizationId !== membership.organizationId) {
    await db.adminSession.update({
      where: { id: auth.session.id },
      data: { activeOrganizationId: membership.organizationId },
    });
    auth.session.activeOrganizationId = membership.organizationId;
  }

  const role = membership.role;
  const demo = isDemoOrganizationSlug(membership.organization.slug);
  // La demo es de solo lectura por contrato: el rol de la membresía es VIEWER,
  // pero además acá se corta cualquier capacidad de escritura (así el error es
  // explícito y no depende de que el rol siga siendo VIEWER).
  if (capability && demo) {
    return { ok: false, response: jsonError("Modo demo: solo lectura", 403) };
  }
  if (capability && !roleCan(role, capability)) {
    return { ok: false, response: jsonError("Forbidden", 403) };
  }

  return {
    ok: true,
    context: {
      user: { id: auth.user.id, name: auth.user.name, email: auth.user.email, role },
      session: auth.session,
      organization: membership.organization,
      role,
      organizationId: membership.organizationId,
      demo,
    },
  };
}

export type AdminOrganization = {
  id: string;
  name: string;
  slug: string;
  role: AdminRole;
};

/** Empresas activas a las que pertenece el usuario (para el selector del panel). */
export async function listAdminOrganizations(adminUserId: string): Promise<AdminOrganization[]> {
  const memberships = await db.adminMembership.findMany({
    where: { adminUserId, active: true, organization: { active: true } },
    orderBy: { createdAt: "asc" },
    include: { organization: { select: organizationSelect } },
  });
  return memberships.map((membership) => ({ ...membership.organization, role: membership.role }));
}

/** Cambia la empresa activa de la sesión validando que exista membresía activa. */
export async function setActiveOrganization(
  context: AdminContext,
  organizationId: string,
): Promise<AdminOrganization | null> {
  const membership = await db.adminMembership.findFirst({
    where: { adminUserId: context.user.id, organizationId, active: true, organization: { active: true } },
    include: { organization: { select: organizationSelect } },
  });
  if (!membership) return null;
  await db.adminSession.update({
    where: { id: context.session.id },
    data: { activeOrganizationId: membership.organizationId },
  });
  return { ...membership.organization, role: membership.role };
}

/** Primera empresa activa del usuario (se fija como activa al iniciar sesión). */
export async function resolveActiveOrganizationId(adminUserId: string): Promise<string | null> {
  const membership = await db.adminMembership.findFirst({
    where: { adminUserId, active: true, organization: { active: true } },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true },
  });
  return membership?.organizationId ?? null;
}

/** Organización por defecto para los endpoints públicos (leads y cotizaciones). */
export async function resolveDefaultOrganizationId(): Promise<string | null> {
  const slug = (process.env.DEFAULT_ORGANIZATION_SLUG || "ledbox").trim();
  const bySlug = slug
    ? await db.organization.findFirst({ where: { slug, active: true }, select: { id: true } })
    : null;
  if (bySlug) return bySlug.id;
  const fallback = await db.organization.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return fallback?.id ?? null;
}
