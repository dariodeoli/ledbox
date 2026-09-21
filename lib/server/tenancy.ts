import type { AdminRole } from "@prisma/client";
import { getAuthenticatedAdmin, type AuthenticatedAdmin, type PublicAdminUser } from "./auth";
import { db } from "./db";
import { jsonError } from "./http";
import { roleCan, type AdminCapability } from "./permissions";

/**
 * Capa de tenancy del panel: resuelve la sesión, la empresa activa y la
 * membresía del usuario, y es la única puerta de entrada de `app/api/admin/*`.
 *
 * - Sin sesión → 401.
 * - Con sesión pero sin membresía activa (o sin empresa activa) → 403.
 * - Con membresía pero sin la capacidad pedida → 403.
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

export async function requireAdminContext(capability?: AdminCapability): Promise<AdminContextResult> {
  const auth = await getAuthenticatedAdmin();
  if (!auth) return { ok: false, response: jsonError("Unauthorized", 401) };

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
